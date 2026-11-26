use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{ensure, Context, Result};
use dartclip_face::{
    detect_facecam_box, facecam_box_matches_window,
    frames::{probe_video, seek_frame, FrameSampler},
    shot_cut::ShotCutDetector,
    track_active_speaker, TrackSegment,
};

// Keep all generated fixtures in the crate, even when Cargo is invoked elsewhere.
struct FixtureDir(PathBuf);
impl FixtureDir {
    fn new() -> Result<Self> {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("fixture-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&dir)?;
        Ok(Self(dir))
    }
    fn video(&self, args: &[&str], name: &str) -> Result<PathBuf> {
        let path = self.0.join(name);
        let run = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-filter_threads",
                "1",
                "-filter_complex_threads",
                "1",
            ])
            .args(args)
            .args(["-c:v", "ffv1", "-threads:v", "1"])
            .arg(&path)
            .output()
            .context("ffmpeg is required to run the video tests")?;
        ensure!(
            run.status.success(),
            "fixture generation failed: {}",
            String::from_utf8_lossy(&run.stderr)
        );
        Ok(path)
    }
}
impl Drop for FixtureDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn finds_the_cut_in_a_generated_two_color_video() -> Result<()> {
    let fixtures = FixtureDir::new()?;
    let path = fixtures.video(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=160x90:r=25:d=0.52",
            "-f",
            "lavfi",
            "-i",
            "color=c=white:s=160x90:r=25:d=0.48",
            "-filter_complex",
            "[0:v][1:v]concat=n=2:v=1:a=0[out]",
            "-map",
            "[out]",
        ],
        "cut.mkv",
    )?;
    let info = probe_video(&path)?;
    assert_eq!(
        (info.width, info.height, info.fps, info.duration),
        (160, 90, 25.0, 1.0)
    );
    let mut detector = ShotCutDetector::new();
    let mut cuts = Vec::new();
    for frame in FrameSampler::new(&path, info, 0.0, 1.0, info.fps)? {
        let frame = frame?;
        if detector.push(frame.time, &frame.rgb) {
            cuts.push(frame.time);
        }
    }
    assert_eq!(cuts, vec![0.52]); // deliberately off the 5 fps inference grid
    let after_cut = seek_frame(&path, info, 0.7)?.context("missing seeked frame")?;
    assert!(after_cut.get_pixel(0, 0)[0] > 240);
    assert_eq!(
        track_active_speaker(&path, 0.0, 1.0),
        vec![TrackSegment {
            start: 0.0,
            center_x: 0.5
        }]
    );
    Ok(())
}

#[test]
fn rejects_fullscreen_and_rescans_stale_facecam_cache() -> Result<()> {
    let fixtures = FixtureDir::new()?;
    let portrait = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/astronaut.png");
    let portrait = portrait.to_str().context("fixture path was not UTF-8")?;
    // Crop around the real face, scale to 72px, then composite into the
    // bottom-left corner so the face is small against the gameplay canvas.
    let small = fixtures.video(
        &[
            "-loop",
            "1",
            "-framerate",
            "6",
            "-i",
            portrait,
            "-t",
            "1",
            "-vf",
            "crop=200:200:95:14,scale=72:72,pad=640:360:16:250:color=black",
        ],
        "facecam.mkv",
    )?;
    let stale = (440, 15, 180, 140);
    assert!(!facecam_box_matches_window(&small, 0.0, 1.0, stale));
    let repaired = detect_facecam_box(&small, 0.0, 1.0, Some(stale))
        .context("the stale cache should be replaced by the scanned small face")?;
    assert_ne!(repaired, stale);
    assert!(
        facecam_box_matches_window(&small, 0.0, 1.0, repaired),
        "{repaired:?}"
    );
    assert_eq!(
        detect_facecam_box(&small, 0.0, 1.0, Some(repaired)),
        Some(repaired)
    );

    let fullscreen = fixtures.video(
        &[
            "-loop",
            "1",
            "-framerate",
            "6",
            "-i",
            portrait,
            "-t",
            "1",
            "-vf",
            "crop=200:200:95:14,scale=360:360,pad=640:360:140:0:color=black",
        ],
        "fullscreen.mkv",
    )?;
    assert!(detect_facecam_box(&fullscreen, 0.0, 1.0, Some(repaired)).is_none());
    Ok(())
}
