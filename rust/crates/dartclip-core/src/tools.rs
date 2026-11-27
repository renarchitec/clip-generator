use anyhow::{anyhow, bail, Context, Result};
use serde_json::Value;
use std::{
    env,
    path::{Path, PathBuf},
    process::Output,
    time::Duration,
};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolPaths {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub ytdlp: PathBuf,
}
impl ToolPaths {
    pub fn resolve(data_dir: impl AsRef<Path>) -> Result<Self> {
        let d = data_dir.as_ref();
        Ok(Self {
            ffmpeg: resolve_tool(d, "ffmpeg", "FFMPEG_BIN")?,
            ffprobe: resolve_tool(d, "ffprobe", "FFPROBE_BIN")?,
            ytdlp: resolve_tool(d, "yt-dlp", "YTDLP_BIN")?,
        })
    }
}
fn executable(p: &Path) -> bool {
    let Ok(meta) = p.metadata() else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}
fn resolve_tool(data_dir: &Path, tool: &str, override_env: &str) -> Result<PathBuf> {
    let search: Vec<_> = env::var_os("PATH")
        .map(|v| env::split_paths(&v).collect())
        .unwrap_or_default();
    let find =
        |name: &Path, dirs: &[PathBuf]| dirs.iter().map(|d| d.join(name)).find(|p| executable(p));
    if let Some(value) = env::var_os(override_env).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(value);
        if executable(&path) {
            return Ok(path.canonicalize()?);
        }
        if path.components().count() == 1 {
            if let Some(p) = find(&path, &search) {
                return Ok(p.canonicalize()?);
            }
        }
        bail!(
            "{override_env} does not point to an executable: {}",
            path.display()
        );
    }
    let name = if cfg!(windows) {
        format!("{tool}.exe")
    } else {
        tool.to_owned()
    };
    let dirs: Vec<_> = std::iter::once(data_dir.join("bin"))
        .chain(search)
        .chain([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ])
        .collect();
    find(Path::new(&name), &dirs)
        .ok_or_else(|| {
            anyhow!(
                "Missing {tool}; install it in PATH or {}, or set {override_env}",
                data_dir.join("bin").display()
            )
        })?
        .canonicalize()
        .map_err(Into::into)
}
pub async fn ensure_tool_installed(data_dir: impl AsRef<Path>, tool: &str) -> Result<PathBuf> {
    let key = match tool {
        "ffmpeg" => "FFMPEG_BIN",
        "ffprobe" => "FFPROBE_BIN",
        "yt-dlp" => "YTDLP_BIN",
        _ => bail!("Unknown media tool: {tool}"),
    };
    let p = resolve_tool(data_dir.as_ref(), tool, key)?;
    let option = if tool == "yt-dlp" {
        "--version"
    } else {
        "-version"
    };
    run(
        Command::new(&p).arg(option),
        Duration::from_secs(10),
        &CancellationToken::new(),
    )
    .await?;
    Ok(p)
}

pub(crate) async fn run(
    cmd: &mut Command,
    timeout: Duration,
    cancel: &CancellationToken,
) -> Result<Output> {
    let name = cmd.as_std().get_program().to_string_lossy().into_owned();
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd.kill_on_drop(true);
    let output = tokio::select! {biased;
        _=cancel.cancelled()=>bail!("job cancelled"),
        res=tokio::time::timeout(timeout,cmd.output())=>res.with_context(||format!("{name}: timed out after {}s",timeout.as_secs()))?.with_context(||format!("could not run {name}"))?,
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("{name} ({}): {}", output.status, stderr.trim());
    }
    Ok(output)
}
pub(crate) fn ffmpeg(program: &Path) -> Command {
    let mut c = Command::new(program);
    c.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
    ]);
    c
}
pub(crate) fn video_encoder(cmd: &mut Command, encoder: &str, crf: &str) {
    cmd.args(["-c:v", encoder, "-pix_fmt", "yuv420p"]);
    if encoder == "libx264" {
        cmd.args(["-preset", "veryfast", "-crf", crf]);
    } else if encoder == "h264_videotoolbox" {
        cmd.args(["-b:v", "6M", "-allow_sw", "1"]);
    }
}
pub(crate) fn silence(cmd: &mut Command, duration: f64) {
    cmd.args([
        "-f",
        "lavfi",
        "-t",
        &format!("{duration:.3}"),
        "-i",
        "anullsrc=r=44100:cl=stereo",
    ]);
}
pub(crate) fn audio_filter(src: &str, dst: &str, dur: f64, fade: &str) -> String {
    format!("[{src}]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,{fade}apad=whole_dur={dur:.3},atrim=end={dur:.3},asetpts=PTS-STARTPTS[{dst}]")
}
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MediaInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
    pub has_audio: bool,
}
pub async fn probe_media(program: impl AsRef<Path>, path: impl AsRef<Path>) -> Result<MediaInfo> {
    probe_media_cancel(program.as_ref(), path.as_ref(), &CancellationToken::new()).await
}
pub(crate) async fn probe_media_cancel(
    program: &Path,
    path: &Path,
    cancel: &CancellationToken,
) -> Result<MediaInfo> {
    let output=run(Command::new(program).args(["-v","error","-show_entries","stream=codec_type,width,height,avg_frame_rate,r_frame_rate,duration:format=duration","-of","json"]).arg(path),Duration::from_secs(20),cancel).await?;
    let info: Value = serde_json::from_slice(&output.stdout)?;
    let streams = info["streams"]
        .as_array()
        .ok_or_else(|| anyhow!("tanpa stream video"))?;
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video")
        .ok_or_else(|| anyhow!("tanpa stream video"))?;
    let duration = crate::models::number(&video["duration"])
        .filter(|n| *n > 0.)
        .or_else(|| crate::models::number(&info["format"]["duration"]).filter(|n| *n > 0.))
        .ok_or_else(|| anyhow!("durasi tidak terbaca"))?;
    let dimension = |key: &str| {
        video[key]
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .filter(|n| *n > 0)
            .ok_or_else(|| anyhow!("dimensi tidak terbaca"))
    };
    let rate = |key: &str| {
        let s = video[key].as_str()?;
        let f = |s: &str| s.parse::<f64>().ok();
        let n = if let Some((a, b)) = s.split_once('/') {
            f(a)? / f(b)?
        } else {
            f(s)?
        };
        (1. ..=240.).contains(&n).then_some(n)
    };
    Ok(MediaInfo {
        width: dimension("width")?,
        height: dimension("height")?,
        fps: rate("avg_frame_rate")
            .or_else(|| rate("r_frame_rate"))
            .unwrap_or(30.),
        duration,
        has_audio: streams.iter().any(|s| s["codec_type"] == "audio"),
    })
}
