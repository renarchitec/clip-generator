use std::{
    io::Write,
    process::{Command, Output, Stdio},
};

use serde_json::Value;

fn worker() -> Command {
    Command::new(env!("CARGO_BIN_EXE_dartclip-worker"))
}

fn event(output: &Output) -> Value {
    let stdout = std::str::from_utf8(&output.stdout).unwrap();
    assert_eq!(stdout.lines().count(), 1, "unexpected stdout: {stdout}");
    let event: Value = serde_json::from_str(stdout).unwrap();
    assert!(event.is_object());
    event
}

#[test]
fn llm_check_reports_stt_configuration() {
    use dartclip_core::stt::{DEFAULT_STT_FALLBACK_MODEL, DEFAULT_STT_MODEL};
    use serde_json::json;

    let cases: &[(&[(&str, &str)], Option<&str>)] = &[
        (&[], None),
        (
            &[
                ("LLM_BASE_URL", "https://llm.example.test/v1"),
                ("LLM_API_KEY", "test-key"),
            ],
            Some(DEFAULT_STT_MODEL),
        ),
        (
            &[
                ("STT_BASE_URL", "https://stt.example.test/v1"),
                ("STT_API_KEY", "test-key"),
                ("STT_MODEL", " custom/whisper "),
            ],
            Some("custom/whisper"),
        ),
        (
            &[
                ("STT_FALLBACK_BASE_URL", "https://fallback.example.test/v1"),
                ("STT_FALLBACK_API_KEY", "test-key"),
            ],
            Some(DEFAULT_STT_FALLBACK_MODEL),
        ),
        (
            &[
                ("STT_FALLBACK_BASE_URL", "https://fallback.example.test/v1"),
                ("STT_FALLBACK_API_KEY", "test-key"),
                ("STT_FALLBACK_MODEL", " "),
            ],
            None,
        ),
    ];
    for &(overrides, expected_model) in cases {
        let mut command = worker();
        // Keep external runner settings out of the check and don't ping a live LLM.
        for name in [
            "LLM_BASE_URL",
            "LLM_API_KEY",
            "LLM_MODEL",
            "LLM_FALLBACK_BASE_URL",
            "LLM_FALLBACK_API_KEY",
            "LLM_FALLBACK_MODEL",
            "STT_BASE_URL",
            "STT_API_KEY",
            "STT_MODEL",
            "STT_FALLBACK_BASE_URL",
            "STT_FALLBACK_API_KEY",
            "STT_FALLBACK_MODEL",
        ] {
            command.env_remove(name);
        }
        let output = command
            .envs(overrides.iter().copied())
            .args(["--task", "llm-check"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let event = event(&output);
        assert_eq!(event["type"], "result");
        for status in [&event["data"], &event["llmStatus"]] {
            assert_eq!(status["sttConfigured"], expected_model.is_some());
            assert_eq!(status.get("sttModel"), Some(&json!(expected_model)));
        }
    }
}

#[test]
fn self_check_loads_embedded_face_model() {
    let output = worker()
        .env_remove("FONTS_DIR")
        .args(["--task", "self-check"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let event = event(&output);
    assert_eq!(event["type"], "result");
    let data = &event["data"];
    assert_eq!(data["ok"], true);
    assert_eq!(data["ffmpeg"], true);
    assert_eq!(data["ffprobe"], true);
    assert!(data["ytdlp"].is_boolean());
    assert_eq!(data["faceModel"], "yunet-2023mar");
}

#[test]
fn invalid_frame_payload_from_stdin_has_clean_json_error() {
    let mut child = worker()
        .args(["--task", "frame", "--payload-stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(b"{}").unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success());
    let event = event(&output);
    assert_eq!(event["type"], "error");
    assert_eq!(event["message"], "invalid_frame_payload");
    assert_eq!(output.stderr, b"invalid_frame_payload\n");
}

#[test]
fn invalid_brief_has_legacy_error_code() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("payload.json");
    std::fs::write(&path, b"{invalid json}").unwrap();
    let output = worker()
        .args(["--task", "brief", "--payload-file"])
        .arg(path)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert_eq!(event(&output)["message"], "caption_unavailable");
}

#[cfg(unix)]
#[test]
fn missing_subtitles_preserve_legacy_message() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().unwrap();
    let mock = dir.path().join("yt-dlp");
    std::fs::write(&mock, b"#!/bin/sh\nexit 0\n").unwrap();
    std::fs::set_permissions(&mock, std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = dir.path().join("payload.json");
    std::fs::write(&path, br#"{"url":"https://example.test/video"}"#).unwrap();
    let output = worker()
        .env("YTDLP_BIN", mock)
        .env("TEMP_ROOT", dir.path())
        .args(["--task", "preview", "--payload-file"])
        .arg(path)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert_eq!(
        event(&output)["message"],
        "Subtitle YouTube tidak tersedia untuk video ini."
    );
}

#[test]
fn preexisting_cancel_file_stops_job_before_work() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cancel");
    std::fs::write(&path, []).unwrap();
    let output = worker()
        .args(["--task", "job", "--cancel-file"])
        .arg(path)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert_eq!(event(&output)["message"], "job dibatalkan");
}

#[test]
fn cancel_file_interrupts_wait_for_stdin() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cancel");
    let mut child = worker()
        .args(["--task", "job", "--payload-stdin", "--cancel-file"])
        .arg(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let _stdin = child.stdin.take().unwrap();
    let waiter = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(100));
        std::fs::write(path, []).unwrap();
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut timed_out = false;
    while child.try_wait().unwrap().is_none() {
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            timed_out = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    waiter.join().unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(!timed_out, "cancellation did not interrupt the stdin wait");
    assert!(!output.status.success());
    assert_eq!(event(&output)["message"], "job dibatalkan");
}
