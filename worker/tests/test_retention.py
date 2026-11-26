import asyncio
import json

import pytest

from clipper import llm, pipeline
from clipper.models import CaptionStyle, ClipResult, JobParams, job_data_from_dict
from clipper.subtitles import Cue, write_ass


@pytest.mark.parametrize("hook_key,audio_key,text_key", [
    ("hookBanner", "normalizeAudio", "hookText"),
    ("hook_banner", "normalize_audio", "hook_text"),
])
def test_retention_job_fields_parse_and_round_trip(hook_key, audio_key, text_key):
    base = {"jobId": "job", "url": "https://example.com/video"}
    defaults = job_data_from_dict(base)
    assert defaults.hook_banner is False and defaults.normalize_audio is True
    job = job_data_from_dict({**base, hook_key: True, audio_key: False, "ranges": [
        {"start": 0, "end": 3, text_key: "  " + "a" * 85 + "  "},
        {"start": 4, "end": 7, text_key: "   "},
    ]})
    result = job.to_dict()
    assert result["hookBanner"] is True and result["normalizeAudio"] is False
    assert result["ranges"][0]["hookText"] == "a" * 80
    assert "hookText" not in result["ranges"][1]
    assert job_data_from_dict(result) == job


@pytest.mark.parametrize("preset,default", [("hook", True), ("beast", True), ("boxed", False), ("neon", False), ("cinema", False)])
def test_caption_animate_preset_default_and_override(preset, default):
    for invalid in (None, 0, "false"):
        style = CaptionStyle.from_dict({"preset": preset, "animate": invalid})
        assert (style.preset, style.animate) == (preset, default)
    style = CaptionStyle.from_dict({"preset": preset, "animate": not default})
    assert style.to_dict()["animate"] is (not default)
    assert CaptionStyle.from_dict(style.to_dict()) == style


def test_clip_result_omits_only_missing_retention_fields():
    clip = ClipResult("Clip", 0, 3, "clip.mp4", viral_score=0, hook_text="Apa yang terjadi?")
    assert clip.to_dict()["viralScore"] == 0
    assert clip.to_dict()["hookText"] == "Apa yang terjadi?"
    absent = ClipResult("Clip", 0, 3, "clip.mp4").to_dict()
    assert "viralScore" not in absent and "hookText" not in absent


@pytest.mark.parametrize("raw,score", [(140, 100), (-10, 0), ("81", 81), (True, None), ("invalid", None), (float("inf"), None)])
def test_validate_moments_parses_clamps_and_cleans(raw, score):
    cues = [Cue(0, 80, "Kalimat.")]
    moments = llm.validate_moments([
        {"start": 0, "end": 10, "viral_score": raw, "hook_text": '\n “Ini\n baru awal”  '},
        {"start": 25, "end": 35, "hookText": "Awal yang kuat " * 10},
        {"start": 50, "end": 60, "hookText": '  "\n"  '},
    ], cues, JobParams(3, 10))
    assert moments[0].viral_score == score
    assert moments[0].hook_text == "Ini baru awal"
    assert moments[1].hook_text == "Awal yang kuat " * 3 + "Awal yang kuat"
    assert moments[2].hook_text is None


def test_select_moments_ranks_before_overlap_filter_and_preserves_metadata(monkeypatch):
    cues = [Cue(i, i + 5, "Kalimat.") for i in range(0, 90, 5)]
    responses = iter([
        json.dumps([
            {"start": 48, "end": 58, "title": "Weak overlap", "viralScore": 5},
            {"start": 50, "end": 60, "title": "Later wins", "viralScore": 93, "hookText": "Hook kanan"},
            {"start": 5, "end": 15, "title": "Earlier tied", "viralScore": 93, "hookText": "Hook kiri"},
            {"start": 25, "end": 35, "title": "Excluded by rank", "viralScore": 70},
        ]),
        json.dumps([{"index": 0, "start": 55, "end": 65, "viralScore": 0, "hookText": "Ignore"}]),
    ])
    prompts = []

    def complete(*args, **kwargs):
        prompts.append(args[3])
        return next(responses)

    monkeypatch.setattr(llm, "_complete", complete)
    moments = llm.select_moments(cues, JobParams(2, 10), env={
        "LLM_BASE_URL": "mock", "LLM_API_KEY": "mock", "LLM_MODEL": "mock",
    })
    assert [(m.title, m.viral_score, m.hook_text) for m in moments] == [
        ("Later wins", 93, "Hook kanan"), ("Earlier tied", 93, "Hook kiri"),
    ]
    assert moments[0].start > 50 and moments[1].end < moments[0].start
    assert moments[0].to_dict()["viralScore"] == 93
    assert moments[0].to_dict()["hookText"] == "Hook kanan"
    assert all(term in prompts[0] for term in ("0–3", "Konteks mandiri", "viralScore", "hookText"))
    assert all(term in prompts[1] for term in ("oke jadi", "eh tunggu", "payoff"))


@pytest.mark.parametrize("facecam,cues", [(True, []), (False, [Cue(0, 3, "Teks klip")])])
def test_hook_banner_ass_layers_and_positions(facecam, cues):
    ass = write_ass(cues, hook_text="Tunggu sampai bagian berikut", facecam=facecam)
    style = next(line for line in ass.splitlines() if line.startswith("Style: Hook"))
    assert style.startswith("Style: Hook,Montserrat,54,&H00FFFFFF,")
    assert "&H26000000,&H26000000,-1" in style
    assert style.endswith(",3,14,0,5,80,80,0,1" if facecam else ",3,14,0,8,80,80,307,1")
    events = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
    assert len(events) == (3 if cues else 1)
    assert events[0].startswith("Dialogue: 2,0:00:00.00,0:00:02.80,Hook,")
    assert (r"\an5\pos(540,844)" if facecam else r"\an8") in events[0]
    assert r"\fad(120,250)\fscx104\fscy104\t(0,120,\fscx100\fscy100)" in events[0]
    assert events[0].endswith(r"Tunggu sampai bagian\Nberikut")


@pytest.mark.parametrize("normalize_audio,audio_present", [(True, True), (True, False), (False, True)])
def test_render_one_normalization_and_banner_without_captions(tmp_path, monkeypatch, normalize_audio, audio_present):
    commands = []
    ass = tmp_path / "clip.ass"

    def run(cmd, **kwargs):
        commands.append(cmd)
        if cmd[0] == "ffprobe":
            return "1\n" if audio_present else ""
        text = ass.read_text()
        assert "Dialogue: 2,0:00:00.00,0:00:01.50,Hook," in text
        assert "Dialogue: 0," not in text
        return ""

    monkeypatch.setattr(pipeline, "_run", run)
    pipeline._render_one("src.mp4", llm.Moment(0, 1.5, "Clip"), [Cue(0, 2, "Teks klip")],
                         str(tmp_path), "clip.mp4", reframe="black_bars", captions=False,
                         hook_banner=True, hook_text="Tunggu sebentar", normalize_audio=normalize_audio)
    assert [cmd[0] for cmd in commands] == (["ffprobe", "ffmpeg"] if normalize_audio else ["ffmpeg"])
    cmd = commands[-1]
    assert "subtitles=" in cmd[cmd.index("-vf") + 1]
    if normalize_audio and audio_present:
        assert cmd[cmd.index("-af") + 1] == "loudnorm=I=-14:TP=-1.5:LRA=11"
        assert cmd[cmd.index("-ar") + 1] == "44100"
        assert cmd[cmd.index("-b:a") + 1] == "160k"
    else:
        assert "-af" not in cmd and "-ar" not in cmd
    assert not ass.exists()


@pytest.mark.parametrize("mode", ["auto", "manual"])
def test_clip_progress_and_result_include_retention_fields(mode, tmp_path, monkeypatch):
    job = job_data_from_dict({"jobId": "job", "url": "https://example.com/video", "mode": mode,
                              "hookBanner": True, "normalizeAudio": False,
                              "ranges": [{"start": 5, "end": 15, "hookText": "Hook manual"}]})
    cues = [Cue(5, 15, "Isi clip.")]
    moment = (pipeline._moments_from_ranges(cues, job.ranges)[0] if mode == "manual"
              else llm.Moment(5, 15, "Clip", viral_score=92, hook_text="Hook auto"))
    kwargs = {}

    def render(*args, **options):
        kwargs.update(options)

    monkeypatch.setattr(pipeline, "_render_one", render)
    clip = pipeline._render_clip_sync(job, moment, cues, "src.mp4", "clip.mp4", str(tmp_path), 5)
    progress = pipeline._clip_report(clip)
    assert kwargs == {"hook_banner": True, "hook_text": f"Hook {mode}", "normalize_audio": False}
    assert progress == clip.to_dict()
    assert progress["hookText"] == f"Hook {mode}"
    assert progress.get("viralScore") == (92 if mode == "auto" else None)


def test_frame_preview_passes_sample_hook_without_captions(tmp_path, monkeypatch):
    async def download(*args):
        return "src.mp4", 0

    calls = []
    monkeypatch.setattr(pipeline, "_download_preview_section", download)
    monkeypatch.setattr(pipeline, "_render_one", lambda *args, **kwargs: calls.append((args, kwargs)))
    monkeypatch.setattr(pipeline, "_run", lambda *args, **kwargs: "")
    asyncio.run(pipeline.run_frame({
        "url": "https://example.com/video", "atSec": 2, "outPath": ".frames/sample.jpg",
        "aspectRatio": "9:16", "hook_banner": True,
    }, str(tmp_path)))
    args, kwargs = calls[0]
    assert args[2] == []
    assert kwargs == {"hook_banner": True, "hook_text": "WAIT FOR THIS MOMENT"}
