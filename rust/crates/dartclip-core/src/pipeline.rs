use crate::{
    hook_thumbnail, live_chat,
    llm::{self, LlmClient},
    models::*,
    split_screen::{self, PreparedBrollClip},
    stt::{self, SttConfig, Transcriber},
    subtitles,
    tools::{self, ToolPaths},
};
use anyhow::{anyhow, bail, Context, Result};
use std::{
    collections::HashMap,
    fs,
    future::Future,
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::{process::Command, task::JoinSet};
pub use tokio_util::sync::CancellationToken;

pub type FacecamBox = (u32, u32, u32, u32);
pub type SpeakerSegment = (f64, f64, f64);
pub trait FaceAnalyzer: Send + Sync {
    /// Segment times are relative to the beginning of this render window.
    fn track_active_speaker(
        &self,
        video_path: &Path,
        start: f64,
        end: f64,
    ) -> Result<Vec<SpeakerSegment>>;
    fn detect_two_speakers(
        &self,
        video_path: &Path,
        start: f64,
        end: f64,
    ) -> Result<Option<(f64, f64)>>;
    fn detect_facecam_box(
        &self,
        video_path: &Path,
        start: f64,
        end: f64,
        cached: Option<FacecamBox>,
    ) -> Result<Option<FacecamBox>>;
    fn detect_cover_face_focus(&self, image_path: &Path) -> Option<(f32, f32)>;
}
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopFaceAnalyzer;
impl FaceAnalyzer for NoopFaceAnalyzer {
    fn track_active_speaker(&self, _: &Path, _: f64, _: f64) -> Result<Vec<SpeakerSegment>> {
        Ok(vec![])
    }
    fn detect_two_speakers(&self, _: &Path, _: f64, _: f64) -> Result<Option<(f64, f64)>> {
        Ok(None)
    }
    fn detect_facecam_box(
        &self,
        _: &Path,
        _: f64,
        _: f64,
        _: Option<FacecamBox>,
    ) -> Result<Option<FacecamBox>> {
        Ok(None)
    }
    fn detect_cover_face_focus(&self, _: &Path) -> Option<(f32, f32)> {
        None
    }
}
#[derive(Debug, Clone)]
pub struct PipelineConfig {
    pub tools: ToolPaths,
    pub clips_dir: PathBuf,
    pub temp_root: Option<PathBuf>,
    pub font_dir: Option<PathBuf>,
    pub video_encoder: String,
    pub render_timeout: Duration,
}
impl PipelineConfig {
    pub fn new(tools: ToolPaths, clips_dir: impl Into<PathBuf>) -> Self {
        Self {
            tools,
            clips_dir: clips_dir.into(),
            temp_root: None,
            font_dir: None,
            video_encoder: "libx264".into(),
            render_timeout: Duration::from_secs(900),
        }
    }
}
#[derive(Clone)]
pub struct Pipeline {
    pub config: PipelineConfig,
    faces: Arc<dyn FaceAnalyzer>,
    llm: Option<LlmClient>,
    stt_config: Option<SttConfig>,
}
impl Pipeline {
    pub fn new(config: PipelineConfig) -> Self {
        Self {
            config,
            faces: Arc::new(NoopFaceAnalyzer),
            llm: None,
            stt_config: None,
        }
    }
    pub fn with_face_analyzer(mut self, faces: Arc<dyn FaceAnalyzer>) -> Self {
        self.faces = faces;
        self
    }
    pub fn with_llm(mut self, llm: LlmClient) -> Self {
        self.llm = Some(llm);
        self
    }
    pub fn with_stt(mut self, stt: SttConfig) -> Self {
        self.stt_config = Some(stt);
        self
    }
    fn transcriber(&self) -> Result<Transcriber> {
        let cfg = self.stt_config.as_ref().filter(|cfg| cfg.is_configured()).ok_or_else(|| {
            anyhow!("Transkripsi audio belum dikonfigurasi. Atur provider STT atau STT_BASE_URL dan STT_API_KEY.")
        })?;
        Transcriber::new(cfg.clone(), self.config.tools.clone())
    }
    fn workdir(&self, prefix: &str) -> Result<tempfile::TempDir> {
        let mut b = tempfile::Builder::new();
        b.prefix(prefix);
        if let Some(dir) = &self.config.temp_root {
            fs::create_dir_all(dir)?;
            Ok(b.tempdir_in(dir)?)
        } else {
            Ok(b.tempdir()?)
        }
    }
}
#[derive(Debug, Clone)]
pub struct RenderOptions {
    pub reframe: ReframeMode,
    pub aspect_ratio: AspectRatio,
    pub captions: bool,
    pub two_speakers: bool,
    pub facecam: bool,
    pub caption_style: Option<CaptionStyle>,
    pub watermarks: Vec<(Watermark, PathBuf)>,
    pub normalize_audio: bool,
    pub timeline_offset: f64,
    pub split_screen: Option<Arc<PreparedSplitScreen>>,
    pub split_timeline: Option<Vec<SplitScreenSegment>>,
}

#[derive(Debug)]
pub struct PreparedSplitScreen {
    config: SplitScreenConfig,
    catalog: Vec<llm::BrollCatalogItem>,
    clips: HashMap<String, PreparedBrollClip>,
}
impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            reframe: ReframeMode::default(),
            aspect_ratio: AspectRatio::Portrait,
            captions: true,
            two_speakers: false,
            facecam: false,
            caption_style: None,
            watermarks: vec![],
            normalize_audio: false,
            timeline_offset: 0.,
            split_screen: None,
            split_timeline: None,
        }
    }
}

pub fn center_crop(w: u32, h: u32) -> String {
    let ratio = w as f64 / h as f64;
    format!(
        "crop=w='min(in_w,ih*{ratio:.5})':h='min(in_h,iw/{ratio:.5})':x='(in_w-out_w)/2':y='(in_h-out_h)/2',scale={w}:{h},setsar=1"
    )
}
pub fn black_bars(w: u32, h: u32) -> String {
    format!("scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1")
}
pub fn blurred_fill(w: u32, h: u32) -> String {
    format!("split=2[fg][bg];[bg]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=luma_radius=min(h\\,w)/10:luma_power=2[blurred];[fg]scale={w}:{h}:force_original_aspect_ratio=decrease[sharp];[blurred][sharp]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,setsar=1")
}
fn center(cx: f64) -> f64 {
    if cx.is_finite() {
        cx.clamp(0., 1.)
    } else {
        0.5
    }
}
pub fn portrait_crop_filter(cx: f64, w: u32, h: u32) -> String {
    let ratio = w as f64 / h as f64;
    format!(
        "crop=ih*{ratio:.5}:ih:{:.5}*in_w-ih*{:.5}:0,scale={w}:{h}",
        center(cx),
        ratio / 2.
    )
}
pub fn cut_crop_filter(segments: &[SpeakerSegment], w: u32, h: u32) -> String {
    let ratio = w as f64 / h as f64;
    let mut segments: Vec<_> = segments
        .iter()
        .copied()
        .filter(|(s, e, _)| s.is_finite() && e.is_finite() && e > s)
        .collect();
    segments.sort_by(|a, b| a.0.total_cmp(&b.0));
    if segments.is_empty() {
        return portrait_crop_filter(0.5, w, h);
    }
    let terms = segments
        .iter()
        .enumerate()
        .map(|(i, &(start, _, cx))| {
            let next = segments
                .get(i + 1)
                .map(|s| format!("*lt(t,{:.3})", s.0))
                .unwrap_or_default();
            format!("{:.4}*gte(t,{start:.3}){next}", center(cx))
        })
        .collect::<Vec<_>>()
        .join("+");
    format!("crop=w='ih*{ratio:.5}':h=ih:x='max(0,min(({terms})*in_w-ih*{:.5},in_w-ih*{ratio:.5}))',scale={w}:{h}",ratio/2.)
}
pub fn panel_crop_filter(cx: f64) -> String {
    format!("crop=w='min(ih*1.125,in_w)':h='if(gt(ih*1.125,in_w),in_w*0.88889,ih)':x='max(0,min({:.5}*in_w-out_w/2,in_w-out_w))':y='max(0,(in_h-out_h)/2)',scale=1080:960,setsar=1",center(cx))
}
fn standard_video_filter(base: &str, subtitle: Option<&str>) -> String {
    let mut filter = format!("setpts=PTS-STARTPTS,{base}");
    if let Some(sub) = subtitle {
        filter.push(',');
        filter.push_str(sub);
    }
    filter
}
fn add_subtitles(
    mut graph: Vec<String>,
    base: &str,
    subtitle_filter: Option<&str>,
) -> (Vec<String>, String) {
    if let Some(filter) = subtitle_filter {
        graph.push(format!("{base}{filter}[vout]"));
        (graph, "[vout]".into())
    } else {
        (graph, base.into())
    }
}
pub fn two_speaker_graph(
    left: f64,
    right: f64,
    subtitle_filter: Option<&str>,
) -> (Vec<String>, String) {
    add_subtitles(
        vec![
            "[0:v]setpts=PTS-STARTPTS,split=2[s0][s1]".into(),
            format!("[s0]{}[top]", panel_crop_filter(left)),
            format!("[s1]{}[bottom]", panel_crop_filter(right)),
            "[top][bottom]vstack=inputs=2[vstacked]".into(),
        ],
        "[vstacked]",
        subtitle_filter,
    )
}
pub fn facecam_graph(
    (x, y, w, h): FacecamBox,
    subtitle_filter: Option<&str>,
) -> (Vec<String>, String) {
    add_subtitles(vec!["[0:v]setpts=PTS-STARTPTS,split=2[fc0][fc1]".into(),format!("[fc0]crop={w}:{h}:{x}:{y},scale=1080:840,setsar=1[top]"),"[fc1]crop=w='min(ih*1080/1080,in_w)':h=ih:x='(in_w-out_w)/2':y=0,scale=1080:1080,setsar=1[bot]".into(),"[top][bot]vstack=inputs=2[v]".into()],"[v]",subtitle_filter)
}
pub fn chroma_key_filters(ck: &WatermarkChromaKey) -> Vec<String> {
    let hex = ck.color.trim_start_matches('#');
    let rgb = if hex.len() == 6 {
        u32::from_str_radix(hex, 16).unwrap_or(0x00ff00)
    } else {
        0x00ff00
    };
    let (r, g, b) = (
        (rgb >> 16) as f64,
        (rgb >> 8 & 255) as f64,
        (rgb & 255) as f64,
    );
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let opt = format!(
        "color=0x{rgb:06X}:similarity={:.3}:blend={:.3}",
        ck.similarity, ck.blend
    );
    if max == 0. || (max - min) / max < 0.15 {
        return vec![format!("colorkey={opt}")];
    }
    let mut filters = vec![format!("chromakey={opt}")];
    if g > r && g > b {
        filters.push("despill=type=green".into());
    } else if b > r && b > g {
        filters.push("despill=type=blue".into());
    }
    filters
}
pub fn watermark_chain(width: u32, wm: &Watermark, input: &str, output: &str) -> String {
    let w = ((width as f64 * wm.scale / 2.).round_ties_even() as u32)
        .saturating_mul(2)
        .max(2);
    let mut chain = Vec::new();
    if wm.is_video() {
        chain.push("setpts=PTS-STARTPTS".into());
    }
    if let Some(ck) = wm.chroma_key.as_ref().filter(|c| c.enabled) {
        chain.extend(chroma_key_filters(ck));
    }
    chain.extend([
        format!("scale=w={w}:h=-2"),
        "format=rgba".into(),
        format!("colorchannelmixer=aa={:.3}", wm.opacity),
    ]);
    format!("{input}{}{output}", chain.join(","))
}
pub fn watermark_overlay(label: &str, wm: &Watermark, wm_label: &str, output: &str) -> String {
    format!("{label}{wm_label}overlay=x='max(0,min(main_w-overlay_w,main_w*{:.4}-overlay_w/2))':y='max(0,min(main_h-overlay_h,main_h*{:.4}-overlay_h/2))':shortest=1:format=auto{output}",wm.x,wm.y)
}
pub fn with_watermarks(
    mut graph: Vec<String>,
    label: &str,
    width: u32,
    watermarks: &[Watermark],
    first_wm_input_idx: usize,
) -> (Vec<String>, String) {
    let count = watermarks.len().min(WATERMARK_MAX_PER_JOB);
    let mut current = label.to_owned();
    for (i, wm) in watermarks.iter().take(count).enumerate() {
        let input = format!("[{}:v]", i + first_wm_input_idx);
        let wm_label = if count == 1 {
            "[wm]".into()
        } else {
            format!("[wm{i}]")
        };
        let output = if i + 1 == count {
            "[wmout]".into()
        } else {
            format!("[wmout{i}]")
        };
        graph.push(watermark_chain(width, wm, &input, &wm_label));
        graph.push(watermark_overlay(&current, wm, &wm_label, &output));
        current = output;
    }
    (graph, current)
}
fn canonical_destination(path: &Path) -> Result<PathBuf> {
    let filename = path
        .file_name()
        .ok_or_else(|| anyhow!("invalid output path"))?;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    Ok(parent.canonicalize()?.join(filename))
}
fn escape_filter_option(path: &Path) -> String {
    // FFmpeg parses both the filter graph and then the filter's option list.
    let value = path.to_string_lossy().replace('\\', "/");
    let mut inner = String::new();
    for c in value.chars() {
        if matches!(c, ':' | '\'' | '\\' | ' ') {
            inner.push('\\');
        }
        inner.push(c);
    }
    let mut outer = String::new();
    for c in inner.chars() {
        if matches!(c, '[' | ']' | ';' | ',' | '\'' | '\\') {
            outer.push('\\');
        }
        outer.push(c);
    }
    outer
}
fn check_cancel(c: &CancellationToken) -> Result<()> {
    if c.is_cancelled() {
        bail!("job cancelled");
    }
    Ok(())
}
fn resolve_asset(root: &Path, name: &str) -> Option<PathBuf> {
    let normalized = name.replace('\\', "/");
    let relative = Path::new(&normalized);
    if normalized.contains(':')
        || relative
            .components()
            .any(|c| !matches!(c, Component::CurDir | Component::Normal(_)))
    {
        return None;
    }
    let root = root.canonicalize().ok()?;
    let path = root.join(relative).canonicalize().ok()?;
    (path.starts_with(&root) && path.is_file()).then_some(path)
}
fn usable_duration(duration: f64) -> bool {
    duration.is_finite() && duration > 0.
}

impl Pipeline {
    async fn watermark_input(
        &self,
        wm: &Watermark,
        p: &Path,
        duration: f64,
        cancel: &CancellationToken,
    ) -> Result<Vec<std::ffi::OsString>> {
        let mut args = Vec::new();
        if wm.is_video() {
            if p.extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("webm"))
                || wm
                    .mime_type
                    .as_deref()
                    .is_some_and(|s| s.eq_ignore_ascii_case("video/webm"))
            {
                let output = tools::run(
                    Command::new(&self.config.tools.ffprobe)
                        .args([
                            "-v",
                            "error",
                            "-select_streams",
                            "v:0",
                            "-show_entries",
                            "stream=codec_name",
                            "-of",
                            "default=nw=1:nk=1",
                        ])
                        .arg(p),
                    Duration::from_secs(10),
                    cancel,
                )
                .await;
                check_cancel(cancel)?;
                if let Ok(output) = output {
                    let name = String::from_utf8_lossy(&output.stdout);
                    match name.trim() {
                        "vp9" => args.extend(["-c:v".into(), "libvpx-vp9".into()]),
                        "vp8" => args.extend(["-c:v".into(), "libvpx".into()]),
                        _ => {}
                    }
                }
            }
            args.extend([
                "-stream_loop".into(),
                "-1".into(),
                "-t".into(),
                format!("{duration:.3}").into(),
                "-an".into(),
            ]);
        } else {
            args.extend([
                "-loop".into(),
                "1".into(),
                "-t".into(),
                format!("{duration:.3}").into(),
            ]);
        }
        args.extend(["-i".into(), p.as_os_str().to_owned()]);
        Ok(args)
    }
    pub async fn render_one(
        &self,
        video: &Path,
        moment: &Moment,
        cues: &[TranscriptCue],
        out: &Path,
        options: &RenderOptions,
        cancel: &CancellationToken,
    ) -> Result<()> {
        self.render_window(video, moment, cues, out, options, None, None, cancel)
            .await
            .map(|_| ())
    }
    #[allow(clippy::too_many_arguments)]
    async fn render_window(
        &self,
        video: &Path,
        moment: &Moment,
        cues: &[TranscriptCue],
        out: &Path,
        options: &RenderOptions,
        cached: Option<FacecamBox>,
        hook_cover: Option<&Path>,
        cancel: &CancellationToken,
    ) -> Result<Option<FacecamBox>> {
        check_cancel(cancel)?;
        if moment.start < 0. || !usable_duration(moment.end - moment.start) {
            bail!("invalid clip range");
        }
        let video = video.canonicalize()?;
        let out = canonical_destination(out)?;
        let work = self.workdir("render-")?;
        let (w, h) = options.aspect_ratio.output_size();
        let portrait = options.aspect_ratio == AspectRatio::Portrait;
        let landscape = options.aspect_ratio == AspectRatio::Landscape;
        let split = options.split_screen.as_deref().filter(|_| portrait);
        let duration = if split.is_some() {
            moment.end - moment.start
        } else {
            (moment.end - moment.start).max(0.5)
        };
        let layout = split
            .map(|split| split_screen::split_panel_dims(split.config.ratio, split.config.swap));
        let style = subtitles::with_split_seam(
            options.caption_style.as_ref(),
            layout.map(|l| l.seam_y_frac),
        );
        let two = split.is_none() && portrait && options.two_speakers;
        let abs_start = moment.start + options.timeline_offset;
        let abs_end = moment.end + options.timeline_offset;
        let clip_cues = if options.captions {
            subtitles::clip_caption_cues(cues, abs_start, abs_end)
        } else {
            vec![]
        };
        let subtitle = if !clip_cues.is_empty() {
            fs::write(
                work.path().join("caption.ass"),
                subtitles::ass_text(&clip_cues, w, h, two, style.as_ref()),
            )?;
            let fonts = self
                .config
                .font_dir
                .as_ref()
                .map(|p| p.canonicalize().unwrap_or_else(|_| p.clone()));
            Some(match fonts {
                Some(fonts) => format!(
                    "subtitles=caption.ass:fontsdir={}",
                    escape_filter_option(&fonts)
                ),
                None => "subtitles=caption.ass".into(),
            })
        } else {
            None
        };
        let mut broll = None;
        if let (Some(split), Some(layout)) = (split, layout) {
            let segments = self
                .split_timeline(
                    split,
                    (abs_start, abs_start + duration),
                    cues,
                    options.split_timeline.as_deref(),
                    cancel,
                )
                .await?;
            let path = work.path().join("broll_track.mp4");
            let vol = split.config.secondary_volume.clamp(0., 1.);
            split_screen::render_broll_track(
                &segments,
                &split.clips,
                layout.secondary_w,
                layout.secondary_h,
                split.config.secondary_fit,
                duration,
                vol > 0.001,
                &path,
                &self.config.tools,
                &self.config.video_encoder,
                self.config.render_timeout,
                cancel,
            )
            .await?;
            if let Some(dest) = hook_cover {
                if let Some(first) = segments
                    .first()
                    .and_then(|s| split.clips.get(&s.clip_id).map(|clip| (s, clip)))
                {
                    let (segment, clip) = first;
                    if split_screen::extract_split_cover_frame(
                        &self.config.tools.ffmpeg,
                        (&video, moment.start),
                        (
                            &clip.path,
                            segment.source_start_sec.unwrap_or(0.),
                            clip.is_image,
                        ),
                        &split.config,
                        None,
                        dest,
                        cancel,
                    )
                    .await
                    .is_err()
                    {
                        let _ = fs::remove_file(dest);
                    }
                    check_cancel(cancel)?;
                }
            }
            broll = Some((path, vol));
        }
        let require_facecam = split.is_none() && portrait && options.facecam && !two;
        let faces = self.faces.clone();
        let src = video.clone();
        let (start, end) = (moment.start, moment.end);
        let reframe = options.reframe;
        let split_inactive = split.is_none();
        let (facebox, centers, segments) = tokio::task::spawn_blocking(move || {
            let facebox = if require_facecam {
                faces
                    .detect_facecam_box(&src, start, end, cached)
                    .ok()
                    .flatten()
                    .filter(|&(_, _, w, h)| w > 0 && h > 0)
            } else {
                None
            };
            let centers = if two {
                faces.detect_two_speakers(&src, start, end).ok().flatten()
            } else {
                None
            };
            let segments = if !two
                && facebox.is_none()
                && !landscape
                && split_inactive
                && reframe == ReframeMode::FaceTracking
            {
                faces
                    .track_active_speaker(&src, start, end)
                    .unwrap_or_default()
            } else {
                vec![]
            };
            (facebox, centers, segments)
        })
        .await?;
        let reframe_graph = |subtitle| {
            if let (Some(split), Some(layout)) = (split, layout) {
                let graph = vec![
                    "[0:v:0]setpts=PTS-STARTPTS,fps=30[src]".into(),
                    split_screen::fit_panel_filter(
                        "[src]",
                        layout.primary_w,
                        layout.primary_h,
                        split.config.primary_fit,
                        "[primary]",
                    ),
                    "[1:v:0]setpts=PTS-STARTPTS[secondary]".into(),
                    split_screen::stack_panels(layout),
                ];
                let (graph, base) = add_subtitles(graph, "[stacked]", subtitle);
                (graph, base, None)
            } else if two {
                let (left, right) = centers.unwrap_or((0.25, 0.75));
                let (graph, base) = two_speaker_graph(left, right, subtitle);
                (graph, base, None)
            } else if let Some(b) = facebox {
                let (graph, base) = facecam_graph(b, subtitle);
                (graph, base, None)
            } else {
                let vf = if landscape || reframe == ReframeMode::BlurredFill {
                    blurred_fill(w, h)
                } else if reframe == ReframeMode::BlackBars {
                    black_bars(w, h)
                } else if reframe == ReframeMode::CenterCrop {
                    center_crop(w, h)
                } else {
                    format!("{},setsar=1", cut_crop_filter(&segments, w, h))
                };
                let vf = standard_video_filter(&vf, subtitle);
                (vec![format!("[0:v]{vf}[base]")], "[base]".into(), Some(vf))
            }
        };
        if let Some(dest) = hook_cover.filter(|_| split.is_none()) {
            let (graph, base, simple) = reframe_graph(None);
            let complex = graph.join(";");
            let filter_args = match simple.as_deref() {
                Some(vf) => ["-vf", vf, "-map", "0:v:0"],
                None => ["-filter_complex", &complex, "-map", &base],
            };
            // Only face tracking populates segments. Multiple segments need clip-relative time.
            if hook_thumbnail::cover_frame_filtered(
                &self.config.tools.ffmpeg,
                &video,
                (moment.start, duration),
                &filter_args,
                segments.len() > 1,
                dest,
                cancel,
            )
            .await
            .is_err()
            {
                // A missing cover falls back to source extraction in add_hook.
                let _ = fs::remove_file(dest);
            }
            check_cancel(cancel)?;
        }
        let (graph, base, simple) = reframe_graph(subtitle.as_deref());
        let has_audio =
            if options.normalize_audio || broll.as_ref().is_some_and(|(_, vol)| *vol > 0.001) {
                !tools::run(
                    Command::new(&self.config.tools.ffprobe)
                        .args([
                            "-v",
                            "error",
                            "-select_streams",
                            "a:0",
                            "-show_entries",
                            "stream=index",
                            "-of",
                            "csv=p=0",
                        ])
                        .arg(&video),
                    Duration::from_secs(20),
                    cancel,
                )
                .await?
                .stdout
                .is_empty()
            } else {
                false
            };
        let loudnorm = options.normalize_audio && has_audio;
        let mix_vol = broll
            .as_ref()
            .map(|(_, vol)| *vol)
            .filter(|vol| has_audio && *vol > 0.001);
        let mut layers = Vec::new();
        let mut wm_args = Vec::new();
        for (wm, path) in options.watermarks.iter().take(WATERMARK_MAX_PER_JOB) {
            let path = path.canonicalize().unwrap_or_else(|_| path.clone());
            wm_args.extend(self.watermark_input(wm, &path, duration, cancel).await?);
            layers.push(wm.clone());
        }
        let tmp = tempfile::Builder::new()
            .prefix(".clip-")
            .suffix(".mp4")
            .tempfile_in(out.parent().unwrap())?;
        let build = |with_marks: bool| {
            let mut cmd = tools::ffmpeg(&self.config.tools.ffmpeg);
            cmd.current_dir(work.path())
                .args([
                    "-ss",
                    &format!("{:.3}", moment.start),
                    "-t",
                    &format!("{duration:.3}"),
                    "-i",
                ])
                .arg(&video);
            if let Some((path, _)) = &broll {
                cmd.arg("-i").arg(path);
            }
            let (mut chain, label) = if with_marks {
                cmd.arg("-xerror").args(&wm_args);
                with_watermarks(
                    graph.clone(),
                    &base,
                    w,
                    &layers,
                    if broll.is_some() { 2 } else { 1 },
                )
            } else {
                (graph.clone(), base.clone())
            };
            if let Some(vol) = mix_vol {
                let norm = if loudnorm {
                    ",loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100,aformat=channel_layouts=stereo"
                } else {
                    ""
                };
                chain.push(format!("[0:a:0]aformat=sample_rates=44100:channel_layouts=stereo,asetpts=PTS-STARTPTS,volume=1.0[a0];[1:a:0]aformat=sample_rates=44100:channel_layouts=stereo,asetpts=PTS-STARTPTS,volume={vol:.6}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0{norm}[mixed]"));
            }
            if let Some(vf) = simple.as_ref().filter(|_| !with_marks) {
                cmd.args(["-vf", vf, "-map", "0:v:0"]);
            } else {
                cmd.args(["-filter_complex", &chain.join(";"), "-map", &label]);
            }
            cmd.args([
                "-map",
                if mix_vol.is_some() {
                    "[mixed]"
                } else {
                    "0:a:0?"
                },
            ]);
            tools::video_encoder(&mut cmd, &self.config.video_encoder, "23");
            cmd.args([
                "-c:a",
                "aac",
                "-b:a",
                if loudnorm { "160k" } else { "128k" },
            ]);
            if loudnorm && mix_vol.is_none() {
                cmd.args(["-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "44100"]);
            }
            // Also bound the output: some image demuxers loop forever on a corrupt
            // watermark even with an input-side duration.
            cmd.args([
                "-t",
                &format!("{duration:.3}"),
                "-movflags",
                "+faststart",
                "-sn",
                "-f",
                "mp4",
            ])
            .arg(tmp.path());
            cmd
        };
        let run = tools::run(
            &mut build(!layers.is_empty()),
            self.config.render_timeout,
            cancel,
        )
        .await;
        if let Err(e) = run {
            if layers.is_empty() || cancel.is_cancelled() {
                return Err(e);
            }
            tools::run(&mut build(false), self.config.render_timeout, cancel)
                .await
                .context("retry without watermarks")?;
        }
        check_cancel(cancel)?;
        if fs::metadata(tmp.path())?.len() == 0 {
            bail!("render output is empty");
        }
        tmp.persist(out)?;
        Ok(facebox)
    }

    pub async fn append_outro(
        &self,
        clip: &Path,
        outro: &Path,
        out: &Path,
        cancel: &CancellationToken,
    ) -> Result<()> {
        let c = tools::probe_media_cancel(&self.config.tools.ffprobe, clip, cancel).await?;
        let o = tools::probe_media_cancel(&self.config.tools.ffprobe, outro, cancel).await?;
        let (w, h, fps) = (c.width, c.height, c.fps);
        let out = canonical_destination(out)?;
        let tmp = tempfile::Builder::new()
            .prefix(".outro-")
            .suffix(".mp4")
            .tempfile_in(out.parent().unwrap())?;
        let mut cmd = tools::ffmpeg(&self.config.tools.ffmpeg);
        cmd.arg("-i").arg(clip).arg("-i").arg(outro);
        let mut next = 2;
        let mut audio = |i: u32, m: tools::MediaInfo| {
            if m.has_audio {
                format!("{i}:a:0")
            } else {
                tools::silence(&mut cmd, m.duration);
                let label = format!("{next}:a");
                next += 1;
                label
            }
        };
        let ca = audio(0, c);
        let oa = audio(1, o);
        let graph = [
            format!(
                "[0:v]scale={w}:{h},setsar=1,fps={fps:.3},format=yuv420p,setpts=PTS-STARTPTS[cv]"
            ),
            format!(
                "[1:v]{},fps={fps:.3},format=yuv420p,setpts=PTS-STARTPTS[ov]",
                blurred_fill(w, h)
            ),
            tools::audio_filter(&ca, "ca", c.duration, ""),
            tools::audio_filter(&oa, "oa", o.duration, ""),
            "[cv][ca][ov][oa]concat=n=2:v=1:a=1[v][a]".into(),
        ]
        .join(";");
        cmd.args(["-filter_complex", &graph, "-map", "[v]", "-map", "[a]"]);
        tools::video_encoder(&mut cmd, &self.config.video_encoder, "23");
        cmd.args([
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            "-sn",
            "-f",
            "mp4",
        ])
        .arg(tmp.path());
        tools::run(&mut cmd, self.config.render_timeout, cancel).await?;
        if fs::metadata(tmp.path())?.len() == 0 {
            bail!("hasil outro kosong");
        }
        tmp.persist(out)?;
        Ok(())
    }
}

const NO_LIVE_CHAT_LONG_VIDEO_ERROR: &str = "Live chat dan heatmap YouTube tidak tersedia. Transkripsi audio penuh dibatasi 20 menit; batasi durasi sumber atau pilih rentang secara manual.";
const NO_STT_CUES_ERROR: &str = "Transkripsi audio tidak menemukan dialog yang bisa digunakan.";
const NO_SUBTITLE_ERROR: &str = "Subtitle YouTube tidak tersedia untuk video ini.";
const SECTION_FORMAT:&str="bv*[ext=mp4][protocol^=http]+ba[ext=m4a][protocol^=http]/bv*[ext=mp4][protocol^=http]+ba[ext=mp4][protocol^=http]/b[ext=mp4][protocol^=http]";
const FULL_FORMAT: &str = "bv*[ext=mp4]+ba[ext=m4a]/bv*[ext=mp4]+ba[ext=mp4]/b[ext=mp4]/b";
fn read_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<_> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|v| v.ok().map(|e| e.path()))
        .filter(|p| p.is_file())
        .collect();
    files.sort();
    files
}
fn filename(p: &Path) -> &str {
    p.file_name().and_then(|s| s.to_str()).unwrap_or_default()
}
fn media_file(dir: &Path, prefix: &str) -> Option<PathBuf> {
    let mp4 = dir.join(format!("{prefix}.mp4"));
    if mp4.is_file() {
        return Some(mp4);
    }
    read_files(dir).into_iter().find(|p| {
        let name = filename(p).to_ascii_lowercase();
        name.starts_with(prefix)
            && !name.contains(".part")
            && [".mp4", ".webm", ".mkv", ".mov"]
                .iter()
                .any(|e| name.ends_with(e))
    })
}
fn within_limit(cues: Vec<TranscriptCue>, limit: Option<u32>) -> Vec<TranscriptCue> {
    let Some(limit) = limit.map(f64::from) else {
        return cues;
    };
    cues.into_iter()
        .filter(|c| c.start < limit)
        .map(|mut c| {
            if c.end > limit {
                c.end = limit;
                c.words.retain(|w| w.start < limit);
                for w in &mut c.words {
                    w.end = w.end.min(limit);
                }
            }
            c
        })
        .collect()
}
fn validate_url(url: &str) -> Result<()> {
    if !reqwest::Url::parse(url)
        .is_ok_and(|u| matches!(u.scheme(), "http" | "https") && u.host().is_some())
    {
        bail!("URL video harus http atau https");
    }
    Ok(())
}

impl Pipeline {
    fn local_primary(
        &self,
        source: Option<&PrimaryMediaSource>,
        url: &str,
    ) -> Result<Option<PathBuf>> {
        match source.filter(|s| s.kind != MediaSourceKind::Url) {
            Some(source) => split_screen::resolve_local_media_path(
                &self.config.clips_dir,
                source
                    .file_path
                    .as_deref()
                    .context("missing local primary file path")?,
            )
            .map(Some),
            None => {
                validate_url(url)?;
                Ok(None)
            }
        }
    }

    async fn local_cues(
        &self,
        path: &Path,
        info: tools::MediaInfo,
        bounds: Option<(f64, f64)>,
        language: &str,
        dir: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<TranscriptCue>> {
        if !info.has_audio {
            return Ok(vec![]);
        }
        let (start, end) = bounds.unwrap_or((0., info.duration));
        let end = end.min(info.duration);
        if end <= start {
            return Ok(vec![]);
        }
        self.transcriber()?
            .media(path, Some((start, end)), start, language, dir, cancel)
            .await
    }

    async fn prepare_split(
        &self,
        config: Option<&SplitScreenConfig>,
        dir: &Path,
        vision: bool,
        cancel: &CancellationToken,
    ) -> Result<Option<Arc<PreparedSplitScreen>>> {
        let Some(config) = config.filter(|c| c.is_active()) else {
            return Ok(None);
        };
        let sources = split_screen::prepare_broll_sources(
            self,
            config,
            dir,
            vision && config.auto_match(),
            self.llm.as_ref(),
            cancel,
        )
        .await?;
        let catalog = sources.iter().map(llm::BrollCatalogItem::from).collect();
        let clips = sources
            .into_iter()
            .map(|clip| (clip.id.clone(), clip))
            .collect();
        Ok(Some(Arc::new(PreparedSplitScreen {
            config: config.clone(),
            catalog,
            clips,
        })))
    }

    async fn split_timeline(
        &self,
        split: &PreparedSplitScreen,
        (start, end): (f64, f64),
        cues: &[TranscriptCue],
        manual: Option<&[SplitScreenSegment]>,
        cancel: &CancellationToken,
    ) -> Result<Vec<SplitScreenSegment>> {
        if let Some(segments) = manual.filter(|s| !s.is_empty()) {
            return Ok(llm::normalize_split_timeline(
                segments.to_vec(),
                end - start,
                &split.catalog,
            ));
        }
        if let Some(llm) = self
            .llm
            .as_ref()
            .filter(|_| split.config.auto_match() && !cues.is_empty())
        {
            let result = tokio::select! { biased; _ = cancel.cancelled() => bail!("job cancelled"), result = llm.plan_split_screen_timeline(start, end, cues, &split.catalog) => result };
            if let Some(timeline) = result.filter(|s| !s.is_empty()) {
                return Ok(timeline);
            }
        }
        Ok(llm::build_sequential_timeline(end - start, &split.catalog))
    }

    pub(crate) async fn download_broll(
        &self,
        url: &str,
        dir: &Path,
        prefix: &str,
        start: Option<f64>,
        end: Option<f64>,
        cancel: &CancellationToken,
    ) -> Result<(PathBuf, bool)> {
        validate_url(url)?;
        if start.is_some() || end.is_some() {
            let start = start.unwrap_or(0.);
            let end = match end {
                Some(end) => end,
                None => self
                    .video_metadata(url, cancel)
                    .await
                    .ok()
                    .and_then(|meta| number(&meta["duration"]))
                    .unwrap_or(f64::INFINITY),
            };
            if end <= start {
                bail!("invalid B-roll download range");
            }
            if end.is_finite() {
                if let Ok(path) = self
                    .section(
                        url,
                        dir,
                        prefix,
                        (start, end),
                        Duration::from_secs(600),
                        cancel,
                    )
                    .await
                {
                    return Ok((path, true));
                }
            }
        }
        check_cancel(cancel)?;
        self.download_source(url, dir, prefix, None, Duration::from_secs(900), cancel)
            .await
            .map(|path| (path, false))
    }

    pub(crate) async fn download_broll_image(
        &self,
        url: &str,
        dir: &Path,
        prefix: &str,
        cancel: &CancellationToken,
    ) -> Result<PathBuf> {
        validate_url(url)?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()?;
        let resp = tokio::select! {
            biased;
            _ = cancel.cancelled() => bail!("job cancelled"),
            r = client.get(url).send() => r.map_err(|e| anyhow!("{}", e.without_url()))?,
        };
        if !resp.status().is_success() {
            bail!("Gagal mengunduh gambar B-roll (HTTP {})", resp.status());
        }
        let bytes = tokio::select! {
            biased;
            _ = cancel.cancelled() => bail!("job cancelled"),
            b = resp.bytes() => b.map_err(|e| anyhow!("{}", e.without_url()))?,
        };
        if bytes.is_empty() || bytes.len() > 15 * 1024 * 1024 {
            bail!("Ukuran gambar B-roll tidak valid (maksimal 15 MB)");
        }
        let ext = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
            "png"
        } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            "webp"
        } else {
            "jpg"
        };
        let path = dir.join(format!("{prefix}.{ext}"));
        fs::write(&path, &bytes)?;
        Ok(path)
    }

    pub async fn run_generate_image(
        &self,
        request: &GenerateImageRequest,
        cancel: &CancellationToken,
    ) -> Result<GenerateImageResult> {
        check_cancel(cancel)?;
        let llm = self
            .llm
            .as_ref()
            .ok_or_else(|| anyhow!("LLM belum dikonfigurasi"))?;
        let normalized = request.out_path.replace('\\', "/");
        let relative = relative_output(&normalized)?;
        fs::create_dir_all(&self.config.clips_dir)?;
        let root = self.config.clips_dir.canonicalize()?;
        let dest = destination_in(&root, &relative)?;
        let (bytes, mime_type) = tokio::select! {
            biased;
            _ = cancel.cancelled() => bail!("job cancelled"),
            res = llm.generate_image(&request.prompt, request.aspect_ratio.as_deref()) => res?,
        };
        let decoded = image::load_from_memory(&bytes)
            .context("Gambar AI tidak dapat dibaca")?;
        let width = decoded.width();
        let height = decoded.height();
        let ext = if mime_type == "image/png" {
            ".png"
        } else if mime_type == "image/webp" {
            ".webp"
        } else {
            ".jpg"
        };
        let tmp = tempfile::Builder::new()
            .suffix(ext)
            .tempfile_in(dest.parent().unwrap())?;
        fs::write(tmp.path(), &bytes)?;
        let size_bytes = bytes.len() as u64;
        tmp.persist(&dest)?;
        Ok(GenerateImageResult {
            file: relative.to_string_lossy().replace('\\', "/"),
            mime_type,
            width,
            height,
            size_bytes,
        })
    }

    pub async fn run_capture_frame(
        &self,
        request: &CaptureFrameRequest,
        cancel: &CancellationToken,
    ) -> Result<CaptureFrameResult> {
        check_cancel(cancel)?;
        if !request.at_sec.is_finite() || request.at_sec < 0. {
            bail!("Timestamp frame tidak valid");
        }
        let normalized = request.out_path.replace('\\', "/");
        let relative = relative_output(&normalized)?;
        fs::create_dir_all(&self.config.clips_dir)?;
        let root = self.config.clips_dir.canonicalize()?;
        let dest = destination_in(&root, &relative)?;
        let dir = self.workdir("capture-")?;
        let (source, offset) = if request.kind == MediaSourceKind::Url {
            let url = request
                .url
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("URL video wajib diisi"))?;
            let off = (request.at_sec - 1.).max(0.);
            let path = match self
                .section(
                    url,
                    dir.path(),
                    "capture-src",
                    (off, request.at_sec + 3.),
                    Duration::from_secs(120),
                    cancel,
                )
                .await
            {
                Ok(p) => (p, off),
                Err(_) => {
                    let p = self
                        .download_source(
                            url,
                            dir.path(),
                            "capture-src",
                            None,
                            Duration::from_secs(300),
                            cancel,
                        )
                        .await?;
                    (p, 0.)
                }
            };
            path
        } else {
            let rel = request
                .file_path
                .as_deref()
                .ok_or_else(|| anyhow!("filePath lokal wajib diisi"))?;
            (
                split_screen::resolve_local_media_path(&self.config.clips_dir, rel)?,
                0.,
            )
        };
        let info = tools::probe_media_cancel(&self.config.tools.ffprobe, &source, cancel).await?;
        let seek = (request.at_sec - offset)
            .max(0.)
            .min((info.duration - 1. / info.fps.max(1.)).max(0.));
        let is_png = dest
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("png"));
        let tmp = tempfile::Builder::new()
            .suffix(if is_png { ".png" } else { ".jpg" })
            .tempfile_in(dest.parent().unwrap())?;
        let mut cmd = tools::ffmpeg(&self.config.tools.ffmpeg);
        cmd.args(["-ss", &format!("{seek:.6}"), "-i"])
            .arg(&source)
            .args(["-map", "0:v:0", "-frames:v", "1", "-update", "1"]);
        if !is_png {
            cmd.args(["-q:v", "2"]);
        }
        tools::run(cmd.arg(tmp.path()), Duration::from_secs(30), cancel).await?;
        let meta = fs::metadata(tmp.path())?;
        if meta.len() == 0 {
            bail!("Gagal mengekstrak frame dari video");
        }
        let (width, height) = image::image_dimensions(tmp.path())
            .context("Frame hasil ekstrak tidak valid")?;
        let size_bytes = meta.len();
        tmp.persist(&dest)?;
        Ok(CaptureFrameResult {
            file: relative.to_string_lossy().replace('\\', "/"),
            mime_type: if is_png {
                "image/png".into()
            } else {
                "image/jpeg".into()
            },
            width,
            height,
            size_bytes,
        })
    }

    pub async fn run_find_moment(
        &self,
        request: &FindMomentRequest,
        cancel: &CancellationToken,
    ) -> Result<FindMomentResult> {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
        check_cancel(cancel)?;
        let llm = self
            .llm
            .as_ref()
            .ok_or_else(|| anyhow!("LLM belum dikonfigurasi"))?;
        let prompt = request.prompt.trim();
        if prompt.is_empty() {
            bail!("Prompt pencarian momen wajib diisi");
        }
        let target = request
            .target_duration_sec
            .filter(|v| v.is_finite() && *v >= 2.)
            .unwrap_or(15.0);
        let dir = self.workdir("find-moment-")?;
        let local_path = if request.kind == MediaSourceKind::Url {
            let url = request
                .url
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("URL video wajib diisi"))?;
            validate_url(url)?;
            // Fast path: try YouTube/platform subtitles first without downloading the video.
            let meta_dur = self
                .video_metadata(url, cancel)
                .await
                .ok()
                .and_then(|m| number(&m["duration"]));
            if let Ok(cues) = self.fetch_cues(url, dir.path(), cancel).await {
                if !cues.is_empty() {
                    let total = meta_dur
                        .filter(|d| *d > 0.)
                        .or_else(|| cues.last().map(|c| c.end))
                        .unwrap_or(0.);
                    if total > 0. {
                        let res = tokio::select! {
                            biased;
                            _ = cancel.cancelled() => bail!("job cancelled"),
                            r = llm.find_moment_from_transcript(&cues, prompt, target, total) => r,
                        };
                        if let Ok(found) = res {
                            return Ok(found);
                        }
                    }
                }
            }
            check_cancel(cancel)?;
            self.download_source(
                url,
                dir.path(),
                "moment-src",
                None,
                Duration::from_secs(600),
                cancel,
            )
            .await?
        } else {
            let rel = request
                .file_path
                .as_deref()
                .ok_or_else(|| anyhow!("filePath lokal wajib diisi"))?;
            split_screen::resolve_local_media_path(&self.config.clips_dir, rel)?
        };
        let info = tools::probe_media_cancel(&self.config.tools.ffprobe, &local_path, cancel).await?;
        if !info.duration.is_finite() || info.duration <= 0. {
            bail!("Durasi video tidak valid");
        }
        // Try local audio transcription first if available.
        if info.has_audio && self.transcriber().is_ok() {
            if let Ok(cues) = self
                .local_cues(
                    &local_path,
                    info,
                    Some((0., info.duration.min(1800.))),
                    "auto",
                    dir.path(),
                    cancel,
                )
                .await
            {
                if !cues.is_empty() {
                    let res = tokio::select! {
                        biased;
                        _ = cancel.cancelled() => bail!("job cancelled"),
                        r = llm.find_moment_from_transcript(&cues, prompt, target, info.duration) => r,
                    };
                    if let Ok(found) = res {
                        return Ok(found);
                    }
                }
            }
        }
        check_cancel(cancel)?;
        // Fallback: sample visual frames across the video and ask the vision model.
        let sample_count = if info.duration < 10. { 5 } else { 10 };
        let mut frames = Vec::with_capacity(sample_count);
        for i in 0..sample_count {
            check_cancel(cancel)?;
            let frac = (i as f64 + 0.5) / sample_count as f64;
            let ts = (info.duration * frac).clamp(0., (info.duration - 0.1).max(0.));
            if let Ok(out) = tools::run(
                tools::ffmpeg(&self.config.tools.ffmpeg)
                    .args(["-ss", &format!("{ts:.3}"), "-i"])
                    .arg(&local_path)
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
                        "5",
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
                    frames.push((ts, BASE64.encode(&out.stdout)));
                }
            }
        }
        tokio::select! {
            biased;
            _ = cancel.cancelled() => bail!("job cancelled"),
            r = llm.find_moment_from_frames(&frames, prompt, target, info.duration) => r,
        }
    }

    fn ytdlp(&self) -> Command {
        let mut cmd = Command::new(&self.config.tools.ytdlp);
        cmd.arg("--ffmpeg-location").arg(&self.config.tools.ffmpeg);
        cmd
    }
    async fn fetch_cues(
        &self,
        url: &str,
        dir: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<TranscriptCue>> {
        for write_flag in ["--write-subs", "--write-auto-subs"] {
            let mut cmd = self.ytdlp();
            cmd.args([
                "--skip-download",
                "--ignore-errors",
                "--no-playlist",
                write_flag,
                "--extractor-args",
                "youtube:skip=translated_subs",
                "--sub-langs",
                "id,id-orig,en,en-orig",
                "--sub-format",
                "vtt",
                "--convert-subs",
                "vtt",
                "--no-progress",
                "--no-warnings",
                "-o",
            ])
            .arg(dir.join("source.%(ext)s"))
            .arg("--")
            .arg(url);
            let _ = tools::run(&mut cmd, Duration::from_secs(180), cancel).await;
            check_cancel(cancel)?;
            let mut files: Vec<_> = read_files(dir)
                .into_iter()
                .filter(|p| filename(p).starts_with("source") && filename(p).ends_with(".vtt"))
                .collect();
            files.sort_by_key(|p| !filename(p).to_ascii_lowercase().contains(".id."));
            if let Some(path) = files.first() {
                let input = fs::read(path)?;
                return Ok(subtitles::parse_vtt(&String::from_utf8_lossy(&input), true));
            }
        }
        bail!(NO_SUBTITLE_ERROR)
    }
    async fn optional_cues(
        &self,
        source: TranscriptSource,
        url: &str,
        dir: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<TranscriptCue>> {
        if source == TranscriptSource::LiveChatStt {
            return Ok(vec![]);
        }
        let result = self.fetch_cues(url, dir, cancel).await;
        check_cancel(cancel)?;
        match (source, result) {
            (_, Ok(cues)) if !cues.is_empty() => Ok(cues),
            (TranscriptSource::Youtube, Err(err)) => Err(err),
            (TranscriptSource::Youtube, Ok(_)) => bail!(NO_SUBTITLE_ERROR),
            _ => Ok(vec![]),
        }
    }
    async fn video_metadata(
        &self,
        url: &str,
        cancel: &CancellationToken,
    ) -> Result<serde_json::Value> {
        let mut cmd = self.ytdlp();
        cmd.args([
            "--dump-single-json",
            "--skip-download",
            "--no-warnings",
            "--no-playlist",
            "--",
            url,
        ]);
        let out = tools::run(&mut cmd, Duration::from_secs(60), cancel).await?;
        Ok(serde_json::from_slice(&out.stdout)?)
    }
    #[allow(clippy::too_many_arguments)]
    async fn auto_stt<F, Fut>(
        &self,
        source: TranscriptSource,
        url: &str,
        dir: &Path,
        video: Option<&Path>,
        limit: Option<u32>,
        max_windows: usize,
        language: &str,
        cancel: &CancellationToken,
        mut progress: F,
    ) -> Result<Vec<TranscriptCue>>
    where
        F: FnMut(JobProgress) -> Fut,
        Fut: Future<Output = ()>,
    {
        let transcriber = self.transcriber()?;
        let stage = |percent, message| JobProgress {
            stage: "transcribe".into(),
            percent,
            message,
            clip: None,
        };
        progress(stage(0., "memindai live chat...".into())).await;
        let meta = if video.is_none() {
            self.video_metadata(url, cancel).await?
        } else {
            serde_json::Value::Null
        };
        let duration = if let Some(video) = video {
            transcriber.duration(video, cancel).await?
        } else {
            live_chat::number(&meta["duration"]).unwrap_or_default()
        };
        let mut windows = live_chat::discover_windows(
            url,
            duration,
            limit,
            max_windows,
            Some(&meta["heatmap"]),
            cancel,
        )
        .await;
        check_cancel(cancel)?;
        if windows.is_empty() && video.is_some() {
            if let Ok(meta) = self.video_metadata(url, cancel).await {
                windows =
                    live_chat::windows_from_heatmap(&meta["heatmap"], duration, limit, max_windows);
            }
            check_cancel(cancel)?;
        }
        if windows.is_empty() {
            if let Some(window) = live_chat::full_audio_window(duration, limit) {
                windows.push(window);
            } else {
                if source == TranscriptSource::LiveChatStt {
                    // The worker makes one last VTT attempt for long sources with no radar data.
                    let cues = self
                        .optional_cues(TranscriptSource::Auto, url, dir, cancel)
                        .await?;
                    if !cues.is_empty() {
                        progress(stage(100., format!("{} cue dari subtitle", cues.len()))).await;
                        return Ok(cues);
                    }
                }
                bail!(NO_LIVE_CHAT_LONG_VIDEO_ERROR);
            }
        }
        let stream = stt::pick_hls_audio(&meta);
        let total = windows.len();
        let mut pending = windows.into_iter().enumerate();
        let mut tasks = JoinSet::new();
        let mut results: Vec<(usize, Result<Vec<TranscriptCue>>)> = Vec::new();
        let mut completed = 0;
        let spawn = |tasks: &mut JoinSet<_>, (i, (start, end))| {
            let transcriber = transcriber.clone();
            let (url, language, base, video, stream, cancel) = (
                url.to_owned(),
                language.to_owned(),
                dir.to_owned(),
                video.map(Path::to_owned),
                stream.clone(),
                cancel.clone(),
            );
            tasks.spawn(async move {
                let result = async {
                    let dir = tempfile::Builder::new()
                        .prefix("stt-window-")
                        .tempdir_in(&base)?;
                    if let Some(video) = video {
                        transcriber
                            .media(
                                &video,
                                Some((start, end)),
                                start,
                                &language,
                                dir.path(),
                                &cancel,
                            )
                            .await
                    } else {
                        transcriber
                            .remote_window(
                                &url,
                                stream.as_ref(),
                                (start, end),
                                &language,
                                dir.path(),
                                &cancel,
                            )
                            .await
                    }
                }
                .await;
                (i, result)
            });
        };
        for window in pending.by_ref().take(stt::MAX_STT_WINDOW_CONCURRENCY) {
            spawn(&mut tasks, window);
        }
        let mut join_error = None;
        // Drain every sibling before returning an error, so the parent working directory stays alive.
        while let Some(item) = tasks.join_next().await {
            match item {
                Ok((index, result)) => {
                    if result.is_ok() {
                        completed += 1;
                        progress(stage(
                            completed as f64 * 100. / total as f64,
                            format!("mentranskrip segmen {completed}/{total}..."),
                        ))
                        .await;
                    }
                    results.push((index, result));
                }
                Err(err) => {
                    join_error = Some(err);
                }
            }
            if !cancel.is_cancelled() {
                if let Some(window) = pending.next() {
                    spawn(&mut tasks, window);
                }
            }
        }
        check_cancel(cancel)?;
        if let Some(err) = join_error {
            return Err(err.into());
        }
        results.sort_by_key(|(index, _)| *index);
        let mut cues = Vec::new();
        for (_, result) in results {
            cues.extend(result?);
        }
        if cues.is_empty() {
            bail!(NO_STT_CUES_ERROR)
        }
        cues.sort_by(|a, b| a.start.total_cmp(&b.start));
        progress(stage(100., format!("{} cue dari audio", cues.len()))).await;
        Ok(cues)
    }
    async fn stream_start(
        &self,
        path: &Path,
        stream: &str,
        cancel: &CancellationToken,
    ) -> Result<Option<f64>> {
        let out = tools::run(
            Command::new(&self.config.tools.ffprobe)
                .args([
                    "-v",
                    "error",
                    "-select_streams",
                    stream,
                    "-show_entries",
                    "stream=start_time",
                    "-of",
                    "csv=p=0",
                ])
                .arg(path),
            Duration::from_secs(20),
            cancel,
        )
        .await?;
        Ok(String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|n| n.is_finite()))
    }
    async fn download_source(
        &self,
        url: &str,
        dir: &Path,
        prefix: &str,
        section: Option<(f64, f64)>,
        timeout: Duration,
        cancel: &CancellationToken,
    ) -> Result<PathBuf> {
        let mut cmd = self.ytdlp();
        cmd.args([
            "-f",
            if prefix.starts_with("broll_") {
                if section.is_some() {
                    "bv*[height<=1080][ext=mp4][protocol^=http]+ba[ext=m4a][protocol^=http]/b[height<=1080][ext=mp4][protocol^=http]"
                } else {
                    "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]"
                }
            } else if section.is_some() {
                SECTION_FORMAT
            } else {
                FULL_FORMAT
            },
            "--merge-output-format",
            "mp4",
            "--no-playlist",
            "--no-progress",
            "--no-warnings",
            "-N",
            "8",
            "--http-chunk-size",
            "10M",
        ]);
        if let Some((s, e)) = section {
            cmd.args([
                "--download-sections",
                &format!("*{s:.3}-{e:.3}"),
                "--force-keyframes-at-cuts",
            ]);
        }
        cmd.arg("-o")
            .arg(dir.join(format!("{prefix}.%(ext)s")))
            .arg("--")
            .arg(url);
        tools::run(&mut cmd, timeout, cancel).await?;
        let path = media_file(dir, prefix)
            .ok_or_else(|| anyhow!("yt-dlp selesai tanpa menghasilkan file video"))?;
        if section.is_some() {
            let meta = tools::probe_media_cancel(&self.config.tools.ffprobe, &path, cancel).await?;
            if meta.has_audio {
                let video = self.stream_start(&path, "v:0", cancel).await?;
                let audio = self.stream_start(&path, "a:0", cancel).await?;
                if video.zip(audio).is_some_and(|(v, a)| v - a > 0.05) {
                    bail!("section A/V tidak sinkron (video mulai lebih lambat dari audio)");
                }
            }
        }
        Ok(path)
    }
    async fn section(
        &self,
        url: &str,
        dir: &Path,
        prefix: &str,
        window: (f64, f64),
        timeout: Duration,
        cancel: &CancellationToken,
    ) -> Result<PathBuf> {
        for attempt in [1, 2] {
            let result = self
                .download_source(url, dir, prefix, Some(window), timeout, cancel)
                .await;
            match result {
                Ok(p) => return Ok(p),
                Err(e) => {
                    for file in read_files(dir)
                        .into_iter()
                        .filter(|p| filename(p).starts_with(prefix))
                    {
                        let _ = fs::remove_file(file);
                    }
                    if attempt != 1 || !e.to_string().contains("403") {
                        return Err(e);
                    }
                }
            }
        }
        unreachable!()
    }
    async fn select(
        &self,
        cues: &[TranscriptCue],
        params: &JobParams,
        desc: Option<&str>,
        all: bool,
        cancel: &CancellationToken,
    ) -> Result<Vec<Moment>> {
        let client = self.llm.as_ref().ok_or_else(|| {
            anyhow!("LLM tidak dikonfigurasi: set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL di worker.")
        })?;
        tokio::select! {biased;_=cancel.cancelled()=>bail!("job cancelled"),r=client.select_moments(cues,params,desc,all)=>r}
    }
    pub async fn run_preview(
        &self,
        request: &PreviewRequest,
        cancel: &CancellationToken,
    ) -> Result<PreviewResult> {
        self.run_preview_with_progress(request, cancel, |_| std::future::ready(()))
            .await
    }
    pub async fn run_preview_with_progress<F, Fut>(
        &self,
        request: &PreviewRequest,
        cancel: &CancellationToken,
        mut progress: F,
    ) -> Result<PreviewResult>
    where
        F: FnMut(JobProgress) -> Fut,
        Fut: Future<Output = ()>,
    {
        let local = self.local_primary(request.primary_source.as_ref(), &request.url)?;
        let dir = self.workdir("preview-")?;
        let mut cues = if let Some(path) = &local {
            let info = tools::probe_media_cancel(&self.config.tools.ffprobe, path, cancel).await?;
            self.local_cues(
                path,
                info,
                request.max_source_sec.map(|limit| (0., f64::from(limit))),
                &request.caption_language,
                dir.path(),
                cancel,
            )
            .await?
        } else {
            self.optional_cues(request.transcript_source, &request.url, dir.path(), cancel)
                .await?
        };
        if local.is_some() && cues.is_empty() {
            bail!(NO_STT_CUES_ERROR);
        }
        if cues.is_empty() {
            cues = self
                .auto_stt(
                    request.transcript_source,
                    &request.url,
                    dir.path(),
                    None,
                    request.max_source_sec,
                    12,
                    &request.caption_language,
                    cancel,
                    progress,
                )
                .await?;
        } else {
            progress(JobProgress {
                stage: "transcribe".into(),
                percent: 100.,
                message: format!(
                    "{} cue dari {}",
                    cues.len(),
                    if local.is_some() { "audio" } else { "subtitle" }
                ),
                clip: None,
            })
            .await;
        }
        let cues = within_limit(cues, request.max_source_sec);
        let candidates = self
            .select(
                &cues,
                &request.params,
                request.description.as_deref(),
                true,
                cancel,
            )
            .await?;
        let split = self
            .prepare_split(request.split_screen.as_ref(), dir.path(), true, cancel)
            .await?;
        let broll_summaries = split.as_ref().map(|split| {
            split
                .catalog
                .iter()
                .filter_map(|clip| Some((clip.id.clone(), clip.description.clone()?)))
                .collect()
        });
        let mut planned = Vec::with_capacity(candidates.len());
        for moment in candidates {
            let split_timeline = if let Some(split) = &split {
                Some(
                    self.split_timeline(split, (moment.start, moment.end), &cues, None, cancel)
                        .await?,
                )
            } else {
                None
            };
            planned.push(PreviewCandidate {
                moment,
                split_timeline,
            });
        }
        let cues = cues
            .into_iter()
            .map(|c| TranscriptCue {
                start: llm::round_time(c.start),
                end: llm::round_time(c.end),
                words: vec![],
                ..c
            })
            .collect();
        Ok(PreviewResult {
            candidates: planned,
            cues,
            broll_summaries,
        })
    }
    pub async fn run_frame(
        &self,
        request: &FrameRequest,
        cancel: &CancellationToken,
    ) -> Result<FrameResult> {
        let local = self.local_primary(request.primary_source.as_ref(), &request.url)?;
        if !request.at_sec.is_finite() || request.at_sec < 0. {
            bail!("invalid_frame_payload");
        }
        let normalized = request.out_path.replace('\\', "/");
        let relative = relative_output(&normalized)?;
        fs::create_dir_all(&self.config.clips_dir)?;
        let root = self.config.clips_dir.canonicalize()?;
        let dest = destination_in(&root, &relative)?;
        clean_frames(&root.join(".frames"));
        let dir = self.workdir("frame-")?;
        let (width, height) = request.aspect_ratio.output_size();
        let offset = if local.is_some() {
            0.
        } else {
            (request.at_sec - 1.).max(0.)
        };
        let source = if let Some(path) = local {
            path
        } else {
            self.section(
                &request.url,
                dir.path(),
                "frame-source",
                (offset, request.at_sec + 3.),
                Duration::from_secs(100),
                cancel,
            )
            .await?
        };
        let tmp = tempfile::Builder::new()
            .suffix(".jpg")
            .tempfile_in(dest.parent().unwrap())?;
        let info = tools::probe_media_cancel(&self.config.tools.ffprobe, &source, cancel).await?;
        let seek = (request.at_sec - offset).min((info.duration - 1. / info.fps).max(0.));
        if request.aspect_ratio == AspectRatio::Portrait {
            // A frame payload has no storyboard; only the first B-roll source is needed.
            let mut frame_split = request.split_screen.clone();
            if let Some(config) = &mut frame_split {
                config.clips.truncate(1);
            }
            if let Some(split) = self
                .prepare_split(frame_split.as_ref(), dir.path(), false, cancel)
                .await?
            {
                let first = split
                    .clips
                    .get(&split.catalog[0].id)
                    .context("missing B-roll source")?;
                let layout = split_screen::split_panel_dims(split.config.ratio, split.config.swap);
                let subtitle = if request.captions {
                    let style = subtitles::with_split_seam(
                        request.caption_style.as_ref(),
                        Some(layout.seam_y_frac),
                    );
                    let path = dir.path().join("caption.ass");
                    let cues = [TranscriptCue {
                        start: 0.,
                        end: 2.,
                        text: request.caption_sample.clone(),
                        words: vec![],
                    }];
                    fs::write(
                        &path,
                        subtitles::ass_text(&cues, width, height, false, style.as_ref()),
                    )?;
                    let mut filter = format!("subtitles={}", escape_filter_option(&path));
                    if let Some(fonts) = &self.config.font_dir {
                        filter.push_str(&format!(":fontsdir={}", escape_filter_option(fonts)));
                    }
                    Some(filter)
                } else {
                    None
                };
                split_screen::extract_split_cover_frame(
                    &self.config.tools.ffmpeg,
                    (&source, seek),
                    (&first.path, 0., first.is_image),
                    &split.config,
                    subtitle.as_deref(),
                    tmp.path(),
                    cancel,
                )
                .await?;
                if fs::metadata(tmp.path())?.len() == 0 {
                    bail!("frame_render_failed");
                }
                tmp.persist(dest)?;
                return Ok(FrameResult {
                    file: relative.to_string_lossy().replace('\\', "/"),
                    width,
                    height,
                    at_sec: request.at_sec,
                });
            }
        }
        let start = (seek - 1.).max(0.);
        let opts = RenderOptions {
            reframe: request.reframe,
            two_speakers: request.two_speakers,
            facecam: request.facecam,
            captions: request.captions,
            aspect_ratio: request.aspect_ratio,
            caption_style: request.caption_style.clone(),
            timeline_offset: offset,
            ..Default::default()
        };
        let cues = if request.captions {
            vec![TranscriptCue {
                start: offset + start,
                end: offset + start + 2.,
                text: request.caption_sample.clone(),
                words: vec![],
            }]
        } else {
            vec![]
        };
        let moment = Moment {
            start,
            end: (start + 2.).min(info.duration),
            title: "frame".into(),
            ..Default::default()
        };
        let rendered = dir.path().join("render.mp4");
        self.render_one(&source, &moment, &cues, &rendered, &opts, cancel)
            .await?;
        tools::run(
            tools::ffmpeg(&self.config.tools.ffmpeg)
                .args(["-ss", &format!("{:.6}", seek - start), "-i"])
                .arg(&rendered)
                .args(["-frames:v", "1", "-q:v", "3"])
                .arg(tmp.path()),
            Duration::from_secs(20),
            cancel,
        )
        .await?;
        if fs::metadata(tmp.path())?.len() == 0 {
            bail!("frame_render_failed");
        }
        tmp.persist(dest)?;
        Ok(FrameResult {
            file: relative.to_string_lossy().replace('\\', "/"),
            width,
            height,
            at_sec: request.at_sec,
        })
    }
    async fn add_hook(
        &self,
        source: &Path,
        moment: &Moment,
        clip: &Path,
        pre_reframed_cover: Option<&Path>,
        template: HookTemplate,
        cancel: &CancellationToken,
    ) -> Result<()> {
        let Some(text) = moment
            .hook_text
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .or_else(|| Some(moment.title.trim()).filter(|s| !s.is_empty()))
        else {
            return Ok(());
        };
        let dir = self.workdir("hook-")?;
        let thumb = dir.path().join("hook.png");
        let meta = tools::probe_media_cancel(&self.config.tools.ffprobe, clip, cancel).await?;
        let pre_reframed_cover = pre_reframed_cover.filter(|&path| {
            image::image_dimensions(path).is_ok_and(|dims| dims == (meta.width, meta.height))
        });
        let (cover, needs_focus) = if let Some(path) = pre_reframed_cover {
            (path.to_owned(), false)
        } else {
            let cover = dir.path().join("cover.png");
            hook_thumbnail::cover_frame(
                &self.config.tools.ffmpeg,
                source,
                moment.start,
                moment.end - moment.start,
                &cover,
                cancel,
            )
            .await?;
            (cover, true)
        };
        let faces = self.faces.clone();
        let fonts = self.config.font_dir.clone().unwrap_or_default();
        let text = text.to_owned();
        let thumb2 = thumb.clone();
        // The tempdir stays alive until the blocking task finishes.
        let _dir = tokio::task::spawn_blocking(move || {
            let focus = if needs_focus {
                faces.detect_cover_face_focus(&cover)
            } else {
                None
            };
            hook_thumbnail::render_hook_thumbnail_with_template(
                &cover,
                &text,
                meta.width,
                meta.height,
                focus,
                fonts,
                template,
                &thumb2,
            )?;
            Ok::<_, anyhow::Error>(dir)
        })
        .await??;
        let tmp = tempfile::Builder::new()
            .prefix(".intro-")
            .suffix(".mp4")
            .tempfile_in(clip.parent().unwrap())?;
        hook_thumbnail::intro(
            &self.config.tools.ffmpeg,
            clip,
            &thumb,
            tmp.path(),
            meta,
            &self.config.video_encoder,
            cancel,
        )
        .await?;
        tmp.persist(clip)?;
        Ok(())
    }
    pub async fn run_job<F, Fut>(
        &self,
        job: &JobData,
        cancel: &CancellationToken,
        mut on_progress: F,
    ) -> Result<JobResult>
    where
        F: FnMut(JobProgress) -> Fut,
        Fut: Future<Output = ()>,
    {
        check_cancel(cancel)?;
        let local = self.local_primary(job.primary_source.as_ref(), &job.url)?;
        let local_info = if let Some(path) = &local {
            Some(tools::probe_media_cancel(&self.config.tools.ffprobe, path, cancel).await?)
        } else {
            None
        };
        let split_config = job
            .split_screen
            .as_ref()
            .filter(|config| job.aspect_ratio == AspectRatio::Portrait && config.is_active());
        if job.job_id.is_empty()
            || job.job_id.len() > 64
            || !job
                .job_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        {
            bail!("job_id tidak valid: {:?}", job.job_id);
        }
        fs::create_dir_all(&self.config.clips_dir)?;
        let minimum = std::env::var("MIN_FREE_GB")
            .ok()
            .and_then(|s| s.trim().parse::<f64>().ok())
            .unwrap_or(5.0);
        let free = fs2::available_space(&self.config.clips_dir)? as f64 / (1024_f64.powi(3));
        if free < minimum {
            bail!("Ruang disk tinggal {free:.1} GB, minimal {minimum:.0} GB. Hapus clip lama lalu jalankan ulang job.");
        }
        let manual = job.mode == JobMode::Manual;
        let mut valid_ranges: Vec<_> = job
            .ranges
            .iter()
            .filter(|r| {
                r.start >= 0.
                    && usable_duration(r.end - r.start)
                    && local_info.is_none_or(|info| r.start < info.duration)
            })
            .collect();
        valid_ranges.sort_by(|a, b| a.start.total_cmp(&b.start));
        if manual && valid_ranges.is_empty() {
            bail!("mode manual butuh minimal satu range");
        }
        let stage = |stage: &str, percent, message: String, clip| JobProgress {
            stage: stage.into(),
            percent,
            message,
            clip,
        };
        let dir = self.workdir("clip-")?;
        let limit = (!manual).then_some(job.max_source_sec).flatten();
        let timeout = Duration::from_secs(1800);
        let local_job = local.is_some();
        let mut full = local;
        if !local_job && job.transcript_source == TranscriptSource::LiveChatStt {
            self.transcriber()?;
        }
        let message = if local_job {
            "menyiapkan file video lokal".into()
        } else if manual {
            format!("mengunduh subtitle untuk {} rentang", valid_ranges.len())
        } else if let Some(n) = limit {
            format!("mengunduh 0-{n} detik")
        } else {
            "mengunduh video".into()
        };
        on_progress(stage("download", 0., message, None)).await;
        if !manual && !local_job {
            if let Some(limit) = limit {
                full = self
                    .section(
                        &job.url,
                        dir.path(),
                        "source",
                        (0., limit.into()),
                        timeout,
                        cancel,
                    )
                    .await
                    .ok();
            }
            if full.is_none() {
                full = Some(
                    self.download_source(&job.url, dir.path(), "source", None, timeout, cancel)
                        .await?,
                );
            }
        }
        let mut cues = if local_job {
            vec![]
        } else if manual && !job.captions && split_config.is_some() {
            if split_config.is_some_and(SplitScreenConfig::auto_match) {
                self.optional_cues(TranscriptSource::Auto, &job.url, dir.path(), cancel)
                    .await?
            } else {
                vec![]
            }
        } else {
            self.optional_cues(job.transcript_source, &job.url, dir.path(), cancel)
                .await?
        };
        on_progress(stage(
            "download",
            100.,
            if manual && !cues.is_empty() {
                "subtitle siap"
            } else {
                "media siap dirender"
            }
            .into(),
            None,
        ))
        .await;
        check_cancel(cancel)?;
        let needs_split_cues = split_config.is_some_and(SplitScreenConfig::auto_match)
            && valid_ranges
                .iter()
                .any(|range| range.split_timeline.as_ref().is_none_or(Vec::is_empty));
        let manual_stt = if cues.is_empty()
            && manual
            && !local_job
            && (job.captions || split_config.is_none() || needs_split_cues)
        {
            if job.captions || split_config.is_none() {
                Some(self.transcriber()?)
            } else {
                self.transcriber().ok()
            }
        } else {
            None
        };
        if let Some(info) = local_info.filter(|_| !manual) {
            on_progress(stage(
                "transcribe",
                0.,
                "mentranskrip video lokal...".into(),
                None,
            ))
            .await;
            cues = self
                .local_cues(
                    full.as_ref().context("missing primary source")?,
                    info,
                    limit.map(|limit| (0., f64::from(limit))),
                    &job.caption_language,
                    dir.path(),
                    cancel,
                )
                .await?;
            if cues.is_empty() {
                bail!(NO_STT_CUES_ERROR);
            }
            on_progress(stage(
                "transcribe",
                100.,
                format!("{} cue dari audio", cues.len()),
                None,
            ))
            .await;
        } else if cues.is_empty() && !manual {
            cues = self
                .auto_stt(
                    job.transcript_source,
                    &job.url,
                    dir.path(),
                    full.as_deref(),
                    limit,
                    job.params.clip_count.saturating_mul(2).clamp(6, 10),
                    &job.caption_language,
                    cancel,
                    &mut on_progress,
                )
                .await?;
        } else if !cues.is_empty() {
            on_progress(stage("transcribe", 0., "menyiapkan transkrip".into(), None)).await;
            on_progress(stage(
                "transcribe",
                100.,
                format!("{} cue dari subtitle", cues.len()),
                None,
            ))
            .await;
        }
        let mut cues = within_limit(cues, limit);
        on_progress(stage("select", 0., "memilih momen".into(), None)).await;
        let moments = if manual {
            valid_ranges
                .iter()
                .map(|r| Moment {
                    start: if local_job {
                        r.start
                    } else {
                        llm::round_time(r.start)
                    },
                    end: local_info
                        .map_or_else(|| llm::round_time(r.end), |info| r.end.min(info.duration)),
                    title: r
                        .title
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(|s| cut(s, 70))
                        .unwrap_or_else(|| llm::title_from_cues(&cues, r.start, r.end)),
                    reason: r
                        .reason
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(|s| cut(s, 200))
                        .unwrap_or_else(|| "manual".into()),
                    hook_text: r.hook_text.clone(),
                    viral_score: None,
                })
                .collect()
        } else {
            self.select(
                &cues,
                &job.params,
                job.description.as_deref(),
                false,
                cancel,
            )
            .await?
        };
        if moments.is_empty() {
            bail!("tidak ada momen yang bisa dirender");
        }
        let total = moments.len();
        on_progress(stage(
            "select",
            100.,
            format!("{total} momen dipilih"),
            None,
        ))
        .await;
        fs::create_dir_all(&self.config.clips_dir)?;
        let root = self.config.clips_dir.canonicalize()?;
        let outdir = destination_in(&root, &Path::new(&job.job_id).join("placeholder"))?
            .parent()
            .unwrap()
            .to_owned();
        let watermarks = if job.watermarks.is_empty() {
            job.watermark.as_slice()
        } else {
            &job.watermarks
        };
        let mut opts = RenderOptions {
            reframe: job.reframe,
            aspect_ratio: job.aspect_ratio,
            captions: job.captions,
            two_speakers: job.two_speakers,
            facecam: job.facecam,
            caption_style: job.caption_style.clone(),
            normalize_audio: job.normalize_audio,
            watermarks: watermarks
                .iter()
                .take(WATERMARK_MAX_PER_JOB)
                .filter_map(|w| Some((w.clone(), resolve_asset(&root, &w.file_path)?)))
                .collect(),
            timeline_offset: 0.,
            split_screen: self
                .prepare_split(
                    split_config,
                    dir.path(),
                    !manual || needs_split_cues,
                    cancel,
                )
                .await?,
            split_timeline: None,
        };
        let outro = job
            .outro
            .as_ref()
            .and_then(|o| resolve_asset(&root, &o.file_path));
        let mut clips = Vec::new();
        let mut cached = None;
        on_progress(stage("render", 0., format!("merender {total} clip"), None)).await;
        for (i, moment) in moments.iter().enumerate() {
            check_cancel(cancel)?;
            let n = i + 1;
            let mut section = None;
            if full.is_none() {
                let percent = i as f64 * 100. / total as f64;
                on_progress(stage(
                    "download",
                    percent,
                    format!("mengunduh clip {n}/{total}"),
                    None,
                ))
                .await;
                let prefix = format!("section-{n:02}");
                section = self
                    .section(
                        &job.url,
                        dir.path(),
                        &prefix,
                        (moment.start, moment.end),
                        timeout,
                        cancel,
                    )
                    .await
                    .ok();
                if section.is_none() {
                    check_cancel(cancel)?;
                    on_progress(stage(
                        "download",
                        percent,
                        "section gagal, mengunduh video penuh".into(),
                        None,
                    ))
                    .await;
                    full = Some(
                        self.download_source(&job.url, dir.path(), "source", None, timeout, cancel)
                            .await?,
                    );
                }
            }
            let video = section
                .as_ref()
                .or(full.as_ref())
                .ok_or_else(|| anyhow!("sumber video tidak tersedia untuk render"))?;
            let offset = if section.is_some() { moment.start } else { 0. };
            opts.timeline_offset = offset;
            opts.split_timeline = if manual {
                valid_ranges[i].split_timeline.clone()
            } else {
                None
            };
            let match_needs_cues =
                needs_split_cues && opts.split_timeline.as_ref().is_none_or(Vec::is_empty);
            let window = Moment {
                start: moment.start - offset,
                end: moment.end - offset,
                ..moment.clone()
            };
            let range_cues = if let Some(info) =
                local_info.filter(|_| manual && (job.captions || match_needs_cues))
            {
                on_progress(stage(
                    "transcribe",
                    0.,
                    format!("mentranskrip clip {n}/{total}..."),
                    None,
                ))
                .await;
                let speech = self
                    .local_cues(
                        video,
                        info,
                        Some((moment.start, moment.end)),
                        &job.caption_language,
                        dir.path(),
                        cancel,
                    )
                    .await;
                check_cancel(cancel)?;
                let speech = if job.captions {
                    speech?
                } else {
                    speech.unwrap_or_default()
                };
                cues.extend(speech.iter().cloned());
                on_progress(stage(
                    "transcribe",
                    100.,
                    format!("{} cue dari audio", speech.len()),
                    None,
                ))
                .await;
                Some(speech)
            } else if let Some(stt) = manual_stt
                .as_ref()
                .filter(|_| job.captions || split_config.is_none() || match_needs_cues)
            {
                on_progress(stage(
                    "transcribe",
                    0.,
                    format!("mentranskrip clip {n}/{total}..."),
                    None,
                ))
                .await;
                let bounds = section.is_none().then_some((moment.start, moment.end));
                let speech = stt
                    .media(
                        video,
                        bounds,
                        moment.start,
                        &job.caption_language,
                        dir.path(),
                        cancel,
                    )
                    .await;
                check_cancel(cancel)?;
                let speech = if job.captions || split_config.is_none() {
                    speech?
                } else {
                    speech.unwrap_or_default()
                };
                cues.extend(speech.iter().cloned());
                on_progress(stage(
                    "transcribe",
                    100.,
                    format!("{} cue dari audio", speech.len()),
                    None,
                ))
                .await;
                Some(speech)
            } else {
                None
            };
            let active_cues = range_cues.as_deref().unwrap_or(&cues);
            let file = format!("clip-{n:02}.mp4");
            let clip = outdir.join(&file);
            let cover_path = job
                .hook_banner
                .then(|| dir.path().join(format!("cover-{n:02}.png")));
            if let Some(b) = self
                .render_window(
                    video,
                    &window,
                    active_cues,
                    &clip,
                    &opts,
                    cached,
                    cover_path.as_deref(),
                    cancel,
                )
                .await?
            {
                cached = Some(b);
            }
            if let Some(cover) = cover_path {
                let _ = self
                    .add_hook(video, &window, &clip, Some(&cover), job.hook_template, cancel)
                    .await;
                let _ = fs::remove_file(cover);
                check_cancel(cancel)?;
            }
            if let Some(outro) = &outro {
                let _ = self.append_outro(&clip, outro, &clip, cancel).await;
                check_cancel(cancel)?;
            }
            if let Some(section) = section {
                let _ = fs::remove_file(section);
            }
            let transcript = llm::clip_transcript(active_cues, moment.start, moment.end);
            let result = ClipResult {
                title: moment.title.clone(),
                start: moment.start,
                end: moment.end,
                file,
                transcript: (!transcript.is_empty()).then_some(transcript),
                viral_score: moment.viral_score,
                hook_text: moment.hook_text.clone(),
                ..Default::default()
            };
            clips.push(result.clone());
            on_progress(stage(
                "render",
                n as f64 * 100. / total as f64,
                format!("clip {n}/{total} selesai"),
                Some(result),
            ))
            .await;
        }
        check_cancel(cancel)?;
        on_progress(stage("save", 0., "membuat caption sosial".into(), None)).await;
        for c in &mut clips {
            c.hashtags = job.custom_hashtags.clone();
        }
        if let Some(llm) = &self.llm {
            let caps = tokio::select! {biased;_=cancel.cancelled()=>bail!("job cancelled"),r=llm.generate_captions(&moments,&cues,&job.caption_language,&job.custom_hashtags,job.description.as_deref())=>r};
            for (clip, cap) in clips.iter_mut().zip(caps) {
                if let Some(cap) = cap {
                    clip.caption = Some(cap.caption);
                    if job.custom_hashtags.is_empty() {
                        clip.hashtags = cap.hashtags;
                    }
                    clip.platform_captions = cap.platform_captions;
                }
            }
        }
        check_cancel(cancel)?;
        clips.retain(|c| {
            fs::metadata(outdir.join(&c.file)).is_ok_and(|m| m.is_file() && m.len() > 0)
        });
        if clips.is_empty() {
            bail!("tidak ada file clip yang tersisa setelah render");
        }
        on_progress(stage("save", 100., "clip tersimpan".into(), None)).await;
        Ok(JobResult { clips })
    }
}
fn relative_output(s: &str) -> Result<PathBuf> {
    if s.contains(':') {
        bail!("invalid_frame_path");
    }
    let mut out = PathBuf::new();
    for c in Path::new(s).components() {
        match c {
            Component::Normal(n) => out.push(n),
            Component::CurDir => {}
            Component::ParentDir if out.pop() => {}
            _ => bail!("invalid_frame_path"),
        }
    }
    if out.as_os_str().is_empty() {
        bail!("invalid_frame_path");
    }
    Ok(out)
}
fn destination_in(root: &Path, relative: &Path) -> Result<PathBuf> {
    // Walk existing parents before creating new directories, including symlinks.
    let file = relative
        .file_name()
        .ok_or_else(|| anyhow!("invalid_frame_path"))?;
    let mut dest = root.to_path_buf();
    for component in relative.parent().unwrap_or(Path::new("")).components() {
        let Component::Normal(name) = component else {
            bail!("invalid_frame_path");
        };
        dest.push(name);
        match dest.symlink_metadata() {
            Ok(_) => {
                dest = dest.canonicalize()?;
                if !dest.starts_with(root) || !dest.is_dir() {
                    bail!("invalid_frame_path");
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&dest)?,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(dest.join(file))
}
fn clean_frames(dir: &Path) {
    if !dir
        .symlink_metadata()
        .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
    {
        return;
    }
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        if let Ok(kind) = e.file_type() {
            if kind.is_dir() {
                clean_frames(&e.path());
            } else if kind.is_file()
                && e.metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|t| t > Duration::from_secs(3600))
            {
                let _ = fs::remove_file(e.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_subtitles_default_to_the_seam_without_overriding_position() {
        let cues = [TranscriptCue {
            start: 0.,
            end: 2.,
            text: "example".into(),
            words: vec![],
        }];
        let style = subtitles::with_split_seam(None, Some(0.4));
        assert!(
            subtitles::ass_text(&cues, 1080, 1920, false, style.as_ref())
                .contains(r"\an5\pos(540,768)")
        );
        let explicit = CaptionStyle {
            position_y: Some(0.7),
            ..Default::default()
        };
        let style = subtitles::with_split_seam(Some(&explicit), Some(0.4));
        assert!(
            subtitles::ass_text(&cues, 1080, 1920, false, style.as_ref())
                .contains(r"\an5\pos(540,1344)")
        );
    }

    #[test]
    fn split_watermarks_start_after_both_video_inputs() {
        let (chain, output) = with_watermarks(
            vec![],
            "[stacked]",
            1080,
            &[Watermark::default(), Watermark::default()],
            2,
        );
        assert!(chain[0].starts_with("[2:v]"));
        assert!(chain[2].starts_with("[3:v]"));
        assert_eq!(output, "[wmout]");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn preview_routes_sources_and_rejects_missing_stt_config() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let ytdlp = dir.path().join("yt-dlp");
        fs::write(
            &ytdlp,
            r#"#!/bin/sh
case "$1" in --ffmpeg-location) shift 2;; esac
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then output="$2"; shift; fi
  url="$1"
  shift
done
case "$url" in
  */vtt) printf 'WEBVTT\n\n00:05.000 --> 00:07.000\nSpeech\n' > "${output%.*}.en.vtt";;
  */empty) printf 'WEBVTT\n' > "${output%.*}.en.vtt";;
esac
"#,
        )
        .unwrap();
        fs::set_permissions(&ytdlp, fs::Permissions::from_mode(0o755)).unwrap();
        let tool_paths = ToolPaths {
            ytdlp,
            ffmpeg: "unused".into(),
            ffprobe: "unused".into(),
        };
        let pipeline = Pipeline::new(PipelineConfig::new(tool_paths, dir.path()));
        let cancel = CancellationToken::new();
        for (source, url, expected) in [
            ("youtube", "vtt", "LLM tidak dikonfigurasi"),
            ("youtube", "empty", NO_SUBTITLE_ERROR),
            ("auto", "vtt", "LLM tidak dikonfigurasi"),
            ("auto", "empty", "STT_BASE_URL"),
            ("auto", "missing", "STT_BASE_URL"),
            ("live_chat_stt", "vtt", "STT_BASE_URL"),
        ] {
            let req = serde_json::from_value(serde_json::json!({"url":format!("https://example.test/{url}"), "transcriptSource":source})).unwrap();
            let error = pipeline
                .run_preview(&req, &cancel)
                .await
                .unwrap_err()
                .to_string();
            assert!(error.contains(expected), "{source} {url}: {error}");
        }
    }

    #[test]
    fn caption_filters_reset_pts_before_burning_subtitles() {
        let sf = Some("subtitles=caption.ass");
        for base in [
            black_bars(1080, 1920),
            blurred_fill(1920, 1080),
            cut_crop_filter(&[(0., 5., 0.5)], 1080, 1920),
        ] {
            let filter = standard_video_filter(&base, sf);
            assert!(filter.starts_with("setpts=PTS-STARTPTS,"));
            assert!(filter.ends_with(",subtitles=caption.ass"));
        }
        for (graph, output) in [
            two_speaker_graph(0.25, 0.75, sf),
            facecam_graph((10, 10, 200, 200), sf),
        ] {
            assert!(graph[0].starts_with("[0:v]setpts=PTS-STARTPTS,split"));
            assert!(graph.last().unwrap().contains("subtitles=caption.ass"));
            assert_eq!(output, "[vout]");
        }
        // Preview frames use render_one -> render_window, the same filter path.
    }

    #[test]
    fn center_crop_is_default_and_crops_before_scaling() {
        assert_eq!(RenderOptions::default().reframe, ReframeMode::CenterCrop);
        assert_eq!(
            center_crop(1080, 1920),
            "crop=w='min(in_w,ih*0.56250)':h='min(in_h,iw/0.56250)':x='(in_w-out_w)/2':y='(in_h-out_h)/2',scale=1080:1920,setsar=1"
        );
        assert_eq!(
            center_crop(1080, 1080),
            "crop=w='min(in_w,ih*1.00000)':h='min(in_h,iw/1.00000)':x='(in_w-out_w)/2':y='(in_h-out_h)/2',scale=1080:1080,setsar=1"
        );
    }

    #[test]
    fn reframe_graphs_match_worker_dimensions() {
        assert_eq!(black_bars(1080,1920),"scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1");
        assert!(blurred_fill(1920, 1080)
            .contains(r"boxblur=luma_radius=min(h\,w)/10:luma_power=2[blurred]"));
        assert_eq!(
            portrait_crop_filter(0.5, 1080, 1920),
            "crop=ih*0.56250:ih:0.50000*in_w-ih*0.28125:0,scale=1080:1920"
        );
        assert!(
            cut_crop_filter(&[(0., 1.5, 0.25), (1.5, 3., 0.75)], 1080, 1920)
                .contains("0.2500*gte(t,0.000)*lt(t,1.500)+0.7500*gte(t,1.500)")
        );
        assert!(panel_crop_filter(0.25).ends_with("scale=1080:960,setsar=1"));
        let (g, l) = facecam_graph((1, 2, 300, 200), Some("subtitles=clip.ass"));
        assert_eq!(l, "[vout]");
        assert!(g[1].contains("crop=300:200:1:2,scale=1080:840"));
        assert!(g[2].contains("scale=1080:1080"));
    }
    #[test]
    fn watermark_layers_are_clamped_to_five_and_chroma_is_selected_by_color() {
        let key = |color: &str| WatermarkChromaKey {
            enabled: true,
            color: color.into(),
            ..Default::default()
        };
        assert!(chroma_key_filters(&key("#333333"))[0].starts_with("colorkey="));
        assert_eq!(chroma_key_filters(&key("#0000FF"))[1], "despill=type=blue");
        let wm = Watermark {
            file_path: "video.webm".into(),
            chroma_key: Some(key("#00ff00")),
            scale: 0.251,
            y: 0.8,
            ..Default::default()
        };
        let (graph, label) = with_watermarks(
            vec!["[0:v]null[base]".into()],
            "[base]",
            1080,
            &vec![wm; 6],
            1,
        );
        assert_eq!(label, "[wmout]");
        assert_eq!(graph.len(), 11);
        assert!(graph[1].contains("[1:v]setpts=PTS-STARTPTS,chromakey=color=0x00FF00"));
        assert!(graph[1].contains(
            "despill=type=green,scale=w=272:h=-2,format=rgba,colorchannelmixer=aa=1.000"
        ));
        assert!(graph[10].starts_with("[wmout3][wm4]overlay"));
        assert!(graph[10].contains("main_h*0.8000-overlay_h/2"));
    }
    #[test]
    fn paths_cannot_traverse_clips_root() {
        assert_eq!(
            relative_output(".frames/../still.jpg").unwrap(),
            Path::new("still.jpg")
        );
        assert!(relative_output("../still.jpg").is_err());
        assert!(relative_output("C:/still.jpg").is_err());
    }
}
