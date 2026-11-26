//! Loopback HTTP API for the embedded DartClip desktop application.
mod assets;
mod db;
mod jobs;
mod media;
mod settings;
mod tasks;
mod tools_api;

use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use dartclip_core::{
    models::{FrameRequest, JobData, PreviewRequest},
    pipeline::{
        CancellationToken, FaceAnalyzer, FacecamBox, Pipeline, PipelineConfig, SpeakerSegment,
    },
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
};
use tokio::sync::{broadcast, mpsc, oneshot, Semaphore};
use tower_http::cors::{AllowOrigin, CorsLayer};

#[derive(Debug, Clone)]
pub struct LocalApiConfig {
    pub data_dir: PathBuf,
    pub clips_dir: PathBuf,
    pub bind_addr: SocketAddr,
    pub fonts_dir: Option<PathBuf>,
}
impl Default for LocalApiConfig {
    fn default() -> Self {
        let data_dir = std::env::var_os("DARTCLIP_DATA_DIR")
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::var_os("HOME")
                    .or_else(|| std::env::var_os("USERPROFILE"))
                    .map(PathBuf::from)
                    .unwrap_or_default()
                    .join("DartClip")
            });
        Self {
            clips_dir: data_dir.clone(),
            data_dir,
            bind_addr: ([127, 0, 0, 1], 0).into(),
            fonts_dir: None,
        }
    }
}

pub struct RunningLocalApi {
    pub addr: SocketAddr,
    pub base_url: String,
    /// Sending or dropping this sender stops accepting requests and cancels active work.
    pub shutdown: oneshot::Sender<()>,
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);
struct Inner {
    config: LocalApiConfig,
    db: Mutex<rusqlite::Connection>,
    settings: Mutex<settings::Store>,
    previews: RwLock<HashMap<String, tasks::Task>>,
    frames: RwLock<HashMap<String, tasks::Task>>,
    job_cancel_tokens: RwLock<HashMap<String, CancellationToken>>,
    job_events_tx: RwLock<HashMap<String, broadcast::Sender<Value>>>,
    queue: mpsc::UnboundedSender<JobData>,
    stop: CancellationToken,
    preview_slots: Arc<Semaphore>,
    frame_slots: Arc<Semaphore>,
    install_lock: tokio::sync::Mutex<()>,
}
impl AppState {
    /// Opens the database and starts the single job worker; requires a Tokio runtime.
    pub fn new(mut config: LocalApiConfig) -> anyhow::Result<Self> {
        std::fs::create_dir_all(&config.data_dir)?;
        std::fs::create_dir_all(&config.clips_dir)?;
        config.data_dir = config.data_dir.canonicalize()?;
        config.clips_dir = config.clips_dir.canonicalize()?;
        let db = db::open(&config.data_dir)?;
        let settings = settings::Store::open(&config.data_dir)?;
        let (queue, rx) = mpsc::unbounded_channel();
        let state = Self(Arc::new(Inner {
            config,
            db: Mutex::new(db),
            settings: Mutex::new(settings),
            previews: Default::default(),
            frames: Default::default(),
            job_cancel_tokens: Default::default(),
            job_events_tx: Default::default(),
            queue,
            stop: CancellationToken::new(),
            preview_slots: Arc::new(Semaphore::new(2)),
            frame_slots: Arc::new(Semaphore::new(1)),
            install_lock: Default::default(),
        }));
        jobs::spawn_worker(&state, rx);
        Ok(state)
    }

    fn db(&self) -> std::sync::MutexGuard<'_, rusqlite::Connection> {
        self.0.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    async fn pipeline(&self) -> anyhow::Result<(Pipeline, Option<settings::PipelineLlm>)> {
        let tools = dartclip_core::tools::ToolPaths::resolve(&self.0.config.data_dir)?;
        let mut config = PipelineConfig::new(tools, &self.0.config.clips_dir);
        config.temp_root = Some(self.0.config.data_dir.join("work"));
        config.font_dir = self.0.config.fonts_dir.clone();
        let setup = {
            let store = self.settings();
            config.video_encoder = store.encoder().to_owned();
            store.providers()
        };
        let mut pipeline = Pipeline::new(config).with_face_analyzer(Arc::new(OnnxFaceAnalyzer));
        let llm = settings::PipelineLlm::new(setup).await?;
        if let Some(llm) = &llm {
            pipeline = pipeline.with_llm(llm.client.clone());
        }
        Ok((pipeline, llm))
    }

    fn settings(&self) -> std::sync::MutexGuard<'_, settings::Store> {
        self.0.settings.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub async fn start_local_api(config: LocalApiConfig) -> anyhow::Result<RunningLocalApi> {
    anyhow::ensure!(
        config.bind_addr.ip().is_loopback(),
        "desktop API must bind to a loopback address"
    );
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    let addr = listener.local_addr()?;
    // Best-effort IPv6 loopback listener on the same port so http://localhost:<port>
    // (required by YouTube embeds instead of raw 127.0.0.1) works on both IPv4 & IPv6.
    let v6_listener = if addr.is_ipv4() {
        tokio::net::TcpListener::bind(SocketAddr::from(([0u16, 0, 0, 0, 0, 0, 0, 1], addr.port())))
            .await
            .ok()
    } else {
        None
    };
    let state = tokio::task::spawn_blocking(move || AppState::new(config)).await??;
    let stop = state.0.stop.clone();
    let (shutdown, rx) = oneshot::channel();
    let router = build_router(state);
    if let Some(v6) = v6_listener {
        let v6_router = router.clone();
        let v6_stop = stop.clone();
        tokio::spawn(async move {
            let _ = axum::serve(v6, v6_router)
                .with_graceful_shutdown(async move {
                    v6_stop.cancelled().await;
                })
                .await;
        });
    }
    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = rx.await;
                stop.cancel();
            })
            .await;
    });
    Ok(RunningLocalApi {
        addr,
        base_url: format!("http://{addr}"),
        shutdown,
    })
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/auth/me", get(|| async { Json(json!({"user":{"id":"local-desktop-user","email":"local@dartclip.desktop","name":"Local","role":"user"}})) }))
        .route("/api/auth/config", get(|| async { Json(json!({"registrationOpen":false})) }))
        .route("/api/auth/logout", post(|| async { StatusCode::NO_CONTENT }))
        .route("/api/system/runtime", get(runtime))
        .route("/api/system/llm-status", get(settings::status))
        .route("/api/system/desktop-settings", get(settings::view).patch(settings::patch))
        .route("/api/system/llm-test", post(settings::test))
        .route("/api/system/tools", get(tools_api::status))
        .route("/api/system/tools/{tool}/download", post(tools_api::download))
        .route("/api/system/clips/{id}/local-path", get(media::local_path))
        .route("/api/system/embed/youtube/{id}", get(youtube_embed))
        .route("/api/social/providers", get(empty))
        .route("/api/social/accounts", get(empty))
        .route("/api/reference-jobs", get(empty))
        .merge(jobs::routes()).merge(media::routes()).merge(tasks::routes()).merge(assets::routes())
        .with_state(state)
        .layer(middleware::from_fn(check_origin))
        .layer(CorsLayer::very_permissive().allow_origin(AllowOrigin::predicate(|origin, _| allowed_origin(origin)))
            .expose_headers([header::ACCEPT_RANGES, header::CONTENT_RANGE, header::CONTENT_LENGTH, header::CONTENT_DISPOSITION]))
}

// CORS alone does not stop cross-origin form submissions or DNS rebinding to loopback.
async fn check_origin(request: Request, next: Next) -> Response {
    if request
        .headers()
        .get(header::ORIGIN)
        .is_some_and(|origin| !allowed_origin(origin))
        || request.headers().get(header::HOST).is_some_and(|host| {
            host.to_str()
                .ok()
                .and_then(|host| host.parse::<axum::http::uri::Authority>().ok())
                .is_none_or(|host| {
                    let host = host.host();
                    !host.eq_ignore_ascii_case("localhost")
                        && !host
                            .trim_matches(['[', ']'])
                            .parse::<std::net::IpAddr>()
                            .is_ok_and(|ip| ip.is_loopback())
                })
        })
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(request).await
}
fn allowed_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    if matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) {
        return true;
    }
    reqwest::Url::parse(origin).is_ok_and(|url| {
        url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
            && url.origin().ascii_serialization() == origin
    })
}
async fn empty() -> Json<Value> {
    Json(json!([]))
}

async fn youtube_embed(axum::extract::Path(id): axum::extract::Path<String>) -> Response {
    if id.len() != 11
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return (StatusCode::BAD_REQUEST, "Invalid YouTube video ID").into_response();
    }
    let html = format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body,iframe{{margin:0;padding:0;width:100%;height:100%;border:0;background:#000;overflow:hidden}}</style></head><body><iframe src="https://www.youtube-nocookie.com/embed/{id}?rel=0" title="YouTube video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>"#
    );
    axum::response::Html(html).into_response()
}
async fn runtime(State(state): State<AppState>) -> Json<Value> {
    Json(
        json!({"mode":"desktop","isDesktop":true,"publishEnabled":false,"clipsDir":state.0.config.clips_dir,"dataDir":state.0.config.data_dir,"platform":std::env::consts::OS}),
    )
}

#[derive(Debug)]
struct ApiError(StatusCode, String);
type ApiResult<T> = Result<T, ApiError>;
impl ApiError {
    fn bad(message: impl ToString) -> Self {
        Self(StatusCode::BAD_REQUEST, message.to_string())
    }
    fn missing() -> Self {
        Self(StatusCode::NOT_FOUND, "Not found".into())
    }
    fn unavailable(message: impl ToString) -> Self {
        Self(StatusCode::SERVICE_UNAVAILABLE, message.to_string())
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.0,
            Json(json!({"statusCode": self.0.as_u16(), "message":self.1})),
        )
            .into_response()
    }
}
impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
    }
}
impl From<rusqlite::Error> for ApiError {
    fn from(error: rusqlite::Error) -> Self {
        if matches!(error, rusqlite::Error::QueryReturnedNoRows) {
            Self::missing()
        } else {
            anyhow::Error::from(error).into()
        }
    }
}
impl From<std::io::Error> for ApiError {
    fn from(error: std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::NotFound {
            Self::missing()
        } else {
            anyhow::Error::from(error).into()
        }
    }
}
fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn source_url(raw: &Value) -> ApiResult<String> {
    let url =
        reqwest::Url::parse(raw.as_str().unwrap_or_default().trim()).map_err(ApiError::bad)?;
    let host = url.host_str().unwrap_or_default();
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || !["youtube.com", "youtu.be", "instagram.com", "tiktok.com"]
            .iter()
            .any(|d| {
                host == *d
                    || host
                        .strip_suffix(d)
                        .is_some_and(|prefix| prefix.ends_with('.'))
            })
    {
        return Err(ApiError::bad(
            "Use a YouTube, TikTok, or Instagram HTTP(S) URL",
        ));
    }
    Ok(url.into())
}

/// Adapts the YuNet implementation to the engine's clip-relative segment format.
pub struct OnnxFaceAnalyzer;
impl FaceAnalyzer for OnnxFaceAnalyzer {
    fn track_active_speaker(
        &self,
        path: &Path,
        start: f64,
        end: f64,
    ) -> anyhow::Result<Vec<SpeakerSegment>> {
        let segments = dartclip_face::track_active_speaker(path, start, end);
        Ok(segments
            .iter()
            .enumerate()
            .map(|(i, s)| {
                (
                    s.start,
                    segments.get(i + 1).map_or(end - start, |next| next.start),
                    s.center_x,
                )
            })
            .collect())
    }
    fn detect_two_speakers(
        &self,
        path: &Path,
        start: f64,
        end: f64,
    ) -> anyhow::Result<Option<(f64, f64)>> {
        Ok(dartclip_face::detect_two_speakers(path, start, end))
    }
    fn detect_facecam_box(
        &self,
        path: &Path,
        start: f64,
        end: f64,
        cached: Option<FacecamBox>,
    ) -> anyhow::Result<Option<FacecamBox>> {
        Ok(dartclip_face::detect_facecam_box(path, start, end, cached))
    }
    fn detect_cover_face_focus(&self, path: &Path) -> Option<(f32, f32)> {
        dartclip_face::detect_cover_face_focus(path)
    }
}
