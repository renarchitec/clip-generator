"""Batas pemindaian sumber (maxSourceSec): parse toleran, potongan cue, unduh section."""

import asyncio
import os
from unittest.mock import patch

from clipper import llm, models, pipeline
from clipper.models import JobData, JobParams
from clipper.subtitles import Cue, Word


def test_to_max_source_sec_tolerant():
    assert models.to_max_source_sec(None) is None
    assert models.to_max_source_sec(120) == 120
    assert models.to_max_source_sec(600) == 600
    assert models.to_max_source_sec("300") == 300
    assert models.to_max_source_sec("abc") is None
    assert models.to_max_source_sec(30) is None      # di bawah minimum
    assert models.to_max_source_sec(40000) is None   # di atas maksimum
    assert models.to_max_source_sec([1]) is None     # tipe tak dikenal


def test_job_data_parses_and_serializes_max_source_sec():
    job = models.job_data_from_dict(
        {"jobId": "j1", "url": "https://youtube.com/watch?v=d", "maxSourceSec": 900}
    )
    assert job.max_source_sec == 900
    assert job.to_dict()["maxSourceSec"] == 900

    # invalid di payload -> None (durasi penuh), bukan error
    bad = models.job_data_from_dict(
        {"jobId": "j2", "url": "https://youtube.com/watch?v=d", "maxSourceSec": "x"}
    )
    assert bad.max_source_sec is None
    assert bad.to_dict()["maxSourceSec"] is None


def test_cues_within_limit_drops_and_clamps():
    cues = [
        Cue(0.0, 10.0, "awal"),
        Cue(110.0, 130.0, "melintasi limit", words=[Word(110.0, 115.0, "a"), Word(125.0, 130.0, "b")]),
        Cue(120.0, 140.0, "setelah limit"),
        Cue(200.0, 210.0, "jauh setelah"),
    ]
    kept = pipeline._cues_within_limit(cues, 120)

    assert [cue.start for cue in kept] == [0.0, 110.0]
    assert kept[1].end == 120.0
    assert [w.text for w in kept[1].words] == ["a"]  # kata setelah limit ikut dibuang
    # Tanpa limit: semua cue dikembalikan utuh.
    assert len(pipeline._cues_within_limit(cues, None)) == 4


def test_validate_moments_respects_limit_via_clamped_cues():
    cues = pipeline._cues_within_limit(
        [Cue(0.0, 10.0, "a"), Cue(100.0, 130.0, "b"), Cue(200.0, 300.0, "c")],
        120,
    )
    items = [
        {"start": 90.0, "end": 500.0, "title": "melampaui limit"},
        {"start": 2.0, "end": 8.0, "title": "aman"},
    ]
    moments = llm.validate_moments(items, cues, JobParams(clip_count=5, target_duration_sec=30.0))
    assert moments
    assert all(moment.end <= 120.0 for moment in moments)
    assert all(0.0 <= moment.start < moment.end for moment in moments)


def test_run_preview_filters_cues_and_passes_them_to_llm(monkeypatch, tmp_path):
    cues = [
        Cue(0.0, 10.0, "awal"),
        Cue(118.0, 125.0, "ujung"),
        Cue(300.0, 310.0, "luar batas"),
    ]

    def fake_fetch(url, workdir):
        (tmp_path / "source.vtt").write_text("WEBVTT\n")
        return str(tmp_path / "source.vtt")

    seen = {}

    def fake_select(cues_arg, params, env, description):
        seen["cues"] = list(cues_arg)
        seen["params"] = params
        return [llm.Moment(start=1.0, end=9.0, title="K", reason="r")]

    monkeypatch.setattr(pipeline, "_fetch_subtitles", fake_fetch)
    monkeypatch.setattr(pipeline, "_read_vtt", lambda path: list(cues))
    monkeypatch.setattr(llm, "select_moments", fake_select)

    result = asyncio.run(
        pipeline.run_preview(
            {"url": "https://youtube.com/watch?v=d", "clipCount": 7, "targetDurationSec": 60, "maxSourceSec": 120},
        )
    )

    # LLM hanya menerima cue di dalam limit.
    assert [cue.start for cue in seen["cues"]] == [0.0, 118.0]
    assert seen["cues"][1].end == 120.0
    # Parameter flat dari preview diteruskan (bukan default).
    assert seen["params"].clip_count == 7
    assert seen["params"].target_duration_sec == 60.0
    # Transkrip yang dikembalikan ke UI sama dengan versi terpotong.
    assert [cue["start"] for cue in result["cues"]] == [0.0, 118.0]
    assert result["cues"][1]["end"] == 120.0


def test_download_auto_limit_uses_single_section(tmp_path):
    job = JobData(
        job_id="joblim",
        url="https://youtube.com/watch?v=dummy",
        mode="auto",
        max_source_sec=900,
    )

    section_cmds = []

    def fake_run(cmd, cwd=None, timeout=None):
        if "--download-sections" in cmd:
            section_cmds.append(list(cmd))
            (tmp_path / "source.mp4").write_text("limited")
        else:
            (tmp_path / "source.mp4").write_text("full")
        return ""

    with patch.object(pipeline, "_has_video", return_value=True), \
         patch.object(pipeline, "_run", side_effect=fake_run), \
         patch.object(pipeline, "_opencv_readable", return_value=True), \
         patch.object(pipeline, "_fetch_subtitles", return_value=str(tmp_path / "source.vtt")):
        (tmp_path / "source.vtt").write_text("WEBVTT\n")
        dl = asyncio.run(pipeline.download(job, str(tmp_path)))

    assert dl.video == str(tmp_path / "source.mp4")
    assert dl.sections == []
    assert len(section_cmds) == 1
    cmd = section_cmds[0]
    assert cmd[cmd.index("--download-sections") + 1] == "*0.000-900.000"
    assert "--force-keyframes-at-cuts" in cmd


def test_download_auto_limit_falls_back_to_full_video(tmp_path):
    job = JobData(
        job_id="joblim2",
        url="https://youtube.com/watch?v=dummy",
        mode="auto",
        max_source_sec=600,
    )

    calls = []

    def fake_run(cmd, cwd=None, timeout=None):
        calls.append(list(cmd))
        (tmp_path / "source.mp4").write_text("x")
        return ""

    with patch.object(pipeline, "_has_video", return_value=False), \
         patch.object(pipeline, "_run", side_effect=fake_run), \
         patch.object(pipeline, "_fetch_subtitles", return_value=str(tmp_path / "source.vtt")):
        (tmp_path / "source.vtt").write_text("WEBVTT\n")
        dl = asyncio.run(pipeline.download(job, str(tmp_path)))

    # Section pertama tanpa stream video -> fallback mengunduh video penuh.
    assert any("--download-sections" in cmd for cmd in calls)
    assert sum(1 for cmd in calls if "--download-sections" not in cmd) == 1
    assert dl.video == str(tmp_path / "source.mp4")


def test_run_job_auto_limit_filters_cues_before_select(monkeypatch, tmp_path):
    """run_job mode auto memotong cue sebelum select; momen tidak melewati limit."""
    job = models.job_data_from_dict(
        {
            "jobId": "jobauto-lim",
            "url": "https://youtube.com/watch?v=dummy",
            "mode": "auto",
            "maxSourceSec": 120,
            "params": {"clipCount": 1, "targetDurationSec": 30},
        }
    )
    assert job.max_source_sec == 120

    cues = [
        Cue(0.0, 10.0, "awal"),
        Cue(100.0, 140.0, "melintasi"),
        Cue(300.0, 310.0, "luar"),
    ]
    seen = {}

    def fake_select(cues_arg, params, env, description):
        seen["cues"] = list(cues_arg)
        return [llm.Moment(start=1.0, end=9.0, title="K", reason="r")]

    async def fake_download(job_arg, workdir, on_progress=None):
        (tmp_path / "source.mp4").write_text("v")
        (tmp_path / "source.vtt").write_text("WEBVTT\n")
        return pipeline.Downloaded(
            video=str(tmp_path / "source.mp4"),
            subtitles=str(tmp_path / "source.vtt"),
        )

    def fake_render_one(video, moment, subs, outdir, filename, *args, **kwargs):
        os.makedirs(outdir, exist_ok=True)
        with open(os.path.join(outdir, filename), "w") as handle:
            handle.write("clip")

    monkeypatch.setattr(pipeline, "download", fake_download)
    monkeypatch.setattr(pipeline, "_read_vtt", lambda path: list(cues))
    monkeypatch.setattr(llm, "select_moments", fake_select)
    monkeypatch.setattr(pipeline, "_render_one", fake_render_one)

    result = asyncio.run(
        pipeline.run_job(job, clips_dir=str(tmp_path / "out"), temp_root=str(tmp_path))
    )

    assert [cue.start for cue in seen["cues"]] == [0.0, 100.0]
    assert seen["cues"][1].end == 120.0
    assert result.clips[0].end <= 120.0
