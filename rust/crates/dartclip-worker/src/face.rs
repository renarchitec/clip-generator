use std::path::Path;

use anyhow::Result;
use dartclip_core::pipeline::{FaceAnalyzer, FacecamBox, SpeakerSegment};
use dartclip_face::reframe;

pub(crate) struct YuNet;

impl FaceAnalyzer for YuNet {
    fn track_active_speaker(
        &self,
        path: &Path,
        start: f64,
        end: f64,
    ) -> Result<Vec<SpeakerSegment>> {
        let tracks = reframe::try_track_active_speaker(path, start, end)?;
        Ok(tracks
            .iter()
            .enumerate()
            .map(|(i, track)| {
                (
                    track.start,
                    tracks.get(i + 1).map_or(end - start, |next| next.start),
                    track.center_x,
                )
            })
            .collect())
    }

    fn detect_two_speakers(&self, path: &Path, start: f64, end: f64) -> Result<Option<(f64, f64)>> {
        Ok(reframe::detect_two_speakers(path, start, end))
    }

    fn detect_facecam_box(
        &self,
        path: &Path,
        start: f64,
        end: f64,
        cached: Option<FacecamBox>,
    ) -> Result<Option<FacecamBox>> {
        reframe::try_detect_facecam_box(path, start, end, cached)
    }

    fn detect_cover_face_focus(&self, path: &Path) -> Option<(f32, f32)> {
        reframe::detect_cover_face_focus(path)
    }
}
