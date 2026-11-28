mod face;

use std::{
    env, fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{ExitCode, Stdio},
    sync::Arc,
    time::Duration,
};

use ab_glyph::FontRef;
use anyhow::{anyhow, bail, Context, Result};
use dartclip_core::{
    llm::{LlmClient, LlmConfig},
    models::{
        CaptionRequest, CaptureFrameRequest, FindMomentRequest, FrameRequest, GenerateImageRequest,
        JobData, PreviewRequest,
    },
    pipeline::{CancellationToken, Pipeline, PipelineConfig},
    stt::SttConfig,
    tools::ToolPaths,
};
use serde_json::{json, Value};
use tokio::process::Command;

const USAGE: &str =
    "dartclip-worker --task <job|preview|frame|caption|brief|generate-image|find-moment|capture-frame|llm-check|self-check> \
    [--payload-file <path> | --payload-stdin] [--clips-dir <path>] [--fonts-dir <path>] \
    [--cancel-file <path>]";
const MONTSERRAT: &[u8] = include_bytes!("../../dartclip-core/assets/Montserrat-Bold.ttf");

#[derive(Clone, Copy)]
enum Task {
    Job,
    Preview,
    Frame,
    Caption,
    Brief,
    GenerateImage,
    FindMoment,
    CaptureFrame,
    LlmCheck,
    SelfCheck,
}

impl Task {
    fn parse(task: &str) -> Result<Self> {
        Ok(match task {
            "job" => Self::Job,
            "preview" => Self::Preview,
            "frame" => Self::Frame,
            "caption" => Self::Caption,
            "brief" => Self::Brief,
            "generate-image" => Self::GenerateImage,
            "find-moment" => Self::FindMoment,
            "capture-frame" => Self::CaptureFrame,
            "llm-check" => Self::LlmCheck,
            "self-check" => Self::SelfCheck,
            _ => bail!("Task tidak dikenal: {task}"),
        })
    }
}

enum Payload {
    File(PathBuf),
    Stdin,
}

struct Args {
    task: Task,
    payload: Option<Payload>,
    clips_dir: PathBuf,
    fonts_dir: PathBuf,
    cancel_file: Option<PathBuf>,
}

fn env_path(name: &str) -> Option<PathBuf> {
    env::var_os(name).filter(|p| !p.is_empty()).map(Into::into)
}

impl Args {
    fn parse() -> Result<Option<Self>> {
        let mut args = env::args_os().skip(1);
        let mut task = None;
        let mut payload = None;
        let mut clips_dir = None;
        let mut fonts_dir = None;
        let mut cancel_file = None;
        while let Some(flag) = args.next() {
            let mut value = || {
                args.next()
                    .filter(|v| !v.is_empty())
                    .ok_or_else(|| anyhow!("Nilai untuk {} wajib diisi", flag.to_string_lossy()))
            };
            match flag.to_str() {
                Some("--help" | "-h") => return Ok(None),
                Some("--task") if task.is_none() => {
                    task = Some(Task::parse(&value()?.to_string_lossy())?)
                }
                Some("--payload-file") if payload.is_none() => {
                    payload = Some(Payload::File(value()?.into()))
                }
                Some("--payload-stdin") if payload.is_none() => payload = Some(Payload::Stdin),
                Some("--clips-dir") if clips_dir.is_none() => clips_dir = Some(value()?.into()),
                Some("--fonts-dir") if fonts_dir.is_none() => fonts_dir = Some(value()?.into()),
                Some("--cancel-file") if cancel_file.is_none() => {
                    cancel_file = Some(value()?.into())
                }
                Some("--payload-file" | "--payload-stdin") => {
                    bail!("Gunakan hanya satu dari --payload-file atau --payload-stdin")
                }
                _ => bail!(
                    "Argumen tidak dikenal atau duplikat: {}",
                    flag.to_string_lossy()
                ),
            }
        }
        Ok(Some(Self {
            task: task.ok_or_else(|| anyhow!("--task wajib diisi"))?,
            payload,
            clips_dir: clips_dir
                .or_else(|| env_path("CLIPS_DIR"))
                .unwrap_or_else(|| "/data/clips".into()),
            fonts_dir: fonts_dir
                .or_else(|| env_path("FONTS_DIR"))
                .unwrap_or_else(|| "/app/fonts".into()),
            cancel_file,
        }))
    }

    async fn read_payload(&self, cancel: &CancellationToken) -> Result<Value> {
        let bytes = match &self.payload {
            Some(Payload::File(path)) => fs::read(path).context("Tidak dapat membaca payload")?,
            Some(Payload::Stdin) => {
                // A blocking stdin read cannot be interrupted by dropping a Tokio future.
                // Use a standalone thread so a pending stdin read doesn't hold up runtime shutdown.
                let (sender, receiver) = tokio::sync::oneshot::channel();
                std::thread::spawn(move || {
                    let mut bytes = Vec::new();
                    let result = io::stdin().read_to_end(&mut bytes).map(|_| bytes);
                    let _ = sender.send(result);
                });
                tokio::select! { biased;
                    _ = cancel.cancelled() => bail!("job dibatalkan"),
                    result = receiver => result?.context("Tidak dapat membaca stdin")?,
                }
            }
            None if matches!(self.task, Task::LlmCheck | Task::SelfCheck) => return Ok(json!({})),
            None => bail!("Gunakan --payload-file atau --payload-stdin"),
        };
        let payload: Value = serde_json::from_slice(&bytes).context("Payload JSON tidak valid")?;
        if !payload.is_object() {
            bail!("Payload JSON harus berupa object");
        }
        Ok(payload)
    }

    fn pipeline(&self, llm: LlmClient) -> Result<Pipeline> {
        let mut config = PipelineConfig::new(ToolPaths::resolve(&self.clips_dir)?, &self.clips_dir);
        config.temp_root = env_path("TEMP_ROOT");
        config.font_dir = Some(self.fonts_dir.clone());
        if let Ok(encoder) = env::var("VIDEO_ENCODER") {
            if !encoder.trim().is_empty() {
                config.video_encoder = encoder.trim().into();
            }
        }
        // run_job applies MIN_FREE_GB itself.
        let mut pipeline = Pipeline::new(config)
            .with_face_analyzer(Arc::new(face::YuNet))
            .with_llm(llm);
        let stt = SttConfig::from_env();
        if stt.is_configured() {
            pipeline = pipeline.with_stt(stt);
        }
        Ok(pipeline)
    }
}

fn llm_status(llm: &LlmClient) -> Value {
    let stt = SttConfig::from_env();
    let configured = stt.is_configured();
    let model = configured.then(|| {
        if stt.whisper_configured() {
            stt.model.as_str()
        } else {
            stt.fallback_model.as_str()
        }
    });
    let mut status = json!(llm.status());
    status["sttConfigured"] = json!(configured);
    status["sttModel"] = json!(model);
    status
}

fn emit(event: Value) -> Result<()> {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, &event)?;
    stdout.write_all(b"\n")?;
    stdout.flush()?;
    Ok(())
}

fn register_signals(cancel: CancellationToken) -> Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut terminate = signal(SignalKind::terminate())?;
        let mut interrupt = signal(SignalKind::interrupt())?;
        tokio::spawn(async move {
            tokio::select! { _ = terminate.recv() => {}, _ = interrupt.recv() => {} }
            cancel.cancel();
        });
    }
    #[cfg(not(unix))]
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            cancel.cancel();
        }
    });
    Ok(())
}

async fn check_tool(override_var: &str, fallback: &str, flag: &str) -> bool {
    let program = env_path(override_var).unwrap_or_else(|| fallback.into());
    let mut command = Command::new(program);
    command
        .arg(flag)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    matches!(tokio::time::timeout(Duration::from_secs(10), command.status()).await, Ok(Ok(status)) if status.success())
}

async fn self_check(fonts: &Path) -> Result<Value> {
    let (ffmpeg, ffprobe, ytdlp) = tokio::join!(
        check_tool("FFMPEG_BIN", "ffmpeg", "-version"),
        check_tool("FFPROBE_BIN", "ffprobe", "-version"),
        check_tool("YTDLP_BIN", "yt-dlp", "--version"),
    );
    if !ffmpeg || !ffprobe {
        bail!("Self-check: ffmpeg dan ffprobe wajib tersedia (ffmpeg={ffmpeg}, ffprobe={ffprobe})");
    }
    FontRef::try_from_slice(MONTSERRAT)
        .map_err(|_| anyhow!("Font bawaan Montserrat tidak valid"))?;
    // If a font directory is configured/provisioned, also catch a broken deployment.
    if fonts.exists() || fonts != Path::new("/app/fonts") {
        let bytes = fs::read(fonts.join("Montserrat-Bold.ttf"))
            .context("Montserrat-Bold.ttf tidak tersedia di direktori font")?;
        FontRef::try_from_slice(&bytes).map_err(|_| anyhow!("Montserrat-Bold.ttf tidak valid"))?;
    }
    tokio::task::spawn_blocking(dartclip_face::OnnxFaceDetector::new)
        .await?
        .context("Gagal memuat model wajah YuNet")?;
    Ok(
        json!({"ok": true, "ffmpeg": ffmpeg, "ffprobe": ffprobe, "ytdlp": ytdlp, "faceModel": "yunet-2023mar"}),
    )
}

async fn run(args: &Args, cancel: &CancellationToken, llm: Option<&LlmClient>) -> Result<Value> {
    if cancel.is_cancelled() {
        bail!("job dibatalkan");
    }
    let payload = args.read_payload(cancel).await?;
    if matches!(args.task, Task::SelfCheck) {
        return self_check(&args.fonts_dir).await;
    }
    let llm = llm.context("LLM client tidak tersedia")?;
    Ok(match args.task {
        Task::Job => {
            let job = JobData::from_json(payload)?;
            json!(
                args.pipeline(llm.clone())?
                    .run_job(&job, cancel, |data| async move {
                        if let Err(err) = emit(json!({"type": "progress", "data": data})) {
                            eprintln!("Gagal mengirim progress: {err}");
                        }
                    })
                    .await?
            )
        }
        Task::Preview => {
            let request: PreviewRequest =
                serde_json::from_value(payload).map_err(|_| anyhow!("invalid_preview_payload"))?;
            json!(
                args.pipeline(llm.clone())?
                    .run_preview(&request, cancel)
                    .await?
            )
        }
        Task::Frame => {
            let request: FrameRequest =
                serde_json::from_value(payload).map_err(|_| anyhow!("invalid_frame_payload"))?;
            json!(
                args.pipeline(llm.clone())?
                    .run_frame(&request, cancel)
                    .await?
            )
        }
        Task::Caption => {
            let request = CaptionRequest::from_value(&payload);
            tokio::select! { biased;
                _ = cancel.cancelled() => bail!("job dibatalkan"),
                result = llm.regenerate_caption(&request) => json!(result?),
            }
        }
        Task::Brief => {
            let brief = payload["brief"].as_str().unwrap_or_default();
            tokio::select! { biased;
                _ = cancel.cancelled() => bail!("job dibatalkan"),
                result = llm.expand_brief(brief) => json!({"brief": result?}),
            }
        }
        Task::GenerateImage => {
            let request: GenerateImageRequest = serde_json::from_value(payload)
                .map_err(|_| anyhow!("invalid_generate_image_payload"))?;
            json!(
                args.pipeline(llm.clone())?
                    .run_generate_image(&request, cancel)
                    .await?
            )
        }
        Task::FindMoment => {
            let request: FindMomentRequest = serde_json::from_value(payload)
                .map_err(|_| anyhow!("invalid_find_moment_payload"))?;
            json!(
                args.pipeline(llm.clone())?
                    .run_find_moment(&request, cancel)
                    .await?
            )
        }
        Task::CaptureFrame => {
            let request: CaptureFrameRequest = serde_json::from_value(payload)
                .map_err(|_| anyhow!("invalid_capture_frame_payload"))?;
            json!(
                args.pipeline(llm.clone())?
                    .run_capture_frame(&request, cancel)
                    .await?
            )
        }
        Task::LlmCheck => {
            let ok = tokio::select! { biased;
                _ = cancel.cancelled() => bail!("job dibatalkan"),
                result = llm.ping() => result.is_ok(),
            };
            let mut status = llm_status(llm);
            status["ok"] = json!(ok);
            status
        }
        Task::SelfCheck => unreachable!(),
    })
}

fn fail(message: &str, llm_status: Value) -> ExitCode {
    eprintln!("{message}");
    let _ = emit(json!({"type": "error", "message": message, "llmStatus": llm_status}));
    ExitCode::FAILURE
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = match Args::parse() {
        Ok(Some(args)) => args,
        Ok(None) => {
            eprintln!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Err(err) => return fail(&err.to_string(), Value::Null),
    };
    let cancel = CancellationToken::new();
    if let Err(err) = register_signals(cancel.clone()) {
        return fail(
            &format!("Gagal memasang handler sinyal: {err}"),
            Value::Null,
        );
    }
    if let Some(path) = args.cancel_file.clone() {
        if path.exists() {
            cancel.cancel();
        }
        let cancel = cancel.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(250));
            loop {
                tokio::select! { _ = cancel.cancelled() => break, _ = interval.tick() => {} }
                if path.exists() {
                    cancel.cancel();
                    break;
                }
            }
        });
    }
    let outcome = async {
        // These task types only use the text endpoint; the legacy LLM_VISION_MODEL
        // applies to reference-jobs, which dartclip-core does not implement.
        let llm = if matches!(args.task, Task::SelfCheck) {
            None
        } else {
            Some(LlmClient::new(LlmConfig::from_env())?)
        };
        let result = run(&args, &cancel, llm.as_ref()).await;
        let status = llm.as_ref().map_or(Value::Null, llm_status);
        Ok::<_, anyhow::Error>((result, status))
    }
    .await;
    let (result, llm_status) = match outcome {
        Ok(outcome) => outcome,
        Err(err) => (Err(err), Value::Null),
    };
    match result {
        Ok(data) if !cancel.is_cancelled() => {
            match emit(json!({"type": "result", "data": data, "llmStatus": llm_status})) {
                Ok(()) => ExitCode::SUCCESS,
                Err(err) => fail(&format!("Gagal mengirim hasil: {err}"), Value::Null),
            }
        }
        _ if cancel.is_cancelled() => fail("job dibatalkan", llm_status),
        Err(err) if matches!(args.task, Task::Caption | Task::Brief) => {
            eprintln!("Caption/brief gagal: {err}");
            fail("caption_unavailable", llm_status)
        }
        Err(err) => fail(&err.to_string(), llm_status),
        Ok(_) => fail("job dibatalkan", llm_status),
    }
}
