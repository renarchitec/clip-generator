use super::*;
use axum::{
    extract::{rejection::JsonRejection, DefaultBodyLimit, Multipart, Path as Param},
    http::HeaderMap,
};
use dartclip_core::{
    models::{WatermarkChromaKey, WATERMARK_MAX_PER_JOB},
    tools::probe_media,
};
use rusqlite::{params, Connection, Row};
use std::io::{Cursor, Write};

const MIB: usize = 1024 * 1024;
const WATERMARK_DEFAULT: &str = "watermark_default";
const OUTRO_DEFAULT: &str = "outro_default";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Library {
    Watermarks,
    Outros,
}
impl Library {
    fn name(self) -> &'static str {
        if self == Self::Watermarks {
            "watermarks"
        } else {
            "outros"
        }
    }
    fn key(self) -> &'static str {
        if self == Self::Watermarks {
            WATERMARK_DEFAULT
        } else {
            OUTRO_DEFAULT
        }
    }
    fn limit(self) -> usize {
        if self == Self::Watermarks {
            25 * MIB
        } else {
            50 * MIB
        }
    }
}

// Both libraries share the transport and storage logic, but only their concrete paths
// are mounted. The library extension selects the known table, never user input.
pub(crate) fn routes() -> Router<AppState> {
    let mount = |library: Library| {
        Router::new()
            .route(
                "/",
                get(list)
                    .post(upload)
                    .layer(DefaultBodyLimit::max(library.limit() + 16 * 1024)),
            )
            .route("/default", get(get_default).put(set_default))
            .route("/{id}/file", get(file))
            .route("/{id}", axum::routing::delete(remove))
            .layer(axum::Extension(library))
    };
    Router::new()
        .nest("/api/watermarks", mount(Library::Watermarks))
        .nest("/api/outros", mount(Library::Outros))
}

struct Asset {
    id: String,
    name: String,
    path: String,
    mime: String,
    width: u32,
    height: u32,
    duration: Option<f64>,
    created: String,
}
impl Asset {
    fn read(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            path: row.get("file_path")?,
            mime: row.get("mime_type")?,
            width: row.get("width")?,
            height: row.get("height")?,
            duration: row.get("duration_sec")?,
            created: row.get("created_at")?,
        })
    }
    fn view(&self, root: &Path, library: Library) -> Value {
        let mut value = json!({"id":self.id,"name":self.name,"mimeType":self.mime,"width":self.width,"height":self.height,"durationSec":self.duration,"createdAt":self.created});
        if library == Library::Watermarks {
            value["kind"] = json!(if self.mime.starts_with("video/") {
                "video"
            } else {
                "image"
            });
            value["url"] = json!(format!("/api/watermarks/{}/file", self.id));
        } else {
            value["sizeBytes"] =
                json!(std::fs::metadata(root.join(&self.path)).map_or(0, |m| m.len()));
        }
        value
    }
}
fn lookup(db: &Connection, library: Library, id: &str) -> ApiResult<Asset> {
    Ok(db.query_row(
        &format!("SELECT * FROM {} WHERE id=?", library.name()),
        [id],
        Asset::read,
    )?)
}
async fn list(
    State(state): State<AppState>,
    axum::Extension(library): axum::Extension<Library>,
) -> ApiResult<Json<Vec<Value>>> {
    let db = state.db();
    let mut stmt = db.prepare(&format!(
        "SELECT * FROM {} ORDER BY created_at DESC, rowid DESC",
        library.name()
    ))?;
    let rows = stmt
        .query_map([], Asset::read)?
        .map(|item| item.map(|a| a.view(&state.0.config.clips_dir, library)))
        .collect::<rusqlite::Result<_>>()?;
    Ok(Json(rows))
}

fn format(
    bytes: &[u8],
    library: Library,
) -> Option<(&'static str, &'static str, Option<image::ImageFormat>)> {
    use image::ImageFormat::*;
    if library == Library::Watermarks {
        match image::guess_format(bytes) {
            Ok(Png) => return Some(("image/png", "png", Some(Png))),
            Ok(Jpeg) => return Some(("image/jpeg", "jpg", Some(Jpeg))),
            Ok(WebP) => return Some(("image/webp", "webp", Some(WebP))),
            _ => {}
        }
        if bytes.starts_with(b"\x1a\x45\xdf\xa3")
            && bytes[..bytes.len().min(4096)]
                .windows(4)
                .any(|w| w == b"webm")
        {
            return Some(("video/webm", "webm", None));
        }
    }
    if bytes.get(4..8) == Some(b"ftyp") {
        match bytes.get(8..12)? {
            b"qt  " => return Some(("video/quicktime", "mov", None)),
            b"isom" | b"iso2" | b"iso4" | b"iso5" | b"iso6" | b"mp41" | b"mp42" | b"avc1"
            | b"M4V " | b"dash" | b"MSNV" => return Some(("video/mp4", "mp4", None)),
            _ => {}
        }
    }
    None
}
async fn upload(
    State(state): State<AppState>,
    axum::Extension(library): axum::Extension<Library>,
    body: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let mut multipart = body.map_err(ApiError::bad)?;
    let mut name = None;
    let mut file = None;
    let mut original = String::new();
    while let Some(mut field) = multipart.next_field().await.map_err(ApiError::bad)? {
        match field.name() {
            Some("name") if name.is_none() => {
                let mut bytes = Vec::new();
                while let Some(chunk) = field.chunk().await.map_err(ApiError::bad)? {
                    if bytes.len() + chunk.len() > 4096 {
                        return Err(ApiError::bad("Name is too long"));
                    }
                    bytes.extend_from_slice(&chunk);
                }
                name = Some(String::from_utf8(bytes).map_err(ApiError::bad)?);
            }
            Some("file") if file.is_none() => {
                original = field
                    .file_name()
                    .unwrap_or_default()
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or_default()
                    .to_owned();
                let mut bytes = Vec::new();
                while let Some(chunk) = field.chunk().await.map_err(ApiError::bad)? {
                    if bytes.len() + chunk.len() > library.limit() {
                        return Err(ApiError::bad("Media file exceeds the upload limit"));
                    }
                    bytes.extend_from_slice(&chunk);
                }
                file = Some(bytes);
            }
            _ => return Err(ApiError::bad("Expected one file and an optional name")),
        }
    }
    let bytes = file.ok_or_else(|| ApiError::bad("Missing multipart file"))?;
    let (mime, ext, image_format) =
        format(&bytes, library).ok_or_else(|| ApiError::bad("Unsupported media format"))?;
    let fallback = Path::new(&original)
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(library.name());
    let name: String = name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback)
        .chars()
        .take(80)
        .collect();
    let root = &state.0.config.clips_dir;
    let directory = root.join(library.name());
    std::fs::create_dir_all(&directory)?;
    if directory.canonicalize()? != directory {
        return Err(ApiError::bad("Invalid media directory"));
    }
    let mut temp = tempfile::Builder::new()
        .suffix(&format!(".{ext}"))
        .tempfile_in(directory)?;
    let (width, height, duration) = if let Some(image_format) = image_format {
        if bytes.len() > 2 * MIB {
            return Err(ApiError::bad("Image watermarks are limited to 2 MB"));
        }
        let dimensions = image::ImageReader::with_format(Cursor::new(&bytes), image_format)
            .into_dimensions()
            .map_err(|_| ApiError::bad("Invalid image"))?;
        temp.write_all(&bytes)?;
        (dimensions.0, dimensions.1, None)
    } else {
        temp.write_all(&bytes)?;
        let ffprobe = tools_api::find_tool(&state.0.config.data_dir, "ffprobe")
            .ok_or_else(|| ApiError::unavailable("Install FFmpeg and FFprobe to upload videos"))?;
        let info = probe_media(ffprobe, temp.path())
            .await
            .map_err(|_| ApiError::bad("Invalid video or unreadable media information"))?;
        let range = if library == Library::Watermarks {
            0.2..=30.0
        } else {
            0.5..=20.0
        };
        if !range.contains(&info.duration) {
            return Err(ApiError::bad(format!(
                "Video duration must be between {} and {} seconds",
                range.start(),
                range.end()
            )));
        }
        (info.width, info.height, Some(info.duration))
    };
    let id = id();
    let path = format!("{}/{id}.{ext}", library.name());
    let db = state.db();
    let count: u32 = db.query_row(
        &format!("SELECT count(*) FROM {}", library.name()),
        [],
        |r| r.get(0),
    )?;
    if count >= 20 {
        return Err(ApiError::bad("The media library is limited to 20 items"));
    }
    let asset = Asset {
        id,
        name,
        path,
        mime: mime.into(),
        width,
        height,
        duration,
        created: now(),
    };
    temp.persist_noclobber(root.join(&asset.path))
        .map_err(anyhow::Error::from)?;
    if let Err(e) = db.execute(&format!("INSERT INTO {} (id,name,file_path,mime_type,width,height,duration_sec,created_at) VALUES (?,?,?,?,?,?,?,?)",library.name()), params![asset.id,asset.name,asset.path,asset.mime,asset.width,asset.height,asset.duration,asset.created]) {
        let _ = media::remove_file(root,&asset.path);
        return Err(e.into());
    }
    Ok((StatusCode::CREATED, Json(asset.view(root, library))))
}

async fn file(
    State(state): State<AppState>,
    axum::Extension(library): axum::Extension<Library>,
    Param(id): Param<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let asset = lookup(&state.db(), library, &id)?;
    media::serve(
        &state.0.config.clips_dir,
        &asset.path,
        &asset.mime,
        &headers,
        None,
    )
    .await
}

fn layers(raw: &Value) -> &[Value] {
    match raw {
        Value::Null => &[],
        Value::Array(items) => items,
        item => std::slice::from_ref(item),
    }
}
fn serialize_layers(layers: &[Value]) -> Value {
    match layers {
        [] => Value::Null,
        [one] => one.clone(),
        many => json!(many),
    }
}
fn asset_id<'a>(value: &'a Value, key: &str) -> ApiResult<&'a str> {
    value[key]
        .as_str()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| ApiError::bad(format!("Missing {key}")))
}
fn validate_watermarks(db: &Connection, raw: &Value, snapshot: bool) -> ApiResult<Vec<Value>> {
    let layers = layers(raw);
    if layers.len() > WATERMARK_MAX_PER_JOB {
        return Err(ApiError::bad("At most five watermark layers are allowed"));
    }
    layers.iter().map(|item| {
        let id = asset_id(item,"watermarkId")?;
        let asset = lookup(db,Library::Watermarks,id)?;
        let f = |key: &str, default: f64, min: f64| match &item[key] {
            Value::Null => Ok(default),
            v => v.as_f64().map(|n| n.clamp(min,1.)).ok_or_else(|| ApiError::bad(format!("Invalid {key}"))),
        };
        let mut value = json!({"watermarkId":id,"x":f("x",0.5,0.)?,"y":f("y",0.5,0.)?,"scale":f("scale",0.18,0.03)?,"opacity":f("opacity",0.8,0.1)?});
        if let Some(key) = item.get("chromaKey") {
            if !key.is_null() && !key.is_object() { return Err(ApiError::bad("Invalid chromaKey")); }
            value["chromaKey"] = if asset.mime.starts_with("video/") { json!(WatermarkChromaKey::from_value(key)) } else { Value::Null };
        }
        if snapshot { value["filePath"] = json!(asset.path); value["mimeType"] = json!(asset.mime); }
        Ok(value)
    }).collect()
}
pub(crate) fn resolve_watermarks(db: &Connection, raw: &Value) -> ApiResult<Value> {
    Ok(serialize_layers(&validate_watermarks(db, raw, true)?))
}
fn validate_outro(db: &Connection, raw: &Value, snapshot: bool) -> ApiResult<Value> {
    if raw.is_null() {
        return Ok(Value::Null);
    }
    let id = asset_id(raw, "outroId")?;
    let asset = lookup(db, Library::Outros, id)?;
    Ok(if snapshot {
        json!({"outroId":id,"filePath":asset.path,"durationSec":asset.duration})
    } else {
        json!({"outroId":id})
    })
}
pub(crate) fn resolve_outro(db: &Connection, raw: &Value) -> ApiResult<Value> {
    validate_outro(db, raw, true)
}
fn default_response(library: Library, value: Value) -> Json<Value> {
    if library == Library::Watermarks {
        Json(json!({"default":value,"defaults":layers(&value)}))
    } else {
        Json(json!({"default":value}))
    }
}
async fn get_default(
    State(state): State<AppState>,
    axum::Extension(library): axum::Extension<Library>,
) -> ApiResult<Json<Value>> {
    Ok(default_response(
        library,
        db::setting(&state.db(), library.key())?,
    ))
}
async fn set_default(
    State(state): State<AppState>,
    axum::Extension(library): axum::Extension<Library>,
    body: Result<Json<Value>, JsonRejection>,
) -> ApiResult<Json<Value>> {
    let Json(raw) = body.map_err(ApiError::bad)?;
    let db = state.db();
    let value = if library == Library::Watermarks {
        serialize_layers(&validate_watermarks(&db, &raw, false)?)
    } else {
        validate_outro(&db, &raw, false)?
    };
    db::set_setting(&db, library.key(), &value)?;
    Ok(default_response(library, value))
}
async fn remove(
    State(state): State<AppState>,
    axum::Extension(library): axum::Extension<Library>,
    Param(id): Param<String>,
) -> ApiResult<StatusCode> {
    let mut db = state.db();
    let tx = db.transaction()?;
    let asset = lookup(&tx, library, &id)?;
    let saved = db::setting(&tx, library.key())?;
    let remaining = if library == Library::Watermarks {
        serialize_layers(
            &layers(&saved)
                .iter()
                .filter(|layer| layer["watermarkId"] != id)
                .cloned()
                .collect::<Vec<_>>(),
        )
    } else if saved["outroId"] == id {
        Value::Null
    } else {
        saved.clone()
    };
    if remaining != saved {
        db::set_setting(&tx, library.key(), &remaining)?;
    }
    tx.execute(&format!("DELETE FROM {} WHERE id=?", library.name()), [&id])?;
    media::remove_file(&state.0.config.clips_dir, &asset.path)?;
    tx.commit()?;
    Ok(StatusCode::NO_CONTENT)
}
