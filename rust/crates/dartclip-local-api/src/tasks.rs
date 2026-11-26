use super::*;
use axum::{
    extract::{rejection::JsonRejection, Path as Param},
    http::HeaderMap,
};
use dartclip_core::models::AspectRatio;
use std::time::{Duration, Instant};

const TTL: Duration = Duration::from_secs(3600);

pub(crate) struct Task {
    view: Value,
    finished: Option<Instant>,
}
impl Task {
    fn expired(&self) -> bool {
        self.finished.is_some_and(|t| t.elapsed() >= TTL)
    }
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/previews", post(create_preview))
        .route("/api/previews/{id}", get(preview))
        .route("/api/frames", post(create_frame))
        .route("/api/frames/{id}", get(frame))
        .route("/api/frames/{id}/image", get(image))
        .route("/api/briefs/expand", post(expand))
        .route("/api/briefs/history", get(history).post(record))
        .route(
            "/api/briefs/history/{id}",
            axum::routing::delete(remove_brief),
        )
}
fn insert(map: &RwLock<HashMap<String, Task>>, id: &str, view: Value) {
    let mut map = map.write().unwrap();
    map.retain(|_, task| !task.expired());
    map.insert(
        id.into(),
        Task {
            view,
            finished: None,
        },
    );
}
fn view(map: &RwLock<HashMap<String, Task>>, id: &str) -> ApiResult<Value> {
    Ok(map
        .read()
        .unwrap()
        .get(id)
        .filter(|t| !t.expired())
        .ok_or_else(ApiError::missing)?
        .view
        .clone())
}
fn running(map: &RwLock<HashMap<String, Task>>, id: &str) {
    if let Some(task) = map.write().unwrap().get_mut(id) {
        task.view["status"] = json!("running");
    }
}
fn finish(map: &RwLock<HashMap<String, Task>>, id: &str, result: anyhow::Result<Value>) {
    let mut map = map.write().unwrap();
    if let Some(task) = map.get_mut(id) {
        task.finished = Some(Instant::now());
        match result {
            Ok(result) => {
                task.view["status"] = json!("done");
                if let Value::Object(fields) = result {
                    for (key, val) in fields {
                        task.view[key] = val;
                    }
                }
            }
            Err(err) => {
                task.view["status"] = json!("failed");
                task.view["error"] = json!(err.to_string());
            }
        }
    }
}
fn slot(semaphore: &Arc<Semaphore>, message: &str) -> ApiResult<tokio::sync::OwnedSemaphorePermit> {
    semaphore
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, message.into()))
}
async fn create_preview(
    State(state): State<AppState>,
    body: Result<Json<Value>, JsonRejection>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let Json(mut raw) = body.map_err(ApiError::bad)?;
    raw["url"] = json!(source_url(&raw["url"])?);
    let transcript_source = jobs::validate_preview(&raw)?;
    let mut req: PreviewRequest = serde_json::from_value(raw).map_err(ApiError::bad)?;
    req.transcript_source = transcript_source;
    let permit = slot(&state.0.preview_slots, "Preview queue is busy")?;
    let id = id();
    insert(
        &state.0.previews,
        &id,
        json!({"id":id,"url":req.url,"transcriptSource":req.transcript_source,"status":"queued","description":req.description,"error":null,"candidates":null,"cues":null}),
    );
    let task_id = id.clone();
    tokio::spawn(async move {
        let _permit = permit;
        running(&state.0.previews, &task_id);
        let result = async {
            let (pipeline, llm) = state.pipeline().await?;
            if let Some(llm) = &llm {
                state.settings().tracker = Some(llm.client.status_tracker());
            }
            let result = pipeline.run_preview(&req, &state.0.stop).await?;
            Ok(serde_json::to_value(result)?)
        }
        .await;
        finish(&state.0.previews, &task_id, result);
    });
    Ok((StatusCode::CREATED, Json(json!({"id":id}))))
}
async fn preview(
    State(state): State<AppState>,
    Param(id): Param<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(view(&state.0.previews, &id)?))
}
async fn create_frame(
    State(state): State<AppState>,
    body: Result<Json<Value>, JsonRejection>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let Json(mut raw) = body.map_err(ApiError::bad)?;
    let id = id();
    raw["url"] = json!(source_url(&raw["url"])?);
    raw["outPath"] = json!(format!(".frames/{id}.jpg"));
    raw["captionSample"] = json!("Sample caption");
    if raw["captions"].is_null() {
        raw["captions"] = json!(true);
    }
    if !raw["atSec"]
        .as_f64()
        .is_some_and(|at| (0.0..=36000.).contains(&at))
        || (!raw["reframe"].is_null()
            && !matches!(
                raw["reframe"].as_str(),
                Some("face_tracking" | "blurred_fill" | "black_bars")
            ))
    {
        return Err(ApiError::bad("Invalid frame request"));
    }
    let mut req: FrameRequest = serde_json::from_value(raw).map_err(ApiError::bad)?;
    if req.aspect_ratio != AspectRatio::Portrait {
        req.two_speakers = false;
        req.facecam = false;
    }
    if req.two_speakers {
        req.facecam = false;
    }
    let permit = slot(
        &state.0.frame_slots,
        "Frame preview is already being rendered",
    )?;
    insert(
        &state.0.frames,
        &id,
        json!({"id":id,"status":"queued","atSec":req.at_sec}),
    );
    let task_id = id.clone();
    tokio::spawn(async move {
        let _permit = permit;
        running(&state.0.frames, &task_id);
        let result = async {
            let (pipeline,_llm) = state.pipeline().await?;
            let result = pipeline.run_frame(&req,&state.0.stop).await?;
            Ok(json!({"width":result.width,"height":result.height,"imageUrl":format!("/api/frames/{task_id}/image")}))
        }.await;
        finish(&state.0.frames, &task_id, result);
    });
    Ok((StatusCode::CREATED, Json(json!({"id":id}))))
}
async fn frame(State(state): State<AppState>, Param(id): Param<String>) -> ApiResult<Json<Value>> {
    Ok(Json(view(&state.0.frames, &id)?))
}
async fn image(
    State(state): State<AppState>,
    Param(id): Param<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    if view(&state.0.frames, &id)?["status"] != "done" {
        return Err(ApiError::missing());
    }
    let mut response = media::serve(
        &state.0.config.clips_dir,
        &format!(".frames/{id}.jpg"),
        "image/jpeg",
        &headers,
        None,
    )
    .await?;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=3600"),
    );
    Ok(response)
}
fn brief_text<'a>(raw: &'a Value, key: &str) -> ApiResult<&'a str> {
    raw[key]
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.chars().count() <= 500)
        .ok_or_else(|| ApiError::bad(format!("{key} must be 1 to 500 characters")))
}
async fn expand(
    State(state): State<AppState>,
    body: Result<Json<Value>, JsonRejection>,
) -> ApiResult<Json<Value>> {
    let Json(raw) = body.map_err(ApiError::bad)?;
    let result = settings::expand(&state, brief_text(&raw, "brief")?).await?;
    Ok(Json(json!({"brief":result})))
}
async fn history(State(state): State<AppState>) -> ApiResult<Json<Vec<Value>>> {
    let db = state.db();
    let mut stmt =
        db.prepare("SELECT * FROM brief_history ORDER BY last_used_at DESC,rowid DESC LIMIT 30")?;
    let rows = stmt
        .query_map([], db::brief)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Json(rows))
}
async fn record(
    State(state): State<AppState>,
    body: Result<Json<Value>, JsonRejection>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let Json(raw) = body.map_err(ApiError::bad)?;
    Ok((
        StatusCode::CREATED,
        Json(db::record_brief(&state.db(), brief_text(&raw, "text")?)?),
    ))
}
async fn remove_brief(
    State(state): State<AppState>,
    Param(id): Param<String>,
) -> ApiResult<StatusCode> {
    if state
        .db()
        .execute("DELETE FROM brief_history WHERE id=?", [id])?
        == 0
    {
        return Err(ApiError::missing());
    }
    Ok(StatusCode::NO_CONTENT)
}
