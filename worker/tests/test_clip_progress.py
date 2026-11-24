"""Laporan per klip lewat progress event (data.clip dipakai API)."""

import asyncio
import os
from unittest.mock import patch

from clipper import llm, models, pipeline
from clipper.models import JobData
from clipper.subtitles import Cue


def test_job_progress_includes_clip_only_when_set():
    plain = models.JobProgress(stage="render", percent=66.67, message="clip 1/2").to_dict()
    assert plain == {"stage": "render", "percent": 66.7, "message": "clip 1/2"}
    assert "clip" not in plain

    clip = {"title": "Judul", "start": 10.0, "end": 20.0, "file": "clip-01.mp4",
            "transcript": "halo"}
    with_clip = models.JobProgress(
        stage="render", percent=50, message="clip 1/2 selesai", clip=clip
    ).to_dict()
    assert with_clip["clip"] == clip
    with_clip["clip"]["title"] = "diubah"
    assert clip["title"] == "Judul"  # payload disalin, bukan dipakai bersama


def test_render_reports_each_finished_clip_auto(tmp_path):
    job = JobData(job_id="jobauto-report", url="https://youtube.com/watch?v=dummy", mode="auto")
    moments = [
        llm.Moment(start=1.0, end=6.0, title="Pertama"),
        llm.Moment(start=20.0, end=25.0, title="Kedua"),
    ]
    cues = [Cue(1.0, 5.0, "halo pertama"), Cue(20.0, 24.0, "halo kedua")]
    events = []

    async def on_progress(stage, percent, message="", *, clip=None):
        # Klip sudah ada di folder output saat event dikirim.
        if clip:
            assert os.path.isfile(os.path.join(tmp_path, clip["file"]))
        events.append((stage, percent, message, clip))

    def fake_render_one(video, moment, subs, outdir, filename, *args, **kwargs):
        with open(os.path.join(outdir, filename), "w") as handle:
            handle.write("clip")

    with patch.object(pipeline, "_render_one", side_effect=fake_render_one):
        clips = asyncio.run(
            pipeline.render(
                job, moments, str(tmp_path / "source.mp4"), cues, str(tmp_path), on_progress
            )
        )

    reports = [event[3] for event in events if event[3] is not None]
    assert len(reports) == 2
    assert reports[0] == {
        "title": "Pertama",
        "start": 1.0,
        "end": 6.0,
        "file": "clip-01.mp4",
        "transcript": "halo pertama",
    }
    assert reports[1] == {
        "title": "Kedua",
        "start": 20.0,
        "end": 25.0,
        "file": "clip-02.mp4",
        "transcript": "halo kedua",
    }
    assert "caption" not in reports[0] and "hashtags" not in reports[0]
    assert [(event[0], event[1]) for event in events if event[3]] == [
        ("render", 50.0), ("render", 100.0)
    ]
    assert "clip 2/2" in events[-1][2]
    assert [clip.title for clip in clips] == ["Pertama", "Kedua"]


def test_render_manual_reports_clip_between_sections(tmp_path):
    job = JobData(job_id="jobmanual-report", url="https://youtube.com/watch?v=dummy", mode="manual")
    moments = [
        llm.Moment(start=10.0, end=20.0, title="Pertama"),
        llm.Moment(start=40.0, end=50.0, title="Kedua"),
    ]
    cues = [Cue(10.0, 15.0, "halo pertama"), Cue(40.0, 45.0, "halo kedua")]
    events = []

    async def on_progress(stage, percent, message="", *, clip=None):
        if clip:
            assert os.path.isfile(os.path.join(tmp_path, clip["file"]))
        events.append({"stage": stage, "message": message, "clip": clip})

    async def fake_section(job_arg, index, moment, workdir):
        events.append({"stage": "download-section", "message": f"mulai {index}", "clip": None})
        path = tmp_path / f"section-{index:02d}.mp4"
        path.write_text("sec")
        return str(path), moment.start

    def fake_render_one(video, moment, subs, outdir, filename, *args, **kwargs):
        with open(os.path.join(outdir, filename), "w") as handle:
            handle.write("clip")

    with patch.object(pipeline, "_download_one_section", side_effect=fake_section), \
         patch.object(pipeline, "_render_one", side_effect=fake_render_one):
        clips = asyncio.run(
            pipeline.render_manual(job, moments, cues, str(tmp_path), str(tmp_path), on_progress)
        )

    assert [event["message"] for event in events] == [
        "merender 2 clip",
        "mengunduh clip 1/2",
        "mulai 1",
        "clip 1/2 selesai",
        "mengunduh clip 2/2",
        "mulai 2",
        "clip 2/2 selesai",
    ]
    reports = [event["clip"] for event in events if event["clip"]]
    assert [report["file"] for report in reports] == ["clip-01.mp4", "clip-02.mp4"]
    assert [report["transcript"] for report in reports] == ["halo pertama", "halo kedua"]
    assert [clip.file for clip in clips] == ["clip-01.mp4", "clip-02.mp4"]


def test_emit_keeps_legacy_three_argument_callbacks(tmp_path):
    seen = []

    def on_progress(stage, percent, message):
        seen.append((stage, percent, message))

    asyncio.run(pipeline._emit(on_progress, "render", 10.0, "clip 1/2"))
    # Callback tanpa kwarg clip tidak boleh pecah saat ada laporan klip.
    asyncio.run(pipeline._emit(on_progress, "render", 20.0, "clip 2/2", clip={"file": "a.mp4"}))
    assert seen == [("render", 10.0, "clip 1/2"), ("render", 20.0, "clip 2/2")]
