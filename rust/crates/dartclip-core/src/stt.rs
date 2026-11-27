//! Timestamped Whisper and multimodal Gemini audio fallback.
use crate::{
    live_chat::{number, Window},
    llm,
    models::{TranscriptCue as Cue, WordTiming as Word},
    subtitles::{
        caption_tokens, cue_to_words, ends_sentence, sanitize, MAX_TAIL_WORD_SEC,
        MAX_WORD_DISPLAY_SEC,
    },
    tools::{self, ToolPaths},
};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::multipart::{Form, Part};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::Path,
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

pub const DEFAULT_STT_MODEL: &str = "groq/whisper-large-v3-turbo";
pub const DEFAULT_STT_FALLBACK_MODEL: &str = "ag/gemini-4-hydrogen-low";
pub const MAX_STT_WINDOW_CONCURRENCY: usize = 4;
const MAX_STT_CHUNK_SEC: f64 = 180.;
const MAX_GEMINI_SLICE_SEC: f64 = 45.;
const MAX_MP3_BYTES: u64 = 20 * 1024 * 1024;
static WARNED_MODELS: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Mutex::default);

#[derive(Clone)]
pub struct SttConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub fallback_base_url: String,
    pub fallback_api_key: String,
    pub fallback_model: String,
}
impl Default for SttConfig {
    fn default() -> Self {
        Self::new("", "")
    }
}
impl SttConfig {
    /// Configure both defaults on an OpenAI-compatible provider. Override the model
    /// fields or use `with_fallback` for providers with separate endpoints.
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        let base_url = base_url.into();
        let api_key = api_key.into();
        Self {
            fallback_base_url: base_url.clone(),
            fallback_api_key: api_key.clone(),
            base_url,
            api_key,
            model: DEFAULT_STT_MODEL.into(),
            fallback_model: DEFAULT_STT_FALLBACK_MODEL.into(),
        }
    }
    pub fn with_fallback(
        mut self,
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        self.fallback_base_url = base_url.into();
        self.fallback_api_key = api_key.into();
        self.fallback_model = model.into();
        self
    }
    pub fn from_env() -> Self {
        Self::from_lookup(|name| std::env::var(name).ok())
    }
    fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Self {
        let choose = |key, default: &str, url: bool| {
            let value = get(key).unwrap_or_default();
            let value = value.trim();
            let value = if url {
                value.trim_end_matches('/')
            } else {
                value
            };
            if value.is_empty() {
                default.to_owned()
            } else {
                value.to_owned()
            }
        };
        let llm_url = choose("LLM_BASE_URL", "", true);
        let llm_key = choose("LLM_API_KEY", "", false);
        let base_url = choose("STT_BASE_URL", &llm_url, true);
        let api_key = choose("STT_API_KEY", &llm_key, false);
        Self {
            fallback_base_url: choose(
                "STT_FALLBACK_BASE_URL",
                if llm_url.is_empty() {
                    &base_url
                } else {
                    &llm_url
                },
                true,
            ),
            fallback_api_key: choose(
                "STT_FALLBACK_API_KEY",
                if llm_key.is_empty() {
                    &api_key
                } else {
                    &llm_key
                },
                false,
            ),
            fallback_model: get("STT_FALLBACK_MODEL").map_or_else(
                || DEFAULT_STT_FALLBACK_MODEL.into(),
                |s| s.trim().to_owned(),
            ),
            model: choose("STT_MODEL", DEFAULT_STT_MODEL, false),
            base_url,
            api_key,
        }
    }
    pub fn whisper_configured(&self) -> bool {
        [&self.base_url, &self.api_key, &self.model]
            .iter()
            .all(|s| !s.trim().is_empty())
    }
    pub fn gemini_configured(&self) -> bool {
        [
            &self.fallback_base_url,
            &self.fallback_api_key,
            &self.fallback_model,
        ]
        .iter()
        .all(|s| !s.trim().is_empty())
    }
    pub fn is_configured(&self) -> bool {
        self.whisper_configured() || self.gemini_configured()
    }
}
fn endpoint(base: &str, method: &str) -> String {
    format!("{}/{method}", base.trim().trim_end_matches('/'))
}
fn items(value: &Value) -> &[Value] {
    value.as_array().map_or(&[], Vec::as_slice)
}

pub fn words_to_cues(raw: &[Value], offset: f64) -> Vec<Cue> {
    let mut words = Vec::new();
    let mut text = String::new();
    let mut times = Vec::new();
    for item in raw {
        let token = item["word"].as_str().unwrap_or_default().trim();
        if token.is_empty() {
            continue;
        }
        times.push((text.len(), number(&item["start"]), number(&item["end"])));
        text.push_str(token);
        text.push(' ');
    }
    for (at, piece, keep) in caption_tokens(&text) {
        if !keep {
            continue;
        }
        let text = sanitize(piece);
        if text.is_empty() {
            continue;
        }
        let (_, Some(start), Some(end)) = times[times.partition_point(|t| t.0 <= at) - 1] else {
            continue;
        };
        let start = start.max(0.);
        let end = if end <= start { start + 0.05 } else { end };
        words.push(Word {
            start: start + offset,
            end: end + offset,
            text,
        });
    }
    words.sort_by(|a, b| a.start.total_cmp(&b.start));
    let mut cues = Vec::new();
    let mut group = Vec::<Word>::new();
    fn finish(cues: &mut Vec<Cue>, group: &mut Vec<Word>) {
        let tail = group.last_mut().unwrap();
        tail.end = tail.end.min(tail.start + MAX_TAIL_WORD_SEC);
        cues.push(Cue {
            start: group[0].start,
            end: group
                .iter()
                .map(|w| w.end)
                .fold(f64::NEG_INFINITY, f64::max),
            text: group
                .iter()
                .map(|w| w.text.as_str())
                .collect::<Vec<_>>()
                .join(" "),
            words: std::mem::take(group),
        });
    }
    for word in words {
        let group_len = group.len();
        let group_start = group.first().map(|w| w.start);
        if let Some(prev) = group.last_mut() {
            prev.end = prev.end.min(prev.start + MAX_WORD_DISPLAY_SEC);
            let pause = word.start - prev.end;
            if pause >= 0.75
                || group_len >= 12
                || group_start.is_some_and(|start| word.end - start > 6.)
                || (group_len >= 4 && ends_sentence(&prev.text))
            {
                finish(&mut cues, &mut group);
            }
        }
        group.push(word);
    }
    if !group.is_empty() {
        finish(&mut cues, &mut group);
    }
    cues
}

pub fn segments_to_cues(raw: &[Value], offset: f64, trim_leading_silence: bool) -> Vec<Cue> {
    let mut cues: Vec<_> = raw
        .iter()
        .filter_map(|s| {
            let text = sanitize(s["text"].as_str()?);
            let mut start = number(&s["start"])?.max(0.);
            let end = number(&s["end"])?;
            if text.is_empty() || end <= start {
                return None;
            }
            if trim_leading_silence {
                let words = text.split_whitespace().count();
                let chars = text.chars().filter(|c| !c.is_whitespace()).count();
                let spoken = 1.2_f64
                    .max(words as f64 * 0.55 + 0.5)
                    .max(chars as f64 / 9. + 0.6);
                start = start.max(end - spoken);
            }
            let mut cue = Cue {
                start: start + offset,
                end: end + offset,
                text,
                words: vec![],
            };
            cue.words = cue_to_words(&cue);
            Some(cue)
        })
        .collect();
    cues.sort_by(|a, b| a.start.total_cmp(&b.start));
    cues
}

const GEMINI_PROMPT: &str = concat!("Transcribe only verbatim speech in its original language. Do not translate or include sound ",
    "annotations such as [tertawa] or [Musik]. Return only strict JSON: ",
    "{\"segments\":[{\"start\":0.0,\"end\":1.5,\"text\":\"spoken words\"}]}. ",
    "Times are seconds relative to this audio slice, not the source video. Use an empty segments array if there is no speech.");
fn gemini_payload(model: &str, wav: &[u8]) -> Value {
    json!({"model":model,"temperature":0,"stream":false,"messages":[{"role":"user","content":[
        {"type":"text","text":GEMINI_PROMPT}, {"type":"input_audio","input_audio":{"data":STANDARD.encode(wav),"format":"wav"}}
    ]}]})
}
fn body_preview(body: &str) -> &str {
    let body = body.trim();
    let end = body.char_indices().nth(180).map_or(body.len(), |(i, _)| i);
    &body[..end]
}
fn parse_gemini_body(body: &str, content_type: &str, duration: f64, offset: f64) -> Result<Vec<Cue>> {
    let Some(raw) = llm::extract_chat_content(body) else {
        if let Ok(response) = serde_json::from_str::<Value>(body) {
            if let Some(message) = response
                .pointer("/error/message")
                .and_then(Value::as_str)
                .or_else(|| response.pointer("/error").and_then(Value::as_str))
            {
                bail!("Gemini transcription error: {}", body_preview(message));
            }
        }
        bail!(
            "Gemini returned no transcription content (content-type: {content_type}): {}",
            body_preview(body)
        );
    };
    let mut segments = llm::parse_llm_list(
        &raw,
        &[
            "segments", "moments", "clips", "results", "result", "data", "captions",
        ],
        true,
    )?;
    segments.retain_mut(|s| {
        let (Some(start), Some(end)) = (number(&s["start"]), number(&s["end"])) else {
            return false;
        };
        s["start"] = json!(start.clamp(0., duration));
        s["end"] = json!(end.clamp(0., duration));
        true
    });
    Ok(segments_to_cues(&segments, offset, false))
}
fn whisper_form(model: &str, audio: Vec<u8>, language: &str) -> Result<Form> {
    let mut form = Form::new()
        .text("model", model.to_owned())
        .text("response_format", "verbose_json")
        .text("timestamp_granularities[]", "word")
        .text("timestamp_granularities[]", "segment")
        .part(
            "file",
            Part::bytes(audio)
                .file_name("chunk.mp3")
                .mime_str("audio/mpeg")?,
        );
    if matches!(language, "id" | "en") {
        form = form.text("language", language.to_owned());
    }
    Ok(form)
}
fn parse_whisper(response: &Value, model: &str, offset: f64) -> Result<Vec<Cue>> {
    let words = items(&response["words"]);
    let segments = items(&response["segments"]);
    if words.is_empty()
        && !segments.is_empty()
        && WARNED_MODELS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(model.to_owned())
    {
        let message = format!("STT {model} tidak mengembalikan timestamp per kata; gunakan STT_BASE_URL langsung ke Groq/OpenAI untuk sinkronisasi presisi");
        if log::max_level() == log::LevelFilter::Off {
            // The standalone worker may not have installed a logger yet.
            eprintln!("{message}");
        } else {
            log::warn!("{message}");
        }
    }
    if words.is_empty()
        && segments.is_empty()
        && !sanitize(response["text"].as_str().unwrap_or_default()).is_empty()
    {
        bail!("Whisper mengembalikan transkrip tanpa timestamp");
    }
    let cues = words_to_cues(words, offset);
    Ok(if cues.is_empty() {
        segments_to_cues(segments, offset, true)
    } else {
        cues
    })
}

#[derive(Clone)]
pub(crate) struct Transcriber {
    cfg: SttConfig,
    client: reqwest::Client,
    tools: ToolPaths,
}
impl Transcriber {
    pub(crate) fn new(cfg: SttConfig, tools: ToolPaths) -> Result<Self> {
        Ok(Self {
            cfg,
            tools,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(90))
                .build()?,
        })
    }

    async fn request_text(
        &self,
        request: reqwest::RequestBuilder,
        cancel: &CancellationToken,
    ) -> Result<(String, String)> {
        let request = async {
            let response = request.send().await.map_err(reqwest::Error::without_url)?;
            let status = response.status();
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("unknown")
                .to_owned();
            let body = response.text().await.map_err(reqwest::Error::without_url)?;
            if !status.is_success() {
                let preview = body_preview(&body);
                if preview.is_empty() {
                    bail!("STT HTTP {status}");
                }
                bail!("STT HTTP {status}: {preview}");
            }
            Ok((body, content_type))
        };
        tokio::select! { biased; _ = cancel.cancelled() => bail!("job cancelled"), result = request => result }
    }
    #[allow(clippy::too_many_arguments)]
    async fn chunk(
        &self,
        path: &Path,
        duration: f64,
        offset: f64,
        language: &str,
        dir: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<Cue>> {
        if self.cfg.whisper_configured() {
            let request = self
                .client
                .post(endpoint(&self.cfg.base_url, "audio/transcriptions"))
                .bearer_auth(&self.cfg.api_key)
                .multipart(whisper_form(
                    &self.cfg.model,
                    std::fs::read(path)?,
                    language,
                )?);
            let result = self
                .request_text(request, cancel)
                .await
                .and_then(|(body, content_type)| {
                    let response = serde_json::from_str::<Value>(&body).map_err(|error| {
                        anyhow::anyhow!(
                            "Whisper returned invalid JSON (content-type: {content_type}): {error}; body: {}",
                            body_preview(&body)
                        )
                    })?;
                    parse_whisper(&response, &self.cfg.model, offset)
                });
            match result {
                Ok(cues) if !cues.is_empty() || !self.cfg.gemini_configured() => return Ok(cues),
                Err(e) if !self.cfg.gemini_configured() || cancel.is_cancelled() => return Err(e),
                _ => log::warn!(
                    "STT Whisper gagal atau kosong; mencoba model cadangan {}",
                    self.cfg.fallback_model
                ),
            }
        }
        let wav = dir.join("slice.wav");
        let mut cues = Vec::new();
        for (start, end) in chunks((0., duration), MAX_GEMINI_SLICE_SEC) {
            self.extract_local(path, &wav, (start, end), true, cancel)
                .await?;
            let request = self
                .client
                .post(endpoint(&self.cfg.fallback_base_url, "chat/completions"))
                .bearer_auth(&self.cfg.fallback_api_key)
                .header(reqwest::header::ACCEPT, "application/json")
                .json(&gemini_payload(
                    &self.cfg.fallback_model,
                    &std::fs::read(&wav)?,
                ));
            let (body, content_type) = self.request_text(request, cancel).await?;
            cues.extend(parse_gemini_body(
                &body,
                &content_type,
                end - start,
                offset + start,
            )?);
        }
        Ok(cues)
    }
    async fn extract_local(
        &self,
        path: &Path,
        out: &Path,
        (start, end): Window,
        wav: bool,
        cancel: &CancellationToken,
    ) -> Result<()> {
        let mut cmd = tools::ffmpeg(&self.tools.ffmpeg);
        cmd.args(["-ss", &format!("{start:.6}"), "-i"])
            .arg(path)
            .args([
                "-t",
                &format!("{:.6}", end - start),
                "-map",
                "0:a:0",
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
            ]);
        if wav {
            cmd.args(["-c:a", "pcm_s16le", "-f", "wav"]);
        } else {
            cmd.args(["-c:a", "libmp3lame", "-b:a", "32k", "-f", "mp3"]);
        }
        tools::run(cmd.arg(out), Duration::from_secs(90), cancel).await?;
        Ok(())
    }
    pub(crate) async fn duration(&self, path: &Path, cancel: &CancellationToken) -> Result<f64> {
        let out = tools::run(
            Command::new(&self.tools.ffprobe)
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "csv=p=0",
                ])
                .arg(path),
            Duration::from_secs(20),
            cancel,
        )
        .await?;
        String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|d| d.is_finite() && *d > 0.)
            .context("durasi media untuk transkripsi tidak terbaca")
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn media(
        &self,
        path: &Path,
        bounds: Option<Window>,
        offset: f64,
        language: &str,
        dir: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<Cue>> {
        let (first, stop) = match bounds {
            Some(bounds) => bounds,
            None => (0., self.duration(path, cancel).await?),
        };
        if !first.is_finite() || !stop.is_finite() || first < 0. {
            bail!("batas transkripsi tidak valid")
        }
        if bounds.is_none()
            && stop <= MAX_STT_CHUNK_SEC
            && path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("mp3"))
            && path.metadata()?.len() <= MAX_MP3_BYTES
        {
            return self.chunk(path, stop, offset, language, dir, cancel).await;
        }
        let mut cues = Vec::new();
        let mp3 = dir.join("chunk.mp3");
        for (start, end) in chunks((first, stop), MAX_STT_CHUNK_SEC) {
            self.extract_local(path, &mp3, (start, end), false, cancel)
                .await?;
            cues.extend(
                self.chunk(
                    &mp3,
                    end - start,
                    offset + start - first,
                    language,
                    dir,
                    cancel,
                )
                .await?,
            );
        }
        cues.sort_by(|a, b| a.start.total_cmp(&b.start));
        Ok(cues)
    }
    pub(crate) async fn remote_window(
        &self,
        url: &str,
        stream: Option<&HlsAudio>,
        bounds: Window,
        language: &str,
        dir: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<Cue>> {
        if let Some(stream) = stream {
            let mut cues = Vec::new();
            for (start, end) in chunks(bounds, MAX_STT_CHUNK_SEC) {
                let path = dir.join("hls.mp3");
                if self.extract_hls(stream, (start, end), &path, cancel).await {
                    // This MP3 is already mono/16 kHz; send it directly to Whisper.
                    cues.extend(
                        self.chunk(&path, end - start, start, language, dir, cancel)
                            .await?,
                    );
                } else {
                    if cancel.is_cancelled() {
                        bail!("job cancelled")
                    }
                    cues.extend(
                        self.downloaded_window(url, (start, end), language, dir, cancel)
                            .await?,
                    );
                }
            }
            return Ok(cues);
        }
        self.downloaded_window(url, bounds, language, dir, cancel)
            .await
    }
    async fn downloaded_window(
        &self,
        url: &str,
        (start, end): Window,
        language: &str,
        dir: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<Cue>> {
        let temp = tempfile::Builder::new()
            .prefix("section-")
            .tempdir_in(dir)?;
        let mut cmd = Command::new(&self.tools.ytdlp);
        cmd.arg("--ffmpeg-location")
            .arg(&self.tools.ffmpeg)
            .args([
                "-f",
                "ba[ext=m4a]/ba/b",
                "--no-playlist",
                "--no-progress",
                "--no-warnings",
                "-N",
                "8",
                "--http-chunk-size",
                "10M",
                "--download-sections",
                &format!("*{start:.3}-{end:.3}"),
                "-o",
            ])
            .arg(temp.path().join("audio.%(ext)s"))
            .args(["--", url]);
        if tools::run(&mut cmd, Duration::from_secs(300), cancel)
            .await
            .is_err()
        {
            if cancel.is_cancelled() {
                bail!("job cancelled")
            }
            log::warn!("gagal unduh audio segmen untuk transkripsi");
            return Ok(vec![]);
        }
        let path = std::fs::read_dir(temp.path())?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|p| {
                p.is_file()
                    && p.extension().and_then(|s| s.to_str()).is_some_and(|s| {
                        matches!(
                            s.to_ascii_lowercase().as_str(),
                            "m4a"
                                | "mp4"
                                | "webm"
                                | "opus"
                                | "ogg"
                                | "mp3"
                                | "aac"
                                | "mkv"
                                | "ts"
                                | "wav"
                        )
                    })
            })
            .min();
        match path {
            Some(path) => {
                self.media(&path, None, start, language, temp.path(), cancel)
                    .await
            }
            None => Ok(vec![]),
        }
    }
    async fn extract_hls(
        &self,
        stream: &HlsAudio,
        bounds: Window,
        out: &Path,
        cancel: &CancellationToken,
    ) -> bool {
        let _ = std::fs::remove_file(out);
        if tools::run(
            &mut hls_command(&self.tools.ffmpeg, stream, bounds, out),
            Duration::from_secs(60),
            cancel,
        )
        .await
        .is_ok()
            && out.metadata().is_ok_and(|m| m.len() > 0)
        {
            return true;
        }
        // Never log ffmpeg output here; it may contain signed URLs/headers.
        log::warn!("gagal ekstrak audio HLS; mencoba unduh segmen audio");
        false
    }
}

fn chunks((first, stop): Window, size: f64) -> impl Iterator<Item = Window> {
    std::iter::successors((first < stop).then_some(first), move |start| {
        (start + size < stop).then_some(start + size)
    })
    .map(move |start| (start, stop.min(start + size)))
}

#[derive(Clone)]
pub(crate) struct HlsAudio {
    url: String,
    headers: String,
}
pub(crate) fn pick_hls_audio(meta: &Value) -> Option<HlsAudio> {
    items(&meta["formats"])
        .iter()
        .filter_map(|fmt| {
            let url = fmt["url"].as_str()?.trim();
            if !reqwest::Url::parse(url).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
                || fmt["vcodec"] != "none"
                || fmt["acodec"] == "none"
                || fmt["audio_ext"] == "none"
                || !fmt["protocol"]
                    .as_str()?
                    .to_ascii_lowercase()
                    .contains("m3u8")
            {
                return None;
            }
            let bitrate = ["abr", "tbr"]
                .into_iter()
                .find_map(|k| number(&fmt[k]).filter(|b| *b > 0.))
                .unwrap_or(f64::INFINITY);
            Some((
                bitrate,
                fmt["format_id"].as_str().unwrap_or_default(),
                url,
                &fmt["http_headers"],
            ))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(b.1)))
        .map(|(_, _, url, headers)| HlsAudio {
            url: url.to_owned(),
            headers: headers
                .as_object()
                .into_iter()
                .flat_map(|h| h.iter())
                .filter_map(|(name, value)| {
                    let value = value.as_str()?;
                    if reqwest::header::HeaderName::from_bytes(name.as_bytes()).is_err()
                        || reqwest::header::HeaderValue::from_str(value).is_err()
                    {
                        return None;
                    }
                    Some(format!("{name}: {value}\r\n"))
                })
                .collect(),
        })
}
fn hls_command(ffmpeg: &Path, stream: &HlsAudio, (start, end): Window, out: &Path) -> Command {
    let mut cmd = tools::ffmpeg(ffmpeg);
    if !stream.headers.is_empty() {
        cmd.args(["-headers", &stream.headers]);
    }
    let len = format!("{:.3}", (end - start).max(0.5));
    cmd.args([
        "-ss",
        &format!("{start:.3}"),
        "-t",
        &len,
        "-i",
        &stream.url,
        "-t",
        &len,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "32k",
    ])
    .arg(out);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_uses_stt_override_and_independent_fallback() {
        let cfg = SttConfig::from_lookup(|key| match key {
            "LLM_BASE_URL" => Some(" https://router.test/v1/ ".into()),
            "LLM_API_KEY" => Some("router".into()),
            "STT_BASE_URL" => Some("https://groq.test/v1/".into()),
            "STT_API_KEY" => Some("groq".into()),
            "STT_MODEL" => Some("whisper-large-v3-turbo".into()),
            "STT_FALLBACK_MODEL" => Some("  ".into()),
            _ => None,
        });
        assert!(cfg.whisper_configured());
        assert!(!cfg.gemini_configured());
        assert_eq!(
            (
                cfg.base_url.as_str(),
                cfg.api_key.as_str(),
                cfg.model.as_str()
            ),
            ("https://groq.test/v1", "groq", "whisper-large-v3-turbo")
        );
        assert_eq!(
            (
                cfg.fallback_base_url.as_str(),
                cfg.fallback_api_key.as_str()
            ),
            ("https://router.test/v1", "router")
        );
        assert!(!SttConfig::default().is_configured());
        let desktop = SttConfig::new("https://router.test/v1", "key");
        assert!(desktop.is_configured());
        assert_eq!(desktop.fallback_model, DEFAULT_STT_FALLBACK_MODEL);
    }

    #[test]
    fn timed_words_filter_cross_entry_annotations_and_keep_gaps() {
        let input: Vec<_> = [
            ("Halo", 0.5, 0.9),
            ("[tertawa]", 0.9, 1.1),
            ("[", 1.1, 1.2),
            ("__", 1.2, 1.3),
            ("]", 1.3, 1.35),
            ("f***", 1.35, 1.4),
            ("***", 1.4, 1.45),
            ("♪", 1.45, 1.5),
            ("dunia", 1.5, 1.5),
            ("[Musik]", 2., 2.2),
            ("Lanjut", 3., 20.),
        ]
        .into_iter()
        .map(|(w, s, e)| json!({"word":w,"start":s,"end":e}))
        .collect();
        let cues = words_to_cues(&input, 40.);
        assert_eq!(
            cues.iter().map(|c| c.text.as_str()).collect::<Vec<_>>(),
            ["Halo dunia", "Lanjut"]
        );
        assert_eq!(
            cues[0]
                .words
                .iter()
                .map(|w| (w.start, w.end))
                .collect::<Vec<_>>(),
            [(40.5, 40.9), (41.5, 41.55)]
        );
        assert_eq!(cues[1].end, 44.2);
        let text = "I have four words. one two three four five six seven eight nine ten eleven twelve last";
        let input: Vec<_> = text
            .split_whitespace()
            .enumerate()
            .map(|(i, t)| json!({"word":t,"start":i as f64/4.,"end":i as f64/4.+0.1}))
            .collect();
        assert_eq!(
            words_to_cues(&input, 0.)
                .iter()
                .map(|c| c.words.len())
                .collect::<Vec<_>>(),
            [4, 12, 1]
        );
    }

    #[test]
    fn timed_words_cap_stretched_word_before_splitting_at_pause_threshold() {
        let input = [
            json!({"word":"one","start":0.1,"end":1.75}),
            json!({"word":"two","start":1.75,"end":4.0}),
        ];
        let cues = words_to_cues(&input, 0.);
        assert_eq!(
            cues.iter().map(|c| c.text.as_str()).collect::<Vec<_>>(),
            ["one", "two"]
        );
        assert_eq!(cues[0].words[0].end, 1.0);
        assert_eq!(cues[0].end, cues[0].start + MAX_WORD_DISPLAY_SEC);
        assert_eq!(cues[1].start - cues[0].end, 0.75);
        assert_eq!(cues[1].words[0].end, 2.95);
        assert_eq!(cues[1].end, cues[1].start + MAX_TAIL_WORD_SEC);
    }

    #[test]
    fn segment_only_whisper_trims_leading_silence_without_touching_end() {
        let response = json!({"segments":[
            {"start":14.26,"end":21.46,"text":"Ternyata semuanya masih berjalan"},
            {"start":22.,"end":23.8,"text":"Ini masih normal"},
            {"start":25.,"end":26.56,"text":"Semut"},
            {"start":27.,"end":29.,"text":"[Musik]"},
            {"start":30.,"end":31.5,"text":"Halo [tertawa] f*** dunia"}
        ]});
        let model = "test-segment-only";
        for _ in 0..2 {
            let cues = parse_whisper(&response, model, 100.).unwrap();
            assert_eq!(cues.len(), 4);
            for (cue, (s, e)) in cues.iter().zip([
                (121.46 - (29. / 9. + 0.6), 121.46),
                (122., 123.8),
                (125.36, 126.56),
                (130., 131.5),
            ]) {
                assert!((cue.start - s).abs() < 1e-10);
                assert!((cue.end - e).abs() < 1e-10);
                assert_eq!(cue.words.first().unwrap().start, cue.start);
                assert_eq!(cue.words.last().unwrap().end, cue.end);
            }
            assert_eq!(cues[3].text, "Halo dunia");
        }
        assert!(WARNED_MODELS.lock().unwrap().contains(model));
        assert!(parse_whisper(&json!({"text":"untimed speech"}), model, 0.).is_err());
    }

    #[test]
    fn gemini_fenced_json_is_clamped_and_offset_and_accepts_silence() {
        let response = |content| json!({"choices":[{"message":{"content":content}}]}).to_string();
        let body = response(
            "```json\n{\"segments\":[{\"start\":-2,\"end\":100,\"text\":\"[tertawa] halo\"}]}\n```",
        );
        let c = parse_gemini_body(&body, "application/json", 45., 80.).unwrap();
        assert_eq!(
            (c[0].start, c[0].end, c[0].text.as_str()),
            (80., 125., "halo")
        );
        assert!(parse_gemini_body(
            &response(r#"{"segments":[]}"#),
            "application/json",
            5.,
            0.,
        )
        .unwrap()
        .is_empty());
        let payload = gemini_payload("model", b"wav");
        assert_eq!(payload["stream"], json!(false));
        assert_eq!(
            payload["messages"][0]["content"][1],
            json!({"type":"input_audio","input_audio":{"data":"d2F2","format":"wav"}})
        );
    }

    #[test]
    fn gemini_9router_sse_is_clamped_and_offset() {
        let body = concat!(
            r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#,
            "\n\n",
            r#"data: {"choices":[{"delta":{"content":"{\"segments\":["}}]}"#,
            "\n\n",
            r#"data: {"choices":[{"delta":{"content":"{\"start\":-2,\"end\":10,\"text\":\"halo\"}]}"}}]}"#,
            "\n\ndata: [DONE]\n",
        );
        let cues = parse_gemini_body(body, "text/event-stream", 5., 80.).unwrap();
        assert_eq!(cues.len(), 1);
        assert_eq!(
            (cues[0].start, cues[0].end, cues[0].text.as_str()),
            (80., 85., "halo"),
        );
    }

    #[test]
    fn gemini_surfaces_provider_error_messages() {
        for body in [
            r#"{"error":{"message":"Audio not supported"}}"#,
            r#"{"error":"Audio not supported"}"#,
        ] {
            let error = parse_gemini_body(body, "application/json", 5., 0.)
                .err()
                .expect("expected a provider error");
            assert_eq!(
                error.to_string(),
                "Gemini transcription error: Audio not supported"
            );
        }
    }

    #[test]
    fn hls_stream_selection_and_seek_arguments_and_chunk_offsets() {
        let fmt = |id, codec, audio_ext, bitrate, protocol| json!({"format_id":id,"vcodec":codec,"audio_ext":audio_ext,"acodec":null,"url":format!("https://media.test/{id}.m3u8"),"protocol":protocol,"abr":bitrate,"http_headers":{"User-Agent":"Test"}});
        let meta = json!({"formats":[fmt("video","avc1","aac",1,"m3u8"),fmt("dash","none","aac",1,"http"),fmt("000","none","none",1,"m3u8"),fmt("234","none","mp4",48,"m3u8"),fmt("235","none","mp4",32,"m3u8"),fmt("233","none","mp4",32,"M3U8")]});
        let stream = pick_hls_audio(&meta).unwrap();
        assert_eq!(stream.url, "https://media.test/233.m3u8");
        assert_eq!(stream.headers, "User-Agent: Test\r\n");
        let cmd = hls_command(
            Path::new("ffmpeg"),
            &stream,
            (22.5, 22.6),
            Path::new("out.mp3"),
        );
        let args: Vec<_> = cmd
            .as_std()
            .get_args()
            .map(|s| s.to_str().unwrap())
            .collect();
        assert!(args
            .windows(6)
            .any(|args| args == ["-ss", "22.500", "-t", "0.500", "-i", &stream.url]));
        assert!(args
            .windows(4)
            .any(|args| args == ["-c:a", "libmp3lame", "-b:a", "32k"]));
        assert_eq!(
            chunks((30., 400.), 180.).collect::<Vec<_>>(),
            [(30., 210.), (210., 390.), (390., 400.)]
        );
    }

    fn serve_json(
        listener: std::net::TcpListener,
        responses: &[(&str, &str)],
    ) -> Vec<(String, String)> {
        use std::io::{BufRead, BufReader, Read, Write};
        responses.iter().map(|(status,response)| {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut reader = BufReader::new(&mut stream);
            let mut header = String::new();
            loop {
                let n = header.len();
                assert!(reader.read_line(&mut header).unwrap() > 0);
                if &header[n..] == "\r\n" { break; }
            }
            let lower = header.to_ascii_lowercase();
            let size: usize = lower.lines().find_map(|line| line.strip_prefix("content-length:")).unwrap().trim().parse().unwrap();
            let mut body = vec![0;size];
            reader.read_exact(&mut body).unwrap();
            write!(stream,"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",response.len()).unwrap();
            (header,String::from_utf8(body).unwrap())
        }).collect()
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn missing_or_failed_whisper_falls_back_to_gemini_wav_slices() {
        use std::os::unix::fs::PermissionsExt;
        for (status, whisper) in [
            ("503 Service Unavailable", "{}"),
            ("200 OK", r#"{"segments":[]}"#),
        ] {
            let primary = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let fallback = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let primary_addr = primary.local_addr().unwrap();
            let fallback_addr = fallback.local_addr().unwrap();
            let server = std::thread::spawn(move || serve_json(primary, &[(status, whisper)]));
            let gemini_server = std::thread::spawn(move || {
                let response = json!({"choices":[{"message":{"content":"```json\n{\"segments\":[{\"start\":-1,\"end\":100,\"text\":\"[Musik] hello\"}]}\n```"}}]}).to_string();
                serve_json(fallback, &[("200 OK", &response), ("200 OK", &response)])
            });
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("audio.mp3");
            std::fs::write(&path, b"mp3").unwrap();
            let ffmpeg = dir.path().join("ffmpeg");
            std::fs::write(
                &ffmpeg,
                "#!/bin/sh\nfor output do :; done\nprintf wav > \"$output\"\n",
            )
            .unwrap();
            std::fs::set_permissions(&ffmpeg, std::fs::Permissions::from_mode(0o755)).unwrap();
            let tools = ToolPaths {
                ffmpeg,
                ffprobe: "unused".into(),
                ytdlp: "unused".into(),
            };
            let cfg = SttConfig::new(format!("http://{primary_addr}/v1"), "whisper-key")
                .with_fallback(
                    format!("http://{fallback_addr}/v1"),
                    "gemini-key",
                    "gemini-model",
                );
            let cues = Transcriber::new(cfg, tools)
                .unwrap()
                .chunk(
                    &path,
                    50.,
                    80.,
                    "auto",
                    dir.path(),
                    &CancellationToken::new(),
                )
                .await
                .unwrap();
            assert!(!server.join().unwrap()[0].1.contains("name=\"language\""));
            assert_eq!(
                cues.iter()
                    .map(|c| (c.start, c.end, c.text.as_str()))
                    .collect::<Vec<_>>(),
                [(80., 125., "hello"), (125., 130., "hello")]
            );
            for (headers, body) in gemini_server.join().unwrap() {
                assert!(headers.starts_with("POST /v1/chat/completions HTTP/1.1"));
                assert!(headers
                    .to_ascii_lowercase()
                    .contains("authorization: bearer gemini-key"));
                let payload: Value = serde_json::from_str(&body).unwrap();
                assert_eq!(payload["model"], "gemini-model");
                assert_eq!(
                    payload["messages"][0]["content"][1]["input_audio"],
                    json!({"data":"d2F2","format":"wav"})
                );
            }
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn direct_hls_passes_mp3_through_or_downloads_the_same_window() {
        use std::os::unix::fs::PermissionsExt;
        for succeeds in [true, false] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                serve_json(
                    listener,
                    &[(
                        "200 OK",
                        r#"{"words":[{"word":"speech","start":0.25,"end":0.6}]}"#,
                    )],
                )
            });
            let dir = tempfile::tempdir().unwrap();
            let script = |name: &str, source: &str| {
                let path = dir.path().join(name);
                std::fs::write(&path, source).unwrap();
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
                path
            };
            let ffmpeg = script(
                "ffmpeg",
                if succeeds {
                    "#!/bin/sh\nfor arg do case \"$arg\" in *.m3u8) hls=1;; esac; done\n[ \"$hls\" = 1 ] || exit 1\nprintf hls-mp3 > \"$arg\"\n"
                } else {
                    "#!/bin/sh\nexit 1\n"
                },
            );
            let ytdlp = script(
                "yt-dlp",
                if succeeds {
                    "#!/bin/sh\nexit 1\n"
                } else {
                    r#"#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    --download-sections) [ "$2" = '*22.500-24.000' ] || exit 1; shift;;
    -o) output="$2"; shift;;
  esac
  shift
done
printf fallback-mp3 > "${output%.*}.mp3"
"#
                },
            );
            let ffprobe = script("ffprobe", "#!/bin/sh\nprintf '1.5\n'\n");
            let cfg = SttConfig::new(format!("http://{addr}/v1"), "key").with_fallback("", "", "");
            let stt = Transcriber::new(
                cfg,
                ToolPaths {
                    ffmpeg,
                    ffprobe,
                    ytdlp,
                },
            )
            .unwrap();
            let stream = HlsAudio {
                url: "https://media.test/audio.m3u8".into(),
                headers: String::new(),
            };
            let cues = stt
                .remote_window(
                    "https://example.test",
                    Some(&stream),
                    (22.5, 24.),
                    "en",
                    dir.path(),
                    &CancellationToken::new(),
                )
                .await
                .unwrap();
            assert_eq!(cues[0].start, 22.75);
            let requests = server.join().unwrap();
            assert!(requests[0]
                .1
                .contains(if succeeds { "hls-mp3" } else { "fallback-mp3" }));
        }
    }

    // Inspect the actual HTTP multipart request rather than just the form builder.
    #[tokio::test]
    async fn whisper_posts_verbose_multipart_with_word_and_segment_granularity() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            serve_json(
                listener,
                &[(
                    "200 OK",
                    r#"{"words":[{"word":"speech","start":0.25,"end":0.6}]}"#,
                )],
            )
            .pop()
            .unwrap()
        });
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audio.mp3");
        std::fs::write(&path, b"placeholder audio").unwrap();
        let tools = ToolPaths {
            ffmpeg: "unused".into(),
            ffprobe: "unused".into(),
            ytdlp: "unused".into(),
        };
        let cfg = SttConfig::new(format!("http://{addr}/v1/"), "test-key");
        let client = Transcriber::new(cfg, tools).unwrap();
        let cues = client
            .chunk(&path, 1., 5., "id", dir.path(), &CancellationToken::new())
            .await
            .unwrap();
        let (headers, body) = server.join().unwrap();
        assert!(headers.starts_with("POST /v1/audio/transcriptions HTTP/1.1"));
        assert!(headers
            .to_ascii_lowercase()
            .contains("authorization: bearer test-key"));
        assert!(headers
            .to_ascii_lowercase()
            .contains("multipart/form-data; boundary="));
        for value in [
            "name=\"model\"\r\n\r\ngroq/whisper-large-v3-turbo",
            "name=\"response_format\"\r\n\r\nverbose_json",
            "name=\"timestamp_granularities[]\"\r\n\r\nword",
            "name=\"timestamp_granularities[]\"\r\n\r\nsegment",
            "name=\"language\"\r\n\r\nid",
            "placeholder audio",
        ] {
            assert!(body.contains(value), "missing {value:?} in {body}");
        }
        assert_eq!(
            (cues[0].start, cues[0].end, cues[0].text.as_str()),
            (5.25, 5.6, "speech")
        );
    }
}
