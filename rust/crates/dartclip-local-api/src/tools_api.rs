use super::*;
use anyhow::{bail, Context};
use std::{env, io::Write, time::Duration};

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
pub(crate) fn find_tool(dir: &Path, tool: &str) -> Option<PathBuf> {
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
        if executable(&p) {
            return p.canonicalize().ok();
        }
        if p.components().count() == 1 {
            return path
                .iter()
                .map(|d| d.join(&p))
                .find(|p| executable(p))
                .and_then(|p| p.canonicalize().ok());
        }
        return None;
    }
    std::iter::once(dir.join("bin"))
        .chain(path)
        .chain([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ])
        .map(|d| d.join(filename(tool)))
        .find(|p| executable(p))
        .and_then(|p| p.canonicalize().ok())
}
fn detected(dir: &Path, tool: &str) -> bool {
    find_tool(dir, tool).is_some() && (tool != "ffmpeg" || find_tool(dir, "ffprobe").is_some())
}
pub(crate) async fn status(State(state): State<AppState>) -> Json<Value> {
    let dir = &state.0.config.data_dir;
    Json(
        json!({"ffmpeg":{"detected":detected(dir,"ffmpeg")},"yt-dlp":{"detected":detected(dir,"yt-dlp")}}),
    )
}
pub(crate) async fn download(
    State(state): State<AppState>,
    axum::extract::Path(tool): axum::extract::Path<String>,
) -> ApiResult<StatusCode> {
    if !matches!(tool.as_str(), "ffmpeg" | "yt-dlp") {
        return Err(ApiError::missing());
    }
    let _guard = state.0.install_lock.lock().await;
    if state.0.stop.is_cancelled() {
        return Err(ApiError::unavailable("Local API is shutting down"));
    }
    let install = install(&state.0.config.data_dir, &tool);
    tokio::select! {
        _ = state.0.stop.cancelled() => Err(ApiError::unavailable("Local API is shutting down")),
        result = install => result.map(|_| StatusCode::NO_CONTENT).map_err(|e| ApiError::unavailable(format!("Could not install {tool}: {e:#}"))),
    }
}

async fn download_bytes(http: &reqwest::Client, url: &str) -> anyhow::Result<Vec<u8>> {
    const MAX: usize = 150 * 1024 * 1024;
    let mut response = http.get(url).send().await?.error_for_status()?;
    if response.content_length().is_some_and(|n| n > MAX as u64) {
        bail!("Download too large");
    }
    let mut result = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if result.len() + chunk.len() > MAX {
            bail!("Download too large");
        }
        result.extend_from_slice(&chunk);
    }
    anyhow::ensure!(!result.is_empty(), "Download was empty");
    Ok(result)
}
fn save_executable(dir: &Path, name: &str, mut data: impl std::io::Read) -> anyhow::Result<()> {
    let mut file = tempfile::NamedTempFile::new_in(dir)?;
    std::io::copy(&mut data, &mut file)?;
    file.flush()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o755))?;
    }
    file.persist(dir.join(filename(name)))?;
    Ok(())
}

async fn install(dir: &Path, tool: &str) -> anyhow::Result<()> {
    if detected(dir, tool) {
        return Ok(());
    }
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin)?;
    anyhow::ensure!(bin.canonicalize()? == bin, "Invalid tools directory");
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .https_only(true)
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
            &http,
            &format!("https://github.com/yt-dlp/yt-dlp/releases/latest/download/{asset}"),
        )
        .await
        .context(
            "Downloading the official yt-dlp release failed; check your internet connection",
        )?;
        tokio::task::spawn_blocking(move || save_executable(&bin, "yt-dlp", bytes.as_slice()))
            .await??;
    } else {
        #[cfg(target_os = "macos")]
        for tool in ["ffmpeg", "ffprobe"] {
            if find_tool(dir, tool).is_some() {
                continue;
            }
            let bytes = download_bytes(
                &http,
                &format!("https://evermeet.cx/ffmpeg/getrelease/{tool}/zip"),
            )
            .await
            .with_context(|| {
                format!("Downloading {tool} failed; check your internet connection")
            })?;
            let bin = bin.clone();
            tokio::task::spawn_blocking(move || {
                let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))?;
                let entry = archive.by_name(tool)?;
                anyhow::ensure!(
                    entry.is_file() && (1..=150 * 1024 * 1024).contains(&entry.size()),
                    "Invalid {tool} archive entry"
                );
                save_executable(&bin, tool, entry)
            })
            .await??;
        }
        #[cfg(not(target_os = "macos"))]
        bail!("Automatic FFmpeg installation is only available on macOS; install ffmpeg and ffprobe on PATH");
    }
    anyhow::ensure!(
        detected(dir, tool),
        "Tool is still unavailable; check executable paths and environment overrides"
    );
    Ok(())
}
