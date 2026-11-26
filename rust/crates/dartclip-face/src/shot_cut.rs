use image::RgbImage;

const W: usize = 64;
const H: usize = 36;
const BINS: usize = 16;
pub const SHOT_MIN_GAP_SEC: f64 = 0.25;
const HARD_MAD: f64 = 0.14;
const SOFT_MAD: f64 = 0.08;
const MIN_CORRELATION: f64 = 0.75;

pub(crate) fn luma(r: f64, g: f64, b: f64) -> f64 {
    0.299 * r + 0.587 * g + 0.114 * b
}

struct Signature {
    gray: [u8; W * H],
    // Pearson correlation is invariant to the positive L2 normalization
    // used by OpenCV, so the raw counts suffice.
    hs: [u32; BINS * BINS],
}

impl Signature {
    fn new(rgb: &RgbImage) -> Self {
        let mut sig = Self {
            gray: [0; W * H],
            hs: [0; BINS * BINS],
        };
        let dx = f64::from(rgb.width()) / W as f64;
        let dy = f64::from(rgb.height()) / H as f64;
        for y in 0..H {
            let (y0, y1) = (y as f64 * dy, (y + 1) as f64 * dy);
            for x in 0..W {
                let (x0, x1) = (x as f64 * dx, (x + 1) as f64 * dx);
                // Area-weighted resize, including partially covered pixels.
                let mut channels = [0.0; 3];
                for py in y0 as u32..(y1.ceil() as u32).min(rgb.height()) {
                    let vy = y1.min(f64::from(py + 1)) - y0.max(f64::from(py));
                    for px in x0 as u32..(x1.ceil() as u32).min(rgb.width()) {
                        let weight = vy * (x1.min(f64::from(px + 1)) - x0.max(f64::from(px)));
                        let pixel = rgb.get_pixel(px, py);
                        for c in 0..3 {
                            channels[c] += weight * f64::from(pixel[c]);
                        }
                    }
                }
                let [r, g, b] = channels.map(|v| (v / (dx * dy)).round());
                sig.gray[y * W + x] = luma(r, g, b).round() as u8;
                let max = r.max(g).max(b);
                let range = max - r.min(g).min(b);
                let sat = if max == 0.0 {
                    0.0
                } else {
                    (255.0 * range / max).round()
                };
                let hue = if range == 0.0 {
                    0.0
                } else if max == r {
                    (g - b) / range
                } else if max == g {
                    2.0 + (b - r) / range
                } else {
                    4.0 + (r - g) / range
                };
                let hbin = ((hue * 30.0).round().rem_euclid(180.0) as usize * BINS) / 180;
                let sbin = sat as usize * BINS / 256;
                sig.hs[hbin * BINS + sbin] += 1;
            }
        }
        sig
    }

    fn differs(&self, prev: &Self) -> bool {
        let abs_diff: u32 = self
            .gray
            .iter()
            .zip(&prev.gray)
            .map(|(a, b)| u32::from(a.abs_diff(*b)))
            .sum();
        let mad = f64::from(abs_diff) / (255 * W * H) as f64;
        mad >= HARD_MAD || (mad >= SOFT_MAD && correlation(&self.hs, &prev.hs) < MIN_CORRELATION)
    }
}

fn correlation(a: &[u32; BINS * BINS], b: &[u32; BINS * BINS]) -> f64 {
    let mean = (W * H) as f64 / (BINS * BINS) as f64;
    let (mut ab, mut aa, mut bb) = (0.0, 0.0, 0.0);
    for (&x, &y) in a.iter().zip(b) {
        let (x, y) = (f64::from(x) - mean, f64::from(y) - mean);
        ab += x * y;
        aa += x * x;
        bb += y * y;
    }
    let denom = (aa * bb).sqrt();
    if denom == 0.0 {
        1.0
    } else {
        ab / denom
    }
}

/// Adjacent-frame hard-cut detector with a 0.25s debounce window.
pub struct ShotCutDetector {
    previous: Option<Signature>,
    last_cut: f64,
}

impl Default for ShotCutDetector {
    fn default() -> Self {
        Self {
            previous: None,
            last_cut: -SHOT_MIN_GAP_SEC,
        }
    }
}

impl ShotCutDetector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, time: f64, rgb: &RgbImage) -> bool {
        if rgb.is_empty() {
            return false;
        }
        let sig = Signature::new(rgb);
        let cut = time - self.last_cut >= SHOT_MIN_GAP_SEC
            && self.previous.as_ref().is_some_and(|prev| sig.differs(prev));
        if cut {
            self.last_cut = time;
        }
        self.previous = Some(sig);
        cut
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    #[test]
    fn histogram_soft_cut_and_debounce() {
        let a = RgbImage::from_pixel(64, 36, Rgb([255, 0, 0]));
        let b = RgbImage::from_pixel(64, 36, Rgb([0, 0, 255]));
        let mut cut = ShotCutDetector::new();
        assert!(!cut.push(0.0, &a));
        assert!(cut.push(0.1, &b)); // MAD ~0.184: hard cut
        let c = RgbImage::from_pixel(64, 36, Rgb([0, 100, 0]));
        assert!(!cut.push(0.2, &c)); // MAD ~0.118, but debounced
        assert!(cut.push(0.4, &b)); // soft cut
        assert!(!cut.push(0.8, &b));
    }
}
