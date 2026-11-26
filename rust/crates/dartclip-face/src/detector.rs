use std::{
    io::Cursor,
    sync::{Arc, OnceLock},
};

use anyhow::{anyhow, ensure, Context, Result};
use image::{imageops, RgbImage};
use tract_onnx::prelude::*;

const MODEL: &[u8] = include_bytes!("../models/face_detection_yunet_2023mar.onnx");
const SIDE: usize = 320;
const IOU_THRESHOLD: f32 = 0.35;
const SCORE_THRESHOLD: f32 = 0.55;
const OUTPUTS: [&str; 9] = [
    "cls_8", "obj_8", "bbox_8", "cls_16", "obj_16", "bbox_16", "cls_32", "obj_32", "bbox_32",
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FaceBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub score: f32,
}

impl FaceBox {
    pub fn cx(&self) -> f32 {
        self.x + self.w * 0.5
    }
    pub fn cy(&self) -> f32 {
        self.y + self.h * 0.5
    }
    pub fn area(&self) -> f32 {
        self.w * self.h
    }

    fn iou(self, other: Self) -> f32 {
        let w = ((self.x + self.w).min(other.x + other.w) - self.x.max(other.x)).max(0.0);
        let h = ((self.y + self.h).min(other.y + other.h) - self.y.max(other.y)).max(0.0);
        w * h / (self.area() + other.area() - w * h)
    }
}

fn suppress(mut boxes: Vec<FaceBox>) -> Vec<FaceBox> {
    boxes.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut kept = Vec::new();
    for b in boxes {
        if kept.iter().all(|&a| b.iou(a) <= IOU_THRESHOLD) {
            kept.push(b);
        }
    }
    kept
}

pub struct OnnxFaceDetector {
    plan: &'static Arc<TypedRunnableModel>,
}

impl OnnxFaceDetector {
    /// Loads and optimizes the embedded YuNet model once per process.
    pub fn new() -> Result<Self> {
        static PLAN: OnceLock<Result<Arc<TypedRunnableModel>, String>> = OnceLock::new();
        let plan = PLAN.get_or_init(|| {
            (|| -> Result<_> {
                // OpenCV's export annotates intermediate shapes at 640x640.
                // Re-infer them for our smaller, stride-aligned input.
                let mut model = tract_onnx::onnx()
                    .with_ignore_value_info(true)
                    .with_ignore_output_shapes(true)
                    .model_for_read(&mut Cursor::new(MODEL))?;
                model.select_outputs_by_name(OUTPUTS)?;
                Ok(model
                    .with_input_fact(0, f32::fact([1, 3, SIDE, SIDE]).into())?
                    .into_optimized()?
                    .into_runnable()?)
            })()
            .map_err(|e| format!("{e:#}"))
        });
        Ok(Self {
            plan: plan
                .as_ref()
                .map_err(|e| anyhow!("could not load embedded YuNet: {e}"))?,
        })
    }

    /// Detects faces (highest score first) in a packed RGB24 image.
    pub fn detect(&self, image: &RgbImage) -> Result<Vec<FaceBox>> {
        ensure!(image.width() > 0 && image.height() > 0, "empty image");
        // Preserve aspect ratio: the 320x320 YuNet input is zero-padded on the
        // right/bottom. YuNet expects raw 0..255 planar BGR, not RGB or 0..1.
        let scale = SIDE as f64 / image.width().max(image.height()) as f64;
        let w = (image.width() as f64 * scale).round().max(1.0) as usize;
        let h = (image.height() as f64 * scale).round().max(1.0) as usize;
        let resized = imageops::resize(image, w as u32, h as u32, imageops::FilterType::Triangle);
        let mut input = vec![0.0f32; 3 * SIDE * SIDE];
        for (x, y, pixel) in resized.enumerate_pixels() {
            let i = y as usize * SIDE + x as usize;
            for c in 0..3 {
                input[c * SIDE * SIDE + i] = f32::from(pixel[2 - c]);
            }
        }
        let tensor = Tensor::from_shape(&[1, 3, SIDE, SIDE], &input)?;
        let outputs = self
            .plan
            .run(tvec!(tensor.into()))
            .context("YuNet inference")?;
        let mut boxes = Vec::new();
        for (i, stride) in [8, 16, 32].into_iter().enumerate() {
            let cls = outputs[3 * i].try_as_plain_ram()?.as_slice::<f32>()?;
            let obj = outputs[3 * i + 1].try_as_plain_ram()?.as_slice::<f32>()?;
            let bbox = outputs[3 * i + 2].try_as_plain_ram()?.as_slice::<f32>()?;
            let grid = SIDE / stride;
            ensure!(
                cls.len() == grid * grid && obj.len() == cls.len() && bbox.len() == cls.len() * 4,
                "unexpected YuNet stride-{stride} output shapes"
            );
            for (j, b) in bbox.chunks_exact(4).enumerate() {
                let score = (cls[j].clamp(0.0, 1.0) * obj[j].clamp(0.0, 1.0)).sqrt();
                if !score.is_finite() || score < SCORE_THRESHOLD || !b.iter().all(|v| v.is_finite())
                {
                    continue;
                }
                let cx = (j % grid) as f32 + b[0];
                let cy = (j / grid) as f32 + b[1];
                let (hw, hh) = (b[2].exp() * 0.5, b[3].exp() * 0.5);
                let (sx, sy) = (stride as f32 / w as f32, stride as f32 / h as f32);
                if !(0.0..=1.0).contains(&(cx * sx)) || !(0.0..=1.0).contains(&(cy * sy)) {
                    continue; // anchor regressed into padded pixels
                }
                let x = ((cx - hw) * sx).clamp(0.0, 1.0);
                let y = ((cy - hh) * sy).clamp(0.0, 1.0);
                let w = ((cx + hw) * sx).clamp(0.0, 1.0) - x;
                let h = ((cy + hh) * sy).clamp(0.0, 1.0) - y;
                if w > 0.0 && h > 0.0 {
                    boxes.push(FaceBox { x, y, w, h, score });
                }
            }
        }
        Ok(suppress(boxes))
    }

    /// Detects in a pixel rectangle `(x, y, width, height)`, returning boxes
    /// normalized against the full image, not against the crop.
    pub fn detect_region(
        &self,
        image: &RgbImage,
        region: (u32, u32, u32, u32),
    ) -> Result<Vec<FaceBox>> {
        let (x, y, w, h) = region;
        ensure!(
            w > 0
                && h > 0
                && x <= image.width().saturating_sub(w)
                && y <= image.height().saturating_sub(h)
                && w <= image.width()
                && h <= image.height(),
            "face detection region is outside the image"
        );
        let crop = imageops::crop_imm(image, x, y, w, h).to_image();
        let mut found = self.detect(&crop)?;
        let (fw, fh) = (image.width() as f32, image.height() as f32);
        for b in &mut found {
            b.x = (x as f32 + b.x * w as f32) / fw;
            b.y = (y as f32 + b.y * h as f32) / fh;
            b.w *= w as f32 / fw;
            b.h *= h as f32 / fh;
        }
        Ok(found)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn embedded_model_detects_a_portrait_and_remaps_crop() -> Result<()> {
        let start = Instant::now();
        let detector = OnnxFaceDetector::new()?;
        let load = start.elapsed();
        let frame =
            image::load_from_memory(include_bytes!("../tests/fixtures/astronaut.png"))?.into_rgb8();
        let start = Instant::now();
        let full = detector.detect(&frame)?;
        let inference = start.elapsed();
        let b = full
            .first()
            .context("expected a face in the NASA astronaut portrait")?;
        assert!((0.35..0.45).contains(&b.cx()), "{b:?}");
        assert!((0.16..0.28).contains(&b.cy()), "{b:?}");
        assert!(b.score >= SCORE_THRESHOLD);
        let crop = detector.detect_region(&frame, (100, 15, 220, 220))?;
        assert!((crop[0].cx() - b.cx()).abs() < 0.035);
        assert!((crop[0].cy() - b.cy()).abs() < 0.035);
        assert!(detector.detect(&RgbImage::new(320, 180))?.is_empty());
        eprintln!("YuNet plan: {load:.2?}; portrait inference (including preprocessing and NMS): {inference:.2?}");
        Ok(())
    }

    #[test]
    fn nms_keeps_highest_score_and_distinct_boxes() {
        let a = FaceBox {
            x: 0.1,
            y: 0.1,
            w: 0.2,
            h: 0.2,
            score: 0.9,
        };
        let b = FaceBox {
            x: 0.11,
            score: 0.8,
            ..a
        };
        let c = FaceBox {
            x: 0.55,
            score: 0.7,
            ..a
        };
        assert_eq!(suppress(vec![b, c, a]), vec![a, c]);
    }
}
