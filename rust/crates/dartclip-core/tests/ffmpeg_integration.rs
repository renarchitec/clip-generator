use dartclip_core::{
    hook_thumbnail::{extract_cover_frame, prepend_hook_intro, render_hook_thumbnail},
    models::{AspectRatio, CaptionStyle, Moment, ReframeMode, Watermark, WatermarkChromaKey},
    pipeline::{CancellationToken, Pipeline, PipelineConfig, RenderOptions},
    subtitles::parse_vtt,
    tools::{ensure_tool_installed, probe_media, ToolPaths},
};
use image::{Rgb, RgbImage, Rgba, RgbaImage};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
};

fn execute(cmd: &mut Command) -> Output {
    let out = cmd
        .output()
        .unwrap_or_else(|e| panic!("cannot run {cmd:?}: {e}"));
    assert!(
        out.status.success(),
        "failed {cmd:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    out
}
fn ffmpeg(path: &Path) -> Command {
    let mut cmd = Command::new(path);
    cmd.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
    ]);
    cmd
}
async fn tools(dir: &Path) -> ToolPaths {
    ToolPaths {
        ffmpeg: ensure_tool_installed(dir, "ffmpeg")
            .await
            .expect("FFmpeg with libx264 and libass is required"),
        ffprobe: ensure_tool_installed(dir, "ffprobe")
            .await
            .expect("ffprobe is required"),
        ytdlp: PathBuf::from("yt-dlp"),
    }
}
fn fonts() -> PathBuf {
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // The mirrored verification workspace may be nested under the real crate.
    crate_dir
        .ancestors()
        .map(|p| p.join("worker/fonts"))
        .find(|p| p.join("Montserrat-Bold.ttf").is_file())
        .expect("worker/fonts/Montserrat-Bold.ttf")
}
fn make_source(ff: &Path, output: &Path) {
    execute(
        ffmpeg(ff)
            .args([
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=480x270:rate=10:duration=2.4",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=880:sample_rate=48000:duration=2.4",
                "-af",
                "volume=0.2",
                "-c:v",
                "libx264",
                "-threads",
                "2",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(output),
    );
}
fn frame(tools: &ToolPaths, video: &Path, at: &str) -> RgbImage {
    let out = execute(
        ffmpeg(&tools.ffmpeg)
            .args(["-ss", at, "-i"])
            .arg(video)
            .args([
                "-frames:v",
                "1",
                "-c:v",
                "png",
                "-threads",
                "1",
                "-f",
                "image2pipe",
                "pipe:1",
            ]),
    );
    image::load_from_memory(&out.stdout).unwrap().to_rgb8()
}
fn assert_rgb(img: &RgbImage, x: u32, y: u32, want: [u8; 3]) {
    let Rgb(actual) = *img.get_pixel(x, y);
    assert!(
        actual.iter().zip(want).all(|(a, b)| a.abs_diff(b) <= 28),
        "at ({x}, {y}): wanted {want:?}, got {actual:?}"
    );
}
fn sample_rate(tools: &ToolPaths, path: &Path) -> String {
    let out = execute(
        Command::new(&tools.ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=sample_rate",
                "-of",
                "json",
            ])
            .arg(path),
    );
    serde_json::from_slice::<Value>(&out.stdout).unwrap()["streams"][0]["sample_rate"]
        .as_str()
        .unwrap()
        .into()
}
fn mean_volume(tools: &ToolPaths, path: &Path) -> f64 {
    let output = execute(
        ffmpeg(&tools.ffmpeg)
            .args(["-loglevel", "info", "-i"])
            .arg(path)
            .args(["-vn", "-af", "volumedetect", "-f", "null", "-"]),
    );
    String::from_utf8_lossy(&output.stderr)
        .lines()
        .find_map(|l| {
            l.split_once("mean_volume: ")
                .and_then(|(_, v)| v.split_whitespace().next()?.parse().ok())
        })
        .expect("mean volume")
}
#[tokio::test]
async fn center_crop_renders_wide_to_portrait_and_portrait_to_square() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path();
    let t = tools(p).await;
    let pipe = Pipeline::new(PipelineConfig::new(t.clone(), p));
    let cancel = CancellationToken::new();
    for (name, size, aspect_ratio, border_box) in [
        ("wide", "320x180", AspectRatio::Portrait, "x=0:y=0:w=48:h=ih"),
        ("tall", "180x320", AspectRatio::Square, "x=0:y=0:w=iw:h=48"),
    ] {
        let source = p.join(format!("{name}-source.mp4"));
        let output = p.join(format!("{name}-crop.mp4"));
        let fixture = format!("color=c=red:s={size}:r=5:d=0.6,drawbox={border_box}:c=blue:t=fill");
        execute(
            ffmpeg(&t.ffmpeg)
                .args(["-f", "lavfi", "-i", &fixture, "-c:v", "libx264"])
                .arg(&source),
        );
        pipe.render_one(
            &source,
            &Moment {
                start: 0.,
                end: 0.6,
                ..Default::default()
            },
            &[],
            &output,
            &RenderOptions {
                aspect_ratio,
                ..Default::default()
            },
            &cancel,
        )
        .await
        .unwrap();
        let img = frame(&t, &output, "0");
        let (w, h) = img.dimensions();
        assert_eq!((w, h), aspect_ratio.output_size());
        // The blue border would still be visible if the crop were anchored at the top or left.
        assert_rgb(&img, 0, 0, [255, 0, 0]);
        assert_rgb(&img, w - 1, h - 1, [255, 0, 0]);
    }
}

#[tokio::test]
async fn portrait_render_burns_positioned_word_pop_and_both_watermarks_with_loudnorm() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path();
    let t = tools(p).await;
    let src = p.join("source.mp4");
    make_source(&t.ffmpeg, &src);
    let logo = p.join("logo.png");
    RgbaImage::from_pixel(20, 20, Rgba([235, 30, 15, 255]))
        .save(&logo)
        .unwrap();
    let green = p.join("green.mp4");
    execute(ffmpeg(&t.ffmpeg).args(["-f","lavfi","-i","color=c=0x00ff00:s=100x100:r=10:d=0.3,drawbox=x=35:y=35:w=30:h=30:c=0xff00ff:t=fill","-c:v","libx264","-pix_fmt","yuv420p","-threads","2"]).arg(&green));
    let cues = parse_vtt(
        "WEBVTT\n\n00:00.200 --> 00:02.000\n<00:00.200><c>Pop</c> <00:00.850><c>now!</c>\n",
        true,
    );
    let style = CaptionStyle {
        preset: "custom".into(),
        position_y: Some(0.27),
        ..CaptionStyle::default()
    };
    let mut config = PipelineConfig::new(t.clone(), p);
    config.font_dir = Some(fonts());
    let pipeline = Pipeline::new(config);
    let options = RenderOptions {
        reframe: ReframeMode::BlackBars,
        caption_style: Some(style),
        watermarks: vec![
            (
                Watermark {
                    file_path: "logo.png".into(),
                    x: 0.2,
                    y: 0.12,
                    scale: 0.14,
                    ..Default::default()
                },
                logo,
            ),
            (
                Watermark {
                    file_path: "green.mp4".into(),
                    x: 0.8,
                    y: 0.12,
                    scale: 0.17,
                    chroma_key: Some(WatermarkChromaKey {
                        enabled: true,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                green,
            ),
        ],
        normalize_audio: true,
        ..Default::default()
    };
    let out = p.join("portrait.mp4");
    let moment = Moment {
        start: 0.,
        end: 2.,
        ..Default::default()
    };
    pipeline
        .render_one(
            &src,
            &moment,
            &cues,
            &out,
            &options,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    let meta = probe_media(&t.ffprobe, &out).await.unwrap();
    assert_eq!((meta.width, meta.height), (1080, 1920));
    assert!(meta.has_audio);
    assert!((meta.duration - 2.).abs() < 0.15);
    let first = frame(&t, &out, "0.300");
    let second = frame(&t, &out, "0.900");
    // The second timestamp is past the 0.3s video watermark asset: it had to loop.
    for f in [&first, &second] {
        assert_rgb(f, 216, 230, [235, 30, 15]);
        assert_rgb(f, 864, 230, [255, 0, 255]);
        assert_rgb(f, 807, 172, [0, 0, 0]);
    }
    let yellow_center = |f: &RgbImage| {
        let points: Vec<_> = f
            .enumerate_pixels()
            .filter(|(x, y, p)| {
                (310..770).contains(x)
                    && (455..585).contains(y)
                    && p[0] > 155
                    && p[1] > 155
                    && p[2] < 100
            })
            .map(|(x, _, _)| x as usize)
            .collect();
        assert!(points.len() > 100, "no yellow subtitle at position_y");
        points.iter().sum::<usize>() / points.len()
    };
    assert!(
        yellow_center(&second) > yellow_center(&first) + 45,
        "active word highlight did not advance"
    );
    assert_eq!(sample_rate(&t, &out), "44100");
    assert!(mean_volume(&t, &out) > mean_volume(&t, &src) + 10.);
}

#[tokio::test]
async fn hook_thumbnail_and_zoom_intro_extend_video_with_valid_audio() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path();
    let t = tools(p).await;
    let src = p.join("source.mp4");
    make_source(&t.ffmpeg, &src);
    let cover = p.join("cover.png");
    let thumb = p.join("hook.png");
    let out = p.join("with-intro.mp4");
    extract_cover_frame(&t.ffmpeg, &src, 0., 2.4, &cover)
        .await
        .unwrap();
    render_hook_thumbnail(
        &cover,
        "Wait for the Twist",
        480,
        270,
        Some((0.51, 0.40)),
        fonts(),
        &thumb,
    )
    .unwrap();
    let thumbnail = image::open(&thumb).unwrap().to_rgb8();
    assert_eq!(thumbnail.dimensions(), (480, 270));
    assert!(
        thumbnail.pixels().filter(|p| p.0 == [250, 204, 21]).count() > 100,
        "missing pill/gold typography"
    );
    assert!(
        thumbnail.pixels().filter(|p| p.0 == [255; 3]).count() > 25,
        "missing white typography"
    );
    let before = probe_media(&t.ffprobe, &src).await.unwrap();
    prepend_hook_intro(&t.ffmpeg, &t.ffprobe, &src, &thumb, 480, 270, &out)
        .await
        .unwrap();
    let after = probe_media(&t.ffprobe, &out).await.unwrap();
    assert_eq!((after.width, after.height), (480, 270));
    assert!(after.has_audio);
    assert!(
        (after.duration - before.duration - 0.9).abs() < 0.15,
        "before {before:?}; after {after:?}"
    );
    assert_eq!(sample_rate(&t, &out), "44100");
    let intro = frame(&t, &out, "0.200");
    assert!(
        intro
            .pixels()
            .filter(|p| p[0] > 160 && (125..=240).contains(&p[1]) && p[2] < 100)
            .count()
            > 100
    );
}

#[tokio::test]
async fn broken_watermark_falls_back_and_silent_outro_concats() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path();
    let t = tools(p).await;
    let video = p.join("source.mp4");
    let outro = p.join("silent.mp4");
    let bad = p.join("broken.png");
    let rendered = p.join("render.mp4");
    std::fs::write(&bad, b"not a PNG").unwrap();
    make_source(&t.ffmpeg, &video);
    execute(
        ffmpeg(&t.ffmpeg)
            .args([
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=100x150:rate=10:duration=0.6",
                "-c:v",
                "libx264",
                "-an",
            ])
            .arg(&outro),
    );
    let mut config = PipelineConfig::new(t.clone(), p);
    config.render_timeout = std::time::Duration::from_secs(8);
    let pipe = Pipeline::new(config);
    let cancel = CancellationToken::new();
    pipe.render_one(
        &video,
        &Moment {
            start: 0.,
            end: 0.7,
            ..Default::default()
        },
        &[],
        &rendered,
        &RenderOptions {
            reframe: ReframeMode::BlurredFill,
            watermarks: vec![(
                Watermark {
                    file_path: "broken.png".into(),
                    ..Default::default()
                },
                bad,
            )],
            ..Default::default()
        },
        &cancel,
    )
    .await
    .unwrap();
    let before = probe_media(&t.ffprobe, &rendered).await.unwrap();
    pipe.append_outro(&rendered, &outro, &rendered, &cancel)
        .await
        .unwrap();
    let after = probe_media(&t.ffprobe, &rendered).await.unwrap();
    assert_eq!((after.width, after.height), (1080, 1920));
    assert!(after.has_audio);
    assert!((after.duration - before.duration - 0.6).abs() < 0.15);
}
