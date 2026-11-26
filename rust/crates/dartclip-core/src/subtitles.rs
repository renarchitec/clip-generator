use crate::models::{CaptionStyle, TranscriptCue as Cue, WordTiming as Word};
use regex::Regex;
use std::{fmt::Write as _, io, path::Path, sync::LazyLock};

static TIMESTAMP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:([0-9]+):)?([0-9]{1,3}):([0-9]{1,2})[.,]([0-9]{1,3})").unwrap()
});
static INLINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<[0-9]+(?::[0-9]+){1,2}[.,][0-9]+>").unwrap());
static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]*>").unwrap());
pub const WRAP_CHARS: usize = 18;
pub const MAX_WORDS_PER_CUE: usize = 4;
pub const WRAP_CHARS_WIDE: usize = 32;
pub const MAX_WORDS_PER_CUE_WIDE: usize = 6;

fn parse_timestamp(s: &str) -> Option<f64> {
    let m = TIMESTAMP.captures(s)?;
    let n = |i: usize| {
        m.get(i)
            .map(|x| x.as_str())
            .unwrap_or("0")
            .parse::<f64>()
            .ok()
    };
    Some(n(1)? * 3600. + n(2)? * 60. + n(3)? + n(4)? / 10_f64.powi(m[4].len() as i32))
}
pub fn sanitize(s: &str) -> String {
    TAG.replace_all(s, " ")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn word_timing(body: &[&str], end: f64) -> Vec<Word> {
    let mut words = Vec::new();
    let mut current = None;
    for l in body {
        let mut from = 0;
        let mut push = |chunk: &str, current: Option<f64>| {
            for text in TAG.replace_all(chunk, " ").split_whitespace() {
                let Some(start) = current else {
                    return false;
                };
                words.push(Word {
                    start,
                    end: start,
                    text: text.into(),
                });
            }
            true
        };
        for m in INLINE.find_iter(l) {
            if !push(&l[from..m.start()], current) {
                return vec![];
            }
            current = parse_timestamp(m.as_str());
            from = m.end();
        }
        if !push(&l[from..], current) {
            return vec![];
        }
    }
    for i in 0..words.len() {
        words[i].end = words.get(i + 1).map_or(end, |w| w.start);
    }
    words
}
fn tokens(c: &Cue) -> Vec<&str> {
    if c.words.is_empty() {
        c.text.split_whitespace().collect()
    } else {
        c.words.iter().map(|w| w.text.as_str()).collect()
    }
}
fn append(cues: &mut Vec<Cue>, mut cue: Cue) {
    if let Some(prev) = cues.last_mut() {
        if prev.text == cue.text {
            prev.end = prev.end.max(cue.end);
            return;
        }
        let a = tokens(prev);
        let b = tokens(&cue);
        if let Some(n) = (1..=a.len().min(b.len()))
            .rev()
            .find(|&n| a[a.len() - n..] == b[..n])
        {
            if n == b.len() {
                prev.end = prev.end.max(cue.end);
                return;
            }
            cue.text = b[n..].join(" ");
            if !cue.words.is_empty() {
                cue.words.drain(..n);
            }
        }
    }
    cues.push(cue);
}
pub fn parse_vtt(text: &str, word_level: bool) -> Vec<Cue> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<_> = normalized.split('\n').collect();
    let mut cues = Vec::new();
    let mut i = 0;
    while let Some(raw) = lines.get(i) {
        i += 1;
        let l = raw.trim();
        if let Some((left, right)) = l.split_once("-->") {
            let body = i;
            while i < lines.len() && !lines[i].trim().is_empty() {
                i += 1;
            }
            let times = parse_timestamp(left)
                .zip(right.split_whitespace().next().and_then(parse_timestamp));
            if let Some((start, end)) = times.filter(|(s, e)| e > s) {
                let words = if word_level {
                    word_timing(&lines[body..i], end)
                } else {
                    vec![]
                };
                let text = if words.is_empty() {
                    sanitize(&lines[body..i].join("\n"))
                } else {
                    words
                        .iter()
                        .map(|w| w.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                };
                if !text.is_empty() {
                    append(
                        &mut cues,
                        Cue {
                            start,
                            end,
                            text,
                            words,
                        },
                    );
                }
            }
        } else if matches!(
            l.split_whitespace()
                .next()
                .unwrap_or("")
                .to_ascii_uppercase()
                .as_str(),
            "NOTE" | "STYLE" | "REGION"
        ) {
            while i < lines.len() && !lines[i].trim().is_empty() {
                i += 1;
            }
        }
    }
    cues
}

pub fn cue_to_words(cue: &Cue) -> Vec<Word> {
    if !cue.words.is_empty() {
        return cue.words.clone();
    }
    let tokens: Vec<_> = cue.text.split_whitespace().collect();
    let total = tokens.iter().map(|s| s.chars().count() + 1).sum::<usize>() as f64;
    let mut cursor = cue.start;
    let mut words: Vec<_> = tokens
        .into_iter()
        .map(|s| {
            let start = cursor;
            cursor += cue.duration() * (s.chars().count() + 1) as f64 / total;
            Word {
                start,
                end: cursor,
                text: s.into(),
            }
        })
        .collect();
    if let Some(w) = words.last_mut() {
        w.end = cue.end;
    }
    words
}
pub fn clip_words(cues: &[Cue], start: f64, end: f64) -> Vec<Word> {
    cues.iter()
        .flat_map(cue_to_words)
        .filter_map(|mut w| {
            w.start = (w.start - start).max(0.);
            w.end = (w.end - start).min(end - start);
            (w.end > w.start).then_some(w)
        })
        .collect()
}
pub fn clip_cues(cues: &[Cue], start: f64, end: f64) -> Vec<Cue> {
    cues.iter()
        .filter_map(|c| {
            let s = c.start.max(start) - start;
            let e = c.end.min(end) - start;
            if e <= s {
                return None;
            }
            let words = c
                .words
                .iter()
                .cloned()
                .filter_map(|mut w| {
                    w.start = (w.start - start).max(0.);
                    w.end = (w.end - start).min(end - start);
                    (w.end > w.start).then_some(w)
                })
                .collect();
            Some(Cue {
                start: s,
                end: e,
                text: c.text.clone(),
                words,
            })
        })
        .collect()
}
fn timestamp(t: f64) -> String {
    let cs = (t.max(0.) * 100.).round_ties_even() as u64;
    format!(
        "{}:{:02}:{:02}.{:02}",
        cs / 360000,
        cs / 6000 % 60,
        cs / 100 % 60,
        cs % 100
    )
}
pub fn hex_to_ass_color(hex: &str, alpha: u8) -> String {
    let color = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or_default();
    format!(
        "&H{alpha:02X}{:02X}{:02X}{:02X}",
        color & 255,
        (color >> 8) & 255,
        (color >> 16) & 255
    )
}
fn render_parts(cues: &[Cue], max_words: usize, max_chars: usize) -> Vec<Vec<Word>> {
    let mut ordered: Vec<_> = cues.iter().filter(|c| c.end > c.start).collect();
    ordered.sort_by(|a, b| a.start.total_cmp(&b.start));
    let mut result = Vec::new();
    for (i, cue) in ordered.iter().enumerate() {
        let end = ordered
            .get(i + 1)
            .map_or(cue.end, |next| cue.end.min(next.start));
        if end <= cue.start {
            continue;
        }
        let mut chunk = Vec::new();
        let mut count = 0;
        let mut cursor = cue.start;
        // Python recomputes inferred timings using the shortened cue duration.
        let shortened = Cue {
            end,
            ..(*cue).clone()
        };
        for mut w in cue_to_words(&shortened) {
            w.start = w.start.max(cursor);
            w.end = w.end.min(end);
            if w.end <= w.start {
                continue;
            }
            cursor = w.end;
            let n = w.text.chars().count();
            if !chunk.is_empty() && (chunk.len() >= max_words || count + 1 + n > max_chars) {
                result.push(std::mem::take(&mut chunk));
                count = 0;
            }
            count += n + usize::from(!chunk.is_empty());
            chunk.push(w);
        }
        if !chunk.is_empty() {
            result.push(chunk);
        }
    }
    result
}

pub fn ass_text(
    cues: &[Cue],
    width: u32,
    height: u32,
    two_speakers: bool,
    style: Option<&CaptionStyle>,
) -> String {
    let wide = width > height;
    let (max_words, mut max_chars) = if wide {
        (MAX_WORDS_PER_CUE_WIDE, WRAP_CHARS_WIDE)
    } else {
        (MAX_WORDS_PER_CUE, WRAP_CHARS)
    };
    let scaled = |n: u32| (n as f64 * height as f64 / 1920.).round_ties_even() as u32;
    let margin = if two_speakers { 0 } else { scaled(180).max(1) };
    let (mut alignment, mut margin_v) = (
        if two_speakers { 5 } else { 2 },
        if two_speakers {
            0
        } else {
            margin.max((height as f64 * 0.18) as u32)
        },
    );
    let (mut font, mut size, mut primary, mut highlight, mut italic, mut uppercase, mut animate) = (
        "Anton",
        scaled(80).max(1),
        "&H00FFFFFF".to_owned(),
        "&H0000FFFF".to_owned(),
        0,
        true,
        true,
    );
    let (mut border, mut outline, mut shadow, mut outline_col, mut back) =
        (1, 6, 2, "&H00000000".to_owned(), "&H80000000".to_owned());
    let mut position = String::new();
    if let Some(style) = style {
        font = &style.font_family;
        size = scaled(style.font_size).max(1);
        primary = hex_to_ass_color(&style.primary_color, 0);
        highlight = hex_to_ass_color(&style.highlight_color, 0);
        italic = if style.italic { -1 } else { 0 };
        uppercase = style.uppercase;
        animate = style.animate;
        if style.font_size > 84 {
            max_chars = (max_chars as f64 * 80. / style.font_size as f64)
                .round_ties_even()
                .max(10.) as usize;
        }
        outline_col = hex_to_ass_color(&style.outline_color, 0);
        match style.effect.as_str() {
            "outline" => {
                outline = scaled(6).max(1);
                shadow = scaled(2).max(1);
            }
            "shadow" => {
                outline = scaled(2).max(1);
                shadow = scaled(6).max(1);
                back = hex_to_ass_color(&style.outline_color, 0x60);
            }
            "box" => {
                border = 3;
                outline = scaled(14).max(4);
                shadow = 0;
                outline_col = hex_to_ass_color(&style.outline_color, 0x45);
                back = outline_col.clone();
            }
            _ => {
                outline = 0;
                shadow = scaled(1).max(1);
            }
        }
        (alignment, margin_v) = match style.position.as_str() {
            "center" => (5, 0),
            "top" => (8, margin.max((height as f64 * 0.12) as u32)),
            "bottom" if two_speakers && style.preset != "custom" => (5, 0),
            _ => (2, margin.max((height as f64 * 0.18) as u32)),
        };
        if let Some(y) = style.position_y {
            alignment = 5;
            margin_v = 0;
            position = format!(
                r"{{\an5\pos({:.0},{:.0})}}",
                width as f64 / 2.,
                height as f64 * y
            );
        }
    }
    let mut ass=format!("[Script Info]\nScriptType: v4.00+\nWrapStyle: 2\nScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\nCollisions: Reverse\nPlayResX: {width}\nPlayResY: {height}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,{font},{size},{primary},{highlight},{outline_col},{back},-1,{italic},0,0,100,100,0,0,{border},{outline},{shadow},{alignment},80,80,{margin_v},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");
    let (pop, restore) = if animate {
        (
            r"\fscx110\fscy110\t(0,120,\fscx100\fscy100)",
            r"\fscx100\fscy100",
        )
    } else {
        ("", "")
    };
    for part in render_parts(cues, max_words, max_chars) {
        let texts: Vec<_> = part
            .iter()
            .map(|w| {
                (if uppercase {
                    w.text.to_uppercase()
                } else {
                    w.text.clone()
                })
                .replace('\\', r"\\")
                .replace('{', r"\{")
            })
            .collect();
        for (i, w) in part.iter().enumerate() {
            let _ = write!(
                ass,
                "Dialogue: 0,{},{},Default,,0,0,0,,{position}",
                timestamp(w.start),
                timestamp(w.end)
            );
            for (j, text) in texts.iter().enumerate() {
                if j > 0 {
                    ass.push(' ');
                }
                if i == j {
                    let _ = write!(
                        ass,
                        r"{{\c{highlight}&{pop}}}{text}{{\c{primary}&{restore}}}"
                    );
                } else {
                    ass.push_str(text);
                }
            }
            ass.push('\n');
        }
    }
    ass
}

#[allow(clippy::too_many_arguments)]
pub fn write_ass(
    path: impl AsRef<Path>,
    cues: &[Cue],
    start: f64,
    end: f64,
    width: u32,
    height: u32,
    two_speakers: bool,
    style: Option<&CaptionStyle>,
) -> io::Result<()> {
    std::fs::write(
        path,
        ass_text(
            &clip_cues(cues, start, end),
            width,
            height,
            two_speakers,
            style,
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn youtube_rolling_and_inline_word_timings() {
        let v="WEBVTT\r\n\r\nNOTE skip\r\n00:01.0 --> 00:02.0\r\n\r\n1\r\n00:00.0 --> 00:02.0 align:start\r\n<00:00.100><c>hello</c> <00:01.200><c>there</c>\r\n\r\n00:02,0 --> 00:04,0\r\n<00:02.000>there <00:03.000>friend!";
        let c = parse_vtt(v, true);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].words[0].end, 1.2);
        assert_eq!(c[1].text, "friend!");
        assert_eq!(c[1].words[0].start, 3.);
        assert_eq!(sanitize("<v Someone> hi&nbsp;&amp; &lt;3&gt;"), "hi & <3>");
    }
    #[test]
    fn ass_uses_position_pop_wrapping_and_nonoverlap() {
        let mut style = CaptionStyle::from_preset("hook");
        style.position_y = Some(0.35);
        let cues = [
            Cue {
                start: 1.,
                end: 4.,
                text: "one two three four five six".into(),
                words: vec![],
            },
            Cue {
                start: 3.,
                end: 5.,
                text: "last word".into(),
                words: vec![],
            },
        ];
        let s = ass_text(&cues, 1080, 1920, false, Some(&style));
        assert!(s.contains("PlayResX: 1080\nPlayResY: 1920"));
        assert!(s.contains(r"{\an5\pos(540,672)}"));
        assert!(s.contains(r"\fscx110\fscy110\t(0,120,\fscx100\fscy100)"));
        assert!(!s.contains("FOUR FIVE SIX"));
        let mut previous = "0:00:00.00";
        for line in s.lines().filter(|l| l.starts_with("Dialogue")) {
            let times: Vec<_> = line.split(',').take(3).collect();
            assert!(times[1] >= previous);
            previous = times[2];
        }
        style.animate = false;
        style.effect = "box".into();
        assert!(!ass_text(&cues, 1920, 1080, false, Some(&style)).contains("fscx110"));
    }
}
