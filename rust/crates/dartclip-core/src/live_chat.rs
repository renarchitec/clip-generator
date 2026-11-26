//! Seek-sampled YouTube replay and heatmap fallback.
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{sync::LazyLock, time::Duration};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

pub type Window = (f64, f64);
pub const MAX_FULL_AUDIO_STT_SEC: f64 = 1200.0;
const MAX_CHAT_CONCURRENCY: usize = 6;
const WINDOW_SEC: f64 = 80.;
const REPLAY_ENDPOINT: &str = "https://www.youtube.com/youtubei/v1/live_chat/get_live_chat_replay";

static KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""INNERTUBE_API_KEY"\s*:\s*"([^"\\]+)""#).unwrap());
static VERSION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"\\]+)""#).unwrap());
static RENDERER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""liveChatRenderer"\s*:\s*"#).unwrap());
static RELOAD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""reloadContinuationData"\s*:\s*"#).unwrap());
static HEATMAP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#""(?:macroMarkersListRenderer|heatmap|most_replayed)"\s*:\s*"#).unwrap()
});
static REACTION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:(?:wk){2,}w?|(?:ha){2,}h?|(?:he){2,}h?|ngakak|kocak|anjir|anjay|gokil|gila|parah|clip|klip|lmao|lol|wtf|omg|gg)\b|[😂🤣💀😭🔥]").unwrap()
});
static EMPHASIS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b[WL]\b|!{3,}|\b[A-Z]{4,}\b").unwrap());

fn embedded<'a>(html: &'a str, re: &'a Regex) -> impl Iterator<Item = Value> + 'a {
    re.find_iter(html).filter_map(|m| {
        Value::deserialize(&mut serde_json::Deserializer::from_str(&html[m.end()..])).ok()
    })
}
fn continuation(data: &Value) -> Option<&str> {
    data["continuation"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| match data {
            Value::Object(o) => o.values().find_map(continuation),
            Value::Array(a) => a.iter().find_map(continuation),
            _ => None,
        })
}
#[derive(Clone)]
struct Bootstrap {
    key: String,
    version: String,
    token: String,
}
fn bootstrap(html: &str) -> Option<Bootstrap> {
    let key = KEY.captures(html)?[1].to_owned();
    let version = VERSION
        .captures(html)
        .map_or_else(|| "2.20250101.00.00".into(), |m| m[1].into());
    let token = embedded(html, &RENDERER)
        .chain(embedded(html, &RELOAD))
        .find_map(|data| {
            continuation(&data["continuations"])
                .or_else(|| continuation(&data))
                .map(str::to_owned)
        })?;
    Some(Bootstrap {
        key,
        version,
        token,
    })
}

pub(crate) fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.trim().parse().ok())
        .filter(|n| n.is_finite())
}
fn items(v: &Value) -> &[Value] {
    v.as_array().map_or(&[], Vec::as_slice)
}

pub fn parse_chat_actions(actions: &[Value], anchor: f64, radius: f64) -> (usize, f64, f64) {
    let (mut count, mut reactions) = (0, 0);
    let (mut first, mut last) = (f64::INFINITY, f64::NEG_INFINITY);
    for entry in actions {
        let replay = &entry["replayChatItemAction"];
        let Some(sec) = number(&replay["videoOffsetTimeMsec"]).map(|n| n / 1000.) else {
            continue;
        };
        if !(anchor - radius..=anchor + radius).contains(&sec) {
            continue;
        }
        for action in items(&replay["actions"]) {
            let mut text = String::new();
            for run in items(
                &action["addChatItemAction"]["item"]["liveChatTextMessageRenderer"]["message"]
                    ["runs"],
            ) {
                if let Some(s) = run["text"].as_str() {
                    text.push_str(s);
                } else {
                    let emoji = &run["emoji"];
                    for s in items(&emoji["shortcuts"])
                        .iter()
                        .chain(std::iter::once(&emoji["emojiId"]))
                        .filter_map(Value::as_str)
                    {
                        text.push(' ');
                        text.push_str(s);
                    }
                    text.push(' ');
                }
            }
            if text.trim().is_empty() {
                continue;
            }
            count += 1;
            reactions += usize::from(REACTION.is_match(&text) || EMPHASIS.is_match(&text));
            first = first.min(sec);
            last = last.max(sec);
        }
    }
    let span = (last - first).max(4.);
    let score = if count == 0 {
        0.
    } else {
        count as f64 / span * (1. + 0.8 * reactions as f64 / count as f64)
    };
    (count, span, score)
}

pub fn select_peak_windows(
    samples: &[(f64, f64)],
    duration: f64,
    max_windows: usize,
    window: f64,
    lead: f64,
    budget: f64,
) -> Vec<Window> {
    if duration <= 0. || max_windows == 0 || window <= 0. || budget <= 0. {
        return vec![];
    }
    let lead = lead.clamp(0., window);
    let mut ranked: Vec<_> = samples
        .iter()
        .copied()
        .filter(|&(at, score)| score > 0. && (0.0..=duration).contains(&at))
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.total_cmp(&b.0)));
    let mut peaks = Vec::<f64>::new();
    for (at, _) in ranked {
        if peaks.iter().all(|&p| (at - p).abs() >= window) {
            peaks.push(at);
            if peaks.len() == max_windows {
                break;
            }
        }
    }
    let mut chronological = peaks.clone();
    chronological.sort_by(f64::total_cmp);
    let mut merged: Vec<Window> = Vec::new();
    for peak in chronological {
        let (start, end) = ((peak - lead).max(0.), (peak + window - lead).min(duration));
        if end <= start {
            continue;
        }
        if let Some(last) = merged.last_mut().filter(|p| start - p.1 <= 5.) {
            last.1 = last.1.max(end);
        } else {
            merged.push((start, end));
        }
    }
    if merged.iter().map(|&(s, e)| e - s).sum::<f64>() <= budget {
        return merged;
    }
    let mut groups: Vec<_> = merged
        .into_iter()
        .filter_map(|(s, e)| Some((peaks.iter().position(|p| (s..=e).contains(p))?, s, e)))
        .collect();
    groups.sort_by_key(|g| g.0);
    let mut left = budget;
    let mut result = Vec::new();
    for (best, start, end) in groups {
        if left <= 0. {
            break;
        }
        let length = (end - start).min(left);
        let preferred = peaks[best] - lead.min(length * lead / window);
        let start = start.max(preferred.min(end - length));
        result.push((start, start + length));
        left -= length;
    }
    result.sort_by(|a, b| a.0.total_cmp(&b.0));
    result
}
fn effective_end(duration: f64, limit: Option<u32>) -> f64 {
    limit
        .filter(|&n| n > 0)
        .map_or(duration, |n| duration.min(n.into()))
}
pub fn full_audio_window(duration: f64, limit: Option<u32>) -> Option<Window> {
    let end = effective_end(duration, limit);
    (duration.is_finite() && end > 0. && end <= MAX_FULL_AUDIO_STT_SEC).then_some((0., end))
}
fn heatmap_samples(data: &Value, out: &mut Vec<(f64, f64)>) {
    if let (Some(s), Some(e), Some(v)) = (
        number(&data["start_time"]),
        number(&data["end_time"]),
        number(&data["value"]),
    ) {
        if s >= 0. && e >= s {
            out.push(((s + e) / 2., v));
        }
    } else if let (Some(s), Some(len), Some(v)) = (
        number(&data["timeRangeStartMillis"]),
        number(&data["markerDurationMillis"]),
        number(&data["heatMarkerIntensityScoreNormalized"]),
    ) {
        if s >= 0. && len >= 0. {
            out.push(((s + len / 2.) / 1000., v));
        }
    } else if let (Some(s), Some(len), Some(v)) = (
        number(&data["startMillis"]),
        number(&data["durationMillis"]),
        number(&data["intensityScoreNormalized"]),
    ) {
        if s >= 0. && len >= 0. {
            out.push(((s + len / 2.) / 1000., v));
        }
    } else {
        match data {
            Value::Array(values) => values.iter().for_each(|v| heatmap_samples(v, out)),
            Value::Object(values) => values.values().for_each(|v| heatmap_samples(v, out)),
            _ => {}
        }
    }
}
pub fn windows_from_heatmap(
    data: &Value,
    duration: f64,
    limit: Option<u32>,
    max_windows: usize,
) -> Vec<Window> {
    let mut samples = Vec::new();
    heatmap_samples(data, &mut samples);
    select_peak_windows(
        &samples,
        effective_end(duration, limit),
        max_windows,
        WINDOW_SEC,
        WINDOW_SEC / 2.,
        900.,
    )
}

fn offsets(end: f64) -> Vec<f64> {
    let first = 30_f64.min(end * 0.1);
    let last = (end - 20.).max(end * 0.9);
    let intervals = (((last - first) / 30.) as usize).min(79);
    if intervals == 0 {
        vec![(first + last) / 2.]
    } else {
        (0..=intervals)
            .map(|i| first + i as f64 * (last - first) / intervals as f64)
            .collect()
    }
}
fn probe_payload(chat: &Bootstrap, offset: f64) -> Value {
    json!({"context":{"client":{"clientName":"WEB","clientVersion":chat.version}}, "continuation":chat.token,
        "currentPlayerState":{"playerOffsetMs":((offset*1000.) as u64).to_string()}})
}
async fn probe(client: reqwest::Client, chat: Bootstrap, offset: f64) -> Option<(f64, f64)> {
    let response = client
        .post(REPLAY_ENDPOINT)
        .query(&[("key", &chat.key)])
        .timeout(Duration::from_secs(10))
        .json(&probe_payload(&chat, offset))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    let actions = items(&response["continuationContents"]["liveChatContinuation"]["actions"]);
    Some((offset, parse_chat_actions(actions, offset, 30.).2))
}

pub async fn discover_windows(
    url: &str,
    duration: f64,
    limit: Option<u32>,
    max_windows: usize,
    heatmap: Option<&Value>,
    cancel: &CancellationToken,
) -> Vec<Window> {
    let end = effective_end(duration, limit);
    if !end.is_finite() || end <= 0. {
        return vec![];
    }
    let work = async {
        let mut html = String::new();
        if let Ok(client) = reqwest::Client::builder()
            .user_agent("Mozilla/5.0")
            .timeout(Duration::from_secs(15))
            .build()
        {
            // The watch page is only fetched for YouTube, never for arbitrary submitted URLs.
            if let Ok(url) = reqwest::Url::parse(url) {
                if url.host_str().is_some_and(|host| {
                    matches!(
                        host,
                        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "youtu.be"
                    )
                }) {
                    if let Ok(response) = client
                        .get(url)
                        .send()
                        .await
                        .and_then(reqwest::Response::error_for_status)
                    {
                        html = response.text().await.unwrap_or_default();
                    }
                }
            }
            if let Some(chat) = bootstrap(&html) {
                let mut tasks = JoinSet::new();
                let mut offsets = offsets(end).into_iter();
                let mut samples = Vec::new();
                for offset in offsets.by_ref().take(MAX_CHAT_CONCURRENCY) {
                    tasks.spawn(probe(client.clone(), chat.clone(), offset));
                }
                while let Some(r) = tasks.join_next().await {
                    if let Ok(Some(sample)) = r {
                        samples.push(sample);
                    }
                    if let Some(offset) = offsets.next() {
                        tasks.spawn(probe(client.clone(), chat.clone(), offset));
                    }
                }
                let windows =
                    select_peak_windows(&samples, end, max_windows, WINDOW_SEC, 55., 900.);
                if !windows.is_empty() {
                    return windows;
                }
            }
        }
        if let Some(heatmap) = heatmap {
            let windows = windows_from_heatmap(heatmap, duration, limit, max_windows);
            if !windows.is_empty() {
                return windows;
            }
        }
        windows_from_heatmap(
            &Value::Array(embedded(&html, &HEATMAP).collect()),
            duration,
            limit,
            max_windows,
        )
    };
    tokio::select! { biased; _ = cancel.cancelled() => vec![], windows = work => windows }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bootstrap_scopes_token_and_extracts_version() {
        let chat = bootstrap(r#""INNERTUBE_API_KEY":"key","INNERTUBE_CLIENT_VERSION":"version","continuation":"wrong","liveChatRenderer":{"continuations":[{"reloadContinuationData":{"continuation":"abc\u003d"}}]}"#).unwrap();
        assert_eq!(
            (&*chat.key, &*chat.version, &*chat.token),
            ("key", "version", "abc=")
        );
        assert!(bootstrap(r#""INNERTUBE_API_KEY":"key","continuation":"wrong""#).is_none());
        assert_eq!(offsets(100.), vec![10., 50., 90.]);
        assert_eq!(
            probe_payload(&chat, 50.)["currentPlayerState"]["playerOffsetMs"],
            "50000"
        );
    }
    #[test]
    fn reactions_score_and_boundaries() {
        let msg = |ms, run| json!({"replayChatItemAction":{"videoOffsetTimeMsec":ms,"actions":[{"addChatItemAction":{"item":{"liveChatTextMessageRenderer":{"message":{"runs":[run]}}}}}]}});
        let actions = [
            msg("0", json!({"text":"PINNED!!!"})),
            msg("70000", json!({"text":"hi"})),
            msg("80000", json!({"text":"wkwkwk"})),
            msg("90000", json!({"emoji":{"shortcuts":[":😂:"]}})),
            msg("130000", json!({"text":"W"})),
            msg("131000", json!({"text":"NOPE"})),
        ];
        let (count, span, score) = parse_chat_actions(&actions, 100., 30.);
        assert_eq!((count, span), (4, 60.));
        assert!((score - 4. / 60. * 1.6).abs() < 1e-12);
        assert_eq!(parse_chat_actions(&actions, 400., 30.), (0, 4., 0.));
    }
    #[test]
    fn peak_nms_merge_budget_and_centered_heatmap() {
        assert_eq!(
            select_peak_windows(&[(85., 5.), (40., 6.), (300., 4.)], 310., 8, 80., 55., 900.),
            [(0., 65.), (245., 310.)]
        );
        let samples = [(100., 5.), (180., 4.), (265., 3.), (500., 8.)];
        assert_eq!(
            select_peak_windows(&samples, 600., 8, 80., 55., 900.),
            [(45., 290.), (445., 525.)]
        );
        assert_eq!(
            select_peak_windows(&samples, 600., 8, 80., 55., 120.),
            [(72.5, 112.5), (445., 525.)]
        );
        let html = r#""macroMarkersListRenderer":{"heatMarkers":[{"heatMarkerRenderer":{"timeRangeStartMillis":90000,"markerDurationMillis":20000,"heatMarkerIntensityScoreNormalized":0.7}}]}"#;
        assert_eq!(
            windows_from_heatmap(
                &Value::Array(embedded(html, &HEATMAP).collect()),
                800.,
                Some(120),
                8
            ),
            [(60., 120.)]
        );
        assert_eq!(full_audio_window(1800., Some(1200)), Some((0., 1200.)));
        assert_eq!(full_audio_window(1200.1, None), None);
    }
}
