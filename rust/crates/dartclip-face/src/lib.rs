//! Local video face analysis. Inference is pure Rust; video inputs require
//! `ffmpeg` and `ffprobe` on PATH. Cover PNGs need no external program.

pub mod detector;
pub mod frames;
pub mod reframe;
pub mod shot_cut;

pub use detector::{FaceBox, OnnxFaceDetector};
pub use reframe::{
    detect_cover_face_focus, detect_facecam_box, detect_two_speakers, facecam_box_matches_window,
    track_active_speaker, FacecamBox, TrackSegment,
};
