use crate::{
    llm::{BrollCatalogItem, LlmClient},
    models::{
        MediaSourceKind, SplitPanelFit, SplitScreenConfig, SplitScreenRatio, SplitScreenSegment,
    },
    pipeline::Pipeline,
    tools::{self, ToolPaths},
};
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SplitPanelLayout {
    pub primary_w: u32,
    pub primary_h: u32,
    pub secondary_w: u32,
    pub secondary_h: u32,
    pub primary_on_top: bool,
    pub seam_y_frac: f64,
}

pub fn split_panel_dims(ratio: SplitScreenRatio, swap: bool) -> SplitPanelLayout {
    let top = match ratio {
        SplitScreenRatio::FiftyFifty => 960,
        SplitScreenRatio::FortySixty => 768,
        SplitScreenRatio::SixtyForty => 1152,
    };
    let bottom = 1920 - top;
    SplitPanelLayout {
        primary_w: 1080,
        primary_h: if swap { bottom } else { top },
        secondary_w: 1080,
        secondary_h: if swap { top } else { bottom },
        primary_on_top: !swap,
        seam_y_frac: f64::from(top) / 1920.,
    }
}

pub fn fit_panel_filter(
    input_label: &str,
    w: u32,
    h: u32,
    fit: SplitPanelFit,
    out_label: &str,
) -> String {
    let cover = format!("scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}");
    match fit {
        SplitPanelFit::Cover => format!("{input_label}{cover},setsar=1{out_label}"),
        SplitPanelFit::ContainBlur => {
            let id = out_label.trim_matches(['[', ']']);
            format!("{input_label}split=2[{id}_bg][{id}_fg];[{id}_bg]{cover},gblur=sigma=24[{id}_blur];[{id}_fg]scale={w}:{h}:force_original_aspect_ratio=decrease[{id}_sharp];[{id}_blur][{id}_sharp]overlay=(W-w)/2:(H-h)/2,setsar=1{out_label}")
        }
    }
}

pub(crate) fn stack_panels(layout: SplitPanelLayout) -> String {
    let panels = if layout.primary_on_top {
        "[primary][secondary]"
    } else {
        "[secondary][primary]"
    };
    format!("{panels}vstack=inputs=2:shortest=1[stacked]")
}

pub fn resolve_local_media_path(clips_dir: &Path, rel_path: &str) -> Result<PathBuf> {
    let normalized = rel_path.replace('\\', "/");
    let rel = Path::new(&normalized);
    if normalized.is_empty()
        || normalized.contains(':')
        || rel
            .components()
            .any(|c| !matches!(c, Component::CurDir | Component::Normal(_)))
    {
        bail!("invalid local media path");
    }
    let root = clips_dir.canonicalize().context("resolving CLIPS_DIR")?;
    let path = root
        .join(rel)
        .canonicalize()
        .context("local media file not found")?;
    if !path.starts_with(&root) || !path.is_file() {
        bail!("invalid local media path");
    }
    Ok(path)
}

#[derive(Debug, Clone)]
pub struct PreparedBrollClip {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub path: PathBuf,
    pub duration_sec: f64,
}

impl From<&PreparedBrollClip> for BrollCatalogItem {
    fn from(clip: &PreparedBrollClip) -> Self {
        Self {
            id: clip.id.clone(),
            label: clip.label.clone(),
            description: clip.description.clone(),
            duration_sec: clip.duration_sec,
        }
    }
}

pub fn needs_visual_summary(label: &str) -> bool {
    let label = label.trim();
    if label.starts_with("https://") || label.starts_with("http://") {
        return true;
    }
    let stem = label
        .rsplit_once('.')
        .filter(|(_, ext)| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v"
            )
        })
        .map_or(label, |(s, _)| s);
    let normalized = stem.to_ascii_lowercase();
    let tokens: Vec<_> = normalized
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .collect();
    if tokens.is_empty()
        || tokens
            .iter()
            .all(|token| token.chars().all(|c| c.is_ascii_hexdigit()))
    {
        return true;
    }
    const GENERIC: &[&str] = &[
        "b",
        "broll",
        "roll",
        "clip",
        "video",
        "upload",
        "media",
        "stock",
        "footage",
        "untitled",
        "img",
        "vid",
        "mov",
        "dsc",
        "pxl",
        "dji",
        "screen",
        "recording",
        "mp4",
        "final",
        "edit",
        "trim",
        "copy",
    ];
    let generic = |token: &str| {
        GENERIC.contains(&token)
            || token.bytes().any(|c| c.is_ascii_digit())
            || (token.len() >= 8
                && !token.chars().any(|c| c.is_whitespace())
                && token.chars().all(|c| c.is_ascii_alphanumeric())
                && !token.chars().any(|c| "aeiou".contains(c)))
    };
    tokens.iter().all(|token| generic(token))
}

async fn summarize(
    clip: &PreparedBrollClip,
    tools: &ToolPaths,
    llm: &LlmClient,
    cancel: &CancellationToken,
) -> Option<String> {
    let mut frames = Vec::new();
    for fraction in [0.2, 0.5, 0.8] {
        if let Ok(out) = tools::run(
            tools::ffmpeg(&tools.ffmpeg)
                .args(["-ss", &format!("{:.6}", clip.duration_sec * fraction), "-i"])
                .arg(&clip.path)
                .args([
                    "-map",
                    "0:v:0",
                    "-vf",
                    "scale='min(512,iw)':-2",
                    "-frames:v",
                    "1",
                    "-c:v",
                    "mjpeg",
                    "-q:v",
                    "4",
                    "-f",
                    "image2pipe",
                    "pipe:1",
                ]),
            Duration::from_secs(20),
            cancel,
        )
        .await
        {
            if !out.stdout.is_empty() {
                frames.push(STANDARD.encode(out.stdout));
            }
        }
    }
    tokio::select! { biased; _ = cancel.cancelled() => None, result = llm.describe_broll_frames(&clip.label, &frames) => result }
}

pub async fn prepare_broll_sources(
    pipeline: &Pipeline,
    config: &SplitScreenConfig,
    work_dir: &Path,
    run_vision: bool,
    llm: Option<&LlmClient>,
    cancel: &CancellationToken,
) -> Result<Vec<PreparedBrollClip>> {
    let tools = &pipeline.config.tools;
    let mut prepared = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for (i, source) in config.clips.iter().enumerate() {
        if source.id.is_empty() || !ids.insert(&source.id) {
            bail!("missing or duplicate B-roll clip ID");
        }
        let start = source
            .start_sec
            .filter(|v| v.is_finite())
            .unwrap_or(0.)
            .max(0.);
        let end = source.end_sec.filter(|v| v.is_finite());
        let (mut path, downloaded_section) = if source.kind == MediaSourceKind::Url {
            let url = source.url.as_deref().context("missing B-roll URL")?;
            let prefix = format!("broll_{i}");
            pipeline
                .download_broll(
                    url,
                    work_dir,
                    &prefix,
                    source.start_sec.map(|_| start),
                    end,
                    cancel,
                )
                .await?
        } else {
            (
                resolve_local_media_path(
                    &pipeline.config.clips_dir,
                    source
                        .file_path
                        .as_deref()
                        .context("missing local B-roll file path")?,
                )?,
                false,
            )
        };
        let info = tools::probe_media_cancel(&tools.ffprobe, &path, cancel).await?;
        let mut duration_sec = info.duration;
        if !downloaded_section && (source.start_sec.is_some() || end.is_some()) {
            let end = end.unwrap_or(info.duration).min(info.duration);
            if end <= start {
                bail!("invalid trim for B-roll {}", source.id);
            }
            if start > 0. || end < info.duration {
                let trimmed = work_dir.join(format!("broll_trim_{i}.mp4"));
                let mut cmd = tools::ffmpeg(&tools.ffmpeg);
                cmd.args(["-ss", &format!("{start:.6}"), "-i"])
                    .arg(&path)
                    .args([
                        "-t",
                        &format!("{:.6}", end - start),
                        "-map",
                        "0:v:0",
                        "-map",
                        "0:a:0?",
                        "-c:a",
                        "aac",
                    ]);
                tools::video_encoder(&mut cmd, &pipeline.config.video_encoder, "23");
                tools::run(cmd.arg(&trimmed), pipeline.config.render_timeout, cancel).await?;
                duration_sec = tools::probe_media_cancel(&tools.ffprobe, &trimmed, cancel)
                    .await?
                    .duration;
                path = trimmed;
            }
        }
        prepared.push(PreparedBrollClip {
            id: source.id.clone(),
            label: source.label.clone(),
            description: source
                .description
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned),
            path,
            duration_sec,
        });
    }
    if let Some(llm) = llm.filter(|_| run_vision) {
        let mut pending = prepared
            .iter()
            .cloned()
            .enumerate()
            .filter(|(_, clip)| clip.description.is_none() && needs_visual_summary(&clip.label))
            .collect::<Vec<_>>()
            .into_iter();
        let mut tasks = JoinSet::new();
        let spawn = |tasks: &mut JoinSet<_>, (i, clip): (usize, PreparedBrollClip)| {
            let (tools, llm, cancel) = (tools.clone(), llm.clone(), cancel.clone());
            tasks.spawn(async move { (i, summarize(&clip, &tools, &llm, &cancel).await) });
        };
        for item in pending.by_ref().take(3) {
            spawn(&mut tasks, item);
        }
        while let Some(result) = tasks.join_next().await {
            if let Ok((i, description)) = result {
                prepared[i].description = description;
            }
            if !cancel.is_cancelled() {
                if let Some(item) = pending.next() {
                    spawn(&mut tasks, item);
                }
            }
        }
    }
    if cancel.is_cancelled() {
        bail!("job cancelled");
    }
    Ok(prepared)
}

#[allow(clippy::too_many_arguments)]
pub async fn render_broll_track(
    segments: &[SplitScreenSegment],
    prepared_map: &HashMap<String, PreparedBrollClip>,
    w: u32,
    h: u32,
    fit: SplitPanelFit,
    clip_dur: f64,
    need_audio: bool,
    out_path: &Path,
    tools: &ToolPaths,
    encoder: &str,
    timeout: Duration,
    cancel: &CancellationToken,
) -> Result<()> {
    if segments.is_empty() || !clip_dur.is_finite() || clip_dur <= 0. {
        bail!("invalid B-roll timeline");
    }
    let piece_dir = tempfile::tempdir_in(out_path.parent().context("no B-roll output directory")?)?;
    let mut list = String::from("ffconcat version 1.0\n");
    let mut prev_frame = 0;
    let total_frames = (clip_dur * 30.).ceil() as u64;
    for (i, segment) in segments.iter().enumerate() {
        let end_frame = if i + 1 == segments.len() {
            total_frames
        } else {
            (segment.at_end * 30.).round() as u64
        }
        .min(total_frames);
        if end_frame <= prev_frame {
            continue;
        }
        let frames = end_frame - prev_frame;
        prev_frame = end_frame;
        let duration = frames as f64 / 30.;
        let clip = prepared_map
            .get(&segment.clip_id)
            .ok_or_else(|| anyhow!("unknown B-roll clip {}", segment.clip_id))?;
        let start = segment
            .source_start_sec
            .unwrap_or(0.)
            .clamp(0., (clip.duration_sec - 0.5).max(0.));
        let meta = if need_audio {
            Some(tools::probe_media_cancel(&tools.ffprobe, &clip.path, cancel).await?)
        } else {
            None
        };
        let mut cmd = tools::ffmpeg(&tools.ffmpeg);
        if duration > clip.duration_sec - start + 0.000_001 {
            cmd.args(["-stream_loop", "-1"]);
        }
        cmd.args(["-ss", &format!("{start:.6}"), "-i"])
            .arg(&clip.path);
        let mut graph = fit_panel_filter("[0:v:0]", w, h, fit, "[fit]");
        graph.push_str(&format!(";[fit]fps=30,tpad=stop_mode=clone:stop_duration={duration:.6},trim=end_frame={frames},setpts=PTS-STARTPTS[v]"));
        if let Some(meta) = meta {
            let audio = if meta.has_audio {
                "0:a:0"
            } else {
                tools::silence(&mut cmd, duration);
                "1:a:0"
            };
            graph.push(';');
            graph.push_str(&tools::audio_filter(audio, "a", duration, ""));
        }
        cmd.args(["-filter_complex", &graph, "-map", "[v]"]);
        tools::video_encoder(&mut cmd, encoder, "23");
        if need_audio {
            cmd.args([
                "-map",
                "[a]",
                "-c:a",
                "pcm_s16le",
                "-ac",
                "2",
                "-ar",
                "44100",
            ]);
        }
        let piece = format!("piece-{i}.mov");
        tools::run(
            cmd.args(["-t", &format!("{duration:.6}")])
                .arg(piece_dir.path().join(&piece)),
            timeout,
            cancel,
        )
        .await?;
        list.push_str(&format!("file {piece}\nduration {duration:.6}\n"));
    }
    let list_path = piece_dir.path().join("pieces.ffconcat");
    fs::write(&list_path, list)?;
    let mut cmd = tools::ffmpeg(&tools.ffmpeg);
    cmd.args(["-f", "concat", "-i"])
        .arg(list_path)
        .args(["-map", "0:v:0", "-c:v", "copy"]);
    if need_audio {
        cmd.args(["-map", "0:a:0", "-c:a", "aac", "-ac", "2", "-ar", "44100"]);
    }
    tools::run(
        cmd.args(["-t", &format!("{clip_dur:.6}")]).arg(out_path),
        timeout,
        cancel,
    )
    .await?;
    Ok(())
}

pub async fn extract_split_cover_frame(
    ffmpeg: &Path,
    primary: (&Path, f64),
    secondary: (&Path, f64),
    config: &SplitScreenConfig,
    subtitle_filter: Option<&str>,
    out_path: &Path,
    cancel: &CancellationToken,
) -> Result<()> {
    let layout = split_panel_dims(config.ratio, config.swap);
    let mut graph = vec![
        "[0:v:0]setpts=PTS-STARTPTS[pcover]".to_owned(),
        "[1:v:0]setpts=PTS-STARTPTS[scover]".to_owned(),
        fit_panel_filter(
            "[pcover]",
            layout.primary_w,
            layout.primary_h,
            config.primary_fit,
            "[primary]",
        ),
        fit_panel_filter(
            "[scover]",
            layout.secondary_w,
            layout.secondary_h,
            config.secondary_fit,
            "[secondary]",
        ),
        stack_panels(layout),
    ];
    let mut label = "[stacked]";
    if let Some(filter) = subtitle_filter {
        graph.push(format!("[stacked]{filter}[subtitled]"));
        label = "[subtitled]";
    }
    let mut cmd = tools::ffmpeg(ffmpeg);
    for (path, seek) in [primary, secondary] {
        cmd.args(["-ss", &format!("{seek:.6}"), "-i"]).arg(path);
    }
    tools::run(
        cmd.args([
            "-filter_complex",
            &graph.join(";"),
            "-map",
            label,
            "-frames:v",
            "1",
            "-update",
            "1",
        ])
        .arg(out_path),
        Duration::from_secs(30),
        cancel,
    )
    .await?;
    if fs::metadata(out_path)?.len() == 0 {
        bail!("empty split-screen frame");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        models::{FrameRequest, JobData},
        pipeline::PipelineConfig,
    };
    use image::GenericImageView;
    use serde_json::json;

    #[test]
    fn ratios_keep_the_same_seam_when_swapped() {
        for (ratio, top, seam) in [
            (SplitScreenRatio::FiftyFifty, 960, 0.5),
            (SplitScreenRatio::FortySixty, 768, 0.4),
            (SplitScreenRatio::SixtyForty, 1152, 0.6),
        ] {
            for swap in [false, true] {
                let dims = split_panel_dims(ratio, swap);
                assert_eq!((dims.primary_w, dims.secondary_w), (1080, 1080));
                let heights = if swap {
                    (dims.secondary_h, dims.primary_h)
                } else {
                    (dims.primary_h, dims.secondary_h)
                };
                assert_eq!(heights, (top, 1920 - top));
                assert_eq!(dims.primary_on_top, !swap);
                assert_eq!(dims.seam_y_frac, seam);
            }
        }
    }

    #[test]
    fn both_panel_filters_produce_labeled_outputs() {
        assert_eq!(
            fit_panel_filter("[in]", 1080, 960, SplitPanelFit::Cover, "[out]"),
            "[in]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[out]"
        );
        let graph = fit_panel_filter("[in]", 1080, 960, SplitPanelFit::ContainBlur, "[out]");
        assert!(graph.contains("gblur=sigma=24[out_blur]"));
        assert!(graph.contains("force_original_aspect_ratio=decrease[out_sharp]"));
        assert!(graph.ends_with("overlay=(W-w)/2:(H-h)/2,setsar=1[out]"));
    }

    #[test]
    fn selects_generic_media_labels_and_rejects_unsafe_paths() {
        assert!(needs_visual_summary("VID_20260101.mp4"));
        assert!(needs_visual_summary("B-roll 2"));
        assert!(needs_visual_summary("https://example.com/watch?v=20"));
        assert!(needs_visual_summary(""));
        assert!(!needs_visual_summary("Crowd cheers after the goal.mp4"));
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        fs::write(root.path().join("clip.mp4"), b"clip").unwrap();
        assert!(resolve_local_media_path(root.path(), "clip.mp4").is_ok());
        for path in ["../clip.mp4", "..\\clip.mp4", "C:\\clip.mp4", "/clip.mp4"] {
            assert!(resolve_local_media_path(root.path(), path).is_err());
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.path(), root.path().join("link.mp4")).unwrap();
            assert!(resolve_local_media_path(root.path(), "link.mp4").is_err());
        }
    }

    #[tokio::test]
    async fn synthetic_local_job_and_frame_render_split_screen() {
        let dir = tempfile::tempdir().unwrap();
        let tools = ToolPaths {
            ffmpeg: "ffmpeg".into(),
            ffprobe: "ffprobe".into(),
            ytdlp: "should-not-be-called".into(),
        };
        if [&tools.ffmpeg, &tools.ffprobe].into_iter().any(|program| {
            !std::process::Command::new(program)
                .arg("-version")
                .output()
                .is_ok_and(|out| out.status.success())
        }) {
            return;
        }
        let cancel = CancellationToken::new();
        let timeout = Duration::from_secs(60);
        for (filename, color, duration, audio) in [
            ("primary.mp4", "red", "3.2", true),
            ("blue.mp4", "blue", "0.4", false),
            ("green.mp4", "lime", "0.4", true),
        ] {
            let mut cmd = tools::ffmpeg(&tools.ffmpeg);
            cmd.args([
                "-f",
                "lavfi",
                "-i",
                &format!("color=c={color}:s=160x90:r=30"),
            ]);
            if audio {
                cmd.args([
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:sample_rate=44100",
                    "-c:a",
                    "aac",
                ]);
            }
            tools::video_encoder(&mut cmd, "libx264", "23");
            tools::run(
                cmd.args(["-t", duration]).arg(dir.path().join(filename)),
                timeout,
                &cancel,
            )
            .await
            .unwrap();
        }
        let mut payload = json!({"primarySource":{"kind":"upload","filePath":"primary.mp4"},"splitScreen":{"enabled":true,"ratio":"40:60","swap":true,"primaryFit":"contain_blur","secondaryVolume":0.5,"matchMode":"sequential","clips":[{"id":"b","kind":"upload","filePath":"blue.mp4"},{"id":"g","kind":"clip","filePath":"green.mp4"}]},"atSec":1.25,"outPath":".frames/split.jpg","aspectRatio":"9:16","captions":false});
        let pipeline = Pipeline::new(PipelineConfig::new(tools.clone(), dir.path()));
        let frame: FrameRequest = serde_json::from_value(payload.clone()).unwrap();
        let result = pipeline.run_frame(&frame, &cancel).await.unwrap();
        let assert_colors = |image: &image::DynamicImage, green: bool| {
            assert_eq!(image.dimensions(), (1080, 1920));
            let top = image.get_pixel(540, 740).0;
            let bottom = image.get_pixel(540, 794).0;
            assert!(
                if green {
                    top[1] > 145 && top[0] < 50 && top[2] < 50
                } else {
                    top[2] > 145 && top[0] < 50 && top[1] < 50
                },
                "top={top:?}"
            );
            assert!(
                bottom[0] > 145 && bottom[1] < 50 && bottom[2] < 50,
                "bottom={bottom:?}"
            );
        };
        assert_colors(&image::open(dir.path().join(result.file)).unwrap(), false);

        payload["jobId"] = json!("split-test");
        payload["mode"] = json!("manual");
        payload["ranges"] = json!([{"start":0.,"end":3.2,"splitTimeline":[{"atStart":0.,"atEnd":1.6,"clipId":"b"},{"atStart":1.6,"atEnd":3.2,"clipId":"g"}]}]);
        payload["normalizeAudio"] = json!(true);
        payload["hookBanner"] = json!(true);
        payload["outro"] = json!({"filePath":"green.mp4"});
        let job = JobData::from_json(payload).unwrap();
        let result = pipeline
            .run_job(&job, &cancel, |_| std::future::ready(()))
            .await
            .unwrap();
        let path = dir.path().join("split-test").join(&result.clips[0].file);
        let info = tools::probe_media(&tools.ffprobe, &path).await.unwrap();
        assert_eq!((info.width, info.height, info.fps), (1080, 1920, 30.));
        assert!(
            (info.duration - (3.2 + 0.4 + crate::hook_thumbnail::HOOK_INTRO_DURATION_SEC)).abs()
                < 0.07
        );
        assert!(info.has_audio);
        for (seek, green) in [("0.2", false), ("1.4", false), ("3.4", true)] {
            let screenshot = dir.path().join("sample.png");
            tools::run(
                tools::ffmpeg(&tools.ffmpeg)
                    .args(["-ss", seek, "-i"])
                    .arg(&path)
                    .args(["-frames:v", "1", "-update", "1"])
                    .arg(&screenshot),
                timeout,
                &cancel,
            )
            .await
            .unwrap();
            assert_colors(&image::open(&screenshot).unwrap(), green);
        }
    }
}
