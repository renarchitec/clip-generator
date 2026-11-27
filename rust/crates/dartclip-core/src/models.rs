use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaSourceKind {
    #[default]
    Url,
    Upload,
    Clip,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PrimaryMediaSource {
    pub kind: MediaSourceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clip_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SplitScreenRatio {
    #[default]
    #[serde(rename = "50:50")]
    FiftyFifty,
    #[serde(rename = "40:60")]
    FortySixty,
    #[serde(rename = "60:40")]
    SixtyForty,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SplitPanelFit {
    #[default]
    Cover,
    #[serde(rename = "contain_blur")]
    ContainBlur,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SplitMatchMode {
    #[default]
    Auto,
    Sequential,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SplitScreenClipSource {
    pub id: String,
    pub kind: MediaSourceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clip_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_sec: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_sec: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SplitScreenSegment {
    pub at_start: f64,
    pub at_end: f64,
    pub clip_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_start_sec: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SplitScreenConfig {
    pub enabled: bool,
    pub ratio: SplitScreenRatio,
    pub swap: bool,
    pub primary_fit: SplitPanelFit,
    pub secondary_fit: SplitPanelFit,
    pub secondary_volume: f64,
    pub match_mode: SplitMatchMode,
    pub clips: Vec<SplitScreenClipSource>,
}

impl SplitScreenConfig {
    pub fn is_active(&self) -> bool {
        self.enabled && !self.clips.is_empty()
    }

    pub fn auto_match(&self) -> bool {
        self.is_active() && self.match_mode == SplitMatchMode::Auto && self.clips.len() >= 2
    }
}

pub const WATERMARK_MAX_PER_JOB: usize = 5;
pub const CUSTOM_HASHTAGS_MAX: usize = 15;
pub const CUSTOM_HASHTAG_MAX_LENGTH: usize = 50;
pub const CAPTION_FONT_SIZE_MIN: u32 = 44;
pub const CAPTION_FONT_SIZE_MAX: u32 = 120;
pub const DEFAULT_CAPTION_FONT_SIZE: u32 = 80;
pub const WATERMARK_CHROMA_SIMILARITY_MIN: f64 = 0.01;
pub const WATERMARK_CHROMA_SIMILARITY_MAX: f64 = 0.5;
pub const WATERMARK_CHROMA_BLEND_MIN: f64 = 0.0;
pub const WATERMARK_CHROMA_BLEND_MAX: f64 = 0.5;
pub const CLIP_TRANSCRIPT_MAX: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum AspectRatio {
    #[default]
    #[serde(rename = "9:16")]
    Portrait,
    #[serde(rename = "1:1")]
    Square,
    #[serde(rename = "16:9")]
    Landscape,
}
impl AspectRatio {
    pub fn output_size(self) -> (u32, u32) {
        match self {
            Self::Portrait => (1080, 1920),
            Self::Square => (1080, 1080),
            Self::Landscape => (1920, 1080),
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReframeMode {
    #[default]
    CenterCrop,
    FaceTracking,
    BlackBars,
    BlurredFill,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobMode {
    #[default]
    Auto,
    Manual,
}

pub(crate) fn first<'a>(v: &'a Value, keys: &[&str]) -> &'a Value {
    keys.iter()
        .map(|k| &v[k])
        .find(|v| !v.is_null())
        .unwrap_or(&Value::Null)
}
fn primary_source(v: &Value) -> Option<PrimaryMediaSource> {
    serde_json::from_value(first(v, &["primarySource", "primary_source"]).clone()).ok()
}

fn payload_url(v: &Value, http_only: bool) -> Option<String> {
    let primary = primary_source(v);
    if primary
        .as_ref()
        .is_some_and(|s| s.kind != MediaSourceKind::Url)
    {
        return Some(v["url"].as_str().unwrap_or_default().to_owned());
    }
    primary
        .as_ref()
        .and_then(|s| s.url.as_deref())
        .filter(|s| !s.trim().is_empty())
        .or_else(|| v["url"].as_str())
        .filter(|s| {
            !s.trim().is_empty()
                && (!http_only || s.starts_with("http://") || s.starts_with("https://"))
        })
        .map(str::to_owned)
}

pub(crate) fn number(v: &Value) -> Option<f64> {
    match v {
        Value::Bool(b) => Some(u8::from(*b).into()),
        Value::String(s) => s.trim().parse().ok(),
        _ => v.as_f64(),
    }
    .filter(|n| n.is_finite())
}
pub(crate) fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}
pub(crate) fn text(v: &Value, n: usize) -> Option<String> {
    v.as_str()
        .map(|s| cut(s.trim(), n))
        .filter(|s| !s.is_empty())
}
fn boolean(v: &Value, default: bool) -> bool {
    match v {
        Value::Null => default,
        Value::Bool(b) => *b,
        Value::String(s) => !matches!(
            s.trim().to_lowercase().as_str(),
            "0" | "false" | "no" | "off"
        ),
        Value::Number(n) => n.as_f64() != Some(0.),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}
fn color(v: &Value) -> Option<String> {
    v.as_str()
        .filter(|s| {
            s.len() == 7
                && s.starts_with('#')
                && s.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        })
        .map(str::to_ascii_uppercase)
}
pub fn to_caption_language(v: &Value) -> String {
    match v
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_lowercase()
        .as_str()
    {
        "id" => "id",
        "en" => "en",
        _ => "auto",
    }
    .into()
}
pub fn to_custom_hashtags(v: &Value) -> Vec<String> {
    let items = if let Some(s) = v.as_str() {
        vec![s]
    } else {
        v.as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect()
    };
    let mut seen = HashSet::new();
    items
        .into_iter()
        .flat_map(|s| s.split(|c: char| c.is_whitespace() || c == ',' || c == '#'))
        .map(|s| {
            s.chars()
                .filter(|c| c.is_alphanumeric() || *c == '_')
                .take(CUSTOM_HASHTAG_MAX_LENGTH)
                .collect::<String>()
        })
        .filter(|s| !s.is_empty() && seen.insert(s.to_lowercase()))
        .take(CUSTOM_HASHTAGS_MAX)
        .collect()
}
fn max_source(v: &Value) -> Option<u32> {
    number(v)
        .map(f64::trunc)
        .filter(|n| (60. ..=36000.).contains(n))
        .map(|n| n as u32)
}
fn empty(s: &str) -> bool {
    s.is_empty()
}
fn rounded<const N: usize, S: Serializer>(v: &f64, s: S) -> Result<S::Ok, S::Error> {
    // Formatting uses nearest-even, including binary floating-point ties.
    s.serialize_f64(format!("{v:.N$}").parse().unwrap_or(*v))
}
fn percent<S: Serializer>(v: &f64, s: S) -> Result<S::Ok, S::Error> {
    rounded::<1, _>(&v.clamp(0., 100.), s)
}
fn transcript<S: Serializer>(v: &Option<String>, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(
        &cut(v.as_deref().unwrap_or("").trim(), CLIP_TRANSCRIPT_MAX)
            .trim()
            .to_owned(),
    )
}
fn empty_option(v: &Option<String>) -> bool {
    v.as_deref().is_none_or(str::is_empty)
}
fn no_transcript(v: &Option<String>) -> bool {
    v.as_deref().unwrap_or("").trim().is_empty()
}

macro_rules! tolerant {
    ($ty:ty, $parse:expr) => {
        impl<'de> Deserialize<'de> for $ty {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let raw = Value::deserialize(d)?;
                ($parse)(&raw)
                    .ok_or_else(|| serde::de::Error::custom(concat!("invalid ", stringify!($ty))))
            }
        }
    };
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionStyle {
    pub preset: String,
    pub font_family: String,
    pub font_size: u32,
    pub primary_color: String,
    pub highlight_color: String,
    pub outline_color: String,
    pub effect: String,
    pub uppercase: bool,
    pub position: String,
    pub italic: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_y: Option<f64>,
    pub animate: bool,
}
impl Default for CaptionStyle {
    fn default() -> Self {
        Self::from_preset("hook")
    }
}
impl CaptionStyle {
    pub fn from_preset(preset: &str) -> Self {
        let (preset, font, size, primary, highlight, outline, effect, uppercase, animate) =
            match preset {
                "beast" => (
                    "beast",
                    "Montserrat",
                    84,
                    "#FFFFFF",
                    "#22C55E",
                    "#000000",
                    "outline",
                    true,
                    true,
                ),
                "boxed" => (
                    "boxed",
                    "Plus Jakarta Sans",
                    68,
                    "#FFFFFF",
                    "#FACC15",
                    "#000000",
                    "box",
                    false,
                    false,
                ),
                "neon" => (
                    "neon",
                    "Bebas Neue",
                    92,
                    "#FFFFFF",
                    "#5CE1C4",
                    "#09090B",
                    "shadow",
                    true,
                    false,
                ),
                "cinema" => (
                    "cinema", "Oswald", 68, "#FEF08A", "#FFFFFF", "#000000", "shadow", false, false,
                ),
                _ => (
                    "hook", "Anton", 80, "#FFFFFF", "#FFFF00", "#000000", "outline", true, true,
                ),
            };
        Self {
            preset: preset.into(),
            font_family: font.into(),
            font_size: size,
            primary_color: primary.into(),
            highlight_color: highlight.into(),
            outline_color: outline.into(),
            effect: effect.into(),
            uppercase,
            position: "bottom".into(),
            italic: false,
            position_y: None,
            animate,
        }
    }
    pub fn from_value(v: &Value) -> Option<Self> {
        v.as_object()?;
        let mut s = Self::from_preset(v["preset"].as_str().unwrap_or("hook"));
        if let Some(font) = first(v, &["fontFamily", "font_family", "font"])
            .as_str()
            .filter(|f| {
                [
                    "Anton",
                    "Bebas Neue",
                    "Montserrat",
                    "Plus Jakarta Sans",
                    "Oswald",
                    "Bangers",
                ]
                .contains(f)
            })
        {
            s.font_family = font.into();
        }
        if let Some(n) = first(v, &["fontSize", "font_size"]).as_f64() {
            s.font_size =
                (n.round_ties_even() as u32).clamp(CAPTION_FONT_SIZE_MIN, CAPTION_FONT_SIZE_MAX);
        }
        for (keys, target) in [
            (["primaryColor", "primary_color"], &mut s.primary_color),
            (
                ["highlightColor", "highlight_color"],
                &mut s.highlight_color,
            ),
            (["outlineColor", "outline_color"], &mut s.outline_color),
        ] {
            if let Some(c) = color(first(v, &keys)) {
                *target = c;
            }
        }
        if let Some(e) = v["effect"]
            .as_str()
            .filter(|e| ["outline", "shadow", "box", "none"].contains(e))
        {
            s.effect = e.into();
        }
        if let Some(p) = v["position"]
            .as_str()
            .filter(|p| ["bottom", "center", "top"].contains(p))
        {
            s.position = p.into();
        }
        for (key, target) in [
            ("uppercase", &mut s.uppercase),
            ("italic", &mut s.italic),
            ("animate", &mut s.animate),
        ] {
            if let Some(b) = v[key].as_bool() {
                *target = b;
            }
        }
        s.position_y = first(v, &["positionY", "position_y"]).as_f64().map(|p| {
            format!("{:.4}", p.clamp(0.05, 0.95))
                .parse()
                .expect("formatted finite number")
        });
        for p in ["hook", "beast", "boxed", "neon", "cinema"] {
            s.preset = p.into();
            if s == Self::from_preset(p) {
                return Some(s);
            }
        }
        s.preset = "custom".into();
        Some(s)
    }
}
tolerant!(CaptionStyle, CaptionStyle::from_value);

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WatermarkChromaKey {
    pub enabled: bool,
    pub color: String,
    pub similarity: f64,
    pub blend: f64,
}
impl Default for WatermarkChromaKey {
    fn default() -> Self {
        Self {
            enabled: false,
            color: "#00FF00".into(),
            similarity: 0.18,
            blend: 0.08,
        }
    }
}
impl WatermarkChromaKey {
    pub fn from_value(v: &Value) -> Option<Self> {
        v.as_object()?;
        let d = Self::default();
        Some(Self {
            enabled: v["enabled"].as_bool().unwrap_or_default(),
            color: color(&v["color"]).unwrap_or(d.color),
            similarity: number(&v["similarity"]).unwrap_or(d.similarity).clamp(
                WATERMARK_CHROMA_SIMILARITY_MIN,
                WATERMARK_CHROMA_SIMILARITY_MAX,
            ),
            blend: number(&v["blend"])
                .unwrap_or(d.blend)
                .clamp(WATERMARK_CHROMA_BLEND_MIN, WATERMARK_CHROMA_BLEND_MAX),
        })
    }
}
tolerant!(WatermarkChromaKey, WatermarkChromaKey::from_value);
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Watermark {
    pub file_path: String,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub opacity: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chroma_key: Option<WatermarkChromaKey>,
}
impl Default for Watermark {
    fn default() -> Self {
        Self {
            file_path: String::new(),
            x: 0.5,
            y: 0.5,
            scale: 0.25,
            opacity: 1.,
            mime_type: None,
            chroma_key: None,
        }
    }
}
impl Watermark {
    pub fn is_video(&self) -> bool {
        self.mime_type
            .as_deref()
            .unwrap_or("")
            .to_ascii_lowercase()
            .starts_with("video/")
            || [".mp4", ".webm", ".mov"]
                .iter()
                .any(|e| self.file_path.to_ascii_lowercase().ends_with(e))
    }
    pub fn from_value(v: &Value) -> Option<Self> {
        let f = |k: &str, d: f64| number(&v[k]).unwrap_or(d).clamp(0., 1.);
        Some(Self {
            file_path: text(first(v, &["filePath", "file_path", "path"]), 512)?,
            x: f("x", 0.5),
            y: f("y", 0.5),
            scale: f("scale", 0.25),
            opacity: f("opacity", 1.),
            mime_type: text(first(v, &["mimeType", "mime_type"]), 512),
            chroma_key: WatermarkChromaKey::from_value(first(v, &["chromaKey", "chroma_key"])),
        })
    }
}
tolerant!(Watermark, Watermark::from_value);
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outro {
    pub file_path: String,
    pub duration_sec: Option<f64>,
}
impl Outro {
    pub fn from_value(v: &Value) -> Option<Self> {
        Some(Self {
            file_path: text(first(v, &["filePath", "file_path", "path"]), 512)?,
            duration_sec: number(first(v, &["durationSec", "duration_sec"])).filter(|n| *n > 0.),
        })
    }
}
tolerant!(Outro, Outro::from_value);
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualRange {
    pub start: f64,
    pub end: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hook_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_timeline: Option<Vec<SplitScreenSegment>>,
}
impl ManualRange {
    fn from_value(v: &Value) -> Option<Self> {
        v.as_object()?;
        Some(Self {
            start: number(&v["start"]).unwrap_or_default(),
            end: number(&v["end"]).unwrap_or_default(),
            title: text(&v["title"], 70),
            reason: text(&v["reason"], 200),
            hook_text: text(first(v, &["hookText", "hook_text"]), 80).map(|s| s.trim_end().into()),
            split_timeline: serde_json::from_value(
                first(v, &["splitTimeline", "split_timeline"]).clone(),
            )
            .ok(),
        })
    }
}
tolerant!(ManualRange, ManualRange::from_value);
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobParams {
    pub clip_count: usize,
    pub target_duration_sec: f64,
}
impl Default for JobParams {
    fn default() -> Self {
        Self {
            clip_count: 3,
            target_duration_sec: 45.,
        }
    }
}
impl JobParams {
    fn from_value(v: &Value) -> Self {
        Self {
            clip_count: (number(first(v, &["clipCount", "clip_count"])).unwrap_or(3.) as usize)
                .max(1),
            target_duration_sec: number(first(v, &["targetDurationSec", "target_duration_sec"]))
                .unwrap_or(45.)
                .max(1.),
        }
    }
}
tolerant!(JobParams, |v| Some(JobParams::from_value(v)));

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptSource {
    #[default]
    Youtube,
    Auto,
    LiveChatStt,
}

impl TranscriptSource {
    fn from_value(value: &Value) -> Self {
        match value
            .as_str()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "auto" => Self::Auto,
            "live_chat_stt" => Self::LiveChatStt,
            _ => Self::Youtube,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobData {
    pub job_id: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_source: Option<PrimaryMediaSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_screen: Option<SplitScreenConfig>,
    pub mode: JobMode,
    pub reframe: ReframeMode,
    pub captions: bool,
    pub two_speakers: bool,
    pub facecam: bool,
    pub aspect_ratio: AspectRatio,
    pub caption_language: String,
    pub transcript_source: TranscriptSource,
    pub custom_hashtags: Vec<String>,
    pub max_source_sec: Option<u32>,
    pub description: Option<String>,
    pub params: JobParams,
    pub ranges: Vec<ManualRange>,
    pub caption_style: Option<CaptionStyle>,
    pub watermark: Option<Watermark>,
    pub watermarks: Vec<Watermark>,
    pub outro: Option<Outro>,
    pub hook_banner: bool,
    pub normalize_audio: bool,
}
impl Default for JobData {
    fn default() -> Self {
        Self {
            job_id: String::new(),
            url: String::new(),
            primary_source: None,
            split_screen: None,
            mode: JobMode::Auto,
            reframe: ReframeMode::default(),
            captions: true,
            two_speakers: false,
            facecam: false,
            aspect_ratio: AspectRatio::Portrait,
            caption_language: "auto".into(),
            transcript_source: TranscriptSource::default(),
            custom_hashtags: vec![],
            max_source_sec: None,
            description: None,
            params: JobParams::default(),
            ranges: vec![],
            caption_style: None,
            watermark: None,
            watermarks: vec![],
            outro: None,
            hook_banner: false,
            normalize_audio: true,
        }
    }
}
impl JobData {
    pub fn from_json(v: Value) -> Result<Self> {
        if !v.is_object() {
            bail!("data job harus object");
        }
        let get = |k: &[&str]| first(&v, k);
        let required = |keys: &[&str]| {
            get(keys)
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| anyhow!("{} wajib diisi", keys[0]))
        };
        let parse_enum = |key: &str, d: &str| {
            let raw = &v[key];
            if raw.is_null() {
                d.to_owned()
            } else {
                raw.as_str()
                    .map(|s| s.trim().to_lowercase())
                    .unwrap_or_else(|| raw.to_string())
            }
        };
        let mode = match parse_enum("mode", "auto").as_str() {
            "auto" => JobMode::Auto,
            "manual" => JobMode::Manual,
            s => bail!("mode tidak dikenal: {s:?} (pakai auto/manual)"),
        };
        let reframe = match parse_enum("reframe", "center_crop").as_str() {
            "center_crop" => ReframeMode::CenterCrop,
            "face_tracking" => ReframeMode::FaceTracking,
            "black_bars" => ReframeMode::BlackBars,
            "blurred_fill" => ReframeMode::BlurredFill,
            s => bail!(
                "reframe tidak dikenal: {s:?} (center_crop/face_tracking/black_bars/blurred_fill)"
            ),
        };
        let list = |v: &Value| {
            v.as_array()
                .into_iter()
                .flatten()
                .filter_map(Watermark::from_value)
                .take(WATERMARK_MAX_PER_JOB)
                .collect::<Vec<_>>()
        };
        let mut watermarks = list(&v["watermarks"]);
        if watermarks.is_empty() {
            watermarks = list(&v["watermark"]);
            if watermarks.is_empty() {
                watermarks.extend(Watermark::from_value(&v["watermark"]));
            }
        }
        Ok(Self {
            job_id: required(&["jobId", "job_id"])?,
            url: payload_url(&v, false).ok_or_else(|| anyhow!("url wajib diisi"))?,
            primary_source: primary_source(&v),
            split_screen: serde_json::from_value(get(&["splitScreen", "split_screen"]).clone())?,
            mode,
            reframe,
            captions: boolean(&v["captions"], true),
            two_speakers: boolean(get(&["twoSpeakers", "two_speakers"]), false),
            facecam: boolean(&v["facecam"], false),
            aspect_ratio: serde_json::from_value(Value::String(
                get(&["aspectRatio", "aspect_ratio"])
                    .as_str()
                    .unwrap_or("")
                    .trim()
                    .into(),
            ))
            .unwrap_or_default(),
            caption_language: to_caption_language(get(&["captionLanguage", "caption_language"])),
            transcript_source: TranscriptSource::from_value(get(&[
                "transcriptSource",
                "transcript_source",
            ])),
            custom_hashtags: to_custom_hashtags(get(&["customHashtags", "custom_hashtags"])),
            max_source_sec: max_source(get(&["maxSourceSec", "max_source_sec"])),
            description: text(&v["description"], 500),
            params: JobParams::from_value(&v["params"]),
            ranges: v["ranges"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(ManualRange::from_value)
                .collect(),
            caption_style: CaptionStyle::from_value(get(&["captionStyle", "caption_style"])),
            watermark: watermarks.first().cloned(),
            watermarks,
            outro: Outro::from_value(&v["outro"]),
            hook_banner: boolean(get(&["hookBanner", "hook_banner"]), false),
            normalize_audio: boolean(get(&["normalizeAudio", "normalize_audio"]), true),
        })
    }
}
impl<'de> Deserialize<'de> for JobData {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Self::from_json(Value::deserialize(d)?).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WordTiming {
    pub start: f64,
    pub end: f64,
    pub text: String,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TranscriptCue {
    pub start: f64,
    pub end: f64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<WordTiming>,
}
impl TranscriptCue {
    pub fn duration(&self) -> f64 {
        (self.end - self.start).max(0.)
    }
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Moment {
    pub start: f64,
    pub end: f64,
    pub title: String,
    #[serde(default)]
    pub reason: String,
    #[serde(alias = "viral_score", skip_serializing_if = "Option::is_none")]
    pub viral_score: Option<u32>,
    #[serde(alias = "hook_text", skip_serializing_if = "Option::is_none")]
    pub hook_text: Option<String>,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PlatformCaption {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub caption: String,
    pub hashtags: Vec<String>,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PlatformCaptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub youtube: Option<PlatformCaption>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tiktok: Option<PlatformCaption>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instagram: Option<PlatformCaption>,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipResult {
    pub title: String,
    #[serde(serialize_with = "rounded::<2,_>")]
    pub start: f64,
    #[serde(serialize_with = "rounded::<2,_>")]
    pub end: f64,
    pub file: String,
    #[serde(skip_serializing_if = "empty_option")]
    pub caption: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hashtags: Vec<String>,
    #[serde(serialize_with = "transcript", skip_serializing_if = "no_transcript")]
    pub transcript: Option<String>,
    #[serde(alias = "viral_score", skip_serializing_if = "Option::is_none")]
    pub viral_score: Option<u32>,
    #[serde(alias = "hook_text", skip_serializing_if = "Option::is_none")]
    pub hook_text: Option<String>,
    #[serde(alias = "platform_captions", skip_serializing_if = "Option::is_none")]
    pub platform_captions: Option<PlatformCaptions>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JobProgress {
    pub stage: String,
    #[serde(serialize_with = "percent")]
    pub percent: f64,
    #[serde(default, skip_serializing_if = "empty")]
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clip: Option<ClipResult>,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct JobResult {
    pub clips: Vec<ClipResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameRequest {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_source: Option<PrimaryMediaSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_screen: Option<SplitScreenConfig>,
    pub at_sec: f64,
    pub out_path: String,
    pub aspect_ratio: AspectRatio,
    pub reframe: ReframeMode,
    pub two_speakers: bool,
    pub facecam: bool,
    pub captions: bool,
    pub caption_sample: String,
    pub hook_banner: bool,
    pub caption_style: Option<CaptionStyle>,
}
fn truthy(v: &Value) -> bool {
    match v {
        Value::String(s) => !s.is_empty(),
        _ => boolean(v, false),
    }
}
tolerant!(FrameRequest, |v: &Value| {
    let get = |keys: &[&str]| first(v, keys);
    let at_sec = number(get(&["atSec", "at_sec"])).filter(|n| *n >= 0.)?;
    let url = payload_url(v, true)?;
    let out_path = get(&["outPath", "out_path"])
        .as_str()
        .filter(|s| !s.is_empty())?
        .into();
    let aspect_ratio =
        serde_json::from_value(get(&["aspectRatio", "aspect_ratio"]).clone()).ok()?;
    Some(Self {
        url,
        primary_source: primary_source(v),
        split_screen: serde_json::from_value(get(&["splitScreen", "split_screen"]).clone()).ok()?,
        at_sec,
        out_path,
        aspect_ratio,
        reframe: serde_json::from_value(v["reframe"].clone()).unwrap_or_default(),
        two_speakers: truthy(get(&["twoSpeakers", "two_speakers"])),
        facecam: truthy(&v["facecam"]),
        captions: truthy(&v["captions"]),
        caption_sample: get(&["captionSample", "caption_sample"])
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("Sample caption")
            .into(),
        hook_banner: boolean(get(&["hookBanner", "hook_banner"]), false),
        caption_style: CaptionStyle::from_value(get(&["captionStyle", "caption_style"])),
    })
});
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameResult {
    pub file: String,
    pub width: u32,
    pub height: u32,
    #[serde(alias = "at_sec")]
    pub at_sec: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRequest {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_source: Option<PrimaryMediaSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_screen: Option<SplitScreenConfig>,
    #[serde(flatten)]
    pub params: JobParams,
    pub description: Option<String>,
    pub max_source_sec: Option<u32>,
    pub transcript_source: TranscriptSource,
    pub caption_language: String,
}
tolerant!(PreviewRequest, |v: &Value| Some(Self {
    url: payload_url(v, false)?,
    primary_source: primary_source(v),
    split_screen: serde_json::from_value(first(v, &["splitScreen", "split_screen"]).clone())
        .ok()?,
    params: JobParams::from_value(v),
    description: text(&v["description"], 500),
    max_source_sec: max_source(first(v, &["maxSourceSec", "max_source_sec"])),
    transcript_source: TranscriptSource::from_value(first(
        v,
        &["transcriptSource", "transcript_source"]
    )),
    caption_language: to_caption_language(first(v, &["captionLanguage", "caption_language"])),
}));
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub candidates: Vec<PreviewCandidate>,
    pub cues: Vec<TranscriptCue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub broll_summaries: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PreviewCandidate {
    #[serde(flatten)]
    pub moment: Moment,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_timeline: Option<Vec<SplitScreenSegment>>,
}

pub type PreviewJobData = PreviewRequest;
pub type FrameJobData = FrameRequest;
pub type PreviewJobResult = PreviewResult;
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionRequest {
    pub title: String,
    pub transcript: Option<String>,
    pub current_caption: Option<String>,
    pub description: Option<String>,
    pub language: String,
    pub custom_hashtags: Vec<String>,
}
impl Default for CaptionRequest {
    fn default() -> Self {
        Self::from_value(&Value::Null)
    }
}
impl CaptionRequest {
    pub fn from_value(v: &Value) -> Self {
        let clean = |keys: &[&str], n| text(first(v, keys), n).map(|s| s.trim().to_owned());
        Self {
            title: clean(&["title"], 200).unwrap_or_default(),
            transcript: clean(&["transcript"], CLIP_TRANSCRIPT_MAX),
            current_caption: clean(&["currentCaption", "current_caption"], 2200),
            description: clean(&["description"], 500),
            language: to_caption_language(&v["language"]),
            custom_hashtags: to_custom_hashtags(first(v, &["customHashtags", "custom_hashtags"])),
        }
    }
}
tolerant!(CaptionRequest, |v| Some(CaptionRequest::from_value(v)));
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionResult {
    pub caption: String,
    #[serde(default)]
    pub hashtags: Vec<String>,
    #[serde(alias = "platform_captions", skip_serializing_if = "Option::is_none")]
    pub platform_captions: Option<PlatformCaptions>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn split_screen_payloads_match_shared_wire_contract() {
        let raw = json!({"jobId":"j","primarySource":{"kind":"upload","mediaId":"m","filePath":"media/example.mp4","durationSec":null},"splitScreen":{"enabled":true,"ratio":"40:60","swap":true,"primaryFit":"contain_blur","clips":[{"id":"b1","kind":"clip","clipId":"c1","label":"Crowd","description":null}]},"atSec":1,"outPath":".frames/test.jpg","aspectRatio":"9:16","ranges":[{"start":0,"end":4,"splitTimeline":[{"atStart":0,"atEnd":4,"clipId":"b1"}]}]});
        let job = JobData::from_json(raw.clone()).unwrap();
        let preview: PreviewJobData = serde_json::from_value(raw.clone()).unwrap();
        let frame: FrameJobData = serde_json::from_value(raw).unwrap();
        assert_eq!(preview.primary_source, job.primary_source);
        assert_eq!(frame.split_screen, job.split_screen);
        let wire = serde_json::to_value(job).unwrap();
        assert_eq!(wire["primarySource"]["filePath"], "media/example.mp4");
        assert_eq!(wire["splitScreen"]["ratio"], "40:60");
        assert_eq!(wire["splitScreen"]["primaryFit"], "contain_blur");
        assert_eq!(wire["splitScreen"]["matchMode"], "auto");
        assert_eq!(wire["ranges"][0]["splitTimeline"][0]["clipId"], "b1");
        let result = json!({"candidates":[{"start":0.,"end":4.,"title":"example","reason":"example","splitTimeline":[{"atStart":0.,"atEnd":4.,"clipId":"b1"}]}],"cues":[],"brollSummaries":{"b1":"The crowd cheers."}});
        let decoded: PreviewJobResult = serde_json::from_value(result.clone()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), result);
        let old: PreviewJobResult =
            serde_json::from_value(json!({"candidates":[],"cues":[]})).unwrap();
        assert!(old.broll_summaries.is_none());
    }

    #[test]
    fn job_tolerates_aliases_and_canonicalizes_watermarks() {
        let j:JobData=serde_json::from_value(json!({"job_id":"test","url":"local","mode":" MANUAL ","reframe":"black_bars","aspectRatio":"unknown","normalize_audio":"off","twoSpeakers":"no","params":{"clip_count":"0","targetDurationSec":0},"max_source_sec":"60.9","watermark":[null,{"file_path":" Test.MOV ","x":2,"opacity":"nan","chroma_key":{"similarity":0,"blend":4}}],"customHashtags":" #Bola, BOla #a-b café"})).unwrap();
        assert_eq!(j.mode, JobMode::Manual);
        assert_eq!(j.aspect_ratio.output_size(), (1080, 1920));
        assert!(!j.normalize_audio && !j.two_speakers && j.captions);
        assert_eq!(j.max_source_sec, Some(60));
        assert_eq!(j.params.clip_count, 1);
        assert_eq!(j.params.target_duration_sec, 1.);
        assert_eq!(j.custom_hashtags, ["Bola", "ab", "café"]);
        let wm = j.watermark.as_ref().unwrap();
        assert_eq!(j.watermarks[0], *wm);
        assert!(wm.is_video());
        assert_eq!((wm.x, wm.opacity), (1., 1.));
        assert_eq!(wm.chroma_key.as_ref().unwrap().similarity, 0.01);
        assert_eq!(wm.chroma_key.as_ref().unwrap().blend, 0.5);
    }
    #[test]
    fn job_reframe_defaults_to_center_crop_and_accepts_all_modes() {
        let mut raw = json!({"jobId":"test","url":"local"});
        assert_eq!(JobData::default().reframe, ReframeMode::CenterCrop);
        assert_eq!(
            JobData::from_json(raw.clone()).unwrap().reframe,
            ReframeMode::CenterCrop
        );
        for (value, mode) in [
            ("center_crop", ReframeMode::CenterCrop),
            ("face_tracking", ReframeMode::FaceTracking),
            ("black_bars", ReframeMode::BlackBars),
            ("blurred_fill", ReframeMode::BlurredFill),
        ] {
            raw["reframe"] = json!(value);
            let job = JobData::from_json(raw.clone()).unwrap();
            assert_eq!(job.reframe, mode);
            assert_eq!(serde_json::to_value(job).unwrap()["reframe"], value);
        }
    }
    #[test]
    fn caption_preset_is_recomputed() {
        let s: CaptionStyle = serde_json::from_value(
            json!({"preset":"neon","font_size":200,"position_y":0,"primaryColor":"#aaccee"}),
        )
        .unwrap();
        assert_eq!(s.font_size, 120);
        assert_eq!(s.position_y, Some(0.05));
        assert_eq!(s.primary_color, "#AACCEE");
        assert_eq!(s.preset, "custom");
        for p in ["hook", "beast", "boxed", "neon", "cinema"] {
            let s = CaptionStyle::from_preset(p);
            assert_eq!(
                serde_json::from_value::<CaptionStyle>(serde_json::to_value(&s).unwrap()).unwrap(),
                s
            );
        }
    }
    #[test]
    fn progress_and_clip_wire_shape() {
        let p = JobProgress {
            stage: "render".into(),
            percent: 150.,
            message: String::new(),
            clip: Some(ClipResult {
                title: "Title".into(),
                start: 1.236,
                end: 3.242,
                file: "clip-01.mp4".into(),
                transcript: Some("  words  ".into()),
                ..Default::default()
            }),
        };
        assert_eq!(
            serde_json::to_value(p).unwrap(),
            json!({"stage":"render","percent":100.,"clip":{"title":"Title","start":1.24,"end":3.24,"file":"clip-01.mp4","transcript":"words"}})
        );
    }
}

#[cfg(test)]
mod transcript_source_tests {
    use super::*;
    #[test]
    fn payloads_accept_both_keys_default_and_serialize_camel_case() {
        for (key, value, expected) in [
            ("transcriptSource", "auto", TranscriptSource::Auto),
            (
                "transcript_source",
                " LIVE_CHAT_STT ",
                TranscriptSource::LiveChatStt,
            ),
            (
                "transcript_source",
                "unsupported",
                TranscriptSource::Youtube,
            ),
            ("irrelevant", "auto", TranscriptSource::Youtube),
        ] {
            let raw = serde_json::json!({"jobId":"a", "url":"https://example.com", (key):value, "caption_language":"id"});
            let job = JobData::from_json(raw.clone()).unwrap();
            let preview: PreviewRequest = serde_json::from_value(raw).unwrap();
            assert_eq!(job.transcript_source, expected);
            assert_eq!(preview.transcript_source, expected);
            assert_eq!(preview.caption_language, "id");
            let serialized = serde_json::to_value(expected).unwrap();
            assert_eq!(
                serde_json::to_value(job).unwrap()["transcriptSource"],
                serialized
            );
            assert_eq!(
                serde_json::to_value(preview).unwrap()["transcriptSource"],
                serialized
            );
        }
        assert_eq!(TranscriptSource::default(), TranscriptSource::Youtube);
        assert_eq!(
            serde_json::to_value(TranscriptSource::LiveChatStt).unwrap(),
            "live_chat_stt"
        );
    }
}
