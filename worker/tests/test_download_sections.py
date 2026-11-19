import asyncio
from unittest.mock import patch

import pytest

from clipper import pipeline
from clipper.models import JobData, JobParams, ManualRange
from clipper.subtitles import Cue


def test_valid_ranges_filters_invalid_and_sorts():
    ranges = [
        ManualRange(start=50.0, end=60.0, title="B"),
        ManualRange(start=30.0, end=20.0),  # invalid end <= start
        ManualRange(start=10.0, end=25.0, title="A"),
        ManualRange(start=5.0, end=5.0),   # invalid zero duration
    ]
    valid = pipeline._valid_ranges(ranges)
    assert len(valid) == 2
    assert valid[0].start == 10.0 and valid[0].title == "A"
    assert valid[1].start == 50.0 and valid[1].title == "B"


def test_download_manual_uses_sections_per_range(tmp_path):
    job = JobData(
        job_id="jobm1",
        url="https://youtube.com/watch?v=dummy",
        mode="manual",
        ranges=[
            ManualRange(start=10.0, end=25.5, title="Bagian 1"),
            ManualRange(start=40.0, end=55.0, title="Bagian 2"),
        ],
    )

    run_calls = []

    def fake_run(cmd, cwd=None, timeout=None):
        run_calls.append(list(cmd))
        # Simulasi pembuatan file section
        for arg in cmd:
            if "section-00" in arg:
                (tmp_path / "section-00.mp4").write_text("v0")
            elif "section-01" in arg:
                (tmp_path / "section-01.mp4").write_text("v1")

    with patch.object(pipeline, "_has_video", return_value=True), \
         patch.object(pipeline, "_run", side_effect=fake_run), \
         patch.object(pipeline, "_fetch_subtitles", return_value=str(tmp_path / "source.vtt")):
        (tmp_path / "source.vtt").write_text("WEBVTT\n")
        dl = asyncio.run(pipeline.download(job, str(tmp_path)))

    assert dl.video is None
    assert len(dl.sections) == 2
    assert dl.sections[0] == (str(tmp_path / "section-00.mp4"), 10.0)
    assert dl.sections[1] == (str(tmp_path / "section-01.mp4"), 40.0)

    # Pastikan flag --download-sections diteruskan dengan benar untuk tiap range
    section_flags = [
        arg for cmd in run_calls for arg in cmd if arg.startswith("*") and "-" in arg
    ]
    assert "*10.000-25.500" in section_flags
    assert "*40.000-55.000" in section_flags


def test_download_auto_downloads_full_source(tmp_path):
    job = JobData(
        job_id="jobauto1",
        url="https://youtube.com/watch?v=dummy",
        mode="auto",
    )

    def fake_run(cmd, cwd=None, timeout=None):
        (tmp_path / "source.mp4").write_text("fullvideo")

    with patch.object(pipeline, "_run", side_effect=fake_run), \
         patch.object(pipeline, "_fetch_subtitles", return_value=str(tmp_path / "source.vtt")):
        (tmp_path / "source.vtt").write_text("WEBVTT\n")
        dl = asyncio.run(pipeline.download(job, str(tmp_path)))

    assert dl.video == str(tmp_path / "source.mp4")
    assert dl.sections == []


def test_render_with_sections_shifts_start_and_captions(tmp_path):
    job = JobData(
        job_id="jobrender1",
        url="https://youtube.com/watch?v=dummy",
        mode="manual",
        captions=True,
    )
    cues = [
        Cue(start=10.0, end=15.0, text="Halo pembuka"),
        Cue(start=42.0, end=45.0, text="Bagian kedua"),
    ]
    moments = pipeline._moments_from_ranges(
        cues,
        [
            ManualRange(start=10.0, end=20.0, title="Klip 1"),
            ManualRange(start=40.0, end=50.0, title="Klip 2"),
        ],
    )
    sections = [
        (str(tmp_path / "sec0.mp4"), 10.0),
        (str(tmp_path / "sec1.mp4"), 40.0),
    ]

    rendered_args = []

    def fake_render_one(video, moment, subs, outdir, filename, reframe, captions, two_speakers, timeline_offset=0.0):
        rendered_args.append({
            "video": video,
            "moment_start": moment.start,
            "moment_end": moment.end,
            "timeline_offset": timeline_offset,
            "filename": filename,
        })

    with patch.object(pipeline, "_render_one", side_effect=fake_render_one):
        clips = asyncio.run(
            pipeline.render(
                job,
                moments,
                video=None,
                subs=cues,
                outdir=str(tmp_path),
                sections=sections,
            )
        )

    assert len(clips) == 2
    # Klip 1: offset 10.0 -> momen relatif 0.0..10.0
    assert rendered_args[0]["video"] == str(tmp_path / "sec0.mp4")
    assert rendered_args[0]["moment_start"] == pytest.approx(0.0)
    assert rendered_args[0]["moment_end"] == pytest.approx(10.0)
    assert rendered_args[0]["timeline_offset"] == pytest.approx(10.0)

    # Klip 2: offset 40.0 -> momen relatif 0.0..10.0
    assert rendered_args[1]["video"] == str(tmp_path / "sec1.mp4")
    assert rendered_args[1]["moment_start"] == pytest.approx(0.0)
    assert rendered_args[1]["moment_end"] == pytest.approx(10.0)
    assert rendered_args[1]["timeline_offset"] == pytest.approx(40.0)

    # Hasil klip tetap mempertahankan start/end absolut
    assert clips[0].start == 10.0 and clips[0].end == 20.0
    assert clips[1].start == 40.0 and clips[1].end == 50.0


def test_render_one_seeks_relative_and_keeps_absolute_captions(tmp_path):
    cues = [Cue(start=10.0, end=15.0, text="Halo pembuka")]
    moment = pipeline.llm.Moment(start=0.0, end=10.0, title="Klip 1")
    commands = []

    def fake_run(cmd, cwd=None, timeout=None):
        commands.append(list(cmd))
        return ""

    with patch.object(pipeline, "_run", side_effect=fake_run):
        pipeline._render_one(
            str(tmp_path / "sec0.mp4"),
            moment,
            cues,
            str(tmp_path),
            "clip-01.mp4",
            reframe="black_bars",
            captions=True,
            timeline_offset=10.0,
        )

    cmd = commands[0]
    assert cmd[cmd.index("-ss") + 1] == "0.000"
    assert cmd[cmd.index("-t") + 1] == "10.000"
    # Cue absolut 10-15 detik harus terpilih dan dibakar (bukan cue kosong).
    assert any("subtitles=" in part for part in cmd)


def test_download_manual_falls_back_when_section_has_no_video(tmp_path):
    job = JobData(job_id="jobnovid1", url="https://youtube.com/watch?v=dummy", mode="manual",
                  ranges=[ManualRange(start=5.0, end=12.0)])

    def fake_run(cmd, cwd=None, timeout=None):
        name = "section-00.mp4" if "--download-sections" in cmd else "source.mp4"
        (tmp_path / name).write_text("x")

    with patch.object(pipeline, "_has_video", return_value=False), \
         patch.object(pipeline, "_run", side_effect=fake_run), \
         patch.object(pipeline, "_fetch_subtitles", return_value=str(tmp_path / "source.vtt")):
        dl = asyncio.run(pipeline.download(job, str(tmp_path)))

    assert dl.sections == []
    assert dl.video == str(tmp_path / "source.mp4")
