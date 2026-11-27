use crate::{models::cut, tools};
use ab_glyph::{point, Font, FontRef, Glyph, PxScale, PxScaleFont, ScaleFont};
use anyhow::{anyhow, bail, Context, Result};
use image::{
    imageops::{self, FilterType},
    GrayImage, Luma, RgbImage,
};
use std::{path::Path, time::Duration};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

pub const HOOK_INTRO_DURATION_SEC: f64 = 0.9;
const GOLD: [u8; 3] = [250, 204, 21];
const WHITE: [u8; 3] = [255, 255, 255];
const STROKE: [u8; 3] = [8, 12, 22];
const FONT: &[u8] = include_bytes!("../assets/Montserrat-Bold.ttf");

pub async fn extract_cover_frame(
    ffmpeg: impl AsRef<Path>,
    video_path: impl AsRef<Path>,
    clip_start: f64,
    clip_duration: f64,
    out_png: impl AsRef<Path>,
) -> Result<()> {
    cover_frame(
        ffmpeg.as_ref(),
        video_path.as_ref(),
        clip_start,
        clip_duration,
        out_png.as_ref(),
        &CancellationToken::new(),
    )
    .await
}
pub(crate) async fn cover_frame(
    ffmpeg: &Path,
    video: &Path,
    start: f64,
    duration: f64,
    out: &Path,
    cancel: &CancellationToken,
) -> Result<()> {
    pick_cover(
        sample_offsets(duration, 0.1),
        |offset| {
            let mut cmd = tools::ffmpeg(ffmpeg);
            cmd.args(["-ss", &format!("{:.3}", start + offset), "-i"])
                .arg(video)
                .args(["-map", "0:v:0"]);
            cmd
        },
        out,
        cancel,
    )
    .await
}

pub(crate) async fn cover_frame_filtered(
    ffmpeg: &Path,
    video: &Path,
    (start, duration): (f64, f64),
    filter_args: &[&str],
    time_dependent: bool,
    out: &Path,
    cancel: &CancellationToken,
) -> Result<()> {
    pick_cover(
        sample_offsets(duration, 0.05),
        |offset| {
            let mut cmd = tools::ffmpeg(ffmpeg);
            let seek = if time_dependent {
                start
            } else {
                start + offset
            };
            cmd.args(["-ss", &format!("{seek:.3}"), "-i"])
                .arg(video)
                .args(filter_args);
            if time_dependent {
                // Crop expressions must see time relative to the start of the clip.
                cmd.args(["-ss", &format!("{offset:.3}")]);
            }
            cmd
        },
        out,
        cancel,
    )
    .await
}

fn sample_offsets(duration: f64, end_pad: f64) -> impl Iterator<Item = f64> {
    [0.25, 0.8, 1.6, (duration.max(0.5) * 0.35).min(3.)]
        .into_iter()
        .map(move |offset: f64| offset.clamp(0., (duration - end_pad).max(0.)))
}

async fn pick_cover(
    offsets: impl Iterator<Item = f64>,
    command: impl Fn(f64) -> Command,
    out: &Path,
    cancel: &CancellationToken,
) -> Result<()> {
    let mut seen = Vec::new();
    let mut lit = None;
    let mut brightest = None;
    for offset in offsets {
        if seen.contains(&offset) {
            continue;
        }
        seen.push(offset);
        let Ok(output) = tools::run(
            command(offset).args([
                "-frames:v",
                "1",
                "-an",
                "-c:v",
                "png",
                "-threads",
                "1",
                "-f",
                "image2pipe",
                "pipe:1",
            ]),
            Duration::from_secs(30),
            cancel,
        )
        .await
        else {
            if cancel.is_cancelled() {
                bail!("job cancelled");
            }
            continue;
        };
        let Ok(frame) =
            image::load_from_memory_with_format(&output.stdout, image::ImageFormat::Png)
        else {
            continue;
        };
        let (brightness, sharpness) = frame_stats(&frame.to_rgb8());
        if brightest.as_ref().is_none_or(|(b, _)| brightness > *b) {
            brightest = Some((brightness, output.stdout.clone()));
        }
        if brightness >= 16. && lit.as_ref().is_none_or(|(s, _)| sharpness > *s) {
            lit = Some((sharpness, output.stdout));
        }
    }
    let (_, png) = lit
        .or(brightest)
        .ok_or_else(|| anyhow!("no decodable cover frame"))?;
    std::fs::write(out, png)?;
    Ok(())
}
fn luminance(c: &[u8; 3]) -> f64 {
    (0.299 * c[0] as f64 + 0.587 * c[1] as f64 + 0.114 * c[2] as f64).round()
}
fn frame_stats(image: &RgbImage) -> (f64, f64) {
    let (w, h) = image.dimensions();
    let gray: Vec<_> = image.pixels().map(|c| luminance(&c.0)).collect();
    let n = gray.len() as f64;
    let brightness = gray.iter().sum::<f64>() / n;
    let mut sum = 0.;
    let mut squared = 0.;
    let neighbor = |i: u32, max: u32, d: i64| {
        if max <= 1 {
            return 0;
        }
        let j = i as i64 + d;
        if j < 0 {
            1
        } else if j >= max as i64 {
            max - 2
        } else {
            j as u32
        }
    };
    let at = |x: u32, y: u32| gray[y as usize * w as usize + x as usize];
    for y in 0..h {
        for x in 0..w {
            let l = at(neighbor(x, w, -1), y)
                + at(neighbor(x, w, 1), y)
                + at(x, neighbor(y, h, -1))
                + at(x, neighbor(y, h, 1))
                - 4. * at(x, y);
            sum += l;
            squared += l * l;
        }
    }
    (brightness, (squared / n - (sum / n).powi(2)).max(0.))
}
fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0., 1.);
    t * t * (3. - 2. * t)
}
fn byte(x: f64) -> u8 {
    x.round_ties_even().clamp(0., 255.) as u8
}
fn background(frame: &RgbImage, w: u32, h: u32, focus: (f32, f32)) -> RgbImage {
    let mut img = if frame.dimensions() == (w, h) {
        frame.clone()
    } else {
        let scale = (w as f64 / frame.width() as f64).max(h as f64 / frame.height() as f64);
        let (sw, sh) = (
            ((frame.width() as f64 * scale).ceil() as u32).max(w),
            ((frame.height() as f64 * scale).ceil() as u32).max(h),
        );
        let resized = imageops::resize(frame, sw, sh, FilterType::Lanczos3);
        let origin = |size: u32, target: u32, focus: f32| {
            (size as f64 * focus as f64 - target as f64 / 2.)
                .round_ties_even()
                .clamp(0., (size - target) as f64) as u32
        };
        imageops::crop_imm(
            &resized,
            origin(sw, w, focus.0),
            origin(sh, h, focus.1),
            w,
            h,
        )
        .to_image()
    };
    let mean = (img.pixels().map(|c| luminance(&c.0)).sum::<f64>() / (w as f64 * h as f64)).round();
    for c in img.pixels_mut() {
        c.0 = c.0.map(|v| byte(mean + (v as f64 - mean) * 1.12));
        let gray = luminance(&c.0);
        c.0 = c.0.map(|v| byte(gray + (v as f64 - gray) * 1.14));
    }
    let smooth = imageops::filter3x3(
        &img,
        &[
            1. / 13.,
            1. / 13.,
            1. / 13.,
            1. / 13.,
            5. / 13.,
            1. / 13.,
            1. / 13.,
            1. / 13.,
            1. / 13.,
        ],
    );
    for (x, y, c) in img.enumerate_pixels_mut() {
        if x > 0 && x + 1 < w && y > 0 && y + 1 < h {
            let blur = smooth.get_pixel(x, y);
            for k in 0..3 {
                c[k] = byte(c[k] as f64 + (c[k] as f64 - blur[k] as f64) * 0.1);
            }
        }
        let nx = 2. * x as f64 / w.saturating_sub(1).max(1) as f64 - 1.;
        let ny = y as f64 / h.saturating_sub(1).max(1) as f64;
        let radius = nx.hypot(2. * ny - 1.);
        let top = 0.24 * (1. - ny / 0.18).clamp(0., 1.);
        let center_dist = ((ny - 0.50).abs() / 0.24).clamp(0., 1.);
        let center = 0.56 * (1. - smoothstep(center_dist));
        let bottom = 0.28 * smoothstep((ny - 0.72) / 0.28);
        let edges = 0.22 * smoothstep((radius - 0.50) / (std::f64::consts::SQRT_2 - 0.50));
        let a = byte(255. * (1. - (1. - top) * (1. - center) * (1. - bottom) * (1. - edges)))
            as f64
            / 255.;
        for (k, b) in [5., 8., 17.].into_iter().enumerate() {
            c[k] = byte(c[k] as f64 * (1. - a) + b * a);
        }
    }
    img
}

#[derive(Clone, Copy)]
struct Bounds {
    l: i32,
    t: i32,
    r: i32,
    b: i32,
}
impl Bounds {
    fn width(self) -> i32 {
        self.r - self.l
    }
    fn height(self) -> i32 {
        self.b - self.t
    }
}
fn glyphs(font: &PxScaleFont<&FontRef<'_>>, s: &str) -> (Vec<Glyph>, f32) {
    let mut prev = None;
    let mut x = 0.;
    let mut glyphs = Vec::new();
    for c in s.chars() {
        let id = font.glyph_id(c);
        if let Some(p) = prev {
            x += font.kern(p, id);
        }
        glyphs.push(id.with_scale_and_position(font.scale, point(x, 0.)));
        x += font.h_advance(id);
        prev = Some(id);
    }
    (glyphs, x)
}
fn bounds(font: &PxScaleFont<&FontRef<'_>>, s: &str, stroke: i32) -> Bounds {
    let (glyphs, advance) = glyphs(font, s);
    let mut out = Bounds {
        l: 0,
        t: 0,
        r: advance.ceil() as i32,
        b: 0,
    };
    for glyph in glyphs {
        if let Some(outline) = font.outline_glyph(glyph) {
            let b = outline.px_bounds();
            out.l = out.l.min(b.min.x as i32);
            out.r = out.r.max(b.max.x as i32);
            out.t = out.t.min(b.min.y as i32);
            out.b = out.b.max(b.max.y as i32);
        }
    }
    Bounds {
        l: out.l - stroke,
        r: out.r + stroke,
        t: out.t - stroke,
        b: out.b + stroke,
    }
}
fn balanced_lines(words: &[&str], measure: impl Fn(&str) -> i32, max_width: i32) -> Vec<String> {
    let n = words.len();
    if n == 0 {
        return vec![];
    }
    let mut widths = vec![vec![0; n + 1]; n];
    for i in 0..n {
        for j in i + 1..=n {
            widths[i][j] = measure(&words[i..j].join(" "));
        }
    }
    for count in 1..=3.min(n) {
        let mut best = (f64::INFINITY, Vec::new());
        let mut check = |spans: &[(usize, usize)]| {
            let sizes: Vec<_> = spans.iter().map(|&(a, b)| widths[a][b]).collect();
            if sizes.iter().any(|s| *s > max_width) {
                return;
            }
            let mean = sizes.iter().sum::<i32>() as f64 / count as f64;
            let mut score = sizes
                .iter()
                .map(|s| (*s as f64 - mean).powi(2))
                .sum::<f64>();
            let &(a, b) = spans.last().unwrap();
            if count > 1 && b - a == 1 && (sizes[count - 1] as f64) < mean * 0.65 {
                score += (max_width as f64).powi(2);
            }
            if score < best.0 {
                best = (
                    score,
                    spans.iter().map(|&(a, b)| words[a..b].join(" ")).collect(),
                );
            }
        };
        match count {
            1 => check(&[(0, n)]),
            2 => {
                for a in 1..n {
                    check(&[(0, a), (a, n)]);
                }
            }
            _ => {
                for a in 1..n {
                    for b in a + 1..n {
                        check(&[(0, a), (a, b), (b, n)]);
                    }
                }
            }
        }
        if !best.1.is_empty() {
            return best.1;
        }
    }
    vec![]
}
fn glyph_mask(mask: &mut GrayImage, font: &PxScaleFont<&FontRef<'_>>, text: &str, x: f32, y: i32) {
    for mut glyph in glyphs(font, text).0 {
        glyph.position.x += x;
        glyph.position.y += y as f32;
        if let Some(o) = font.outline_glyph(glyph) {
            let b = o.px_bounds();
            o.draw(|x, y, c| {
                let x = x as i32 + b.min.x as i32;
                let y = y as i32 + b.min.y as i32;
                if x >= 0 && y >= 0 && (x as u32) < mask.width() && (y as u32) < mask.height() {
                    let dest = mask.get_pixel_mut(x as u32, y as u32);
                    dest[0] = dest[0].max(byte(c as f64 * 255.));
                }
            });
        }
    }
}
fn dilate(mask: &GrayImage, r: i32) -> GrayImage {
    let mut out = GrayImage::new(mask.width(), mask.height());
    let offsets: Vec<_> = (-r..=r)
        .flat_map(|y| {
            (-r..=r)
                .filter(move |x| x * x + y * y <= r * r)
                .map(move |x| (x, y))
        })
        .collect();
    for (x, y, p) in mask.enumerate_pixels().filter(|(_, _, p)| p[0] > 0) {
        for &(dx, dy) in &offsets {
            let nx = x as i32 + dx;
            let ny = y as i32 + dy;
            if nx >= 0 && ny >= 0 && (nx as u32) < out.width() && (ny as u32) < out.height() {
                let dst = out.get_pixel_mut(nx as u32, ny as u32);
                dst[0] = dst[0].max(p[0]);
            }
        }
    }
    out
}
fn composite(img: &mut RgbImage, mask: &GrayImage, color: [u8; 3], opacity: f64, dy: i32) {
    for (x, y, p) in mask.enumerate_pixels().filter(|(_, _, p)| p[0] > 0) {
        let y = y as i32 + dy;
        if y < 0 || y >= img.height() as i32 {
            continue;
        }
        let c = img.get_pixel_mut(x, y as u32);
        let a = p[0] as f64 / 255. * opacity;
        for k in 0..3 {
            c[k] = byte(c[k] as f64 * (1. - a) + color[k] as f64 * a);
        }
    }
}
fn pill_mask(w: u32, h: u32, top: i32, pill_h: i32) -> GrayImage {
    let mut mask = GrayImage::new(w, h);
    let pw = (w as f32 * 0.105).round_ties_even().max(1.) as i32;
    let left = (w as i32 - pw) / 2;
    let r = (pill_h.min(pw)) as f64 / 2.;
    for y in top.max(0)..(top + pill_h).min(h as i32) {
        for x in left.max(0)..(left + pw).min(w as i32) {
            let cx = (x - left) as f64 + 0.5;
            let cy = (y - top) as f64 + 0.5;
            if (cx - cx.clamp(r, pw as f64 - r)).hypot(cy - pill_h as f64 / 2.) <= r {
                mask.put_pixel(x as u32, y as u32, Luma([255]));
            }
        }
    }
    mask
}
#[allow(clippy::too_many_arguments)]
pub fn render_hook_thumbnail(
    cover_png: impl AsRef<Path>,
    hook_text: &str,
    width: u32,
    height: u32,
    face_focus: Option<(f32, f32)>,
    font_dir: impl AsRef<Path>,
    out_png: impl AsRef<Path>,
) -> Result<()> {
    if width == 0 || height == 0 {
        bail!("invalid thumbnail size");
    }
    let frame = image::open(cover_png.as_ref())
        .context("open cover frame")?
        .to_rgb8();
    let focus = face_focus
        .filter(|(x, y)| x.is_finite() && y.is_finite())
        .unwrap_or((0.5, 0.38));
    let mut img = background(&frame, width, height, focus);
    let s = hook_text.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = cut(
        &s.trim_matches(['"', '\'', '“', '”', '‘', '’', '«', '»'])
            .trim()
            .to_uppercase(),
        80,
    );
    let words: Vec<_> = s.split_whitespace().collect();
    if !words.is_empty() {
        let primary = std::fs::read(font_dir.as_ref().join("Montserrat-Bold.ttf")).ok();
        let font = primary
            .as_deref()
            .and_then(|b| FontRef::try_from_slice(b).ok())
            .unwrap_or(
                FontRef::try_from_slice(FONT)
                    .map_err(|_| anyhow!("invalid bundled Montserrat font"))?,
            );
        let (w, h) = (width as f32, height as f32);
        let (max_w, start) = if height > width {
            (w * 0.74, w * 0.078)
        } else if width == height {
            (w * 0.80, w * 0.068)
        } else {
            (w * 0.76, h * 0.080)
        };
        let min = (w.min(h) * 0.048).round_ties_even().max(1.);
        let mut size = start.round_ties_even().max(min);
        let (scaled, stroke, mut lines) = loop {
            // ab_glyph's px scale is the font's unscaled height, rather than its EM.
            let scaled = (&font).into_scaled(
                font.pt_to_px_scale(size * 0.75)
                    .unwrap_or(PxScale::from(size)),
            );
            let stroke = (size * 0.05).round_ties_even().max(2.) as i32;
            let lines =
                balanced_lines(&words, |s| bounds(&scaled, s, stroke).width(), max_w as i32);
            if !lines.is_empty() || size == min {
                break (scaled, stroke, lines);
            }
            size = (size - 4.).max(min);
        };
        let measure = |s: &str| bounds(&scaled, s, stroke).width();
        if lines.is_empty() {
            for n in (1..=words.len()).rev() {
                let last = format!("{}…", words[n - 1]);
                let mut tokens = words[..n - 1].to_vec();
                tokens.push(&last);
                lines = balanced_lines(&tokens, measure, max_w as i32);
                if !lines.is_empty() {
                    break;
                }
            }
            if lines.is_empty() {
                let mut prefix = words[0].to_owned();
                while !prefix.is_empty() && measure(&format!("{prefix}…")) > max_w as i32 {
                    prefix.pop();
                }
                lines = vec![format!("{prefix}…")];
            }
        }
        let boxes: Vec<_> = lines.iter().map(|s| bounds(&scaled, s, stroke)).collect();
        let gap = (size * 0.13).round_ties_even() as i32;
        let pill_h = (h * 0.005).round_ties_even().max(4.) as i32;
        let pill_gap = (size * 0.38).round_ties_even().max(8.) as i32;
        let text_h = boxes.iter().map(|b| b.height()).sum::<i32>() + gap * (lines.len() as i32 - 1);
        let total_h = pill_h + pill_gap + text_h;
        let block_top = ((height as i32 - total_h) / 2).max(0);
        let headline_top = block_top + pill_h + pill_gap;
        let mut y = headline_top;
        let mut white = GrayImage::new(width, height);
        let mut gold = white.clone();
        for (i, (line, b)) in lines.iter().zip(boxes).enumerate() {
            let x = ((width as f32 - b.width() as f32) / 2. - b.l as f32).round_ties_even();
            let baseline = y - b.t;
            y += b.height() + gap;
            let tokens: Vec<_> = line.split_whitespace().collect();
            if lines.len() == 1 && tokens.len() > 1 {
                let split = tokens.len() / 2;
                let first = tokens[..split].join(" ");
                let second = tokens[split..].join(" ");
                glyph_mask(&mut white, &scaled, &first, x, baseline);
                let sx = x + glyphs(&scaled, line).1 - glyphs(&scaled, &second).1;
                glyph_mask(&mut gold, &scaled, &second, sx, baseline);
            } else {
                glyph_mask(
                    if i + 1 == lines.len() {
                        &mut gold
                    } else {
                        &mut white
                    },
                    &scaled,
                    line,
                    x,
                    baseline,
                );
            }
        }
        let pill = pill_mask(width, height, block_top, pill_h);
        composite(&mut img, &imageops::blur(&pill, 12.), GOLD, 90. / 255., 0);
        let mut body = white.clone();
        for (p, q) in body.pixels_mut().zip(gold.pixels()) {
            p[0] = p[0].max(q[0]);
        }
        let outline = dilate(&body, stroke);
        composite(
            &mut img,
            &imageops::blur(&outline, (size * 0.18).round_ties_even().max(8.)),
            [0; 3],
            225. / 255.,
            (size * 0.10).round_ties_even().max(6.) as i32,
        );
        composite(&mut img, &pill, GOLD, 1., 0);
        composite(&mut img, &outline, STROKE, 1., 0);
        composite(&mut img, &white, WHITE, 1., 0);
        composite(&mut img, &gold, GOLD, 1., 0);
    }
    img.save_with_format(out_png, image::ImageFormat::Png)?;
    Ok(())
}

pub async fn prepend_hook_intro(
    ffmpeg: impl AsRef<Path>,
    ffprobe: impl AsRef<Path>,
    clip_path: impl AsRef<Path>,
    thumb_png: impl AsRef<Path>,
    width: u32,
    height: u32,
    out_path: impl AsRef<Path>,
) -> Result<()> {
    let media = tools::probe_media(ffprobe, clip_path.as_ref()).await?;
    let dest = out_path.as_ref();
    let parent = dest
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let tmp = tempfile::Builder::new()
        .prefix(".intro-")
        .suffix(".mp4")
        .tempfile_in(parent)?;
    intro(
        ffmpeg.as_ref(),
        clip_path.as_ref(),
        thumb_png.as_ref(),
        tmp.path(),
        tools::MediaInfo {
            width,
            height,
            ..media
        },
        "libx264",
        &CancellationToken::new(),
    )
    .await?;
    tmp.persist(dest)?;
    Ok(())
}
pub(crate) async fn intro(
    ffmpeg: &Path,
    clip: &Path,
    thumb: &Path,
    out: &Path,
    meta: tools::MediaInfo,
    encoder: &str,
    cancel: &CancellationToken,
) -> Result<()> {
    let (w, h, fps, d) = (meta.width, meta.height, meta.fps, meta.duration);
    let intro_d = HOOK_INTRO_DURATION_SEC;
    let frames = (intro_d * fps).round_ties_even().max(1.) as u32;
    let mut cmd = tools::ffmpeg(ffmpeg);
    cmd.arg("-i").arg(thumb).arg("-i").arg(clip);
    tools::silence(&mut cmd, intro_d);
    let audio = if meta.has_audio {
        "1:a:0"
    } else {
        tools::silence(&mut cmd, d);
        "3:a:0"
    };
    let graph=[
        format!("[0:v]scale={w}:{h},setsar=1,zoompan=z='1.06-0.06*(1-pow(1-on/{frames},2))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={w}x{h}:fps={fps:.3},format=yuv420p,setpts=PTS-STARTPTS[iv]"),
        format!("[1:v]scale={w}:{h},setsar=1,fps={fps:.3},format=yuv420p,setpts=PTS-STARTPTS[cv]"),
        tools::audio_filter("2:a:0","ia",intro_d,""),tools::audio_filter(audio,"ca",d,if meta.has_audio{"afade=t=in:st=0:d=0.04,"}else{""}),"[iv][ia][cv][ca]concat=n=2:v=1:a=1[v][a]".into(),
    ].join(";");
    cmd.args(["-filter_complex", &graph, "-map", "[v]", "-map", "[a]"]);
    tools::video_encoder(&mut cmd, encoder, "22");
    cmd.args([
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        "-sn",
        "-f",
        "mp4",
    ])
    .arg(out);
    tools::run(&mut cmd, Duration::from_secs(180), cancel).await?;
    if std::fs::metadata(out)?.len() == 0 {
        bail!("hook intro output is empty");
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;
    #[test]
    fn prefers_balanced_lines_without_orphans() {
        let lines = balanced_lines(&["HELLO", "A", "GOOD", "HOOK"], |s| s.len() as i32, 12);
        assert_eq!(lines, ["HELLO A", "GOOD HOOK"]);
    }
    #[test]
    fn sharpness_discriminates_flat_and_edges() {
        let flat = RgbImage::from_pixel(8, 8, Rgb([30; 3]));
        let mut edges = flat.clone();
        for y in 0..8 {
            for x in 4..8 {
                edges.put_pixel(x, y, Rgb([220; 3]));
            }
        }
        assert_eq!(frame_stats(&flat), (30., 0.));
        assert!(frame_stats(&edges).1 > 0.);
    }
    #[test]
    fn scrim_is_strongest_at_center() {
        let frame = RgbImage::from_pixel(45, 50, Rgb([120; 3]));
        let scrim = background(&frame, 40, 40, (0.5, 0.38));
        assert!(scrim.get_pixel(20, 20)[0] < scrim.get_pixel(20, 0)[0]);
        assert!(scrim.get_pixel(20, 20)[0] < scrim.get_pixel(20, 39)[0]);
    }

    #[test]
    fn headline_and_pill_pixels_are_centered() {
        let dir = tempfile::tempdir().unwrap();
        let cover = dir.path().join("cover.png");
        let thumb = dir.path().join("thumb.png");
        let (w, h) = (360, 640);
        RgbImage::new(w, h).save(&cover).unwrap();
        render_hook_thumbnail(
            &cover,
            "This Changes Everything",
            w,
            h,
            None,
            dir.path(),
            &thumb,
        )
        .unwrap();
        let img = image::open(thumb).unwrap().to_rgb8();
        let mut foreground = img
            .enumerate_pixels()
            .filter(|(_, _, p)| p.0 == WHITE || p.0 == GOLD);
        let first = foreground.next().unwrap().1;
        let last = foreground.last().unwrap().1;
        assert!(first < h / 2 && last > h / 2);
        assert!(
            ((first + last) / 2).abs_diff(h / 2) <= 4,
            "block: {first}..{last}"
        );
        let white_text = img.enumerate_pixels().filter(|(_, _, p)| p.0 == WHITE);
        assert!(
            white_text.count() > 100,
            "must contain headline glyphs as well as the pill"
        );
        assert!(img.enumerate_pixels().all(|(x, _, p)| {
            (w * 13 / 100..w * 87 / 100).contains(&x) || (p.0 != WHITE && p.0 != GOLD)
        }));
    }

    #[tokio::test]
    async fn filtered_cover_uses_clip_relative_tracking_time() {
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = tools::ensure_tool_installed(dir.path(), "ffmpeg")
            .await
            .unwrap();
        let source = dir.path().join("source.mp4");
        tools::run(
            tools::ffmpeg(&ffmpeg)
                .args([
                    "-f",
                    "lavfi",
                    "-i",
                    "color=black:s=320x160:r=20:d=3,drawbox=x=160:w=160:color=red:t=fill",
                    "-c:v",
                    "libx264",
                ])
                .arg(&source),
            Duration::from_secs(20),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        let crop = crate::pipeline::cut_crop_filter(&[(0., 0.5, 0.25), (0.5, 2., 0.75)], 90, 160);
        let filter = format!("setpts=PTS-STARTPTS,{crop},setsar=1");
        let cover = dir.path().join("cover.png");
        cover_frame_filtered(
            &ffmpeg,
            &source,
            (1., 2.),
            &["-vf", &filter, "-map", "0:v:0"],
            true,
            &cover,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        let img = image::open(cover).unwrap().to_rgb8();
        assert_eq!(img.dimensions(), (90, 160));
        // The bright right panel is only selected after the 0.5s crop cut.
        let p = img.get_pixel(45, 80);
        assert!(
            p[0] > 200 && p[1] < 30 && p[2] < 30,
            "expected red, got {p:?}"
        );
    }

    #[test]
    fn matching_size_cover_preserves_split_boundary() {
        let (w, h) = (90, 160);
        let split = h / 2;
        let frame = RgbImage::from_fn(w, h, |_, y| {
            if y < split {
                Rgb([210, 35, 35])
            } else {
                Rgb([35, 35, 210])
            }
        });
        // Even an off-center focus must not change a pre-reframed cover's geometry.
        let img = background(&frame, w, h, (0.1, 0.1));
        assert_eq!(img.dimensions(), (w, h));
        assert!(img.enumerate_pixels().all(|(_, y, p)| {
            if y < split {
                p[0] > p[2] + 50
            } else {
                p[2] > p[0] + 50
            }
        }));
    }
}
