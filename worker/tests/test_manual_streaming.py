"""Mode manual: unduh section → render → hapus, satu per satu (tanpa OOM)."""

import asyncio
import os
import time
from unittest.mock import patch

import pytest

from clipper import llm, pipeline
from clipper.models import JobData, ManualRange
from clipper.subtitles import Cue


def _job(ranges):
    return JobData(
        job_id="jobstream",
        url="https://youtube.com/watch?v=dummy",
        mode="manual",
        ranges=ranges,
    )


def _moments(count=3):
    return [
        llm.Moment(start=10.0 + i * 30, end=20.0 + i * 30, title=f"Klip {i + 1}")
        for i in range(count)
    ]


def test_manual_streaming_downloads_then_renders_in_order(tmp_path):
    """Urutan harus download-1, render-1, download-2, render-2, ..."""
    events = []

    async def fake_section(job_arg, index, moment, workdir):
        events.append(("download", index))
        path = tmp_path / f"section-{index:02d}.mp4"
        path.write_text("sec")
        return str(path), moment.start

    def fake_render_one(video, moment, subs, outdir, filename, *args, **kwargs):
        events.append(("render", filename))
        (tmp_path / filename).write_text("clip")

    with patch.object(pipeline, "_download_one_section", side_effect=fake_section), \
         patch.object(pipeline, "_render_one", side_effect=fake_render_one):
        clips = asyncio.run(
            pipeline.render_manual(
                _job([ManualRange(10, 20), ManualRange(40, 50), ManualRange(70, 80)]),
                _moments(),
                [],
                str(tmp_path),
                str(tmp_path),
            )
        )

    assert events == [
        ("download", 1), ("render", "clip-01.mp4"),
        ("download", 2), ("render", "clip-02.mp4"),
        ("download", 3), ("render", "clip-03.mp4"),
    ]
    assert [clip.file for clip in clips] == ["clip-01.mp4", "clip-02.mp4", "clip-03.mp4"]
    assert list(tmp_path.glob("section-*.mp4")) == []


def test_manual_streaming_never_runs_two_heavy_processes(tmp_path):
    """Tidak boleh ada asyncio.gather atas section: satu yt-dlp/ffmpeg pada satu waktu."""
    job = _job([ManualRange(10, 20), ManualRange(40, 50), ManualRange(70, 80)])
    active = {"n": 0, "max": 0}
    kinds = []

    def fake_run(cmd, cwd=None, timeout=None):
        kind = "download" if "--download-sections" in cmd else "render"
        active["n"] += 1
        active["max"] = max(active["max"], active["n"])
        kinds.append(kind)
        try:
            time.sleep(0.01)  # kalau dijalankan paralel, pasti terdeteksi tumpang tindih
            if kind == "download":
                out = os.path.basename(cmd[cmd.index("-o") + 1]).split(".")[0]
                (tmp_path / f"{out}.mp4").write_text("sec")
            return ""
        finally:
            active["n"] -= 1

    def fake_render_one(video, moment, subs, outdir, filename, *args, **kwargs):
        # _render_one menjalankan ffmpeg lewat _run; hitung juga proses render ini.
        pipeline._run(["ffmpeg", "-y", filename])
        (tmp_path / filename).write_text("clip")

    with patch.object(pipeline, "_run", side_effect=fake_run), \
         patch.object(pipeline, "_has_video", return_value=True), \
         patch.object(pipeline, "_section_video_lags_audio", return_value=False), \
         patch.object(pipeline, "_opencv_readable", return_value=True), \
         patch.object(pipeline, "_render_one", side_effect=fake_render_one):
        clips = asyncio.run(
            pipeline.render_manual(job, _moments(), [], str(tmp_path), str(tmp_path))
        )

    assert len(clips) == 3
    assert active["max"] == 1
    # Selang-seling: download, render, download, render, ...
    assert kinds == ["download", "render"] * 3


def test_manual_streaming_falls_back_to_full_video_mid_job(tmp_path):
    """Section ke-2 gagal → video penuh diunduh sekali, klip 2 & 3 dari video penuh."""
    seen = {"sections": [], "full": 0, "renders": []}

    async def fake_section(job_arg, index, moment, workdir):
        seen["sections"].append(index)
        if index == 2:
            raise RuntimeError("yt-dlp gagal (exit 1)")
        path = tmp_path / f"section-{index:02d}.mp4"
        path.write_text("sec")
        return str(path), moment.start

    async def fake_full(job_arg, workdir, on_progress=None):
        seen["full"] += 1
        path = tmp_path / "source.mp4"
        path.write_text("full")
        return str(path)

    def fake_render_one(video, moment, subs, outdir, filename, reframe, captions,
                        two_speakers, facecam, timeline_offset=0.0, aspect_ratio="9:16"):
        seen["renders"].append(
            (filename, os.path.basename(video), moment.start, timeline_offset)
        )
        (tmp_path / filename).write_text("clip")

    with patch.object(pipeline, "_download_one_section", side_effect=fake_section), \
         patch.object(pipeline, "_download_full", side_effect=fake_full), \
         patch.object(pipeline, "_render_one", side_effect=fake_render_one):
        clips = asyncio.run(
            pipeline.render_manual(
                _job([ManualRange(10, 20), ManualRange(40, 50), ManualRange(70, 80)]),
                _moments(),
                [],
                str(tmp_path),
                str(tmp_path),
            )
        )

    assert seen["sections"] == [1, 2]   # rentang ke-3 tidak dicoba sebagai section
    assert seen["full"] == 1
    assert seen["renders"] == [
        ("clip-01.mp4", "section-01.mp4", 0.0, 10.0),
        ("clip-02.mp4", "source.mp4", 40.0, 0.0),
        ("clip-03.mp4", "source.mp4", 70.0, 0.0),
    ]
    assert [clip.start for clip in clips] == [10.0, 40.0, 70.0]
    assert list((tmp_path / "clip-01.mp4", tmp_path / "clip-02.mp4", tmp_path / "clip-03.mp4"))


def test_manual_streaming_honours_cancel_between_clips(tmp_path):
    calls = {"cancel_checks": 0, "sections": [], "renders": []}

    async def should_cancel():
        calls["cancel_checks"] += 1
        return calls["cancel_checks"] >= 3

    async def fake_section(job_arg, index, moment, workdir):
        calls["sections"].append(index)
        path = tmp_path / f"section-{index:02d}.mp4"
        path.write_text("sec")
        return str(path), moment.start

    def fake_render_one(video, moment, subs, outdir, filename, *args, **kwargs):
        calls["renders"].append(filename)
        (tmp_path / filename).write_text("clip")

    with patch.object(pipeline, "_download_one_section", side_effect=fake_section), \
         patch.object(pipeline, "_render_one", side_effect=fake_render_one):
        with pytest.raises(pipeline.JobCancelled):
            asyncio.run(
                pipeline.render_manual(
                    _job([ManualRange(10, 20), ManualRange(40, 50), ManualRange(70, 80)]),
                    _moments(),
                    [],
                    str(tmp_path),
                    str(tmp_path),
                    should_cancel=should_cancel,
                )
            )

    assert calls["sections"] == [1, 2]
    assert calls["renders"] == ["clip-01.mp4", "clip-02.mp4"]


def test_run_job_manual_uses_streaming_and_keeps_final_result(tmp_path, monkeypatch):
    """Run job manual: subtitle → momen dari ranges → streaming; hasil akhir tetap JobResult."""
    from clipper import models

    job = models.job_data_from_dict({
        "jobId": "jobrun-manual",
        "url": "https://youtube.com/watch?v=dummy",
        "mode": "manual",
        "ranges": [
            {"start": 10, "end": 20, "title": "Klip 1"},
            {"start": 40, "end": 50, "title": "Klip 2"},
        ],
    })
    cues = [Cue(10.0, 15.0, "halo"), Cue(40.0, 45.0, "kedua")]
    seen = {"downloads": [], "renders": []}

    async def fake_download(job_arg, workdir, on_progress=None):
        (tmp_path / "source.vtt").write_text("WEBVTT\n")
        return pipeline.Downloaded(subtitles=str(tmp_path / "source.vtt"))

    async def fake_section(job_arg, index, moment, workdir):
        seen["downloads"].append(index)
        path = tmp_path / f"section-{index:02d}.mp4"
        path.write_text("sec")
        return str(path), moment.start

    def fake_render_one(video, moment, subs, outdir, filename, *args, **kwargs):
        seen["renders"].append(filename)
        with open(os.path.join(outdir, filename), "w") as handle:
            handle.write("clip")

    monkeypatch.setattr(pipeline, "download", fake_download)
    monkeypatch.setattr(pipeline, "_read_vtt", lambda path: list(cues))
    monkeypatch.setattr(pipeline, "_download_one_section", fake_section)
    monkeypatch.setattr(pipeline, "_render_one", fake_render_one)
    monkeypatch.setattr(pipeline.llm, "generate_captions", lambda *args, **kwargs: [])

    result = asyncio.run(
        pipeline.run_job(job, clips_dir=str(tmp_path / "clips"), temp_root=str(tmp_path))
    )

    assert seen["downloads"] == [1, 2]
    assert seen["renders"] == ["clip-01.mp4", "clip-02.mp4"]
    assert [clip.title for clip in result.clips] == ["Klip 1", "Klip 2"]
    assert [clip.start for clip in result.clips] == [10.0, 40.0]
    assert [clip.transcript for clip in result.clips] == ["halo", "kedua"]
    assert all(clip.caption is None for clip in result.clips)


def test_ensure_saved_skips_clips_deleted_during_job(tmp_path):
    # Klip yang dihapus pengguna selagi job berjalan tidak boleh menggagalkan job.
    from clipper import pipeline
    from clipper.models import ClipResult, JobResult

    (tmp_path / "clip-02.mp4").write_bytes(b"x")
    result = JobResult(clips=[
        ClipResult(title="a", start=0, end=1, file="clip-01.mp4"),
        ClipResult(title="b", start=1, end=2, file="clip-02.mp4"),
    ])

    pipeline._ensure_saved(result, str(tmp_path))

    assert [clip.file for clip in result.clips] == ["clip-02.mp4"]


def test_ensure_saved_fails_when_no_clip_left(tmp_path):
    import pytest
    from clipper import pipeline
    from clipper.models import ClipResult, JobResult

    result = JobResult(clips=[ClipResult(title="a", start=0, end=1, file="clip-01.mp4")])
    with pytest.raises(RuntimeError):
        pipeline._ensure_saved(result, str(tmp_path))
