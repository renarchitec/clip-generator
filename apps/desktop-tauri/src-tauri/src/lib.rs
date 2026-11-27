use dartclip_local_api::{start_local_api, LocalApiConfig};
use serde::Serialize;
use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::Mutex,
};
use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

struct LocalApiShutdown(Mutex<Option<oneshot::Sender<()>>>);

fn configure_path(bin_dir: &Path) -> Result<(), env::JoinPathsError> {
    let mut paths = vec![bin_dir.to_owned()];
    #[cfg(target_os = "macos")]
    paths.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    if let Some(inherited) = env::var_os("PATH") {
        paths.extend(env::split_paths(&inherited));
    }
    env::set_var("PATH", env::join_paths(paths)?);
    Ok(())
}

fn fonts_dir(app: &tauri::App) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("fonts"))
        .filter(|dir| dir.is_dir())
        .or_else(|| {
            let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../worker/fonts");
            dir.is_dir().then_some(dir)
        })
}

fn desktop_platform() -> &'static str {
    match env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        os => os,
    }
}

fn init_script(base_url: &str, platform: &str) -> String {
    let config = serde_json::json!({ "apiBaseUrl": base_url, "platform": platform });
    format!("if (window.top === window) {{ window.__DARTCLIP_DESKTOP__ = {config}; }}")
}

pub fn run() {
    let mut config = LocalApiConfig::default();
    fs::create_dir_all(&config.data_dir).expect("failed to create DartClip's data directory");
    let bin_dir = config
        .data_dir
        .canonicalize()
        .expect("failed to resolve DartClip's data directory")
        .join("bin");
    fs::create_dir_all(&bin_dir).expect("failed to create DartClip's bin directory");
    // Set PATH before starting the Tauri runtime or any tool processes.
    configure_path(&bin_dir).expect("failed to configure PATH for DartClip's tools");

    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            reveal_in_finder,
            open_folder,
            open_external_url
        ])
        .setup(move |app| {
            config.bind_addr = ([127, 0, 0, 1], 0).into();
            config.fonts_dir = fonts_dir(app);
            config.auto_install_tools = true;
            let running =
                tauri::async_runtime::block_on(start_local_api(config)).map_err(|err| {
                    io::Error::other(format!("failed to start DartClip's API: {err:#}"))
                })?;
            let script = init_script(&running.base_url, desktop_platform());
            app.manage(LocalApiShutdown(Mutex::new(Some(running.shutdown))));

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("DartClip")
                .inner_size(1360.0, 860.0)
                .min_inner_size(1024.0, 680.0)
                .initialization_script(&script)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to initialize DartClip");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(shutdown) = app.try_state::<LocalApiShutdown>() {
                if let Some(sender) = shutdown
                    .0
                    .lock()
                    .unwrap_or_else(|err| err.into_inner())
                    .take()
                {
                    let _ = sender.send(());
                }
            }
        }
    });
}

#[derive(Serialize)]
struct NativeResult {
    ok: bool,
    error: Option<String>,
}

impl From<io::Result<Child>> for NativeResult {
    fn from(result: io::Result<Child>) -> Self {
        let error = result.err().map(|err| err.to_string());
        Self {
            ok: error.is_none(),
            error,
        }
    }
}

fn expand_home(path: &str, home: Option<&Path>) -> io::Result<PathBuf> {
    if path.is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Path is empty"));
    }
    let mut components = Path::new(path).components();
    if components.next() == Some(std::path::Component::Normal("~".as_ref())) {
        let home = home.ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "Home directory is unavailable")
        })?;
        return Ok(home.join(components.as_path()));
    }
    Ok(PathBuf::from(path))
}

fn resolve_path(path: &str) -> io::Result<PathBuf> {
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    std::path::absolute(expand_home(path, home.as_deref())?)
}

#[tauri::command]
fn reveal_in_finder(path: String) -> NativeResult {
    resolve_path(&path)
        .and_then(|resolved| {
            fs::metadata(&resolved)?;
            #[cfg(target_os = "macos")]
            return Command::new("open").arg("-R").arg(&resolved).spawn();
            #[cfg(target_os = "windows")]
            return Command::new("explorer")
                .arg(format!("/select,{}", resolved.display()))
                .spawn();
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            Command::new("xdg-open")
                .arg(resolved.parent().unwrap_or(&resolved))
                .spawn()
        })
        .into()
}

#[tauri::command]
fn open_folder(path: String) -> NativeResult {
    resolve_path(&path)
        .and_then(|resolved| {
            fs::create_dir_all(&resolved)?;
            #[cfg(target_os = "macos")]
            let opener = "open";
            #[cfg(target_os = "windows")]
            let opener = "explorer";
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let opener = "xdg-open";
            Command::new(opener).arg(&resolved).spawn()
        })
        .into()
}

fn validate_external_url(url: &str) -> io::Result<()> {
    let address = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"));
    if address.is_none_or(|rest| rest.is_empty() || rest.starts_with(['/', '?', '#']))
        || url
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || "\"'`\\|;&<>^!()$".contains(c))
        || (cfg!(target_os = "windows") && url.contains('%'))
        || !Url::parse(url).is_ok_and(|parsed| parsed.has_host())
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Expected a valid HTTP(S) URL without shell metacharacters",
        ));
    }
    Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> NativeResult {
    validate_external_url(&url)
        .and_then(|()| {
            #[cfg(target_os = "macos")]
            return Command::new("open").arg(&url).spawn();
            #[cfg(target_os = "windows")]
            return Command::new("cmd").args(["/C", "start", "", &url]).spawn();
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            Command::new("xdg-open").arg(&url).spawn()
        })
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_only_a_standalone_home_component() {
        let home = Path::new("test-home");
        assert_eq!(expand_home("~", Some(home)).unwrap(), home);
        assert_eq!(
            expand_home("~/clips", Some(home)).unwrap(),
            home.join("clips")
        );
        assert_eq!(
            expand_home("~other/clips", None).unwrap(),
            Path::new("~other/clips")
        );
        assert!(expand_home("~/clips", None).is_err());
        assert!(expand_home("", Some(home)).is_err());
    }

    #[test]
    fn validates_external_http_urls() {
        for url in [
            "https://www.youtube.com/watch?v=abc",
            "http://127.0.0.1:1234/path#anchor",
        ] {
            assert!(validate_external_url(url).is_ok(), "{url}");
        }
        for url in [
            "file:///tmp/x",
            "javascript:alert(1)",
            "https://",
            "https:///example.com",
            "https://[invalid]",
            " https://example.com",
            "https://example.com/\n",
            "https://example.com/?x=1&y=2",
            "https://example.com/|bad",
            "https://example.com/\"bad",
            "https://example.com/\\bad",
        ] {
            assert!(validate_external_url(url).is_err(), "{url:?}");
        }
        #[cfg(target_os = "windows")]
        assert!(validate_external_url("https://example.com/%20").is_err());
    }

    #[test]
    fn initialization_script_embeds_json_without_interpolating_code() {
        let base_url = "http://127.0.0.1:34567";
        let platform = "darwin\"; alert(1); //\\\n";
        let script = init_script(base_url, platform);
        let payload = script
            .strip_prefix("if (window.top === window) { window.__DARTCLIP_DESKTOP__ = ")
            .and_then(|s| s.strip_suffix("; }"))
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(payload).unwrap(),
            serde_json::json!({
                "apiBaseUrl": base_url, "platform": platform
            })
        );
    }
}
