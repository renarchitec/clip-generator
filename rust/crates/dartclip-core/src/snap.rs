use crate::models::TranscriptCue;

pub const SNAP_WINDOW: f64 = 3.;
pub const END_SNAP_WINDOW: f64 = 6.;
pub const PAUSE_GAP: f64 = 0.4;
pub const START_PAD: f64 = 0.15;
pub const END_PAD: f64 = 0.25;
pub const MIN_SNAP_SECONDS: f64 = 1.;

fn ends_sentence(c: &TranscriptCue) -> bool {
    c.text.trim_end().ends_with(['.', '?', '!', '…'])
}
pub fn snap_window(
    cues: &[TranscriptCue],
    start: f64,
    end: f64,
    min_duration: f64,
    max_duration: f64,
) -> (f64, f64) {
    let Some(last) = cues.last() else {
        return (start, end);
    };
    let strong = |i: usize| {
        ends_sentence(&cues[i])
            || cues
                .get(i + 1)
                .is_some_and(|next| next.start - cues[i].end >= PAUSE_GAP)
    };
    let picked_start = cues
        .iter()
        .enumerate()
        .filter(|(_, c)| (start - SNAP_WINDOW..=start).contains(&c.start))
        .min_by(|(i, a), (j, b)| {
            ((*j > 0 && strong(j - 1)).cmp(&(*i > 0 && strong(i - 1))))
                .then_with(|| b.start.total_cmp(&a.start))
        })
        .map_or(start, |(_, c)| c.start);
    let picked_end = cues
        .iter()
        .enumerate()
        .filter(|(i, c)| {
            (end..=end
                + if strong(*i) {
                    END_SNAP_WINDOW
                } else {
                    SNAP_WINDOW
                })
                .contains(&c.end)
        })
        .min_by(|(i, a), (j, b)| {
            strong(*j)
                .cmp(&strong(*i))
                .then_with(|| a.end.total_cmp(&b.end))
        })
        .map_or(end, |(_, c)| c.end);
    let (mut start, mut end) = (
        (picked_start - START_PAD).max(0.),
        (picked_end + END_PAD).min(last.end),
    );
    if end - start > max_duration {
        start = (end - max_duration).max(0.);
    } else if end - start < min_duration {
        end = (start + min_duration).min(last.end);
        start = (end - min_duration).max(0.);
    }
    (start, end)
}

pub fn snap_windows(
    cues: &[TranscriptCue],
    windows: &[(f64, f64)],
    min_duration: f64,
    max_duration: f64,
) -> Vec<(f64, f64)> {
    let mut snapped: Vec<_> = windows
        .iter()
        .map(|&(s, e)| snap_window(cues, s, e, min_duration, max_duration))
        .collect();
    let mut order: Vec<_> = (0..snapped.len()).collect();
    order.sort_by(|&a, &b| snapped[a].0.total_cmp(&snapped[b].0));
    let mut previous_end = 0.;
    for i in order {
        let (mut s, mut e) = snapped[i];
        s = s.max(previous_end);
        if e - s < MIN_SNAP_SECONDS {
            e = s;
        }
        snapped[i] = (s, e);
        previous_end = e;
    }
    snapped
}
#[cfg(test)]
mod tests {
    use super::*;
    fn cue(start: f64, end: f64, text: &str) -> TranscriptCue {
        TranscriptCue {
            start,
            end,
            text: text.into(),
            words: vec![],
        }
    }
    #[test]
    fn prefers_punctuation_and_pause_over_nearest_weak_boundary() {
        let cues = [
            cue(0., 1., "Intro."),
            cue(1., 3., "new"),
            cue(3., 5., "thought"),
            cue(5., 8., "here"),
            cue(8.5, 10., "next…"),
        ];
        assert_eq!(snap_window(&cues, 3.25, 4.8, 1., 15.), (0.85, 8.25));
        assert_eq!(snap_window(&cues, 3.25, 4.8, 1., 4.), (4.25, 8.25));
    }
    #[test]
    fn overlap_removal_preserves_input_order_and_collapses_consumed_windows() {
        assert_eq!(
            snap_windows(&[], &[(4., 4.5), (1., 5.), (3., 8.)], 1., 10.),
            vec![(8., 8.), (1., 5.), (5., 8.)]
        );
    }
}
