use crate::models::{CaptionStyle, TranscriptCue as Cue, WordTiming as Word};
use regex::Regex;
use std::{fmt::Write as _, io, path::Path, sync::LazyLock};

static TIMESTAMP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:([0-9]+):)?([0-9]{1,3}):([0-9]{1,2})[.,]([0-9]{1,3})").unwrap()
});
static INLINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<(?:(?:[0-9]+):)?[0-9]{1,3}:[0-9]{1,2}[.,][0-9]{1,3}>").unwrap());
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
pub const MAX_TAIL_WORD_SEC: f64 = 1.2;
pub const MAX_WORD_DISPLAY_SEC: f64 = 0.9;
pub const MAX_INTRA_CHUNK_PAUSE_SEC: f64 = 0.25;
pub const MAX_CHUNK_LEAD_SEC: f64 = 0.9;
pub const MAX_CHUNK_LEAD_SEC_WIDE: f64 = 1.4;

pub(crate) fn ends_sentence(text: &str) -> bool {
    text.trim_end_matches(['"', '\'', '”', '’', ')', ']'])
        .ends_with(['.', '?', '!'])
}

static CAPTION_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[♪♫♬♩]+|[^\s♪♫♬♩]+").unwrap());
static ANNOTATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[[^\]]*\]|\(([^()\[\]]{1,40})\)").unwrap());
static CENSOR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:_+|\*+)$").unwrap());
static MASKED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:[A-Za-z]+\*+[A-Za-z*]*|\*+[A-Za-z]+[A-Za-z*]*)$").unwrap());
const EXPRESSIONS: &[&str] = &[
    "tertawa",
    "tawa",
    "musik",
    "tepuk tangan",
    "bersorak",
    "sorakan",
    "menangis",
    "tangisan",
    "menghela napas",
    "napas",
    "batuk",
    "berdeham",
    "hening",
    "diam",
    "sensor",
    "disensor",
    "bleep",
    "bip",
    "efek suara",
    "laughter",
    "laughs",
    "laughing",
    "chuckles",
    "giggles",
    "music",
    "singing",
    "applause",
    "cheering",
    "cheers",
    "clapping",
    "crying",
    "sobbing",
    "sighs",
    "sighing",
    "gasps",
    "groans",
    "coughs",
    "clears throat",
    "silence",
    "inaudible",
    "unintelligible",
    "crosstalk",
    "censored",
    "expletive",
    "beep",
    "sound effect",
    "foreign",
    "speaking foreign language",
];

// Offsets are byte offsets into the decoded text. Hidden tokens are returned
// as well: in an inline cue they still delimit adjacent spoken words.
pub(crate) fn caption_tokens(text: &str) -> Vec<(usize, &str, bool)> {
    let mut tokens = Vec::new();
    let mut cursor = 0;
    fn push<'a>(out: &mut Vec<(usize, &'a str, bool)>, text: &'a str, start: usize, end: usize) {
        for found in CAPTION_TOKEN.find_iter(&text[start..end]) {
            let token = found.as_str();
            let core = token.trim_matches(|c| ".,!?;:\"'()—–-".contains(c));
            let hidden = token.starts_with(['♪', '♫', '♬', '♩'])
                || token.chars().all(|c| ".,;:!?".contains(c))
                || (core.len() >= 2 && CENSOR.is_match(core))
                || MASKED.is_match(core);
            out.push((start + found.start(), token, !hidden));
        }
    }
    for m in ANNOTATION.captures_iter(text) {
        if let Some(inner) = m.get(1) {
            let expr = inner
                .as_str()
                .to_lowercase()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            if !EXPRESSIONS.contains(&expr.as_str()) && !CENSOR.is_match(&expr) {
                continue;
            }
        }
        let m = m.get(0).unwrap();
        push(&mut tokens, text, cursor, m.start());
        tokens.push((m.start(), m.as_str(), false));
        cursor = m.end();
    }
    push(&mut tokens, text, cursor, text.len());
    tokens
}

pub fn sanitize(s: &str) -> String {
    let untagged = TAG.replace_all(s, " ");
    let decoded = html_escape::decode_html_entities(&untagged);
    caption_tokens(&decoded)
        .into_iter()
        .filter_map(|(_, token, keep)| keep.then_some(token))
        .collect::<Vec<_>>()
        .join(" ")
}

fn word_timing(body: &[&str], start: f64, end: f64) -> Vec<Word> {
    let Some(first) = body.iter().position(|line| INLINE.is_match(line)) else {
        return vec![];
    };
    let raw = body[first..].join(" ");
    let mut text = String::new();
    let mut offsets = Vec::new();
    let mut current = start;
    let mut cursor = 0;
    for tag in TAG.find_iter(&raw) {
        offsets.push((text.len(), current));
        text.push_str(&html_escape::decode_html_entities(
            &raw[cursor..tag.start()],
        ));
        text.push(' ');
        if INLINE
            .find(tag.as_str())
            .is_some_and(|m| m.len() == tag.len())
        {
            current = parse_timestamp(tag.as_str()).unwrap_or(current);
        }
        cursor = tag.end();
    }
    offsets.push((text.len(), current));
    text.push_str(&html_escape::decode_html_entities(&raw[cursor..]));
    let mut words: Vec<_> = caption_tokens(&text)
        .into_iter()
        .map(|(pos, token, keep)| {
            let start = offsets[offsets.partition_point(|&(off, _)| off <= pos) - 1].1;
            (
                Word {
                    start,
                    end: start,
                    text: token.into(),
                },
                keep,
            )
        })
        .collect();
    let mut i = 0;
    while i < words.len() {
        let start = words[i].0.start;
        let j = i
            + 1
            + words[i + 1..]
                .iter()
                .take_while(|(w, _)| w.start <= start)
                .count();
        let group_end = words
            .get(j)
            .map_or(end.min(start + MAX_TAIL_WORD_SEC).max(start), |(w, _)| {
                w.start
            });
        // As in worker captions, tied words share the interval by character weight.
        let total = words[i..j]
            .iter()
            .map(|(w, _)| w.text.chars().count() + 1)
            .sum::<usize>() as f64;
        let mut cursor = start;
        for (word, _) in &mut words[i..j] {
            word.start = cursor;
            cursor += (group_end - start) * (word.text.chars().count() + 1) as f64 / total;
            word.end = cursor;
        }
        words[j - 1].0.end = group_end;
        i = j;
    }
    words
        .into_iter()
        .filter_map(|(w, keep)| keep.then_some(w))
        .collect()
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
            if prev.words.is_empty() {
                prev.end = prev.end.max(cue.end);
            }
            return;
        }
        let a = tokens(prev);
        let b = tokens(&cue);
        if cue.words.is_empty() && cue.duration() <= 0.05 + 1e-12 && b.ends_with(&a) {
            return;
        }
        if let Some(n) = (1..=a.len().min(b.len()))
            .rev()
            .find(|&n| a[a.len() - n..] == b[..n])
        {
            if n == b.len() {
                if prev.words.is_empty() {
                    prev.end = prev.end.max(cue.end);
                }
                return;
            }
            cue.text = b[n..].join(" ");
            if !cue.words.is_empty() {
                cue.words.drain(..n);
                cue.start = cue.words[0].start;
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
            while i < lines.len() && !lines[i].is_empty() {
                i += 1;
            }
            let times = parse_timestamp(left)
                .zip(right.split_whitespace().next().and_then(parse_timestamp));
            if let Some((start, end)) = times.filter(|(s, e)| e > s) {
                let timed = word_level && lines[body..i].iter().any(|line| INLINE.is_match(line));
                let words = if timed {
                    word_timing(&lines[body..i], start, end)
                } else {
                    vec![]
                };
                if timed && words.is_empty() {
                    continue;
                }
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
                            start: words.first().map_or(start, |w| w.start),
                            end: words.last().map_or(end, |w| w.end),
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
            while i < lines.len() && !lines[i].is_empty() {
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
            let words = clip_words(std::slice::from_ref(c), start, end);
            Some(Cue {
                start: words.first()?.start,
                end: words.last()?.end,
                text: words
                    .iter()
                    .map(|w| w.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
                words,
            })
        })
        .collect()
}

fn render_words(cue: &Cue) -> Vec<Word> {
    if cue.words.is_empty() {
        return cue_to_words(&Cue {
            text: sanitize(&cue.text),
            ..cue.clone()
        });
    }
    let mut text = String::new();
    let mut offsets = Vec::new();
    for word in &cue.words {
        offsets.push(text.len());
        text.push_str(&html_escape::decode_html_entities(&word.text));
        text.push(' ');
    }
    let mut visible = vec![Vec::new(); cue.words.len()];
    for (offset, token, keep) in caption_tokens(&text) {
        if keep {
            visible[offsets.partition_point(|&o| o <= offset) - 1].push(token);
        }
    }
    cue.words
        .iter()
        .zip(visible)
        .filter(|(_, tokens)| !tokens.is_empty())
        .map(|(word, tokens)| Word {
            text: tokens.join(" "),
            ..word.clone()
        })
        .collect()
}
pub(crate) fn clip_caption_cues(cues: &[Cue], start: f64, end: f64) -> Vec<Cue> {
    // Recognize annotations that cross the clip boundary before discarding their
    // opening or closing tokens, without changing existing speech times.
    let clean: Vec<_> = cues
        .iter()
        .filter_map(|cue| {
            let words = render_words(cue);
            (!words.is_empty()).then(|| Cue {
                words,
                ..cue.clone()
            })
        })
        .collect();
    clip_cues(&clean, start, end)
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
fn render_parts(
    cues: &[Cue],
    max_words: usize,
    max_chars: usize,
    max_lead_sec: f64,
) -> Vec<Vec<Word>> {
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
        let timed = !cue.words.is_empty();
        let mut chunk = Vec::<Word>::new();
        let mut count = 0;
        let mut cursor = cue.start;
        // Python recomputes inferred timings using the shortened cue duration.
        let shortened = Cue {
            end,
            ..(*cue).clone()
        };
        let words = render_words(&shortened);
        let last_idx = words.len().saturating_sub(1);
        for (idx, mut w) in words.into_iter().enumerate() {
            w.start = w.start.max(cursor);
            w.end = w.end.min(end);
            if timed && idx < last_idx {
                w.end = w.end.min(w.start + MAX_WORD_DISPLAY_SEC);
            }
            if w.end <= w.start {
                continue;
            }
            cursor = w.end;
            let n = w.text.chars().count();
            if let Some(prev) = chunk.last() {
                if chunk.len() >= max_words
                    || count + 1 + n > max_chars
                    || w.start - prev.end >= MAX_INTRA_CHUNK_PAUSE_SEC
                    || ends_sentence(&prev.text)
                    || (timed && w.start - chunk[0].start > max_lead_sec)
                {
                    result.push(std::mem::take(&mut chunk));
                    count = 0;
                }
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
    let (max_words, mut max_chars, max_lead_sec) = if wide {
        (
            MAX_WORDS_PER_CUE_WIDE,
            WRAP_CHARS_WIDE,
            MAX_CHUNK_LEAD_SEC_WIDE,
        )
    } else {
        (MAX_WORDS_PER_CUE, WRAP_CHARS, MAX_CHUNK_LEAD_SEC)
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
    for part in render_parts(cues, max_words, max_chars, max_lead_sec) {
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
            &clip_caption_cues(cues, start, end),
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

    fn timed_cue(timings: &[(f64, f64, &str)]) -> Cue {
        Cue {
            start: timings[0].0,
            end: timings.last().unwrap().1,
            text: timings
                .iter()
                .map(|&(_, _, text)| text)
                .collect::<Vec<_>>()
                .join(" "),
            words: timings
                .iter()
                .map(|&(start, end, text)| Word {
                    start,
                    end,
                    text: text.into(),
                })
                .collect(),
        }
    }

    fn small_font_ass(cue: Cue, (width, height): (u32, u32)) -> String {
        let mut style = CaptionStyle::from_preset("hook");
        style.font_size = 60;
        style.uppercase = false;
        ass_text(&[cue], width, height, false, Some(&style))
    }

    fn dialogue_texts(ass: &str) -> Vec<String> {
        let tags = Regex::new(r"\{[^}]*\}").unwrap();
        ass.lines()
            .filter(|line| line.starts_with("Dialogue: "))
            .map(|line| {
                tags.replace_all(line.splitn(10, ',').nth(9).unwrap(), "")
                    .into_owned()
            })
            .collect()
    }

    #[test]
    fn timed_ass_splits_at_quarter_second_pause() {
        for dimensions in [(1080, 1920), (1920, 1080)] {
            let cue = timed_cue(&[(0., 0.25, "one"), (0.5, 0.75, "two")]);
            assert_eq!(
                dialogue_texts(&small_font_ass(cue, dimensions)),
                ["one", "two"]
            );
        }
    }

    #[test]
    fn timed_ass_splits_at_sentence_endings() {
        for dimensions in [(1080, 1920), (1920, 1080)] {
            for ending in ["one.", "one?", "one!", "one.\"", "one?’", "one!)]"] {
                let cue = timed_cue(&[(0., 0.25, ending), (0.25, 0.5, "two")]);
                assert_eq!(
                    dialogue_texts(&small_font_ass(cue, dimensions)),
                    [ending, "two"]
                );
            }
        }
    }

    #[test]
    fn timed_ass_splits_only_above_orientation_lead_cap() {
        for (dimensions, last_start, split) in [
            ((1080, 1920), 0.9, false),
            ((1080, 1920), 0.91, true),
            ((1920, 1080), 0.91, false),
            ((1920, 1080), 1.4, false),
            ((1920, 1080), 1.41, true),
        ] {
            let cue = timed_cue(&[
                (0., 0.6, "one"),
                (0.6, last_start, "two"),
                (last_start, last_start + 0.2, "go"),
            ]);
            let expected = if split {
                ["one two", "one two", "go"]
            } else {
                ["one two go"; 3]
            };
            assert_eq!(dialogue_texts(&small_font_ass(cue, dimensions)), expected);
        }
    }

    #[test]
    fn timed_ass_keeps_fast_fluent_words_together() {
        let cue = timed_cue(&[
            (0., 0.2, "we"),
            (0.2, 0.4, "can"),
            (0.4, 0.6, "go"),
            (0.6, 0.8, "now"),
        ]);
        assert_eq!(
            dialogue_texts(&small_font_ass(cue, (1080, 1920))),
            ["we can go now"; 4]
        );
    }

    #[test]
    fn timed_ass_caps_stretched_mid_cue_word_and_splits_before_next_word() {
        let cue = timed_cue(&[(0., 1.25, "one"), (1.25, 2.45, "two")]);
        // In landscape the lead cap alone would not split these words.
        let ass = small_font_ass(cue, (1920, 1080));
        assert_eq!(dialogue_texts(&ass), ["one", "two"]);
        assert!(ass.contains("Dialogue: 0,0:00:00.00,0:00:00.90,"));
        assert!(ass.contains("Dialogue: 0,0:00:01.25,0:00:02.45,"));
    }

    #[test]
    fn spaces_and_rolling_lines_preserve_cue_start_and_cap_tail() {
        let vtt = "WEBVTT\n\nNOTE\n \n00:01.000 --> 00:02.000\nignored\n\n\
                   02:41.000 --> 02:43.000\n \nDean<02:42.239><c> KT.</c>\n\n\
                   02:43.000 --> 02:43.010\nDean KT.\n\n\
                   02:43.010 --> 02:50.000\nDean KT.\nAku<02:43.500><c> pergi</c>\n\n\
                   02:50.000 --> 02:50.010\npergi\n\n\
                   02:58.000 --> 02:58.500\n \nYa.\n";
        let cues = parse_vtt(vtt, true);
        assert_eq!(
            cues.iter().map(|c| c.text.as_str()).collect::<Vec<_>>(),
            ["Dean KT.", "Aku pergi", "Ya."]
        );
        assert_eq!((cues[0].start, cues[0].words[0].end), (161., 162.239));
        assert_eq!(
            (cues[1].start, cues[1].words[0].end, cues[1].end),
            (163.01, 163.5, 164.7)
        );
        assert!(cues[2].words.is_empty());
    }

    #[test]
    fn tied_words_and_suffix_snapshot() {
        let vtt = "00:01.000 --> 00:02.000\nawal<00:01.500><c> kata</c>\n\n\
                   00:02.000 --> 00:03.200\nawal kata\nkata<00:02.400><c> ada ada</c><00:03.000><c> lagi</c>\n\n\
                   00:03.200 --> 00:03.210\nkata ada ada lagi\n \n";
        let cues = parse_vtt(vtt, true);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[1].text, "ada ada lagi");
        assert_eq!(cues[1].start, 2.4);
        assert!((cues[1].words[0].end - 2.7).abs() < 1e-10);
        assert_eq!(cues[1].words[1].end, 3.);
        let weighted = parse_vtt("00:01.0 --> 00:07.0\n<00:02.0>a longer<00:05.0>b", true);
        assert!((weighted[0].words[0].end - (2. + 3. * 2. / 9.)).abs() < 1e-10);
        assert_eq!(weighted[0].end, 6.2);
    }

    #[test]
    fn annotations_censors_entities_and_hidden_word_boundaries() {
        assert_eq!(sanitize("Halo [tertawa] [Musik] [laughter] [&nbsp;__&nbsp;] (APPLAUSE) (clears throat) (_) (***) ♪♫♬♩ f*** an***g __ *** b*tch! -*ck- ? , {kurung} &amp; (katanya) 2*3 &lt;3 &gt;2 &#39;ya&#39; &quot;oke&quot;"), "Halo {kurung} & (katanya) 2*3 <3 >2 'ya' \"oke\"");
        for hidden in [
            "[&nbsp;__&nbsp;]",
            "[tertawa]",
            "(tepuk tangan)",
            "f***!",
            "__",
            "♪",
        ] {
            let vtt = format!("00:01.000 --> 00:04.000\nrollup\n{hidden}<00:01.500><c> sebelum</c><00:02.000><c> {hidden}</c><00:02.500><c> sesudah</c><00:03.000><c> [Musik]</c>");
            let cues = parse_vtt(&vtt, true);
            assert_eq!(cues[0].text, "sebelum sesudah");
            assert_eq!(
                cues[0]
                    .words
                    .iter()
                    .map(|w| (w.start, w.end))
                    .collect::<Vec<_>>(),
                [(1.5, 2.), (2.5, 3.)]
            );
        }
        assert!(parse_vtt(
            "00:01.0 --> 00:04.0\nprior speech\n[Musik]<00:02.0><c> [__]</c>",
            true
        )
        .is_empty());
        let split = parse_vtt(
            "00:01.0 --> 00:06.0\nHalo<00:02.0>[<00:02.5>__<00:03.0>]<00:04.0>lagi",
            true,
        );
        assert_eq!(split[0].text, "Halo lagi");
        assert_eq!((split[0].words[0].end, split[0].words[1].start), (2., 4.));
    }

    #[test]
    fn clip_slices_words_and_discard_silence() {
        let plain = Cue {
            start: 0.,
            end: 4.,
            text: "aa bb cc dd".into(),
            words: vec![],
        };
        let timed = Cue {
            words: cue_to_words(&plain),
            ..plain.clone()
        };
        for cue in [plain, timed] {
            let c = clip_cues(&[cue], 1.5, 2.5);
            assert_eq!(c[0].text, "bb cc");
            assert_eq!(
                c[0].words
                    .iter()
                    .map(|w| (w.start, w.end))
                    .collect::<Vec<_>>(),
                [(0., 0.5), (0.5, 1.)]
            );
        }
        let cue = Cue {
            start: 0.,
            end: 20.,
            text: "speech".into(),
            words: vec![Word {
                start: 6.,
                end: 7.,
                text: "speech".into(),
            }],
        };
        assert!(clip_cues(std::slice::from_ref(&cue), 2., 5.).is_empty());
        let c = clip_cues(&[cue], 5., 9.);
        assert_eq!((c[0].start, c[0].end), (1., 2.));
    }

    #[test]
    fn ass_filters_across_word_boundaries_without_moving_speech() {
        let cue = Cue {
            start: 0.,
            end: 2.,
            text: "[tertawa] halo [ __ ]".into(),
            words: [
                (0., 0.5, "[tertawa]"),
                (0.5, 1., "halo"),
                (1., 1.2, "["),
                (1.2, 1.4, "__"),
                (1.4, 2., "]"),
            ]
            .into_iter()
            .map(|(start, end, text)| Word {
                start,
                end,
                text: text.into(),
            })
            .collect(),
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.ass");
        write_ass(&path, &[cue], 0., 2., 1080, 1920, false, None).unwrap();
        let ass = std::fs::read_to_string(path).unwrap();
        let events: Vec<_> = ass.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        assert_eq!(events.len(), 1);
        assert!(events[0].contains("0:00:00.50,0:00:01.00"));
        assert!(events[0].contains("HALO"));
        assert!(!events[0].contains(['[', ']']));
    }

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
