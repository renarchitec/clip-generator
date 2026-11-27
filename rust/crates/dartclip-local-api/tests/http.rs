use dartclip_local_api::{start_local_api, LocalApiConfig, RunningLocalApi};
use reqwest::{
    multipart::{Form, Part},
    Client, RequestBuilder, StatusCode,
};
use serde_json::{json, Value};
use std::{io::Cursor, path::Path, time::Duration};
use tempfile::TempDir;

const SOURCE: &str = "https://www.youtube.com/watch?v=12345678901";

struct Server {
    running: RunningLocalApi,
    client: Client,
}
impl Server {
    async fn new(dir: &TempDir) -> Self {
        let running = start_local_api(LocalApiConfig {
            data_dir: dir.path().join("data"),
            clips_dir: dir.path().join("clips"),
            ..LocalApiConfig::default()
        })
        .await
        .unwrap();
        assert_eq!(running.addr.ip().to_string(), "127.0.0.1");
        assert_ne!(running.addr.port(), 0);
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        Self { running, client }
    }
    fn request(&self, method: reqwest::Method, path: &str) -> RequestBuilder {
        self.client
            .request(method, format!("{}/api{path}", self.running.base_url))
    }
    fn get(&self, path: &str) -> RequestBuilder {
        self.request(reqwest::Method::GET, path)
    }
    fn post(&self, path: &str) -> RequestBuilder {
        self.request(reqwest::Method::POST, path)
    }
    fn patch(&self, path: &str) -> RequestBuilder {
        self.request(reqwest::Method::PATCH, path)
    }
    fn put(&self, path: &str) -> RequestBuilder {
        self.request(reqwest::Method::PUT, path)
    }
    fn delete(&self, path: &str) -> RequestBuilder {
        self.request(reqwest::Method::DELETE, path)
    }
    fn stop(self) {
        let _ = self.running.shutdown.send(());
    }
}
async fn response(req: RequestBuilder, status: StatusCode) -> reqwest::Response {
    let res = req.send().await.unwrap();
    if res.status() != status {
        panic!(
            "Expected {status}, got {}: {}",
            res.status(),
            res.text().await.unwrap_or_default()
        );
    }
    res
}
async fn data(req: RequestBuilder, status: StatusCode) -> Value {
    response(req, status).await.json().await.unwrap()
}
async fn ok(req: RequestBuilder) -> Value {
    data(req, StatusCode::OK).await
}
async fn created(req: RequestBuilder) -> Value {
    data(req, StatusCode::CREATED).await
}

#[tokio::test]
async fn auth_runtime_tool_status_and_cors() {
    let dir = tempfile::tempdir().unwrap();
    let api = Server::new(&dir).await;
    assert_eq!(
        ok(api.get("/auth/me")).await,
        json!({"user":{"id":"local-desktop-user","email":"local@dartclip.desktop","name":"Local","role":"user"}})
    );
    assert_eq!(
        ok(api.get("/auth/config")).await,
        json!({"registrationOpen":false})
    );
    response(api.post("/auth/logout"), StatusCode::NO_CONTENT).await;
    let runtime = ok(api.get("/system/runtime")).await;
    assert_eq!(
        runtime,
        json!({"mode":"desktop","isDesktop":true,"publishEnabled":false,"clipsDir":dir.path().join("clips").canonicalize().unwrap(),"dataDir":dir.path().join("data").canonicalize().unwrap(),"platform":std::env::consts::OS})
    );
    let tools = ok(api.get("/system/tools")).await;
    assert!(tools["ffmpeg"]["detected"].is_boolean());
    assert!(tools["yt-dlp"]["detected"].is_boolean());
    response(
        api.post("/system/tools/invalid/download"),
        StatusCode::NOT_FOUND,
    )
    .await;
    for path in ["/social/providers", "/social/accounts"] {
        assert_eq!(ok(api.get(path)).await, json!([]));
    }
    response(api.get("/reference-jobs"), StatusCode::NOT_FOUND).await;
    for origin in [
        "tauri://localhost",
        "http://tauri.localhost",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ] {
        let res = response(
            api.request(reqwest::Method::OPTIONS, "/clips/id/stream")
                .header("origin", origin)
                .header("access-control-request-method", "GET")
                .header("access-control-request-headers", "range"),
            StatusCode::OK,
        )
        .await;
        assert_eq!(res.headers()["access-control-allow-origin"], origin);
        assert_eq!(res.headers()["access-control-allow-headers"], "range");
    }
    response(
        api.post("/auth/logout")
            .header("origin", "https://example.com"),
        StatusCode::FORBIDDEN,
    )
    .await;
    api.stop();
}

#[tokio::test]
async fn llm_status_reports_stt_configuration_and_provider_priority() {
    let dir = tempfile::tempdir().unwrap();
    let api = Server::new(&dir).await;
    for (patch, model) in [
        (None, None),
        (
            Some(json!({"geminiApiKey":"test-gemini-key","geminiModel":"gemini-test-model"})),
            Some("gemini-test-model"),
        ),
        (
            Some(json!({"openaiApiKey":"test-openai-key"})),
            Some("whisper-1"),
        ),
        (
            Some(json!({"nineRouterApiKey":"test-router-key"})),
            Some(dartclip_core::stt::DEFAULT_STT_MODEL),
        ),
        (
            Some(json!({"nineRouterUrl":"","clearGeminiApiKey":true})),
            Some("whisper-1"),
        ),
        (
            Some(
                json!({"clearOpenaiApiKey":true,"geminiApiKey":"test-gemini-key","geminiModel":""}),
            ),
            None,
        ),
    ] {
        if let Some(patch) = patch {
            ok(api.patch("/system/desktop-settings").json(&patch)).await;
        }
        let status = ok(api.get("/system/llm-status")).await;
        assert_eq!(status["sttConfigured"], model.is_some());
        assert_eq!(status.get("sttModel"), Some(&json!(model)));
    }
    api.stop();
}

#[tokio::test]
async fn settings_masks_keys_persists_preferences_and_clears_keys() {
    let dir = tempfile::tempdir().unwrap();
    let api = Server::new(&dir).await;
    const NINE: &str = "sk-example-long-abcd";
    const GEMINI: &str = "example-gemini-1234";
    let initial = ok(api.get("/system/desktop-settings")).await;
    assert!(initial["encryptionAvailable"].is_boolean());
    assert_eq!(initial["hasNineRouterApiKey"], false);
    assert_eq!(initial["nineRouterApiKeyHint"], Value::Null);
    let view = ok(api.patch("/system/desktop-settings").json(&json!({"nineRouterUrl":"http://127.0.0.1:20128/v1/","nineRouterModel":"model-for-tests","nineRouterApiKey":NINE,"geminiApiKey":GEMINI,"openaiApiKey":"tiny","videoEncoder":"libx264"}))).await;
    assert_eq!(view["nineRouterUrl"], "http://127.0.0.1:20128/v1");
    assert_eq!(view["hasNineRouterApiKey"], true);
    assert_eq!(view["nineRouterApiKeyHint"], "sk-…abcd");
    assert_eq!(view["geminiApiKeyHint"], "…1234");
    assert_eq!(view["hasOpenaiApiKey"], true);
    assert_eq!(view["openaiApiKeyHint"], "…");
    assert!(!view.to_string().contains(NINE));
    assert!(!view.to_string().contains(GEMINI));
    assert_eq!(view, ok(api.get("/system/desktop-settings")).await);
    let file = dir.path().join("data/desktop-settings.json");
    assert!(!std::fs::read_to_string(&file).unwrap().contains(NINE));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o600);
        let fallback = dir.path().join("data/desktop-secrets.json");
        if view["encryptionAvailable"] == false {
            assert_eq!(
                fallback.metadata().unwrap().permissions().mode() & 0o777,
                0o600
            );
        } else {
            assert!(!fallback.exists());
        }
    }
    let status = ok(api.get("/system/llm-status")).await;
    assert_eq!(status["configured"], true);
    assert_eq!(status["model"], "model-for-tests");
    api.stop();
    let api = Server::new(&dir).await;
    assert_eq!(view, ok(api.get("/system/desktop-settings")).await);
    let cleared = ok(api.patch("/system/desktop-settings").json(
        &json!({"clearNineRouterApiKey":true,"clearGeminiApiKey":true,"clearOpenaiApiKey":true}),
    ))
    .await;
    assert_eq!(cleared["hasNineRouterApiKey"], false);
    assert_eq!(cleared["hasGeminiApiKey"], false);
    assert_eq!(cleared["hasOpenaiApiKey"], false);
    assert_eq!(cleared["nineRouterApiKeyHint"], Value::Null);
    assert_eq!(cleared["nineRouterModel"], "model-for-tests");
    assert_eq!(cleared["videoEncoder"], "libx264");
    assert_eq!(ok(api.post("/system/llm-test")).await["configured"], false);
    api.stop();
    let api = Server::new(&dir).await;
    assert_eq!(cleared, ok(api.get("/system/desktop-settings")).await);
    api.stop();
}

#[tokio::test]
async fn direct_stt_settings_persist_and_clearing_restores_provider_priority() {
    let dir = tempfile::tempdir().unwrap();
    let api = Server::new(&dir).await;
    const KEY: &str = "gsk-test-whisper-abcd";
    const DEFAULT_URL: &str = "https://api.groq.com/openai/v1";
    const MODEL: &str = "whisper-large-v3-turbo";

    let initial = ok(api.get("/system/desktop-settings")).await;
    assert_eq!(initial["sttBaseUrl"], DEFAULT_URL);
    assert_eq!(initial["sttModel"], MODEL);
    assert_eq!(initial["hasSttApiKey"], false);
    assert_eq!(initial["sttApiKeyHint"], Value::Null);
    response(
        api.patch("/system/desktop-settings")
            .json(&json!({"sttBaseUrl":"ftp://stt.example/v1"})),
        StatusCode::BAD_REQUEST,
    )
    .await;

    let saved = ok(api.patch("/system/desktop-settings").json(&json!({
        "sttBaseUrl": " https://stt.example/openai/v1/ ",
        "sttModel": " whisper-large-v3-turbo ",
        "sttApiKey": KEY,
    })))
    .await;
    assert_eq!(saved["sttBaseUrl"], "https://stt.example/openai/v1");
    assert_eq!(saved["sttModel"], MODEL);
    assert_eq!(saved["hasSttApiKey"], true);
    assert_eq!(saved["sttApiKeyHint"], "…abcd");
    assert!(!saved.to_string().contains(KEY));
    let prefs = std::fs::read_to_string(dir.path().join("data/desktop-settings.json")).unwrap();
    assert!(!prefs.contains(KEY));
    api.stop();

    let api = Server::new(&dir).await;
    assert_eq!(ok(api.get("/system/desktop-settings")).await, saved);
    ok(api
        .patch("/system/desktop-settings")
        .json(&json!({"nineRouterApiKey":"test-router-key"})))
    .await;
    let status = ok(api.get("/system/llm-status")).await;
    assert_eq!(status["sttConfigured"], true);
    assert_eq!(status["sttModel"], MODEL);

    let cleared = ok(api
        .patch("/system/desktop-settings")
        .json(&json!({"clearSttApiKey":true})))
    .await;
    assert_eq!(cleared["hasSttApiKey"], false);
    assert_eq!(cleared["sttApiKeyHint"], Value::Null);
    let status = ok(api.get("/system/llm-status")).await;
    assert_eq!(status["sttConfigured"], true);
    assert_eq!(status["sttModel"], dartclip_core::stt::DEFAULT_STT_MODEL);

    let cleared = ok(api.patch("/system/desktop-settings").json(&json!({
        "sttBaseUrl": " ",
        "clearNineRouterApiKey": true,
    })))
    .await;
    assert_eq!(cleared["sttBaseUrl"], "");
    let status = ok(api.get("/system/llm-status")).await;
    assert_eq!(status["sttConfigured"], false);
    assert_eq!(status["sttModel"], Value::Null);
    api.stop();
}

fn png() -> Vec<u8> {
    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(16, 8)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    png.into_inner()
}
async fn upload_png(api: &Server, name: &str, bytes: &[u8]) -> Value {
    created(
        api.post("/watermarks").multipart(
            Form::new()
                .part(
                    "file",
                    Part::bytes(bytes.to_vec())
                        .file_name("logo.png")
                        .mime_str("image/png")
                        .unwrap(),
                )
                .text("name", name.to_owned()),
        ),
    )
    .await
}
#[tokio::test]
async fn watermark_range_and_multi_layer_default_pruning() {
    let dir = tempfile::tempdir().unwrap();
    let api = Server::new(&dir).await;
    let bytes = png();
    let first = upload_png(&api, "First", &bytes).await;
    let second = upload_png(&api, "Second", &bytes).await;
    let first_id = first["id"].as_str().unwrap();
    let second_id = second["id"].as_str().unwrap();
    assert_eq!(first["kind"], "image");
    assert_eq!(first["mimeType"], "image/png");
    assert_eq!(first["width"], 16);
    assert_eq!(first["height"], 8);
    assert_eq!(first["url"], format!("/api/watermarks/{first_id}/file"));
    assert_eq!(ok(api.get("/watermarks")).await, json!([second, first]));
    let path = format!("/watermarks/{first_id}/file");
    let res = response(
        api.get(&path)
            .header("origin", "tauri://localhost")
            .header("range", "bytes=0-15"),
        StatusCode::PARTIAL_CONTENT,
    )
    .await;
    assert_eq!(
        res.headers()["content-range"],
        format!("bytes 0-15/{}", bytes.len())
    );
    assert_eq!(res.headers()["accept-ranges"], "bytes");
    assert_eq!(res.headers()["content-length"], "16");
    assert_eq!(res.headers()["content-type"], "image/png");
    assert!(res.headers()["access-control-expose-headers"]
        .to_str()
        .unwrap()
        .contains("content-range"));
    assert_eq!(res.bytes().await.unwrap().as_ref(), &bytes[..16]);
    let a = json!({"watermarkId":first_id,"x":0.25,"y":0.1,"scale":0.4,"opacity":0.8});
    let b = json!({"watermarkId":second_id,"x":0.75,"y":0.9,"scale":0.3,"opacity":1.0});
    let layers = json!([a, b]);
    let saved = ok(api.put("/watermarks/default").json(&layers)).await;
    assert_eq!(saved, json!({"default":layers,"defaults":layers}));
    assert_eq!(saved, ok(api.get("/watermarks/default")).await);
    response(
        api.delete(&format!("/watermarks/{first_id}")),
        StatusCode::NO_CONTENT,
    )
    .await;
    response(api.get(&path), StatusCode::NOT_FOUND).await;
    assert_eq!(
        ok(api.get("/watermarks/default")).await,
        json!({"default":b,"defaults":[b]})
    );
    assert_eq!(
        ok(api.put("/watermarks/default").json(&Value::Null)).await,
        json!({"default":null,"defaults":[]})
    );
    assert!(dir
        .path()
        .join(format!("clips/watermarks/{second_id}.png"))
        .is_file());
    assert!(!dir
        .path()
        .join(format!("clips/watermarks/{first_id}.png"))
        .exists());
    api.stop();
}

#[tokio::test]
async fn brief_history_crud() {
    let dir = tempfile::tempdir().unwrap();
    let api = Server::new(&dir).await;
    assert_eq!(ok(api.get("/briefs/history")).await, json!([]));
    let first = created(
        api.post("/briefs/history")
            .json(&json!({"text":" Find the best moments "})),
    )
    .await;
    assert_eq!(first["text"], "Find the best moments");
    assert_eq!(first["useCount"], 1);
    assert!(first["lastUsedAt"].is_string());
    let again = created(
        api.post("/briefs/history")
            .json(&json!({"text":"Find the best moments"})),
    )
    .await;
    assert_eq!(again["id"], first["id"]);
    assert_eq!(again["useCount"], 2);
    assert_eq!(ok(api.get("/briefs/history")).await, json!([again]));
    let path = format!("/briefs/history/{}", again["id"].as_str().unwrap());
    response(api.delete(&path), StatusCode::NO_CONTENT).await;
    assert_eq!(ok(api.get("/briefs/history")).await, json!([]));
    response(api.delete(&path), StatusCode::NOT_FOUND).await;
    api.stop();
}

#[cfg(unix)]
fn fake_tools(dir: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let bin = dir.join("data/bin");
    std::fs::create_dir_all(&bin).unwrap();
    for (name, script) in [
        ("ffmpeg", "#!/bin/sh\nexit 0\n"),
        ("ffprobe", "#!/bin/sh\nexit 0\n"),
        ("yt-dlp", "#!/bin/sh\nexec sleep 60\n"),
    ] {
        let path = bin.join(name);
        std::fs::write(&path, script).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

async fn sse_frame(res: &mut reqwest::Response, buffer: &mut String) -> Value {
    loop {
        if let Some(end) = buffer.find("\n\n") {
            let event: String = buffer.drain(..end + 2).collect();
            if let Some(data) = event.strip_prefix("data: ") {
                return serde_json::from_str(data.trim()).unwrap();
            }
        } else {
            let chunk = res
                .chunk()
                .await
                .unwrap()
                .expect("expected SSE frame before close");
            buffer.push_str(std::str::from_utf8(&chunk).unwrap());
        }
    }
}
#[cfg(unix)]
#[tokio::test]
async fn transcript_source_is_validated_and_preserved() {
    let dir = tempfile::tempdir().unwrap();
    fake_tools(dir.path());
    let api = Server::new(&dir).await;

    for endpoint in ["/jobs", "/previews"] {
        let error = data(
            api.post(endpoint)
                .json(&json!({"url":SOURCE,"transcriptSource":"invalid"})),
            StatusCode::BAD_REQUEST,
        )
        .await;
        assert!(error.to_string().contains("transcriptSource"));
    }

    let preview = created(
        api.post("/previews")
            .json(&json!({"url":SOURCE,"transcriptSource":"auto"})),
    )
    .await;
    let preview_path = format!("/previews/{}", preview["id"].as_str().unwrap());
    assert_eq!(ok(api.get(&preview_path)).await["transcriptSource"], "auto");

    let job = created(
        api.post("/jobs")
            .json(&json!({"url":SOURCE,"transcriptSource":"live_chat_stt"})),
    )
    .await;
    let id = job["id"].as_str().unwrap();
    let path = format!("/jobs/{id}");
    assert_eq!(job["transcriptSource"], "live_chat_stt");
    assert_eq!(
        ok(api.get(&path)).await["transcriptSource"],
        "live_chat_stt"
    );
    assert_eq!(
        ok(api.get("/jobs")).await[0]["transcriptSource"],
        "live_chat_stt"
    );
    let mut sse = response(api.get(&format!("{path}/events")), StatusCode::OK).await;
    let snapshot = sse_frame(&mut sse, &mut String::new()).await;
    assert_eq!(snapshot["transcriptSource"], "live_chat_stt");

    created(api.post(&format!("{path}/cancel"))).await;
    let retry = created(api.post(&format!("{path}/retry"))).await;
    assert_ne!(retry["id"], job["id"]);
    assert_eq!(retry["transcriptSource"], "live_chat_stt");
    let retry_path = format!("/jobs/{}", retry["id"].as_str().unwrap());
    assert_eq!(
        ok(api.get(&retry_path)).await["transcriptSource"],
        "live_chat_stt"
    );
    api.stop();
}

#[tokio::test]
async fn existing_local_database_migrates_transcript_source() {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    std::fs::create_dir_all(&data_dir).unwrap();
    // When a Prisma database is present, the local API uses dartclip-local.db.
    rusqlite::Connection::open(data_dir.join("dartclip.db"))
        .unwrap()
        .execute_batch("CREATE TABLE clips (jobId TEXT);")
        .unwrap();
    let db = rusqlite::Connection::open(data_dir.join("dartclip-local.db")).unwrap();
    db.execute_batch(
        &include_str!("../src/schema.sql")
            .replace("  transcript_source TEXT NOT NULL DEFAULT 'youtube',\n", ""),
    )
    .unwrap();
    db.execute(
        "INSERT INTO jobs (id,url,status,created_at,updated_at) VALUES ('old',?1,'done','2026-01-01','2026-01-01')",
        [SOURCE],
    )
    .unwrap();
    assert!(db.prepare("SELECT transcript_source FROM jobs").is_err());
    drop(db);

    let api = Server::new(&dir).await;
    let old = ok(api.get("/jobs/old")).await;
    assert_eq!(old["status"], "done");
    assert_eq!(old["transcriptSource"], "youtube");
    api.stop();
}

#[cfg(unix)]
#[tokio::test]
async fn job_creation_sse_cancellation_retry_and_delete() {
    let dir = tempfile::tempdir().unwrap();
    fake_tools(dir.path());
    let api = Server::new(&dir).await;
    let logo = upload_png(&api, "Logo", &png()).await;
    let job = created(api.post("/jobs").json(&json!({"url":SOURCE,"mode":"auto","description":"Game highlights","clipCount":2,"targetDurationSec":30,"customHashtags":"#Goal #GOAL #Cup","watermark":{"watermarkId":logo["id"],"filePath":"ignored"}}))).await;
    let id = job["id"].as_str().unwrap();
    let path = format!("/jobs/{id}");
    assert_eq!(job["status"], "queued");
    assert_eq!(job["reframe"], "center_crop");
    assert_eq!(job["transcriptSource"], "youtube");
    assert_eq!(job["clips"], json!([]));
    assert_eq!(job["clipCount"], 2);
    assert_eq!(job["customHashtags"], json!(["Goal", "Cup"]));
    assert_eq!(job["watermark"]["watermarkId"], logo["id"]);
    assert_eq!(
        job["watermark"]["filePath"],
        format!("watermarks/{}.png", logo["id"].as_str().unwrap())
    );
    assert_eq!(
        ok(api.get("/briefs/history")).await[0]["text"],
        "Game highlights"
    );
    assert_eq!(ok(api.get("/jobs")).await[0]["id"], id);
    let mut sse = response(api.get(&format!("{path}/events")), StatusCode::OK).await;
    assert_eq!(sse.headers()["content-type"], "text/event-stream");
    let mut buffer = String::new();
    let initial = sse_frame(&mut sse, &mut buffer).await;
    assert_eq!(initial["id"], id);
    assert!(matches!(
        initial["status"].as_str(),
        Some("queued" | "running")
    ));
    assert_eq!(initial["clips"], json!([]));
    let cancelled = created(api.post(&format!("{path}/cancel"))).await;
    assert_eq!(cancelled["status"], "cancelled");
    loop {
        if sse_frame(&mut sse, &mut buffer).await["status"] == "cancelled" {
            break;
        }
    }
    assert!(sse.chunk().await.unwrap().is_none());
    let retry = created(api.post(&format!("{path}/retry"))).await;
    assert_ne!(retry["id"], id);
    assert_eq!(retry["description"], job["description"]);
    assert_eq!(retry["watermark"], job["watermark"]);
    response(
        api.delete(&format!("/jobs/{}", retry["id"].as_str().unwrap())),
        StatusCode::NO_CONTENT,
    )
    .await;
    response(api.delete(&path), StatusCode::NO_CONTENT).await;
    response(api.get(&path), StatusCode::NOT_FOUND).await;
    assert_eq!(ok(api.get("/jobs")).await, json!([]));
    api.stop();
}

#[cfg(unix)]
#[tokio::test]
async fn pipeline_persists_and_streams_incremental_clip_outputs() {
    let dir = tempfile::tempdir().unwrap();
    fake_tools(dir.path());
    let bin = dir.path().join("data/bin");
    std::fs::write(bin.join("yt-dlp"), r#"#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then
    output="$2"
    break
  fi
  shift
 done
case "$output" in
  */source.*) printf 'WEBVTT\n\n00:00:00.000 --> 00:00:08.000\nA fixture subtitle.\n' > "${output%.*}.en.vtt" ;;
  *) prefix=${output%.*}; printf 'test-video' > "$prefix.mp4" ;;
esac
"#).unwrap();
    std::fs::write(bin.join("ffprobe"), r#"#!/bin/sh
printf '%s' '{"streams":[{"codec_type":"video","width":1920,"height":1080,"avg_frame_rate":"30/1","duration":"10"}],"format":{"duration":"10"}}'
"#).unwrap();
    std::fs::write(
        bin.join("ffmpeg"),
        r#"#!/bin/sh
for last do :; done
printf 'finished clip bytes' > "$last"
"#,
    )
    .unwrap();
    let api = Server::new(&dir).await;
    let job = created(api.post("/jobs").json(&json!({"url":SOURCE,"mode":"manual","ranges":[{"start":0,"end":5,"title":"Fixture clip"}],"reframe":"black_bars","captions":false,"normalizeAudio":false}))).await;
    let id = job["id"].as_str().unwrap();
    let mut events = response(api.get(&format!("/jobs/{id}/events")), StatusCode::OK).await;
    let mut buffer = String::new();
    let mut clip_id = None;
    loop {
        let snapshot = sse_frame(&mut events, &mut buffer).await;
        assert_ne!(snapshot["status"], "failed", "{snapshot}");
        if let Some(clip) = snapshot["clips"][0]["id"].as_str() {
            let established = clip_id.get_or_insert_with(|| clip.to_owned());
            assert_eq!(established, clip);
        }
        if snapshot["status"] == "done" {
            assert_eq!(snapshot["clipsCount"], 1);
            assert_eq!(snapshot["progress"], 100.0);
            break;
        }
    }
    let clip = clip_id.unwrap();
    assert_eq!(
        response(api.get(&format!("/clips/{clip}/stream")), StatusCode::OK)
            .await
            .text()
            .await
            .unwrap(),
        "finished clip bytes"
    );
    let path = dir.path().join("clips").join(id).join("clip-01.mp4");
    assert!(path.is_file());

    let frame = created(api.post("/frames").json(&json!({"url":SOURCE,"atSec":15,"aspectRatio":"9:16","reframe":"black_bars","captions":false}))).await;
    let frame_id = frame["id"].as_str().unwrap();
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let frame = ok(api.get(&format!("/frames/{frame_id}"))).await;
            match frame["status"].as_str() {
                Some("done") => break frame,
                Some("failed") => panic!("{frame}"),
                _ => tokio::time::sleep(Duration::from_millis(20)).await,
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(result["atSec"], 15.0);
    assert_eq!(result["imageUrl"], format!("/api/frames/{frame_id}/image"));
    let image = response(
        api.get(&format!("/frames/{frame_id}/image"))
            .header("range", "bytes=0-7"),
        StatusCode::PARTIAL_CONTENT,
    )
    .await;
    assert_eq!(image.headers()["content-type"], "image/jpeg");
    assert_eq!(image.text().await.unwrap(), "finished");

    let mp4 = b"\x00\x00\x00\x14ftypisom\x00\x00\x00\x00isomfixture";
    let outro = created(
        api.post("/outros").multipart(
            Form::new()
                .part("file", Part::bytes(mp4.to_vec()).file_name("ending.mp4"))
                .text("name", "End"),
        ),
    )
    .await;
    let outro_id = outro["id"].as_str().unwrap();
    assert_eq!(outro["width"], 1920);
    assert_eq!(outro["durationSec"], 10.0);
    assert_eq!(outro["sizeBytes"], mp4.len());
    assert_eq!(
        ok(api
            .put("/outros/default")
            .json(&json!({"outroId":outro_id})))
        .await,
        json!({"default":{"outroId":outro_id}})
    );
    let contents = response(
        api.get(&format!("/outros/{outro_id}/file"))
            .header("range", "bytes=0-15"),
        StatusCode::PARTIAL_CONTENT,
    )
    .await;
    assert_eq!(contents.headers()["content-type"], "video/mp4");
    assert_eq!(contents.bytes().await.unwrap().as_ref(), &mp4[..16]);
    response(
        api.delete(&format!("/outros/{outro_id}")),
        StatusCode::NO_CONTENT,
    )
    .await;
    assert_eq!(
        ok(api.get("/outros/default")).await,
        json!({"default":null})
    );
    response(api.delete(&format!("/jobs/{id}")), StatusCode::NO_CONTENT).await;
    assert!(!path.exists());
    assert_eq!(ok(api.get("/clips/recent")).await, json!([]));
    api.stop();
}

#[tokio::test]
async fn llm_ping_brief_and_clip_caption_use_saved_endpoint() {
    use axum::{routing::post, Json, Router};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let relay = tokio::spawn(async move {
        let router = Router::new().route(
            "/v1/chat/completions",
            post(
                |headers: axum::http::HeaderMap, Json(body): Json<Value>| async move {
                    assert_eq!(headers["authorization"], "Bearer sk-example-key");
                    assert_eq!(body["model"], "fixture-model");
                    let prompt = body["messages"][1]["content"].as_str().unwrap();
                    let content = if prompt.starts_with("Balas hanya JSON") {
                        json!({"ok":true})
                    } else if prompt.contains("<brief>") {
                        json!({"brief":"Start before the key play and end after the payoff."})
                    } else {
                        json!([{"caption":"Fixture caption.","hashtags":["clip"]}])
                    };
                    Json(json!({"choices":[{"message":{"content":content.to_string()}}]}))
                },
            ),
        );
        axum::serve(listener, router).await.unwrap();
    });
    let dir = tempfile::tempdir().unwrap();
    let api = Server::new(&dir).await;
    ok(api.patch("/system/desktop-settings").json(&json!({"nineRouterUrl":base,"nineRouterModel":"fixture-model","nineRouterApiKey":"sk-example-key"}))).await;
    assert_eq!(
        ok(api.post("/system/llm-test")).await,
        json!({"ok":true,"configured":true,"provider":"9router","model":"fixture-model","baseUrl":base})
    );
    assert_eq!(
        ok(api.get("/system/llm-status")).await["lastCall"]["ok"],
        true
    );
    assert_eq!(
        ok(api
            .post("/briefs/expand")
            .json(&json!({"brief":"Find the key play"})))
        .await["brief"],
        "Start before the key play and end after the payoff."
    );
    {
        let connection = rusqlite::Connection::open(dir.path().join("data/dartclip.db")).unwrap();
        connection.execute("INSERT INTO jobs (id,url,status,created_at,updated_at) VALUES ('job',?1,'done','2026-01-01','2026-01-01')",[SOURCE]).unwrap();
        connection.execute("INSERT INTO clips (id,job_id,title,start_sec,end_sec,file_path,created_at) VALUES ('clip','job','Test Clip',2,8,'test.mp4','2026-01-01')",[]).unwrap();
    }
    let caption = ok(api
        .post("/clips/clip/caption")
        .json(&json!({"language":"en"})))
    .await;
    assert_eq!(caption["caption"], "Fixture caption.");
    assert_eq!(caption["hashtags"], json!(["clip"]));
    assert_eq!(
        ok(api.get("/jobs/job")).await["clips"][0]["caption"],
        caption["caption"]
    );
    ok(api
        .patch("/system/desktop-settings")
        .json(&json!({"clearNineRouterApiKey":true})))
    .await;
    api.stop();
    relay.abort();
}

#[cfg(unix)]
#[tokio::test]
async fn clip_thumbnail_generates_caches_and_cleans_up() {
    let dir = tempfile::tempdir().unwrap();
    fake_tools(dir.path());
    let mut jpeg = Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(16, 8)
        .write_to(&mut jpeg, image::ImageFormat::Jpeg)
        .unwrap();
    let ffmpeg = dir.path().join("data/bin/ffmpeg");
    let script = r#"#!/bin/sh
set -eu
[ "$6" = '-i' ]
[ -f "$7" ]
shift 7
[ "$1:$2:$3:$4:$5:$6" = "-frames:v:1:-vf:scale='min(540,iw):-2':-q:v:4" ]
cp "${0%/*}/fixture.jpg" "$7"
"#;
    std::fs::write(ffmpeg.with_file_name("fixture.jpg"), jpeg.get_ref()).unwrap();
    std::fs::write(&ffmpeg, script).unwrap();
    let api = Server::new(&dir).await;
    let root = dir.path().join("clips");
    for id in ["clip-1", "clip_2"] {
        std::fs::write(root.join(format!("{id}.mp4")), b"fixture input").unwrap();
    }
    {
        let db = rusqlite::Connection::open(dir.path().join("data/dartclip.db")).unwrap();
        db.execute("INSERT INTO jobs (id,url,status,created_at,updated_at) VALUES ('job',?1,'done','2026-01-01','2026-01-01')", [SOURCE]).unwrap();
        for id in ["clip-1", "clip_2"] {
            db.execute("INSERT INTO clips (id,job_id,title,start_sec,end_sec,file_path,created_at) VALUES (?1,'job','Test Clip',2,8,?2,'2026-01-01')", rusqlite::params![id, format!("{id}.mp4")]).unwrap();
        }
    }

    let route = "/clips/clip-1/thumbnail";
    let cached = root.join(".thumbs/clip-1.jpg");
    let res = response(api.get(route), StatusCode::OK).await;
    assert_eq!(res.headers()["content-type"], "image/jpeg");
    assert_eq!(res.headers()["cache-control"], "private, max-age=3600");
    let bytes = res.bytes().await.unwrap();
    assert!(bytes.starts_with(&[0xff, 0xd8]));
    assert_eq!(image::load_from_memory(&bytes).unwrap().width(), 16);
    assert_eq!(std::fs::read(&cached).unwrap(), bytes.as_ref());

    std::fs::write(&ffmpeg, "#!/bin/sh\nexit 1\n").unwrap();
    let hit = response(api.get(route), StatusCode::OK).await;
    assert_eq!(hit.bytes().await.unwrap(), bytes);
    std::fs::write(&ffmpeg, script).unwrap();
    std::fs::write(&cached, b"stale").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&cached)
        .unwrap()
        .set_modified(std::time::UNIX_EPOCH)
        .unwrap();
    let refreshed = response(api.get(route), StatusCode::OK).await;
    assert_eq!(refreshed.bytes().await.unwrap(), bytes);
    assert_eq!(std::fs::read(&cached).unwrap(), bytes.as_ref());

    response(api.delete("/clips/clip-1"), StatusCode::NO_CONTENT).await;
    assert!(!cached.exists());
    response(api.get(route), StatusCode::NOT_FOUND).await;

    let job_thumb = root.join(".thumbs/clip_2.jpg");
    response(api.get("/clips/clip_2/thumbnail"), StatusCode::OK).await;
    assert!(job_thumb.is_file());
    response(api.delete("/jobs/job"), StatusCode::NO_CONTENT).await;
    assert!(!job_thumb.exists());
    api.stop();
}

#[tokio::test]
async fn clip_range_download_local_path_and_deletion() {
    let dir = tempfile::tempdir().unwrap();
    let api = Server::new(&dir).await;
    let root = dir.path().join("clips").canonicalize().unwrap();
    let path = root.join("test.mp4");
    let bytes: Vec<u8> = (0..64).collect();
    std::fs::write(&path, &bytes).unwrap();
    {
        let db = rusqlite::Connection::open(dir.path().join("data/dartclip.db")).unwrap();
        assert_eq!(
            db.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "wal"
        );
        db.execute("INSERT INTO jobs (id,url,status,created_at,updated_at) VALUES ('job',?1,'done','2026-01-01','2026-01-01')",[SOURCE]).unwrap();
        db.execute("INSERT INTO clips (id,job_id,title,start_sec,end_sec,file_path,created_at) VALUES ('clip','job','Test Clip',2,8,'test.mp4','2026-01-01')",[]).unwrap();
    }
    let recent = ok(api.get("/clips/recent?limit=24")).await;
    assert_eq!(
        recent[0]["job"],
        json!({"id":"job","url":SOURCE,"aspectRatio":"9:16"})
    );
    assert_eq!(recent[0]["startSec"], 2.0);
    assert_eq!(
        ok(api.get("/system/clips/clip/local-path")).await,
        json!({"path":path})
    );
    let stream = "/clips/clip/stream";
    for (input, expected, start, end) in [
        ("bytes=0-15", "bytes 0-15/64", 0, 16),
        ("bytes=60-", "bytes 60-63/64", 60, 64),
        ("bytes=-5", "bytes 59-63/64", 59, 64),
    ] {
        let res = response(
            api.get(stream).header("range", input),
            StatusCode::PARTIAL_CONTENT,
        )
        .await;
        assert_eq!(res.headers()["accept-ranges"], "bytes");
        assert_eq!(res.headers()["content-range"], expected);
        assert_eq!(res.headers()["content-length"], (end - start).to_string());
        assert_eq!(res.headers()["content-type"], "video/mp4");
        assert_eq!(res.bytes().await.unwrap().as_ref(), &bytes[start..end]);
    }
    let bad = response(
        api.get(stream).header("range", "bytes=64-"),
        StatusCode::RANGE_NOT_SATISFIABLE,
    )
    .await;
    assert_eq!(bad.headers()["content-range"], "bytes */64");
    let download = response(api.get("/clips/clip/download"), StatusCode::OK).await;
    assert_eq!(
        download.headers()["content-disposition"],
        "attachment; filename=\"Test_Clip.mp4\""
    );
    assert_eq!(download.bytes().await.unwrap().as_ref(), bytes.as_slice());
    assert!(ok(api.get("/jobs/job")).await["clips"][0]["downloadedAt"].is_string());
    response(api.delete("/clips/clip"), StatusCode::NO_CONTENT).await;
    assert!(!path.exists());
    response(api.get(stream), StatusCode::NOT_FOUND).await;
    api.stop();
}
