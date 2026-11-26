use std::path::Path;

use anyhow::{ensure, Result};
use image::RgbImage;

use crate::{
    detector::{FaceBox, OnnxFaceDetector},
    frames::{probe_video, seek_frame, FrameSampler, VideoInfo},
    shot_cut::{luma, ShotCutDetector},
};

const SAMPLE_FPS: f64 = 5.0;
const MAX_SAMPLES: usize = 1200;
const MAX_FACES: usize = 4;
const MIN_FACE_HEIGHT: f32 = 0.03;
const MIN_SPEAKER_SEPARATION: f64 = 0.08;
const PORTRAIT_ASPECT: f64 = 9.0 / 16.0;
const MIN_HOLD_SEC: f64 = 0.9;
const DRIFT_CUT: f64 = 0.08;
const DRIFT_HOLD_SEC: f64 = 0.5;
const MISSING_TTL_SEC: f64 = 1.0;
const MAX_SEGMENTS: usize = 80;
const SHOT_NO_FACE_GRACE_SEC: f64 = 0.4;
const SAME_X_EPS: f64 = 0.02;
const MOTION_ALPHA: f64 = 0.5;
const SWITCH_MARGIN: f64 = 1.25;
const SPEECH_FLOOR: f64 = 0.003;
const EPS: f64 = 1e-6;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TrackSegment {
    /// Start time in seconds relative to the requested clip window.
    pub start: f64,
    /// Horizontal crop center normalized against the source width.
    pub center_x: f64,
}

#[derive(Clone, Copy)]
struct Observation {
    bbox: FaceBox,
    mouth: [f64; 18],
}

impl Observation {
    fn new(rgb: &RgbImage, bbox: FaceBox) -> Self {
        // Sample a normalized 6x3 patch around the lower center of each
        // face. Remove DC so a lighting change alone isn't mouth motion.
        let mut mouth = std::array::from_fn(|i| {
            let x = bbox.x + bbox.w * (0.27 + (i % 6) as f32 * 0.092);
            let y = bbox.y + bbox.h * (0.66 + (i / 6) as f32 * 0.075);
            let px = ((x * rgb.width() as f32) as u32).min(rgb.width() - 1);
            let py = ((y * rgb.height() as f32) as u32).min(rgb.height() - 1);
            let [r, g, b] = rgb.get_pixel(px, py).0.map(f64::from);
            luma(r, g, b) / 255.0
        });
        let mean = mouth.iter().sum::<f64>() / mouth.len() as f64;
        mouth.iter_mut().for_each(|v| *v -= mean);
        Self { bbox, mouth }
    }

    fn x(self) -> f64 {
        f64::from(self.bbox.cx())
    }
}

struct SpeakerFrame {
    t: f64,
    cut: bool,
    faces: Vec<Observation>,
}

fn speaker_frames(path: &Path, start: f64, end: f64) -> Result<(Vec<SpeakerFrame>, f64)> {
    let info = probe_video(path)?;
    ensure!(end.is_finite(), "invalid video end timestamp");
    let end = end.min(info.duration);
    let detector = OnnxFaceDetector::new()?;
    let mut cuts = ShotCutDetector::new();
    let mut frames = Vec::new();
    let step = (info.fps / SAMPLE_FPS).round().max(1.0) as usize;
    for (i, decoded) in FrameSampler::new(path, info, start, end, info.fps)?.enumerate() {
        let frame = decoded?;
        let cut = cuts.push(frame.time, &frame.rgb);
        if i % step == 0 || cut {
            let faces = detector
                .detect(&frame.rgb)?
                .into_iter()
                .filter(|b| b.h >= MIN_FACE_HEIGHT)
                .take(MAX_FACES)
                .map(|b| Observation::new(&frame.rgb, b))
                .collect();
            frames.push(SpeakerFrame {
                t: frame.time,
                cut,
                faces,
            });
            if frames.len() >= MAX_SAMPLES {
                break;
            }
        }
    }
    Ok((
        frames,
        (PORTRAIT_ASPECT * f64::from(info.height) / f64::from(info.width)).min(1.0),
    ))
}

/// Follow speakers in a portrait crop. Unreadable/faceless windows fall back to center.
pub fn track_active_speaker(
    video_path: impl AsRef<Path>,
    start: f64,
    end: f64,
) -> Vec<TrackSegment> {
    try_track_active_speaker(video_path, start, end).unwrap_or_else(|_| vec![center_segment()])
}

/// Fallible version of [`track_active_speaker`] for callers that log processing failures.
pub fn try_track_active_speaker(
    video_path: impl AsRef<Path>,
    start: f64,
    end: f64,
) -> Result<Vec<TrackSegment>> {
    let (frames, crop_width) = speaker_frames(video_path.as_ref(), start, end)?;
    Ok(select_segments(&frames, crop_width))
}

/// Cluster all observed face centers into the left and right speaker positions.
pub fn detect_two_speakers(
    video_path: impl AsRef<Path>,
    start: f64,
    end: f64,
) -> Option<(f64, f64)> {
    let (frames, _) = speaker_frames(video_path.as_ref(), start, end).ok()?;
    two_means(
        &frames
            .iter()
            .flat_map(|f| f.faces.iter().map(|o| o.x()))
            .collect::<Vec<_>>(),
    )
}

fn two_means(xs: &[f64]) -> Option<(f64, f64)> {
    let mut left = xs.iter().copied().reduce(f64::min)?;
    let mut right = xs.iter().copied().reduce(f64::max)?;
    if right - left < MIN_SPEAKER_SEPARATION {
        return None;
    }
    for _ in 0..20 {
        let (mut sums, mut counts) = ([0.0; 2], [0; 2]);
        for &x in xs {
            let g = usize::from((x - left).abs() > (x - right).abs());
            sums[g] += x;
            counts[g] += 1;
        }
        if counts.contains(&0) {
            return None;
        }
        let next = (
            sums[0] / f64::from(counts[0]),
            sums[1] / f64::from(counts[1]),
        );
        if next == (left, right) {
            break;
        }
        (left, right) = next;
    }
    (right - left >= MIN_SPEAKER_SEPARATION).then_some((left, right))
}

struct Track {
    id: usize,
    obs: Observation,
    score: f64,
    seen: f64,
}

impl Track {
    fn update(&mut self, obs: Observation, t: f64) {
        let motion = self
            .obs
            .mouth
            .iter()
            .zip(obs.mouth)
            .map(|(a, b)| (a - b).abs())
            .sum::<f64>()
            / obs.mouth.len() as f64;
        self.score = MOTION_ALPHA * motion + (1.0 - MOTION_ALPHA) * self.score;
        self.obs = obs;
        self.seen = t;
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Cut,
    Switch,
    Drift,
}

type Segment = (TrackSegment, Kind);

fn append(segments: &mut Vec<Segment>, start: f64, center_x: f64, kind: Kind) {
    segments.push((TrackSegment { start, center_x }, kind));
}

fn center_segment() -> TrackSegment {
    TrackSegment {
        start: 0.0,
        center_x: 0.5,
    }
}

fn select_segments(frames: &[SpeakerFrame], crop_width: f64) -> Vec<TrackSegment> {
    let (mut tracks, mut segments) = (Vec::<Track>::new(), Vec::new());
    let (mut active, mut next_id, mut group) = (None, 0, false);
    let (mut current_x, mut last_change, mut shot_start, mut resolved) = (0.5, 0.0, 0.0, true);
    for (i, frame) in frames.iter().enumerate() {
        let t = frame.t;
        if i == 0 || frame.cut {
            if !resolved {
                append(&mut segments, shot_start, 0.5, Kind::Cut);
            }
            tracks.clear();
            active = None;
            group = false;
            last_change = t;
            shot_start = t;
            resolved = false;
        }

        let mut pending = std::mem::take(&mut tracks);
        pending.retain(|track| t - track.seen <= 2.0 * MISSING_TTL_SEC);
        for track in &mut pending {
            track.score *= 0.8;
        }
        for &obs in &frame.faces {
            let closest = pending
                .iter()
                .enumerate()
                .map(|(i, track)| (i, (track.obs.x() - obs.x()).abs()))
                .min_by(|a, b| a.1.total_cmp(&b.1));
            let track = if let Some((idx, _)) = closest.filter(|&(_, d)| d <= 0.18) {
                let mut track = pending.remove(idx);
                // An expired identity must not acquire misleading motion across the gap.
                if t - track.seen > MISSING_TTL_SEC {
                    track.id = next_id;
                    next_id += 1;
                    track.obs = obs;
                    track.score = 0.0;
                    track.seen = t;
                } else {
                    track.update(obs, t);
                }
                track
            } else {
                next_id += 1;
                Track {
                    id: next_id - 1,
                    obs,
                    score: 0.0,
                    seen: t,
                }
            };
            tracks.push(track);
        }
        tracks.extend(pending);
        let visible: Vec<_> = tracks
            .iter()
            .filter(|tr| t - tr.seen <= MISSING_TTL_SEC)
            .collect();
        if visible.is_empty() {
            if !resolved && t - shot_start >= SHOT_NO_FACE_GRACE_SEC - EPS {
                append(&mut segments, shot_start, 0.5, Kind::Cut);
                current_x = 0.5;
                resolved = true;
            }
            continue;
        }

        let current = visible.iter().copied().find(|tr| Some(tr.id) == active);
        if let Some(current) = current {
            let candidate = visible
                .iter()
                .copied()
                .max_by(|a, b| {
                    a.score
                        .total_cmp(&b.score)
                        .then_with(|| a.obs.bbox.h.total_cmp(&b.obs.bbox.h))
                })
                .unwrap();
            let hold = t - last_change;
            let switch = if group {
                candidate.score > SPEECH_FLOOR && (candidate.obs.x() - current_x).abs() > DRIFT_CUT
            } else {
                candidate.id != current.id
                    && candidate.score > SPEECH_FLOOR.max(current.score * SWITCH_MARGIN)
            };
            if switch && hold >= MIN_HOLD_SEC - EPS {
                active = Some(candidate.id);
                group = false;
                current_x = candidate.obs.x();
                last_change = t;
                append(&mut segments, t, current_x, Kind::Switch);
            } else if !group
                && (current.obs.x() - current_x).abs() > DRIFT_CUT
                && hold >= DRIFT_HOLD_SEC - EPS
            {
                current_x = current.obs.x();
                last_change = t;
                append(&mut segments, t, current_x, Kind::Drift);
            }
        } else {
            let largest = visible
                .iter()
                .max_by(|a, b| a.obs.bbox.h.total_cmp(&b.obs.bbox.h))
                .unwrap();
            let (lo, hi) = visible.iter().fold((1.0f64, 0.0f64), |(lo, hi), tr| {
                (lo.min(tr.obs.x()), hi.max(tr.obs.x()))
            });
            group = visible.len() > 1 && hi - lo <= crop_width;
            current_x = if group {
                (lo + hi) * 0.5
            } else {
                largest.obs.x()
            };
            last_change = if resolved { t } else { shot_start };
            let kind = if !resolved || active.is_none() {
                Kind::Cut
            } else {
                Kind::Switch
            };
            append(&mut segments, last_change, current_x, kind);
            resolved = true;
            active = Some(largest.id);
        }
    }
    // A final shot can end before the no-face grace timer fires.
    if !resolved {
        append(&mut segments, shot_start, 0.5, Kind::Cut);
    }
    normalize(segments)
}

fn normalize(segments: Vec<Segment>) -> Vec<TrackSegment> {
    let mut merged = Vec::<Segment>::new();
    for item in segments {
        let min_gap = match item.1 {
            Kind::Cut => 0.0,
            Kind::Switch => MIN_HOLD_SEC,
            Kind::Drift => DRIFT_HOLD_SEC,
        };
        if merged
            .last()
            .is_none_or(|prev| item.0.start - prev.0.start >= min_gap - EPS)
        {
            merged.push(item);
        }
    }
    let mut deduped = Vec::<Segment>::new();
    for item in merged {
        if deduped
            .last()
            .is_none_or(|prev| (item.0.center_x - prev.0.center_x).abs() >= SAME_X_EPS)
        {
            deduped.push(item);
        }
    }
    while deduped.len() > MAX_SEGMENTS {
        let shortest = (1..deduped.len())
            .min_by(|&i, &j| {
                (deduped[i].1 == Kind::Cut)
                    .cmp(&(deduped[j].1 == Kind::Cut))
                    .then_with(|| {
                        (deduped[i].0.start - deduped[i - 1].0.start)
                            .total_cmp(&(deduped[j].0.start - deduped[j - 1].0.start))
                    })
            })
            .unwrap();
        deduped.remove(shortest);
    }
    if deduped.is_empty() {
        return vec![center_segment()];
    }
    deduped[0].0.start = 0.0;
    deduped.into_iter().map(|s| s.0).collect()
}

pub const FACECAM_PANEL_W: u32 = 1080;
pub const FACECAM_PANEL_H: u32 = 840;
pub const FACECAM_FACE_Y: f64 = 0.72;
pub const FACECAM_MIN_FACE_SCALE: f64 = 2.2;
pub const FACECAM_FULLSCREEN_MAX_H: f32 = 0.24;
const FACECAM_MIN_PANEL_H: f64 = 64.0;
const FACECAM_FACE_SCALE: f64 = 3.0;
const VERIFY_SAMPLES: usize = 5;
const KEYFRAMES: usize = 6;
const REFINE_SAMPLES: usize = 30;

/// Source pixel rectangle `(x, y, width, height)`.
pub type FacecamBox = (u32, u32, u32, u32);

/// Verify a cached panel before reusing it; otherwise rescan this clip window.
pub fn detect_facecam_box(
    video_path: impl AsRef<Path>,
    start: f64,
    end: f64,
    cached_box: Option<FacecamBox>,
) -> Option<FacecamBox> {
    try_detect_facecam_box(video_path, start, end, cached_box)
        .ok()
        .flatten()
}

pub fn try_detect_facecam_box(
    video_path: impl AsRef<Path>,
    start: f64,
    end: f64,
    cached_box: Option<FacecamBox>,
) -> Result<Option<FacecamBox>> {
    let scan = FacecamScan::new(video_path.as_ref(), start, end)?;
    if let Some(cached) = cached_box {
        match scan.verify(cached)? {
            CacheStatus::Matches => return Ok(Some(cached)),
            CacheStatus::Fullscreen => return Ok(None),
            CacheStatus::Mismatch => {} // stale box: rescan the window
        }
    }
    scan.rescan()
}

pub fn facecam_box_matches_window(
    video_path: impl AsRef<Path>,
    start: f64,
    end: f64,
    cached_box: FacecamBox,
) -> bool {
    matches!(
        FacecamScan::new(video_path.as_ref(), start, end).and_then(|scan| scan.verify(cached_box)),
        Ok(CacheStatus::Matches)
    )
}

enum CacheStatus {
    Matches,
    Fullscreen,
    Mismatch,
}

struct FacecamScan<'a> {
    path: &'a Path,
    info: VideoInfo,
    detector: OnnxFaceDetector,
    start: f64,
    end: f64,
}

impl<'a> FacecamScan<'a> {
    fn new(path: &'a Path, start: f64, end: f64) -> Result<Self> {
        let info = probe_video(path)?;
        ensure!(end.is_finite(), "invalid facecam end timestamp");
        let end = end.min(info.duration);
        ensure!(
            start.is_finite() && start >= 0.0 && end > start,
            "invalid facecam window"
        );
        Ok(Self {
            path,
            info,
            detector: OnnxFaceDetector::new()?,
            start,
            end,
        })
    }

    fn sample(&self, count: usize) -> impl Iterator<Item = Result<RgbImage>> + '_ {
        let duration = self.end - self.start;
        let step = (duration / count as f64).max(1.0 / self.info.fps);
        (0..count)
            .map(move |i| self.start + i as f64 * step)
            .take_while(move |&t| t < self.end)
            .filter_map(|t| seek_frame(self.path, self.info, t).transpose())
    }

    fn verify(&self, cached: FacecamBox) -> Result<CacheStatus> {
        let mut evidence = Evidence::default();
        let region = project_region(
            cached,
            (self.info.width, self.info.height),
            self.info.proxy_dimensions(),
        );
        for rgb in self.sample(VERIFY_SAMPLES) {
            let rgb = rgb?;
            let full_faces = self.detector.detect(&rgb)?;
            let full = is_fullscreen(&full_faces);
            let small = match region {
                Some(region) if !full => self
                    .detector
                    .detect_region(&rgb, region)?
                    .into_iter()
                    .any(|b| {
                        fits_cached_panel(b, region, rgb.dimensions())
                            && !full_faces.iter().any(|&upper| is_chest_graphic(upper, b))
                    }),
                _ => false,
            };
            evidence.observe(full, small);
        }
        Ok(if majority(evidence.full, evidence.total) {
            CacheStatus::Fullscreen
        } else if evidence.accepts() {
            CacheStatus::Matches
        } else {
            CacheStatus::Mismatch
        })
    }

    fn rescan(&self) -> Result<Option<FacecamBox>> {
        let mut keyframes = Vec::new();
        let mut full_hits = 0;
        for rgb in self.sample(KEYFRAMES) {
            let rgb = rgb?;
            let faces = self.detector.detect(&rgb)?;
            full_hits += usize::from(is_fullscreen(&faces));
            keyframes.push((rgb, faces));
        }
        if keyframes.len() < 2 || majority(full_hits, keyframes.len()) {
            return Ok(None);
        }

        let mut candidates = Vec::new();
        for (id, (rgb, full)) in keyframes.iter().enumerate() {
            // Truncated detections from the tiles of a fullscreen scene are
            // not allowed to vote for a small facecam candidate.
            if is_fullscreen(full) {
                continue;
            }
            candidates.extend(
                full.iter()
                    .copied()
                    .filter(|&b| is_small(b))
                    .map(|b| (id, b)),
            );
            for tile in tiles(rgb.dimensions()) {
                candidates.extend(
                    self.detector
                        .detect_region(rgb, tile)?
                        .into_iter()
                        .filter(|&b| is_small(b))
                        .map(|b| (id, b)),
                );
            }
        }
        let Some(candidate) = stable_candidate(&candidates, keyframes.len()) else {
            return Ok(None);
        };
        let (w, h) = self.info.proxy_dimensions();
        let face_px = (candidate.h * h as f32).max(1.0);
        let rw = w.min(((face_px * 6.0).round() as u32).max(80));
        let rh = h.min(((face_px * 4.0).round() as u32).max(60));
        let region = (
            offset(candidate.cx(), w, rw),
            offset(candidate.cy(), h, rh),
            rw,
            rh,
        );

        // About 1 fps, spread across the whole window when capped (not just its first 30s).
        let count = ((self.end - self.start).ceil() as usize).clamp(1, REFINE_SAMPLES);
        let mut evidence = Evidence::default();
        let mut hits = Vec::new();
        for rgb in self.sample(count) {
            let rgb = rgb?;
            let full = is_fullscreen(&self.detector.detect(&rgb)?);
            let mut small = false;
            if !full {
                if let Some(face) =
                    matching_face(candidate, self.detector.detect_region(&rgb, region)?)
                {
                    hits.push(face);
                    small = true;
                }
            }
            evidence.observe(full, small);
        }
        Ok(evidence
            .accepts()
            .then(|| panel_box(&hits, self.info.width, self.info.height))
            .flatten())
    }
}

fn majority(count: usize, total: usize) -> bool {
    total > 0 && count >= total.div_ceil(2)
}
fn is_fullscreen(faces: &[FaceBox]) -> bool {
    faces.iter().any(|b| b.h >= FACECAM_FULLSCREEN_MAX_H)
}
fn is_small(b: FaceBox) -> bool {
    (MIN_FACE_HEIGHT..FACECAM_FULLSCREEN_MAX_H).contains(&b.h)
}

#[derive(Default)]
struct Evidence {
    total: usize,
    full: usize,
    small: usize,
}

impl Evidence {
    fn observe(&mut self, full: bool, small: bool) {
        self.total += 1;
        self.full += usize::from(full);
        self.small += usize::from(small && !full);
    }
    fn accepts(&self) -> bool {
        !majority(self.full, self.total) && majority(self.small, self.total)
    }
}

fn project_region(
    (x, y, w, h): FacecamBox,
    (sw, sh): (u32, u32),
    (pw, ph): (u32, u32),
) -> Option<FacecamBox> {
    let (r, b) = (x.checked_add(w)?, y.checked_add(h)?);
    if w == 0 || h == 0 || r > sw || b > sh {
        return None;
    }
    let floor = |n, proxy, src| (u64::from(n) * u64::from(proxy) / u64::from(src)) as u32;
    let ceil = |n, proxy, src| (u64::from(n) * u64::from(proxy)).div_ceil(u64::from(src)) as u32;
    let (x, y) = (floor(x, pw, sw), floor(y, ph, sh));
    Some((x, y, ceil(r, pw, sw) - x, ceil(b, ph, sh) - y))
}

fn fits_cached_panel(face: FaceBox, (x, y, w, h): FacecamBox, (fw, fh): (u32, u32)) -> bool {
    // Regional detections are normalized to the whole frame and clipped at
    // the crop boundary. Require a plausible panel scale and an intact box.
    let scale = face.h * fh as f32 / h as f32;
    let left = face.x * fw as f32 - x as f32;
    let top = face.y * fh as f32 - y as f32;
    let right = left + face.w * fw as f32;
    let bottom = top + face.h * fh as f32;
    let margin = 0.5; // proxy pixels; allow for floating-point remapping
    is_small(face)
        && (0.15..=0.85).contains(&scale)
        && left >= margin
        && top >= margin
        && right <= w as f32 - margin
        && bottom <= h as f32 - margin
}

fn offset(center: f32, size: u32, region: u32) -> u32 {
    (center * size as f32 - region as f32 * 0.5).clamp(0.0, (size - region) as f32) as u32
}

fn tiles((w, h): (u32, u32)) -> impl Iterator<Item = FacecamBox> {
    let tw = (w / 4).max(32).min(w);
    let th = (h / 4).max(24).min(h);
    fn origins(last: u32, stride: u32) -> impl Iterator<Item = u32> {
        (0..last)
            .step_by(stride as usize)
            .chain(std::iter::once(last))
    }
    origins(h - th, (th / 2).max(6))
        .flat_map(move |y| origins(w - tw, (tw / 2).max(8)).map(move |x| (x, y, tw, th)))
        .filter(move |&(_, _, tw, th)| (tw, th) != (w, h))
}

fn cluster_distance(candidate: FaceBox, face: FaceBox) -> Option<f32> {
    let dx = (candidate.cx() - face.cx()).abs();
    let dy = (candidate.cy() - face.cy()).abs();
    (dx < 0.08 && dy < 0.08 && (0.6 * candidate.h..=1.6 * candidate.h).contains(&face.h))
        .then_some(dx + dy + (candidate.h - face.h).abs())
}

fn compare_match(a: &(f32, FaceBox), b: &(f32, FaceBox)) -> std::cmp::Ordering {
    a.0.total_cmp(&b.0)
        .then_with(|| b.1.score.total_cmp(&a.1.score))
}

fn matching_face(candidate: FaceBox, faces: impl IntoIterator<Item = FaceBox>) -> Option<FaceBox> {
    faces
        .into_iter()
        .filter(|&b| is_small(b) && !is_chest_graphic(candidate, b))
        .filter_map(|b| cluster_distance(candidate, b).map(|d| (d, b)))
        .min_by(compare_match)
        .map(|(_, b)| b)
}

fn is_chest_graphic(upper: FaceBox, lower: FaceBox) -> bool {
    lower.h < 0.85 * upper.h
        && (upper.cx() - lower.cx()).abs() <= 1.2 * upper.w.max(0.8 * upper.h)
        && (0.5 * upper.h..=3.2 * upper.h).contains(&(lower.cy() - upper.cy()))
}

fn is_peripheral(face: FaceBox) -> bool {
    !(0.32..=0.68).contains(&face.cx()) || !(0.30..=0.70).contains(&face.cy())
}

fn stable_candidate(candidates: &[(usize, FaceBox)], frame_count: usize) -> Option<FaceBox> {
    let mut clusters = Vec::new();
    for &(_, face) in candidates {
        let mut per_frame = vec![None; frame_count];
        for &(id, other) in candidates {
            if let Some(distance) = cluster_distance(face, other) {
                let matched = (distance, other);
                if per_frame[id].is_none_or(|old| compare_match(&matched, &old).is_lt()) {
                    per_frame[id] = Some(matched);
                }
            }
        }
        let near: Vec<_> = per_frame.into_iter().flatten().map(|(_, b)| b).collect();
        let votes = near.len();
        if votes < 2 {
            continue;
        }
        let (cx, cy, h) = medians(&near);
        let w = median(near.iter().map(|b| f64::from(b.w)));
        clusters.push((
            votes,
            FaceBox {
                x: (cx - w / 2.0) as f32,
                y: (cy - h / 2.0) as f32,
                w: w as f32,
                h: h as f32,
                score: median(near.iter().map(|b| f64::from(b.score))) as f32,
            },
        ));
    }

    let eligible = || {
        clusters.iter().copied().filter(|&(_, face)| {
            !clusters
                .iter()
                .any(|&(_, upper)| is_chest_graphic(upper, face))
        })
    };
    let most_votes = eligible().map(|(votes, _)| votes).max()?;
    // One missed keyframe shouldn't make a center character or a tiny icon
    // win. Preserve the stronger temporal evidence when the gap is larger.
    eligible()
        .filter(|&(votes, _)| votes + 1 >= most_votes)
        .max_by(|(a_votes, a), (b_votes, b)| {
            is_peripheral(*a)
                .cmp(&is_peripheral(*b))
                .then_with(|| (a.h * a.score).total_cmp(&(b.h * b.score)))
                .then_with(|| a_votes.cmp(b_votes))
        })
        .map(|(_, face)| face)
}

fn median(values: impl Iterator<Item = f64>) -> f64 {
    let mut values: Vec<_> = values.collect();
    values.sort_by(f64::total_cmp);
    (values[(values.len() - 1) / 2] + values[values.len() / 2]) * 0.5
}

fn medians(faces: &[FaceBox]) -> (f64, f64, f64) {
    (
        median(faces.iter().map(|b| f64::from(b.cx()))),
        median(faces.iter().map(|b| f64::from(b.cy()))),
        median(faces.iter().map(|b| f64::from(b.h))),
    )
}

fn panel_box(hits: &[FaceBox], sw: u32, sh: u32) -> Option<FacecamBox> {
    if hits.is_empty() || sw < 18 || sh < 14 {
        return None;
    }
    let (cx, cy, face_h) = medians(hits);
    let (swf, shf) = (f64::from(sw), f64::from(sh));
    let ratio = f64::from(FACECAM_PANEL_W) / f64::from(FACECAM_PANEL_H);
    let face_px = face_h * shf;
    let h = (face_px * FACECAM_FACE_SCALE)
        .round()
        .max(FACECAM_MIN_PANEL_H)
        .min(shf)
        .min(swf / ratio);
    let fit = 1.0f64
        .min((2.0 * cx.min(1.0 - cx) * swf) / (h * ratio))
        .min((cy / FACECAM_FACE_Y).min((1.0 - cy) / (1.0 - FACECAM_FACE_Y)) * shf / h);
    let floor = (FACECAM_MIN_FACE_SCALE * face_px / h).min(1.0);
    let desired_h = h * fit.max(floor);
    // 18x14 is the smallest even unit of the exact 9:7 aspect ratio.
    // Round up if needed to honor the minimum hair/headroom scale.
    let units = ((desired_h / 14.0).floor() as u32)
        .max((h * floor / 14.0).ceil() as u32)
        .clamp(1, (sw / 18).min(sh / 14));
    let (w, h) = (units * 18, units * 14);
    let x = (cx * swf - f64::from(w) * 0.5)
        .round()
        .clamp(0.0, f64::from(sw - w)) as u32;
    let y = (cy * shf - f64::from(h) * FACECAM_FACE_Y)
        .round()
        .clamp(0.0, f64::from(sh - h)) as u32;
    Some((x, y, w, h))
}

/// Focus the cover PNG on the largest detected face, or leave the cover unfocused.
pub fn detect_cover_face_focus(image_path: impl AsRef<Path>) -> Option<(f32, f32)> {
    let rgb = image::open(image_path).ok()?.into_rgb8();
    let largest = OnnxFaceDetector::new()
        .ok()?
        .detect(&rgb)
        .ok()?
        .into_iter()
        .max_by(|a, b| a.area().total_cmp(&b.area()))?;
    Some((largest.cx(), largest.cy()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(x: f32, y: f32, h: f32) -> FaceBox {
        FaceBox {
            x: x - h / 2.0,
            y: y - h / 2.0,
            w: h,
            h,
            score: 0.9,
        }
    }

    fn obs(x: f32, h: f32, motion: f64) -> Observation {
        Observation {
            bbox: face(x, 0.5, h),
            mouth: [motion; 18],
        }
    }

    fn frame(t: f64, cut: bool, faces: &[Observation]) -> SpeakerFrame {
        SpeakerFrame {
            t,
            cut,
            faces: faces.to_vec(),
        }
    }

    #[test]
    fn clusters_speakers_and_rechecks_final_separation() {
        let (left, right) = two_means(&[0.20, 0.25, 0.23, 0.73, 0.77]).unwrap();
        assert!((left - 0.226_666_67).abs() < EPS && (right - 0.75).abs() < EPS);
        assert_eq!(two_means(&[0.44, 0.50]), None);
        assert_eq!(two_means(&[0.0, 0.03, 0.06, 0.09]), None);
    }

    #[test]
    fn switches_after_minimum_hold_but_cuts_recenter_immediately() {
        let left = obs(0.2, 0.2, 0.0);
        let right = |motion| obs(0.8, 0.15, motion);
        let frames = [
            frame(0.0, false, &[left, right(0.0)]),
            frame(0.4, false, &[left, right(0.05)]),
            frame(0.8, false, &[left, right(0.0)]),
            frame(1.0, false, &[left, right(0.05)]),
            frame(1.2, true, &[left]),
            frame(1.45, true, &[]), // even a final, short faceless shot centers
        ];
        let segments = select_segments(&frames, 0.3164);
        assert_eq!(
            segments.iter().map(|s| s.start).collect::<Vec<_>>(),
            [0.0, 1.0, 1.2, 1.45]
        );
        for (s, expected) in segments.iter().zip([0.2, 0.8, 0.2, 0.5]) {
            assert!((s.center_x - expected).abs() < EPS);
        }
    }

    #[test]
    fn groups_faces_then_handles_drift_and_missing_speaker() {
        let a = obs(0.2, 0.2, 0.0);
        let b = obs(0.36, 0.15, 0.0);
        let c = obs(0.30, 0.2, 0.0);
        let d = obs(0.75, 0.2, 0.0);
        let frames = [
            frame(0.0, false, &[a, b]),
            frame(0.3, true, &[a]),
            frame(0.6, false, &[c]), // drift too early
            frame(0.9, false, &[c]), // drift accepted after 0.5s
            frame(1.4, false, &[d]), // active still inside TTL
            frame(2.0, false, &[d]), // missing active is replaced
        ];
        let segments = select_segments(&frames, 0.3164);
        assert_eq!(
            segments.iter().map(|s| s.start).collect::<Vec<_>>(),
            [0.0, 0.3, 0.9, 2.0]
        );
        for (s, expected) in segments.iter().zip([0.28, 0.2, 0.3, 0.75]) {
            assert!((s.center_x - expected).abs() < EPS);
        }
    }

    #[test]
    fn caps_segments_and_prefers_preserving_hard_cuts() {
        let mut segments = Vec::new();
        for i in 0..MAX_SEGMENTS {
            append(
                &mut segments,
                i as f64 * 2.0,
                if i % 2 == 0 { 0.1 } else { 0.8 },
                Kind::Cut,
            );
        }
        append(&mut segments, MAX_SEGMENTS as f64 * 2.0, 0.2, Kind::Switch);
        let normalized = normalize(segments);
        assert_eq!(normalized.len(), MAX_SEGMENTS);
        assert_eq!(
            normalized.last().unwrap().start,
            (MAX_SEGMENTS - 1) as f64 * 2.0
        );
    }

    #[test]
    fn panel_geometry_and_edge_zoom_preserve_hair_headroom() {
        let (_, y, w, h) = panel_box(&[face(0.4, 0.4, 0.10)], 1920, 1080).unwrap();
        assert_eq!(w * FACECAM_PANEL_H, h * FACECAM_PANEL_W);
        assert_eq!((w % 2, h % 2), (0, 0));
        assert!(
            ((432.0 - f64::from(y)) / f64::from(h) - FACECAM_FACE_Y).abs() <= 1.0 / f64::from(h)
        );
        let (x, y, w, h) = panel_box(&[face(0.95, 0.85, 0.10)], 1920, 1080).unwrap();
        assert!(x + w <= 1920 && y + h <= 1080);
        assert!(f64::from(h) >= 108.0 * FACECAM_MIN_FACE_SCALE && h < 324);
    }

    #[test]
    fn fullscreen_threshold_and_cache_majority() {
        assert!(is_small(face(0.5, 0.5, 0.03)));
        assert!(!is_small(face(0.5, 0.5, 0.24)));
        assert!(is_fullscreen(&[face(0.1, 0.5, 0.24)]));
        let mut evidence = Evidence::default();
        evidence.observe(false, true);
        evidence.observe(false, false);
        assert!(evidence.accepts());
        evidence.observe(false, false);
        assert!(!evidence.accepts());
        let mut evidence = Evidence::default();
        evidence.observe(false, true);
        evidence.observe(true, true);
        assert!(!evidence.accepts());
    }

    #[test]
    fn overlapping_tiles_cannot_outvote_distinct_keyframes() {
        let spam = face(0.85, 0.82, 0.04);
        let stable = face(0.2, 0.2, 0.07);
        let mut candidates = vec![(0, spam); 10];
        assert!(stable_candidate(&candidates, 6).is_none());
        candidates.extend([(1, stable), (3, stable), (5, stable)]);
        assert!((stable_candidate(&candidates, 6).unwrap().cx() - stable.cx()).abs() < 1e-6);
    }

    fn stable_faces(faces: &[FaceBox]) -> Option<FaceBox> {
        let candidates: Vec<_> = (0..KEYFRAMES)
            .flat_map(|id| faces.iter().copied().map(move |b| (id, b)))
            .collect();
        stable_candidate(&candidates, KEYFRAMES)
    }

    #[test]
    fn suppresses_a_stable_chest_print_even_with_more_votes() {
        let streamer = face(0.12, 0.45, 0.115);
        let print = FaceBox {
            score: 0.98,
            ..face(0.12, 0.61, 0.05)
        };
        let mut candidates: Vec<_> = (0..KEYFRAMES).map(|id| (id, print)).collect();
        assert_eq!(stable_faces(&[print, streamer]), Some(streamer));
        candidates.extend((0..4).map(|id| (id, streamer)));
        assert_eq!(stable_candidate(&candidates, KEYFRAMES), Some(streamer));
        assert_eq!(matching_face(streamer, [print, streamer]), Some(streamer));
        assert_eq!(matching_face(streamer, [print]), None);
        // A nearby chest graphic can even fall inside the generic cluster gate.
        let nearby_print = face(0.12, 0.52, 0.08);
        assert!(cluster_distance(streamer, nearby_print).is_some());
        assert_eq!(matching_face(streamer, [nearby_print]), None);
    }

    #[test]
    fn prefers_a_peripheral_facecam_to_a_larger_center_character() {
        let camera = face(0.15, 0.18, 0.075);
        let character = face(0.5, 0.5, 0.18);
        assert_eq!(stable_faces(&[character, camera]), Some(camera));
    }

    #[test]
    fn prefers_a_larger_confident_corner_facecam_to_a_tiny_hud_portrait() {
        let camera = face(0.18, 0.22, 0.10);
        let hud = FaceBox {
            score: 0.58,
            ..face(0.91, 0.88, 0.032)
        };
        assert_eq!(stable_faces(&[camera, hud]), Some(camera));
    }

    #[test]
    fn refine_uses_the_closest_match_not_the_smallest_face() {
        let candidate = face(0.14, 0.42, 0.12);
        let streamer = face(0.15, 0.43, 0.11);
        let nearby = FaceBox {
            score: 0.99,
            ..face(0.18, 0.41, 0.08)
        };
        let tiny = face(0.13, 0.42, 0.035);
        assert!(cluster_distance(candidate, nearby).is_some());
        assert_eq!(
            matching_face(candidate, [tiny, nearby, streamer]),
            Some(streamer)
        );
        assert_eq!(matching_face(candidate, [tiny]), None);
    }

    #[test]
    fn cached_panel_requires_a_plausibly_sized_uncut_face() {
        let panel = (200, 100, 180, 140);
        let dims = (640, 360);
        assert!(fits_cached_panel(face(0.45, 0.56, 0.12), panel, dims));
        assert!(!fits_cached_panel(face(0.45, 0.56, 0.04), panel, dims));
        let mut cut = face(0.45, 0.56, 0.12);
        cut.x = 200.0 / 640.0;
        assert!(!fits_cached_panel(cut, panel, dims));
    }

    #[test]
    fn cover_uses_the_largest_face() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/astronaut.png");
        let (x, y) = detect_cover_face_focus(path).unwrap();
        assert!((0.35..0.45).contains(&x) && (0.16..0.28).contains(&y));
    }
}
