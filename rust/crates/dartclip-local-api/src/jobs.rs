use super::*;
use axum::{
    extract::{rejection::JsonRejection, Path as Param},
    response::sse::{Event, KeepAlive, Sse},
};
use dartclip_core::models::{AspectRatio, ClipResult, JobMode, TranscriptSource};
use rusqlite::{params, Connection};
use std::convert::Infallible;

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/jobs", get(list).post(create))
        .route("/api/jobs/{id}", get(detail).delete(remove))
        .route("/api/jobs/{id}/events", get(events))
        .route("/api/jobs/{id}/cancel", post(cancel))
        .route("/api/jobs/{id}/retry", post(retry))
}

async fn list(State(state): State<AppState>) -> ApiResult<Json<Vec<Value>>> {
    let db = state.db();
    let mut stmt = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC")?;
    let mut jobs = stmt
        .query_map([], db::job)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for job in &mut jobs {
        db::attach_clips(&db, job)?;
    }
    Ok(Json(jobs))
}
async fn detail(State(state): State<AppState>, Param(id): Param<String>) -> ApiResult<Json<Value>> {
    Ok(Json(db::snapshot(&state.db(), &id)?))
}

fn validate_params(raw: &Value) -> ApiResult<()> {
    for (key, min, max) in [
        ("clipCount", 1, 10),
        ("targetDurationSec", 15, 180),
        ("maxSourceSec", 60, 36000),
    ] {
        if !raw[key].is_null() && !raw[key].as_u64().is_some_and(|n| (min..=max).contains(&n)) {
            return Err(ApiError::bad(format!(
                "{key} must be an integer between {min} and {max}"
            )));
        }
    }
    if !raw["description"].is_null()
        && !raw["description"]
            .as_str()
            .is_some_and(|s| s.trim().chars().count() <= 500)
    {
        return Err(ApiError::bad("description must be at most 500 characters"));
    }
    Ok(())
}
pub(crate) fn validate_preview(raw: &Value) -> ApiResult<TranscriptSource> {
    validate_params(raw)?;
    transcript_source(&raw["transcriptSource"])
}

fn transcript_source(value: &Value) -> ApiResult<TranscriptSource> {
    match value.as_str() {
        Some("youtube") => Ok(TranscriptSource::Youtube),
        Some("auto") => Ok(TranscriptSource::Auto),
        Some("live_chat_stt") => Ok(TranscriptSource::LiveChatStt),
        None if value.is_null() => Ok(TranscriptSource::default()),
        _ => Err(ApiError::bad(
            "transcriptSource must be youtube, auto, or live_chat_stt",
        )),
    }
}

async fn create(
    State(state): State<AppState>,
    body: Result<Json<Value>, JsonRejection>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let Json(mut raw) = body.map_err(ApiError::bad)?;
    let url = source_url(&raw["url"])?;
    validate_params(&raw)?;
    let source = transcript_source(&raw["transcriptSource"])?;
    let id = id();
    raw["jobId"] = json!(id);
    raw["url"] = json!(url);
    raw["params"] =
        json!({"clipCount":raw["clipCount"],"targetDurationSec":raw["targetDurationSec"]});
    if !raw["aspectRatio"].is_null()
        && !matches!(raw["aspectRatio"].as_str(), Some("9:16" | "1:1" | "16:9"))
    {
        return Err(ApiError::bad("Invalid aspect ratio"));
    }
    let db = state.db();
    // Only library IDs are accepted; never use a client-supplied path for rendering.
    let watermark = assets::resolve_watermarks(&db, &raw["watermark"])?;
    let outro = assets::resolve_outro(&db, &raw["outro"])?;
    raw["watermark"] = watermark.clone();
    raw["watermarks"] = Value::Null;
    raw["outro"] = outro.clone();
    let mut job = JobData::from_json(raw).map_err(ApiError::bad)?;
    job.transcript_source = source;
    if job.mode == JobMode::Manual {
        if job.ranges.is_empty()
            || job.ranges.len() > 10
            || job.ranges.iter().any(|r| r.start < 0. || r.end <= r.start)
        {
            return Err(ApiError::bad("Manual jobs require valid time ranges"));
        }
        job.max_source_sec = None;
        job.description = None;
    } else {
        job.ranges.clear();
    }
    if job.aspect_ratio != AspectRatio::Portrait {
        job.two_speakers = false;
        job.facecam = false;
    }
    if job.two_speakers {
        job.facecam = false;
    }
    if !job.captions {
        job.caption_style = None;
    }
    let value = enqueue(&state, &db, job, &watermark, &outro)?;
    if let Some(brief) = value["description"].as_str() {
        let _ = db::record_brief(&db, brief);
    }
    Ok((StatusCode::CREATED, Json(value)))
}

fn enqueue(
    state: &AppState,
    db: &Connection,
    job: JobData,
    watermark: &Value,
    outro: &Value,
) -> ApiResult<Value> {
    if state.0.stop.is_cancelled() {
        return Err(ApiError::unavailable("Local API is shutting down"));
    }
    let v = serde_json::to_value(&job).map_err(anyhow::Error::from)?;
    let ranges = (!job.ranges.is_empty()).then(|| v["ranges"].to_string());
    let style = job
        .caption_style
        .as_ref()
        .map(|_| v["captionStyle"].to_string());
    let at = now();
    db.execute("INSERT INTO jobs (id,url,mode,reframe,captions,two_speakers,facecam,aspect_ratio,caption_language,custom_hashtags_json,max_source_sec,description,clip_count,target_duration_sec,ranges_json,caption_style_json,watermark_json,outro_json,hook_banner,normalize_audio,created_at,updated_at,transcript_source) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?21,?22)", params![job.job_id, job.url, v["mode"].as_str(), v["reframe"].as_str(), job.captions, job.two_speakers, job.facecam, v["aspectRatio"].as_str(), job.caption_language, v["customHashtags"].to_string(), job.max_source_sec, job.description, job.params.clip_count, job.params.target_duration_sec, ranges, style, watermark.to_string(), outro.to_string(), job.hook_banner, job.normalize_audio, at, v["transcriptSource"].as_str()])?;
    let initial = db::snapshot(db, &job.job_id)?;
    state
        .0
        .job_cancel_tokens
        .write()
        .unwrap()
        .insert(job.job_id.clone(), state.0.stop.child_token());
    if state.0.queue.send(job).is_err() {
        let id = initial["id"].as_str().unwrap();
        state.0.job_cancel_tokens.write().unwrap().remove(id);
        db.execute("UPDATE jobs SET status='failed', error='Local worker unavailable', finished_at=?2, updated_at=?2 WHERE id=?1", params![id, now()])?;
        return Err(ApiError::unavailable("Local worker unavailable"));
    }
    Ok(initial)
}

async fn retry(
    State(state): State<AppState>,
    Param(old_id): Param<String>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let db = state.db();
    let mut raw = db::snapshot(&db, &old_id)?;
    if !matches!(raw["status"].as_str(), Some("failed" | "cancelled")) {
        return Err(ApiError::bad(
            "Only failed or cancelled jobs can be retried",
        ));
    }
    raw["jobId"] = json!(id());
    raw["params"] =
        json!({"clipCount":raw["clipCount"],"targetDurationSec":raw["targetDurationSec"]});
    let job = JobData::from_json(raw.clone()).map_err(ApiError::bad)?;
    Ok((
        StatusCode::CREATED,
        Json(enqueue(&state, &db, job, &raw["watermark"], &raw["outro"])?),
    ))
}

pub(crate) fn publish(state: &AppState, db: &Connection, id: &str) {
    if let Some(tx) = state.0.job_events_tx.read().unwrap().get(id) {
        if let Ok(value) = db::snapshot(db, id) {
            let _ = tx.send(value);
        }
    }
}
fn terminal(value: &Value) -> bool {
    matches!(
        value["status"].as_str(),
        Some("done" | "failed" | "cancelled")
    )
}

async fn events(State(state): State<AppState>, Param(id): Param<String>) -> ApiResult<Response> {
    let (initial, mut rx) = {
        let db = state.db();
        let initial = db::snapshot(&db, &id)?;
        let rx = (!terminal(&initial)).then(|| {
            state
                .0
                .job_events_tx
                .write()
                .unwrap()
                .entry(id.clone())
                .or_insert_with(|| broadcast::channel(32).0)
                .subscribe()
        });
        (initial, rx)
    };
    let stream = async_stream::stream! {
        let initial_terminal = terminal(&initial);
        yield Ok::<_, Infallible>(Event::default().data(initial.to_string()));
        if !initial_terminal {
            if let Some(rx) = &mut rx {
                loop {
                    let value = tokio::select! {
                        _ = state.0.stop.cancelled() => break,
                        value = rx.recv() => match value {
                            Ok(v) => v,
                            Err(broadcast::error::RecvError::Lagged(_)) => match db::snapshot(&state.db(), &id) { Ok(v) => v, Err(_) => break },
                            Err(broadcast::error::RecvError::Closed) => break,
                        }
                    };
                    let done = terminal(&value);
                    yield Ok(Event::default().data(value.to_string()));
                    if done { break; }
                }
            }
        }
    };
    Ok(Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response())
}

fn set_cancelled(state: &AppState, db: &Connection, id: &str) -> ApiResult<()> {
    let changed = db.execute("UPDATE jobs SET status='cancelled',finished_at=?2,updated_at=?2 WHERE id=?1 AND status IN ('queued','running')", params![id,now()])?;
    if changed != 0 {
        if let Some(token) = state.0.job_cancel_tokens.read().unwrap().get(id) {
            token.cancel();
        }
        publish(state, db, id);
        state.0.job_events_tx.write().unwrap().remove(id);
    }
    Ok(())
}
async fn cancel(
    State(state): State<AppState>,
    Param(id): Param<String>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let db = state.db();
    set_cancelled(&state, &db, &id)?;
    Ok((StatusCode::CREATED, Json(db::snapshot(&db, &id)?)))
}
async fn remove(State(state): State<AppState>, Param(id): Param<String>) -> ApiResult<StatusCode> {
    let db = state.db();
    db.query_row("SELECT 1 FROM jobs WHERE id=?", [&id], |_| Ok(()))?;
    set_cancelled(&state, &db, &id)?;
    let clips = db
        .prepare("SELECT id,file_path FROM clips WHERE job_id=?")?
        .query_map([&id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let root = &state.0.config.clips_dir;
    for (_, path) in &clips {
        media::remove_file(root, path)?;
    }
    db.execute("DELETE FROM jobs WHERE id=?", [&id])?;
    for (clip_id, _) in clips {
        media::remove_thumbnail(root, &clip_id);
    }
    state.0.job_cancel_tokens.write().unwrap().remove(&id);
    state.0.job_events_tx.write().unwrap().remove(&id);
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn spawn_worker(state: &AppState, mut rx: mpsc::UnboundedReceiver<JobData>) {
    let weak = Arc::downgrade(&state.0);
    let stop = state.0.stop.clone();
    tokio::spawn(async move {
        loop {
            let job = tokio::select! { biased; _ = stop.cancelled() => break, next = rx.recv() => match next { Some(job) => job, None => break } };
            let Some(inner) = weak.upgrade() else {
                break;
            };
            run(AppState(inner), job).await;
        }
    });
}

async fn run(state: AppState, job: JobData) {
    let id = job.job_id.clone();
    let Some(token) = state.0.job_cancel_tokens.read().unwrap().get(&id).cloned() else {
        return;
    };
    let result: ApiResult<()> = async {
        {
            let db = state.db();
            if db.execute("UPDATE jobs SET status='running',started_at=?2,updated_at=?2 WHERE id=?1 AND status='queued'", params![id, now()])? == 0 { return Ok(()); }
            publish(&state, &db, &id);
        }
        let (pipeline, llm) = state.pipeline().await?;
        if let Some(llm) = &llm { state.settings().tracker = Some(llm.client.status_tracker()); }
        let mut progress_error = None;
        let result = pipeline.run_job(&job, &token, |progress| {
            let db = state.db();
            let persisted: ApiResult<()> = (|| {
                let changed = db.execute("UPDATE jobs SET stage=?2,progress=?3,message=?4,updated_at=?5 WHERE id=?1 AND status='running'", params![id, progress.stage, progress.percent.clamp(0.,100.), progress.message, now()])?;
                if changed != 0 {
                    if let Some(clip) = progress.clip { insert_clip(&db, &id, &clip)?; }
                    publish(&state, &db, &id);
                }
                Ok(())
            })();
            if let Err(error) = persisted { progress_error = Some(error); }
            std::future::ready(())
        }).await?;
        if let Some(error) = progress_error { return Err(error); }
        let mut db = state.db();
        let tx = db.transaction()?;
        if tx.execute("UPDATE jobs SET status='done',stage='save',progress=100,updated_at=?2,finished_at=?2 WHERE id=?1 AND status='running'", params![id,now()])? != 0 {
            for clip in result.clips {
                let (tags, platforms) = clip_json(&clip)?;
                // Progress already inserted the clip. A user can delete it before captions finish.
                tx.execute("UPDATE clips SET caption=?3,hashtags_json=?4,platform_captions_json=?5 WHERE job_id=?1 AND file_path=?2", params![id, clip_path(&id, &clip), clip.caption, tags, platforms])?;
            }
            tx.commit()?;
            publish(&state, &db, &id);
        }
        Ok(())
    }.await;
    let db = state.db();
    if let Err(err) = result {
        let status = if token.is_cancelled() {
            "cancelled"
        } else {
            "failed"
        };
        let _ = db.execute("UPDATE jobs SET status=?2,error=?3,updated_at=?4,finished_at=?4 WHERE id=?1 AND status='running'", params![id, status, (!token.is_cancelled()).then_some(err.1), now()]);
        publish(&state, &db, &id);
    }
    state.0.job_cancel_tokens.write().unwrap().remove(&id);
    state.0.job_events_tx.write().unwrap().remove(&id);
    if matches!(
        db::snapshot(&db, &id),
        Err(ApiError(StatusCode::NOT_FOUND, _))
    ) {
        // The pipeline may have written another file just as the job was deleted.
        // IDs in the worker are generated locally, so this only targets its output directory.
        let root = &state.0.config.clips_dir;
        if let Ok(path) = root.join(&id).canonicalize() {
            if path == root.join(&id) {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }
}

fn clip_path(job: &str, clip: &ClipResult) -> String {
    format!("{job}/{}", clip.file)
}

fn clip_json(clip: &ClipResult) -> ApiResult<(String, String)> {
    Ok((
        serde_json::to_string(&clip.hashtags).map_err(anyhow::Error::from)?,
        serde_json::to_string(&clip.platform_captions).map_err(anyhow::Error::from)?,
    ))
}

fn insert_clip(db: &Connection, job: &str, clip: &ClipResult) -> ApiResult<()> {
    let path = clip_path(job, clip);
    let (tags, platforms) = clip_json(clip)?;
    db.execute("INSERT INTO clips (id,job_id,title,start_sec,end_sec,file_path,caption,hashtags_json,platform_captions_json,transcript,viral_score,hook_text,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) ON CONFLICT(job_id,file_path) DO UPDATE SET title=excluded.title,caption=excluded.caption,hashtags_json=excluded.hashtags_json,platform_captions_json=excluded.platform_captions_json,transcript=excluded.transcript,viral_score=excluded.viral_score,hook_text=excluded.hook_text", params![id(),job,clip.title,clip.start,clip.end,path,clip.caption,tags,platforms,clip.transcript,clip.viral_score,clip.hook_text,now()])?;
    Ok(())
}
