use super::*;
use anyhow::{bail, Context};
use serde::{Deserialize, Serialize};
use std::{
    env,
    io::{self, Read, Write},
    time::{Duration, SystemTime},
};

const MAX_DOWNLOAD_BYTES: usize = 260 * 1024 * 1024;
const TOOLS: [&str; 2] = ["ffmpeg", "yt-dlp"];
type VersionKey = (PathBuf, Option<SystemTime>);
type VersionProbe = Arc<tokio::sync::OnceCell<Option<String>>>;

#[derive(Clone, Default, Serialize)]
struct DownloadStatus {
    downloading: bool,
    progress: Option<u8>,
    error: Option<String>,
}

#[derive(Default)]
pub(crate) struct ToolsRuntimeState {
    downloads: HashMap<String, DownloadStatus>,
    versions: HashMap<VersionKey, VersionProbe>,
}

fn runtime(state: &AppState) -> std::sync::MutexGuard<'_, ToolsRuntimeState> {
    state
        .0
        .tools_state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Source {
    Env,
    Managed,
    System,
}

fn executable(path: &Path) -> bool {
    let Ok(meta) = path.metadata() else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 == 0 {
            return false;
        }
    }
    true
}

fn filename(tool: &str) -> String {
    if cfg!(windows) {
        format!("{tool}.exe")
    } else {
        tool.to_owned()
    }
}

fn resolve_tool(dir: &Path, tool: &str) -> Option<(PathBuf, Source)> {
    let key = match tool {
        "ffmpeg" => "FFMPEG_BIN",
        "ffprobe" => "FFPROBE_BIN",
        "yt-dlp" => "YTDLP_BIN",
        _ => return None,
    };
    let path = env::var_os("PATH")
        .map(|p| env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default();
    if let Some(value) = env::var_os(key).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(value);
        let resolved = if executable(&p) {
            p.canonicalize().ok()
        } else if p.components().count() == 1 {
            path.iter()
                .map(|d| d.join(&p))
                .find(|p| executable(p))
                .and_then(|p| p.canonicalize().ok())
        } else {
            None
        };
        return resolved.map(|p| (p, Source::Env));
    }
    let bin = dir.join("bin");
    let name = filename(tool);
    let resolved = std::iter::once(bin.clone())
        .chain(path)
        .chain([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ])
        .map(|d| d.join(&name))
        .find(|p| executable(p))?
        .canonicalize()
        .ok()?;
    let source = if bin
        .canonicalize()
        .is_ok_and(|bin| resolved.starts_with(bin))
    {
        Source::Managed
    } else {
        Source::System
    };
    Some((resolved, source))
}

pub(crate) fn find_tool(dir: &Path, tool: &str) -> Option<PathBuf> {
    resolve_tool(dir, tool).map(|(path, _)| path)
}

fn resolve_group(dir: &Path, tool: &str) -> Option<(PathBuf, Source)> {
    let (path, source) = resolve_tool(dir, tool)?;
    if tool != "ffmpeg" {
        return Some((path, source));
    }
    let (_, probe_source) = resolve_tool(dir, "ffprobe")?;
    let source = match (source, probe_source) {
        (Source::Env, _) | (_, Source::Env) => Source::Env,
        (Source::Managed, Source::Managed) => Source::Managed,
        _ => Source::System,
    };
    Some((path, source))
}

fn detected(dir: &Path, tool: &str) -> bool {
    resolve_group(dir, tool).is_some()
}

fn parse_ffmpeg_version(output: &str) -> Option<&str> {
    let version = output
        .lines()
        .next()?
        .strip_prefix("ffmpeg version ")?
        .split_whitespace()
        .next()?
        .split("-https://")
        .next()?;
    (!version.is_empty()).then_some(version)
}

fn parse_ytdlp_version(output: &str) -> Option<&str> {
    let version = output.lines().next()?.trim();
    (!version.is_empty()).then_some(version)
}

async fn probe_version(path: &Path, tool: &str) -> Option<String> {
    let mut cmd = tokio::process::Command::new(path);
    cmd.arg(if tool == "ffmpeg" {
        "-version"
    } else {
        "--version"
    })
    .stdin(std::process::Stdio::null())
    .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let output = tokio::time::timeout(Duration::from_secs(5), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let version = if tool == "ffmpeg" {
        parse_ffmpeg_version(&stdout)?
    } else {
        parse_ytdlp_version(&stdout)?
    };
    Some(version.to_owned())
}

async fn version(state: &AppState, path: PathBuf, tool: &str) -> Option<String> {
    let modified = path.metadata().and_then(|m| m.modified()).ok();
    let probe = {
        let mut runtime = runtime(state);
        runtime
            .versions
            .retain(|(p, m), _| p != &path || *m == modified);
        runtime
            .versions
            .entry((path.clone(), modified))
            .or_default()
            .clone()
    };
    probe
        .get_or_init(|| probe_version(&path, tool))
        .await
        .clone()
}

#[derive(Serialize)]
struct ToolStatus {
    detected: bool,
    source: Option<Source>,
    version: Option<String>,
    #[serde(flatten)]
    install: DownloadStatus,
}

async fn tool_status(state: &AppState, tool: &str) -> ToolStatus {
    let resolved = resolve_group(&state.0.config.data_dir, tool);
    let (source, version) = match resolved {
        Some((path, source)) => (Some(source), version(state, path, tool).await),
        None => (None, None),
    };
    ToolStatus {
        detected: source.is_some(),
        source,
        version,
        install: runtime(state)
            .downloads
            .get(tool)
            .cloned()
            .unwrap_or_default(),
    }
}

pub(crate) async fn status(State(state): State<AppState>) -> Json<Value> {
    let (ffmpeg, ytdlp) =
        tokio::join!(tool_status(&state, "ffmpeg"), tool_status(&state, "yt-dlp"));
    Json(json!({"ffmpeg": ffmpeg, "yt-dlp": ytdlp}))
}

#[derive(Deserialize, Default)]
pub(crate) struct DownloadQuery {
    #[serde(default, deserialize_with = "deserialize_force")]
    force: bool,
}

fn deserialize_force<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    match String::deserialize(d)?.as_str() {
        "1" | "true" => Ok(true),
        "0" | "false" => Ok(false),
        _ => Err(serde::de::Error::custom(
            "force must be true, false, 1 or 0",
        )),
    }
}

pub(crate) async fn download(
    State(state): State<AppState>,
    axum::extract::Path(tool): axum::extract::Path<String>,
    axum::extract::Query(query): axum::extract::Query<DownloadQuery>,
) -> ApiResult<StatusCode> {
    if !TOOLS.contains(&tool.as_str()) {
        return Err(ApiError::missing());
    }
    if !query.force && detected(&state.0.config.data_dir, &tool) {
        return Ok(StatusCode::NO_CONTENT);
    }
    // Keep the operation and its status alive if the requesting client disconnects.
    let result = tokio::spawn(async move { install_tool(&state, &tool, query.force).await })
        .await
        .map_err(|e| ApiError::unavailable(format!("Tool installer failed: {e}")))?;
    result
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(ApiError::unavailable)
}

pub(crate) async fn auto_install_missing(state: AppState) {
    for tool in TOOLS {
        if state.0.stop.is_cancelled() {
            break;
        }
        if !detected(&state.0.config.data_dir, tool) {
            let _ = install_tool(&state, tool, false).await;
        }
    }
}

async fn install_tool(state: &AppState, tool: &str, force: bool) -> Result<(), String> {
    let shutdown = || "Local API is shutting down".to_owned();
    let _guard = tokio::select! {
        biased;
        _ = state.0.stop.cancelled() => return Err(shutdown()),
        guard = state.0.install_lock.lock() => guard,
    };
    if !force && detected(&state.0.config.data_dir, tool) {
        return Ok(());
    }
    runtime(state).downloads.insert(
        tool.to_owned(),
        DownloadStatus {
            downloading: true,
            progress: Some(0),
            error: None,
        },
    );
    let result = install(state, tool, force)
        .await
        .map_err(|e| format!("Could not install {tool}: {e:#}"));
    let mut runtime = runtime(state);
    runtime.downloads.insert(
        tool.to_owned(),
        DownloadStatus {
            error: result.as_ref().err().cloned(),
            ..DownloadStatus::default()
        },
    );
    if result.is_ok() {
        runtime.versions.clear();
    }
    result
}

fn set_progress(state: &AppState, tool: &str, progress: u8) {
    if let Some(status) = runtime(state).downloads.get_mut(tool) {
        status.progress = Some(progress);
    }
}

async fn download_bytes(
    state: &AppState,
    tool: &str,
    http: &reqwest::Client,
    url: &str,
    (start, end): (u8, u8),
) -> anyhow::Result<Vec<u8>> {
    let download = async {
        set_progress(state, tool, start);
        let mut response = http.get(url).send().await?.error_for_status()?;
        let length = response.content_length();
        anyhow::ensure!(
            length.unwrap_or(0) <= MAX_DOWNLOAD_BYTES as u64,
            "Download too large"
        );
        let mut result = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            anyhow::ensure!(
                result.len() + chunk.len() <= MAX_DOWNLOAD_BYTES,
                "Download too large"
            );
            result.extend_from_slice(&chunk);
            if let Some(length) = length.filter(|n| *n > 0) {
                let pct = (result.len() as u64 * u64::from(end - start) / length)
                    .min(u64::from(end - start));
                set_progress(state, tool, start + pct as u8);
            }
        }
        anyhow::ensure!(!result.is_empty(), "Download was empty");
        set_progress(state, tool, end);
        Ok(result)
    };
    tokio::select! {
        biased;
        _ = state.0.stop.cancelled() => bail!("Local API is shutting down"),
        result = download => result,
    }
}

fn stage_executable(dir: &Path, mut data: impl Read) -> anyhow::Result<tempfile::NamedTempFile> {
    let mut file = tempfile::NamedTempFile::new_in(dir)?;
    let size = io::copy(
        &mut data.by_ref().take(MAX_DOWNLOAD_BYTES as u64 + 1),
        &mut file,
    )?;
    anyhow::ensure!(
        (1..=MAX_DOWNLOAD_BYTES as u64).contains(&size),
        "Invalid executable size"
    );
    file.flush()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(file)
}

fn extract_zip_executables(bytes: &[u8], targets: &[&str], dest_dir: &Path) -> anyhow::Result<()> {
    let mut archive = zip::ZipArchive::new(io::Cursor::new(bytes))?;
    let mut staged = Vec::with_capacity(targets.len());
    for &target in targets {
        anyhow::ensure!(
            matches!(target, "ffmpeg" | "ffprobe" | "ffmpeg.exe" | "ffprobe.exe"),
            "Invalid target {target}"
        );
        let mut found = None;
        for index in 0..archive.len() {
            let entry = archive.by_index(index)?;
            if entry.is_file() && entry.name().rsplit(['/', '\\']).next() == Some(target) {
                anyhow::ensure!(
                    (1..=MAX_DOWNLOAD_BYTES as u64).contains(&entry.size()),
                    "Invalid {target} archive entry"
                );
                found = Some(
                    stage_executable(dest_dir, entry)
                        .with_context(|| format!("Extracting {target}"))?,
                );
                break;
            }
        }
        staged.push((
            target,
            found.with_context(|| format!("Archive is missing {target}"))?,
        ));
    }
    for (target, file) in staged {
        file.persist(dest_dir.join(target))?;
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum FfmpegDownloadPlan {
    Separate([String; 2]),
    Bundle([&'static str; 2]),
}

fn ffmpeg_download_plan(os: &str, arch: &str) -> Option<FfmpegDownloadPlan> {
    let arch = match arch {
        "aarch64" => "arm64",
        "x86_64" => "amd64",
        _ => return None,
    };
    match os {
        "macos" | "linux" => Some(FfmpegDownloadPlan::Separate(["ffmpeg", "ffprobe"].map(|binary| {
            format!("https://ffmpeg.martin-riedl.de/redirect/latest/{os}/{arch}/release/{binary}.zip")
        }))),
        "windows" => Some(FfmpegDownloadPlan::Bundle([
            "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
        ])),
        _ => None,
    }
}

async fn download_archive(
    state: &AppState,
    http: &reqwest::Client,
    url: &str,
    range: (u8, u8),
    targets: &'static [&'static str],
    bin: &Path,
) -> anyhow::Result<()> {
    let bytes = download_bytes(state, "ffmpeg", http, url, range)
        .await
        .with_context(|| format!("Downloading {url}"))?;
    anyhow::ensure!(!state.0.stop.is_cancelled(), "Local API is shutting down");
    let bin = bin.to_owned();
    tokio::task::spawn_blocking(move || extract_zip_executables(&bytes, targets, &bin)).await??;
    Ok(())
}

async fn install(state: &AppState, tool: &str, force: bool) -> anyhow::Result<()> {
    let dir = &state.0.config.data_dir;
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin)?;
    let bin = bin.canonicalize()?;
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .https_only(true)
        .user_agent("DartClip/0.1")
        .build()?;
    if tool == "yt-dlp" {
        let asset = match (env::consts::OS, env::consts::ARCH) {
            ("macos", _) => "yt-dlp_macos",
            ("windows", "aarch64") => "yt-dlp_arm64.exe",
            ("windows", "x86") => "yt-dlp_x86.exe",
            ("windows", _) => "yt-dlp.exe",
            ("linux", "aarch64") => "yt-dlp_linux_aarch64",
            ("linux", "x86_64") => "yt-dlp_linux",
            _ => "yt-dlp",
        };
        let bytes = download_bytes(
            state,
            tool,
            &http,
            &format!("https://github.com/yt-dlp/yt-dlp/releases/latest/download/{asset}"),
            (0, 100),
        )
        .await
        .context("Downloading the official yt-dlp release failed")?;
        anyhow::ensure!(!state.0.stop.is_cancelled(), "Local API is shutting down");
        tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
            stage_executable(&bin, bytes.as_slice())?.persist(bin.join(filename("yt-dlp")))?;
            Ok(())
        })
        .await??;
    } else {
        match ffmpeg_download_plan(env::consts::OS, env::consts::ARCH) {
            Some(FfmpegDownloadPlan::Separate([ffmpeg, ffprobe])) => {
                for (binary, url, range, targets) in [
                    ("ffmpeg", ffmpeg, (0, 50), &["ffmpeg"][..]),
                    ("ffprobe", ffprobe, (50, 100), &["ffprobe"][..]),
                ] {
                    if force || find_tool(dir, binary).is_none() {
                        download_archive(state, &http, &url, range, targets, &bin).await?;
                    }
                }
            }
            Some(FfmpegDownloadPlan::Bundle([primary, fallback])) => {
                let targets = &["ffmpeg.exe", "ffprobe.exe"];
                if let Err(primary_err) = download_archive(state, &http, primary, (0, 100), targets, &bin).await {
                    anyhow::ensure!(!state.0.stop.is_cancelled(), "Local API is shutting down");
                    download_archive(state, &http, fallback, (0, 100), targets, &bin)
                        .await
                        .with_context(|| format!("Primary download failed: {primary_err:#}; fallback also failed"))?;
                }
            }
            None => bail!("Automatic FFmpeg installation is not available for this platform; install ffmpeg and ffprobe on PATH"),
        }
    }
    anyhow::ensure!(
        force || detected(dir, tool),
        "Tool is still unavailable; check executable paths and environment overrides"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(io::Cursor::new(Vec::new()));
        for &(name, bytes) in entries {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn extracts_nested_windows_and_flat_macos_executables() {
        let windows = zip_bytes(&[
            ("ffmpeg-9.1-essentials_build/bin/ffmpeg.exe", b"encoder"),
            ("ffmpeg-9.1-essentials_build\\bin\\ffprobe.exe", b"probe"),
        ]);
        let macos = zip_bytes(&[("ffmpeg", b"flat")]);
        let dir = tempfile::tempdir().unwrap();
        extract_zip_executables(&windows, &["ffmpeg.exe", "ffprobe.exe"], dir.path()).unwrap();
        extract_zip_executables(&macos, &["ffmpeg"], dir.path()).unwrap();
        for (file, bytes) in [
            ("ffmpeg.exe", &b"encoder"[..]),
            ("ffprobe.exe", &b"probe"[..]),
            ("ffmpeg", &b"flat"[..]),
        ] {
            let path = dir.path().join(file);
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
            assert!(executable(&path));
        }
    }

    #[test]
    fn rejects_missing_or_empty_archive_targets_without_installing() {
        let dir = tempfile::tempdir().unwrap();
        for entries in [
            vec![("ffmpeg", &b"encoder"[..])],
            vec![("ffmpeg", &b"encoder"[..]), ("ffprobe", &b""[..])],
        ] {
            assert!(extract_zip_executables(
                &zip_bytes(&entries),
                &["ffmpeg", "ffprobe"],
                dir.path()
            )
            .is_err());
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        }
    }

    #[test]
    fn parses_versions() {
        assert_eq!(
            parse_ffmpeg_version("ffmpeg version 9.1-https://www.martin-riedl.de ..."),
            Some("9.1")
        );
        assert_eq!(
            parse_ffmpeg_version("ffmpeg version 7.1.1 Copyright ..."),
            Some("7.1.1")
        );
        assert_eq!(parse_ffmpeg_version("unknown"), None);
        assert_eq!(parse_ytdlp_version("2026.11.18\n"), Some("2026.11.18"));
        assert_eq!(parse_ytdlp_version("\n"), None);
    }

    #[test]
    fn plans_platform_downloads() {
        for (os, arch, prefix) in [
            ("macos", "aarch64", "macos/arm64"),
            ("macos", "x86_64", "macos/amd64"),
            ("linux", "aarch64", "linux/arm64"),
            ("linux", "x86_64", "linux/amd64"),
        ] {
            assert_eq!(ffmpeg_download_plan(os, arch), Some(FfmpegDownloadPlan::Separate([
                format!("https://ffmpeg.martin-riedl.de/redirect/latest/{prefix}/release/ffmpeg.zip"),
                format!("https://ffmpeg.martin-riedl.de/redirect/latest/{prefix}/release/ffprobe.zip"),
            ])));
        }
        for arch in ["x86_64", "aarch64"] {
            assert_eq!(ffmpeg_download_plan("windows", arch), Some(FfmpegDownloadPlan::Bundle([
                "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
                "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
            ])));
        }
    }

    #[test]
    fn accepts_boolean_and_numeric_force_queries() {
        for (query, expected) in [
            ("", false),
            ("?force=false", false),
            ("?force=0", false),
            ("?force=true", true),
            ("?force=1", true),
        ] {
            let uri = format!("/download{query}").parse().unwrap();
            assert_eq!(
                axum::extract::Query::<DownloadQuery>::try_from_uri(&uri)
                    .unwrap()
                    .force,
                expected
            );
        }
    }
}
