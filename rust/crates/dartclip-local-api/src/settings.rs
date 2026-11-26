use super::*;
use anyhow::Context;
use dartclip_core::llm::{LlmClient, LlmConfig, LlmEndpoint, LlmStatusTracker};
use serde::{Deserialize, Serialize};
use std::{io::Write, time::Duration};

const SETTINGS: &str = "desktop-settings.json";
const SECRETS: &str = "desktop-secrets.json";
const SERVICE: &str = "site.rencraft.dartclip";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Preferences {
    nine_router_url: String,
    nine_router_model: String,
    gemini_model: String,
    openai_model: String,
    video_encoder: String,
    #[serde(flatten)]
    extra: serde_json::Map<String, Value>,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            nine_router_url: "http://localhost:20128/v1".into(),
            nine_router_model: String::new(),
            gemini_model: "gemini-2.5-flash".into(),
            openai_model: "gpt-4o-mini".into(),
            video_encoder: "libx264".into(),
            extra: serde_json::Map::new(),
        }
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Secrets {
    nine_router_api_key: String,
    gemini_api_key: String,
    openai_api_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Patch {
    nine_router_url: Option<String>,
    nine_router_model: Option<String>,
    gemini_model: Option<String>,
    openai_model: Option<String>,
    video_encoder: Option<String>,
    nine_router_api_key: Option<String>,
    gemini_api_key: Option<String>,
    openai_api_key: Option<String>,
    #[serde(default)]
    clear_nine_router_api_key: bool,
    #[serde(default)]
    clear_gemini_api_key: bool,
    #[serde(default)]
    clear_openai_api_key: bool,
}

pub(crate) struct Store {
    dir: PathBuf,
    prefs: Preferences,
    secrets: Secrets,
    entry: Option<keyring::Entry>,
    encrypted: bool,
    pub(crate) tracker: Option<LlmStatusTracker>,
}

fn read_optional<T: serde::de::DeserializeOwned>(path: &Path) -> anyhow::Result<Option<T>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(
            serde_json::from_slice(&bytes)
                .with_context(|| format!("Invalid {}", path.display()))?,
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}
fn persist_private(path: &Path, value: &impl Serialize) -> anyhow::Result<()> {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    serde_json::to_writer_pretty(&mut file, value)?;
    file.flush()?;
    file.as_file().sync_all()?;
    file.persist(path)?;
    Ok(())
}

impl Store {
    pub(crate) fn open(dir: &Path) -> anyhow::Result<Self> {
        let prefs = read_optional(&dir.join(SETTINGS))?.unwrap_or_default();
        let entry = if cfg!(any(
            target_os = "macos",
            target_os = "linux",
            target_os = "windows"
        )) && std::env::var_os("CI").is_none()
        {
            keyring::Entry::new(SERVICE, &dir.to_string_lossy()).ok()
        } else {
            None
        };
        let (secure, mut encrypted) = match entry.as_ref().map(keyring::Entry::get_password) {
            Some(Ok(value)) => (
                Some(serde_json::from_str(&value).context("Invalid Keychain settings")?),
                true,
            ),
            Some(Err(keyring::Error::NoEntry)) => (None, true),
            _ => (None, false),
        };
        // A fallback file overrides older Keychain values, including after a clear in headless mode.
        let fallback = read_optional(&dir.join(SECRETS))?;
        if fallback.is_some() {
            encrypted = false;
        }
        Ok(Self {
            dir: dir.into(),
            prefs,
            secrets: fallback.or(secure).unwrap_or_default(),
            entry,
            encrypted,
            tracker: None,
        })
    }
    pub(crate) fn encoder(&self) -> &str {
        &self.prefs.video_encoder
    }
    pub(crate) fn providers(&self) -> Vec<Provider> {
        [
            (
                "9router",
                self.prefs.nine_router_url.as_str(),
                &self.prefs.nine_router_model,
                &self.secrets.nine_router_api_key,
            ),
            (
                "gemini",
                "https://generativelanguage.googleapis.com/v1beta/openai",
                &self.prefs.gemini_model,
                &self.secrets.gemini_api_key,
            ),
            (
                "openai",
                "https://api.openai.com/v1",
                &self.prefs.openai_model,
                &self.secrets.openai_api_key,
            ),
        ]
        .into_iter()
        .filter(|(_, url, model, key)| !url.is_empty() && !model.is_empty() && !key.is_empty())
        .map(|(name, base_url, model, api_key)| Provider {
            name,
            endpoint: LlmEndpoint {
                base_url: base_url.into(),
                model: model.clone(),
                api_key: api_key.clone(),
            },
        })
        .collect()
    }
    fn view(&self, clips: &Path) -> Value {
        fn hint(key: &str) -> Option<String> {
            let chars: Vec<_> = key.chars().collect();
            if chars.is_empty() {
                None
            } else if chars.len() <= 7 {
                Some("…".into())
            } else {
                Some(format!(
                    "{}…{}",
                    if key.starts_with("sk-") { "sk-" } else { "" },
                    chars[chars.len() - 4..].iter().collect::<String>()
                ))
            }
        }
        let mut value = json!({
            "nineRouterUrl": self.prefs.nine_router_url,
            "nineRouterModel": self.prefs.nine_router_model,
            "geminiModel": self.prefs.gemini_model,
            "openaiModel": self.prefs.openai_model,
            "videoEncoder": self.prefs.video_encoder,
        });
        for (label, field, key) in [
            (
                "NineRouter",
                "nineRouter",
                &self.secrets.nine_router_api_key,
            ),
            ("Gemini", "gemini", &self.secrets.gemini_api_key),
            ("Openai", "openai", &self.secrets.openai_api_key),
        ] {
            value[format!("has{label}ApiKey")] = json!(!key.is_empty());
            value[format!("{field}ApiKeyHint")] = json!(hint(key));
        }
        value["encryptionAvailable"] = json!(self.encrypted);
        value["clipsDir"] = json!(clips);
        value
    }
    fn update(&mut self, patch: Patch) -> ApiResult<()> {
        let mut prefs = self.prefs.clone();
        let mut secrets = self.secrets.clone();
        if let Some(url) = patch.nine_router_url {
            let url = url.trim().trim_end_matches('/');
            if !url.is_empty() {
                let parsed =
                    reqwest::Url::parse(url).map_err(|_| ApiError::bad("Invalid 9Router URL"))?;
                if !matches!(parsed.scheme(), "http" | "https")
                    || !parsed.username().is_empty()
                    || parsed.password().is_some()
                    || parsed.query().is_some()
                    || parsed.fragment().is_some()
                {
                    return Err(ApiError::bad(
                        "9Router must be an HTTP(S) base URL without login, query or fragment",
                    ));
                }
            }
            prefs.nine_router_url = url.into();
        }
        for (dst, value) in [
            (&mut prefs.nine_router_model, patch.nine_router_model),
            (&mut prefs.gemini_model, patch.gemini_model),
            (&mut prefs.openai_model, patch.openai_model),
        ] {
            if let Some(value) = value {
                *dst = value.trim().to_owned();
            }
        }
        if let Some(value) = patch.video_encoder {
            if !matches!(value.as_str(), "h264_videotoolbox" | "libx264") {
                return Err(ApiError::bad("Unknown video encoder"));
            }
            prefs.video_encoder = value;
        }
        let mut keys_changed = false;
        for (dst, value, clear) in [
            (
                &mut secrets.nine_router_api_key,
                patch.nine_router_api_key,
                patch.clear_nine_router_api_key,
            ),
            (
                &mut secrets.gemini_api_key,
                patch.gemini_api_key,
                patch.clear_gemini_api_key,
            ),
            (
                &mut secrets.openai_api_key,
                patch.openai_api_key,
                patch.clear_openai_api_key,
            ),
        ] {
            if clear {
                dst.clear();
                keys_changed = true;
            } else if let Some(value) = value.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                if HeaderValue::from_str(value).is_err() || value.len() > 8192 {
                    return Err(ApiError::bad("Invalid API key"));
                }
                *dst = value.into();
                keys_changed = true;
            }
        }
        if keys_changed {
            let serialized = serde_json::to_string(&secrets).map_err(anyhow::Error::from)?;
            let fallback = self.dir.join(SECRETS);
            let empty = secrets.nine_router_api_key.is_empty()
                && secrets.gemini_api_key.is_empty()
                && secrets.openai_api_key.is_empty();
            let secured = self.entry.as_ref().is_some_and(|entry| {
                if empty {
                    matches!(
                        entry.delete_credential(),
                        Ok(()) | Err(keyring::Error::NoEntry)
                    )
                } else {
                    entry.set_password(&serialized).is_ok()
                }
            });
            if secured {
                match std::fs::remove_file(&fallback) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
                self.encrypted = true;
            } else {
                persist_private(&fallback, &secrets)?;
                self.encrypted = false;
            }
            self.secrets = secrets;
            self.tracker = None;
        }
        persist_private(&self.dir.join(SETTINGS), &prefs)?;
        self.prefs = prefs;
        self.tracker = None;
        Ok(())
    }
}

#[derive(Clone)]
pub(crate) struct Provider {
    name: &'static str,
    endpoint: LlmEndpoint,
}
impl Provider {
    fn client(&self) -> anyhow::Result<LlmClient> {
        LlmClient::new(LlmConfig {
            primary: self.endpoint.clone(),
            timeout: REQUEST_TIMEOUT,
            ..Default::default()
        })
    }
}

pub(crate) async fn view(State(state): State<AppState>) -> Json<Value> {
    Json(state.settings().view(&state.0.config.clips_dir))
}
pub(crate) async fn patch(
    State(state): State<AppState>,
    Json(patch): Json<Patch>,
) -> ApiResult<Json<Value>> {
    tokio::task::spawn_blocking(move || {
        let mut store = state.settings();
        store.update(patch)?;
        Ok(Json(store.view(&state.0.config.clips_dir)))
    })
    .await
    .map_err(anyhow::Error::from)?
}
pub(crate) async fn status(State(state): State<AppState>) -> Json<Value> {
    let store = state.settings();
    let providers = store.providers();
    let last = store
        .tracker
        .as_ref()
        .and_then(|tracker| tracker.snapshot().last_call);
    Json(
        json!({"workerOnline":true,"configured":!providers.is_empty(), "model":providers.first().map(|p| &p.endpoint.model), "lastCall":last,"updatedAt":now()}),
    )
}
pub(crate) async fn test(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let providers = state.settings().providers();
    if providers.is_empty() {
        return Ok(Json(
            json!({"ok":false,"configured":false,"error":"No LLM provider configured"}),
        ));
    }
    let mut last = None;
    for p in providers {
        let client = p.client()?;
        state.settings().tracker = Some(client.status_tracker());
        match client.ping().await {
            Ok(()) => {
                return Ok(Json(
                    json!({"ok":true,"configured":true,"provider":p.name,"model":p.endpoint.model,"baseUrl":p.endpoint.base_url}),
                ))
            }
            Err(e) => last = Some(e.to_string()),
        }
    }
    Ok(Json(json!({"ok":false,"configured":true,"error":last})))
}

/// Try each configured endpoint with the core caption/brief parser.
pub(crate) async fn caption(
    state: &AppState,
    req: &dartclip_core::models::CaptionRequest,
) -> ApiResult<dartclip_core::models::CaptionResult> {
    let providers = state.settings().providers();
    for p in providers {
        let client = p.client()?;
        state.settings().tracker = Some(client.status_tracker());
        if let Ok(result) = client.regenerate_caption(req).await {
            return Ok(result);
        }
    }
    Err(ApiError::unavailable("caption_unavailable"))
}
pub(crate) async fn expand(state: &AppState, brief: &str) -> ApiResult<String> {
    let providers = state.settings().providers();
    for p in providers {
        let client = p.client()?;
        state.settings().tracker = Some(client.status_tracker());
        if let Ok(result) = client.expand_brief(brief).await {
            return Ok(result);
        }
    }
    Err(ApiError::unavailable("brief_unavailable"))
}

// The engine config supports one fallback. A private per-pipeline adapter preserves
// all three providers without re-running downloads or changing the core crate.
pub(crate) struct PipelineLlm {
    pub(crate) client: LlmClient,
    relay: Option<tokio::task::JoinHandle<()>>,
}
impl Drop for PipelineLlm {
    fn drop(&mut self) {
        if let Some(relay) = &self.relay {
            relay.abort();
        }
    }
}
impl PipelineLlm {
    pub(crate) async fn new(providers: Vec<Provider>) -> anyhow::Result<Option<Self>> {
        let Some(first) = providers.first() else {
            return Ok(None);
        };
        let mut config = LlmConfig {
            primary: first.endpoint.clone(),
            timeout: REQUEST_TIMEOUT,
            ..Default::default()
        };
        if providers.len() <= 2 {
            config.fallback = providers.get(1).map(|p| p.endpoint.clone());
            return Ok(Some(Self {
                client: LlmClient::new(config)?,
                relay: None,
            }));
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let token = id();
        config.primary.base_url = format!("http://{}", listener.local_addr()?);
        config.primary.api_key = token.clone();
        config.timeout = REQUEST_TIMEOUT * providers.len() as u32 + Duration::from_secs(5);
        let client = LlmClient::new(config)?;
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        let router = Router::new().route(
            "/chat/completions",
            post(
                move |headers: axum::http::HeaderMap, Json(mut body): Json<Value>| {
                    let providers = providers.clone();
                    let http = http.clone();
                    let auth = format!("Bearer {token}");
                    async move {
                        if headers
                            .get(header::AUTHORIZATION)
                            .and_then(|h| h.to_str().ok())
                            != Some(auth.as_str())
                        {
                            return StatusCode::UNAUTHORIZED.into_response();
                        }
                        for p in providers {
                            let base = p.endpoint.base_url.trim_end_matches('/');
                            let url = if base.ends_with("/chat/completions") {
                                base.to_owned()
                            } else {
                                format!("{base}/chat/completions")
                            };
                            body["model"] = json!(p.endpoint.model);
                            let Ok(response) = http
                                .post(url)
                                .bearer_auth(p.endpoint.api_key)
                                .json(&body)
                                .send()
                                .await
                            else {
                                continue;
                            };
                            if !response.status().is_success() {
                                continue;
                            }
                            let Ok(result) = response.json::<Value>().await else {
                                continue;
                            };
                            if result
                                .pointer("/choices/0/message/content")
                                .is_some_and(Value::is_string)
                            {
                                return Json(result).into_response();
                            }
                        }
                        StatusCode::BAD_GATEWAY.into_response()
                    }
                },
            ),
        );
        let relay = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        Ok(Some(Self {
            client,
            relay: Some(relay),
        }))
    }
}
