use super::*;
use axum::{
    body::Body,
    extract::{rejection::JsonRejection, Path as Param, Query},
    http::HeaderMap,
};
use dartclip_core::models::{CaptionRequest, CLIP_TRANSCRIPT_MAX};
use rusqlite::params;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/clips/recent", get(recent))
        .route("/api/clips/{id}", axum::routing::delete(remove))
        .route("/api/clips/{id}/stream", get(stream))
        .route("/api/clips/{id}/thumbnail", get(thumbnail))
        .route("/api/clips/{id}/download", get(download))
        .route("/api/clips/{id}/caption", post(caption))
}

/// Stored paths may be absolute (imported data) or relative to the clips root.
fn checked_path(root: &Path, path: &str) -> ApiResult<PathBuf> {
    let path = Path::new(path);
    let joined = if path.is_absolute() {
        path.to_owned()
    } else {
        root.join(path)
    };
    if joined == root
        || !joined.starts_with(root)
        || joined
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(ApiError::missing());
    }
    let resolved = joined.canonicalize()?;
    if !resolved.starts_with(root) || !resolved.is_file() {
        return Err(ApiError::missing());
    }
    Ok(resolved)
}

pub(crate) fn remove_file(root: &Path, path: &str) -> ApiResult<()> {
    let path = match checked_path(root, path) {
        Ok(path) => path,
        Err(ApiError(StatusCode::NOT_FOUND, _)) => return Ok(()),
        Err(err) => return Err(err),
    };
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

async fn recent(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult<Json<Vec<Value>>> {
    let limit = query
        .get("limit")
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|n| *n != 0)
        .unwrap_or(8)
        .clamp(1, 24);
    let db = state.db();
    let mut stmt = db.prepare("SELECT c.*, j.url AS job_url,j.aspect_ratio FROM clips c JOIN jobs j ON j.id=c.job_id WHERE j.status='done' ORDER BY c.created_at DESC,c.rowid DESC LIMIT ?")?;
    let rows = stmt.query_map([limit], |row| {
        let mut clip = db::clip(row)?;
        clip["job"] = json!({"id":row.get::<_,String>("job_id")?,"url":row.get::<_,String>("job_url")?,"aspectRatio":row.get::<_,String>("aspect_ratio")?});
        Ok(clip)
    })?.collect::<rusqlite::Result<_>>()?;
    Ok(Json(rows))
}

fn clip_file(state: &AppState, id: &str) -> ApiResult<(String, String)> {
    Ok(state.db().query_row(
        "SELECT file_path,title FROM clips WHERE id=?",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?)
}

pub(crate) async fn local_path(
    State(state): State<AppState>,
    Param(id): Param<String>,
) -> ApiResult<Json<Value>> {
    let (path, _) = clip_file(&state, &id)?;
    let path = checked_path(&state.0.config.clips_dir, &path)?;
    Ok(Json(json!({"path":path})))
}
async fn stream(
    State(state): State<AppState>,
    Param(id): Param<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let (path, _) = clip_file(&state, &id)?;
    serve(
        &state.0.config.clips_dir,
        &path,
        "video/mp4",
        &headers,
        None,
    )
    .await
}
fn thumbnail_path(root: &Path, id: &str) -> Option<PathBuf> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        return None;
    }
    Some(root.join(".thumbs").join(format!("{id}.jpg")))
}

pub(crate) fn remove_thumbnail(root: &Path, id: &str) {
    if let Some(path) = thumbnail_path(root, id) {
        if path
            .parent()
            .is_some_and(|dir| dir.symlink_metadata().is_ok_and(|meta| meta.is_dir()))
        {
            let _ = std::fs::remove_file(path);
        }
    }
}

async fn thumbnail(State(state): State<AppState>, Param(id): Param<String>) -> ApiResult<Response> {
    let root = &state.0.config.clips_dir;
    let cache = thumbnail_path(root, &id).ok_or_else(ApiError::missing)?;
    let (path, _) = clip_file(&state, &id)?;
    let source = checked_path(root, &path)?;
    let source_mtime = tokio::fs::metadata(&source).await?.modified()?;
    let dir = cache.parent().unwrap();
    tokio::fs::create_dir_all(dir).await?;
    if !tokio::fs::symlink_metadata(dir).await?.is_dir() {
        return Err(ApiError::missing());
    }

    let fresh = tokio::fs::symlink_metadata(&cache).await.is_ok_and(|meta| {
        meta.is_file() && meta.len() > 0 && meta.modified().is_ok_and(|mtime| mtime >= source_mtime)
    });
    if !fresh {
        let ffmpeg = tools_api::find_tool(&state.0.config.data_dir, "ffmpeg")
            .ok_or_else(|| ApiError::unavailable("FFmpeg is not installed"))?;
        let tmp = tempfile::Builder::new().suffix(".jpg").tempfile_in(dir)?;
        let mut cmd = tokio::process::Command::new(ffmpeg);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let output = cmd
            .kill_on_drop(true)
            .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
            .arg(&source)
            .args([
                "-frames:v",
                "1",
                "-vf",
                "scale='min(540,iw):-2'",
                "-q:v",
                "4",
            ])
            .arg(tmp.path())
            .output()
            .await?;
        if !output.status.success() || tmp.path().metadata()?.len() == 0 {
            return Err(anyhow::anyhow!(
                "FFmpeg did not produce a thumbnail: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )
            .into());
        }

        // Serialize publication with clip/job deletion so an in-flight extraction cannot
        // recreate the thumbnail after its clip has been deleted.
        let db = state.db();
        db.query_row(
            "SELECT 1 FROM clips WHERE id=? AND file_path=?",
            params![id, path],
            |_| Ok(()),
        )?;
        tmp.persist(&cache).map_err(|err| err.error)?;
    }

    let bytes = tokio::fs::read(cache).await?;
    Ok((
        [
            (header::CONTENT_TYPE, "image/jpeg"),
            (header::CACHE_CONTROL, "private, max-age=3600"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response())
}

async fn download(State(state): State<AppState>, Param(id): Param<String>) -> ApiResult<Response> {
    let (path, title) = clip_file(&state, &id)?;
    let name: String = title
        .chars()
        .take(80)
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let name = if name.trim_matches('_').is_empty() {
        "clip"
    } else {
        &name
    };
    let response = serve(
        &state.0.config.clips_dir,
        &path,
        "video/mp4",
        &HeaderMap::new(),
        Some(&format!("{name}.mp4")),
    )
    .await?;
    let db = state.db();
    if db.execute(
        "UPDATE clips SET downloaded_at=?2 WHERE id=?1 AND downloaded_at IS NULL",
        params![id, now()],
    )? != 0
    {
        if let Ok(job) = db.query_row("SELECT job_id FROM clips WHERE id=?", [&id], |r| {
            r.get::<_, String>(0)
        }) {
            jobs::publish(&state, &db, &job);
        }
    }
    Ok(response)
}
async fn remove(State(state): State<AppState>, Param(id): Param<String>) -> ApiResult<StatusCode> {
    let db = state.db();
    let (path, job): (String, String) = db.query_row(
        "SELECT file_path,job_id FROM clips WHERE id=?",
        [&id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    remove_file(&state.0.config.clips_dir, &path)?;
    db.execute("DELETE FROM clips WHERE id=?", [&id])?;
    remove_thumbnail(&state.0.config.clips_dir, &id);
    jobs::publish(&state, &db, &job);
    Ok(StatusCode::NO_CONTENT)
}
async fn caption(
    State(state): State<AppState>,
    Param(id): Param<String>,
    body: Result<Json<Value>, JsonRejection>,
) -> ApiResult<Json<Value>> {
    let Json(raw) = body.map_err(ApiError::bad)?;
    if !raw["language"].is_null() && !matches!(raw["language"].as_str(), Some("auto" | "id" | "en"))
    {
        return Err(ApiError::bad("Unknown caption language"));
    }
    let (job, request) = state.db().query_row("SELECT c.job_id,c.title,c.transcript,c.caption,j.caption_language,j.description,j.custom_hashtags_json FROM clips c JOIN jobs j ON c.job_id=j.id WHERE c.id=?", [&id], |r| {
        let tags: String = r.get(6)?;
        let lang: String = r.get(4)?;
        let transcript: Option<String> = r.get(2)?;
        Ok((r.get::<_,String>(0)?, CaptionRequest::from_value(&json!({"title":r.get::<_,String>(1)?, "transcript":transcript.map(|s| s.chars().take(CLIP_TRANSCRIPT_MAX).collect::<String>()),"currentCaption":r.get::<_,Option<String>>(3)?, "language":raw["language"].as_str().unwrap_or(&lang),"description":r.get::<_,Option<String>>(5)?,"customHashtags":serde_json::from_str::<Value>(&tags).unwrap_or_default()}))))
    })?;
    let result = settings::caption(&state, &request).await?;
    let db = state.db();
    let tags = serde_json::to_string(&result.hashtags).map_err(anyhow::Error::from)?;
    let platforms =
        serde_json::to_string(&result.platform_captions).map_err(anyhow::Error::from)?;
    if db.execute(
        "UPDATE clips SET caption=?2,hashtags_json=?3,platform_captions_json=?4 WHERE id=?1",
        params![id, result.caption, tags, platforms],
    )? == 0
    {
        return Err(ApiError::missing());
    }
    jobs::publish(&state, &db, &job);
    Ok(Json(
        json!({"caption":result.caption,"hashtags":result.hashtags,"platformCaptions":result.platform_captions}),
    ))
}

fn byte_range(raw: &str, size: u64) -> Option<Result<(u64, u64), ()>> {
    let spec = raw.strip_prefix("bytes=")?.trim();
    if spec.contains(',') {
        return None;
    }
    let (start, end) = match spec.split_once('-') {
        Some(v) => v,
        None => return Some(Err(())),
    };
    Some((|| {
        let last = size.checked_sub(1).ok_or(())?;
        if start.is_empty() {
            let n: u64 = end.parse().map_err(|_| ())?;
            if n == 0 {
                return Err(());
            }
            return Ok((size.saturating_sub(n), last));
        }
        let start: u64 = start.parse().map_err(|_| ())?;
        let end = if end.is_empty() {
            last
        } else {
            end.parse::<u64>().map_err(|_| ())?.min(last)
        };
        if start > end {
            return Err(());
        }
        Ok((start, end))
    })())
}

pub(crate) async fn serve(
    root: &Path,
    path: &str,
    mime: &str,
    headers: &HeaderMap,
    attachment: Option<&str>,
) -> ApiResult<Response> {
    let path = checked_path(root, path)?;
    let mut file = tokio::fs::File::open(path).await?;
    let size = file.metadata().await?.len();
    let mut response = Response::builder()
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_TYPE, mime)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    if let Some(name) = attachment {
        response = response.header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{name}\""),
        );
    }
    let (start, len) = match headers
        .get(header::RANGE)
        .and_then(|h| h.to_str().ok())
        .and_then(|raw| byte_range(raw, size))
    {
        None => (0, size),
        Some(Ok((start, end))) => {
            response = response
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
            (start, end - start + 1)
        }
        Some(Err(())) => {
            return Ok(response
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .header(header::CONTENT_LENGTH, 0)
                .body(Body::empty())
                .map_err(anyhow::Error::from)?)
        }
    };
    if start != 0 {
        file.seek(std::io::SeekFrom::Start(start)).await?;
    }
    Ok(response
        .header(header::CONTENT_LENGTH, len)
        .body(Body::from_stream(ReaderStream::new(file.take(len))))
        .map_err(anyhow::Error::from)?)
}
