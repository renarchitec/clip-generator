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


def test_download_manual_only_fetches_subtitles(tmp_path):
    """Mode manual tidak lagi mengunduh section di download(): itu streaming di run_job."""
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
        return ""

    with patch.object(pipeline, "_run", side_effect=fake_run), \
         patch.object(pipeline, "_fetch_subtitles", return_value=str(tmp_path / "source.vtt")):
        (tmp_path / "source.vtt").write_text("WEBVTT\n")
        dl = asyncio.run(pipeline.download(job, str(tmp_path)))

    assert dl.video is None
    assert dl.subtitles == str(tmp_path / "source.vtt")
    # Tidak ada unduhan apapun (section maupun penuh) di tahap download.
    assert run_calls == []


def test_download_one_section_uses_section_flags_and_format(tmp_path):
    job = JobData(
        job_id="jobm2",
        url="https://youtube.com/watch?v=dummy",
        mode="manual",
        ranges=[ManualRange(start=10.0, end=25.5)],
    )
    moment = pipeline.llm.Moment(start=10.0, end=25.5, title="Bagian 1")

    run_calls = []

    def fake_run(cmd, cwd=None, timeout=None):
        run_calls.append(list(cmd))
        (tmp_path / "section-01.mp4").write_text("v1")
        return ""

    with patch.object(pipeline, "_has_video", return_value=True), \
         patch.object(pipeline, "_opencv_readable", return_value=True), \
         patch.object(pipeline, "_run", side_effect=fake_run):
        path, offset = asyncio.run(
            pipeline._download_one_section(job, 1, moment, str(tmp_path))
        )

    assert path == str(tmp_path / "section-01.mp4")
    assert offset == 10.0

    cmd = run_calls[0]
    assert cmd[cmd.index("--download-sections") + 1] == "*10.000-25.500"
    assert "--force-keyframes-at-cuts" in cmd

    # Section wajib format http terindeks (hindari fallback HLS/TS yang membuat
    # video tertinggal dari audio); unduhan penuh tetap format bebas.
    fmt = cmd[cmd.index("-f") + 1]
    assert "[protocol^=http]" in fmt
    assert fmt == (
        "bv*[ext=mp4][protocol^=http]+ba[ext=m4a][protocol^=http]"
        "/bv*[ext=mp4][protocol^=http]+ba[ext=mp4][protocol^=http]"
        "/b[ext=mp4][protocol^=http]"
    )


def test_download_one_section_rejects_section_without_video(tmp_path):
    job = JobData(job_id="jobnovid1", url="https://youtube.com/watch?v=dummy", mode="manual",
                  ranges=[ManualRange(start=5.0, end=12.0)])
    moment = pipeline.llm.Moment(start=5.0, end=12.0, title="K")

    def fake_run(cmd, cwd=None, timeout=None):
        (tmp_path / "section-01.mp4").write_text("x")
        return ""

    with patch.object(pipeline, "_has_video", return_value=False), \
         patch.object(pipeline, "_run", side_effect=fake_run):
        with pytest.raises(RuntimeError, match="tanpa stream video"):
            asyncio.run(pipeline._download_one_section(job, 1, moment, str(tmp_path)))

    assert not (tmp_path / "section-01.mp4").exists()


def test_download_one_section_rejects_av_desync(tmp_path):
    job = JobData(job_id="jobav1", url="https://youtube.com/watch?v=dummy", mode="manual",
                  ranges=[ManualRange(start=5.0, end=12.0)])
    moment = pipeline.llm.Moment(start=5.0, end=12.0, title="K")

    def fake_run(cmd, cwd=None, timeout=None):
        (tmp_path / "section-01.mp4").write_text("x")
        return ""

    def fake_probe(path, stream):
        # Video 2 detik lebih lambat dari audio (offset keyframe HLS).
        return 2.0 if stream == "v:0" else 0.0

    with patch.object(pipeline, "_has_video", return_value=True), \
         patch.object(pipeline, "_probe_start", side_effect=fake_probe), \
         patch.object(pipeline, "_run", side_effect=fake_run):
        with pytest.raises(RuntimeError, match="A/V tidak sinkron"):
            asyncio.run(pipeline._download_one_section(job, 1, moment, str(tmp_path)))

    assert not (tmp_path / "section-01.mp4").exists()


def test_download_one_section_propagates_command_failure(tmp_path):
    job = JobData(job_id="jobfail1", url="https://youtube.com/watch?v=dummy", mode="manual",
                  ranges=[ManualRange(start=5.0, end=12.0)])
    moment = pipeline.llm.Moment(start=5.0, end=12.0, title="K")

    def fake_run(cmd, cwd=None, timeout=None):
        raise RuntimeError("yt-dlp gagal (exit 1)")

    with patch.object(pipeline, "_run", side_effect=fake_run):
        with pytest.raises(RuntimeError, match="yt-dlp gagal"):
            asyncio.run(pipeline._download_one_section(job, 1, moment, str(tmp_path)))


def test_render_manual_shifts_start_and_captions(tmp_path):
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

    rendered_args = []

    async def fake_section(job_arg, index, moment, workdir):
        path = tmp_path / f"section-{index:02d}.mp4"
        path.write_text("sec")
        return str(path), moment.start

    def fake_render_one(video, moment, subs, outdir, filename, reframe, captions, two_speakers, facecam, timeline_offset=0.0, aspect_ratio="9:16", **kwargs):
        rendered_args.append({
            "video": video,
            "moment_start": moment.start,
            "moment_end": moment.end,
            "timeline_offset": timeline_offset,
            "filename": filename,
        })
        (tmp_path / filename).write_text("clip")

    with patch.object(pipeline, "_download_one_section", side_effect=fake_section), \
         patch.object(pipeline, "_render_one", side_effect=fake_render_one):
        clips = asyncio.run(
            pipeline.render_manual(
                job,
                moments,
                cues,
                str(tmp_path),
                str(tmp_path),
            )
        )

    assert len(clips) == 2
    # Klip 1: offset 10.0 -> momen relatif 0.0..10.0
    assert rendered_args[0]["video"] == str(tmp_path / "section-01.mp4")
    assert rendered_args[0]["moment_start"] == pytest.approx(0.0)
    assert rendered_args[0]["moment_end"] == pytest.approx(10.0)
    assert rendered_args[0]["timeline_offset"] == pytest.approx(10.0)

    # Klip 2: offset 40.0 -> momen relatif 0.0..10.0
    assert rendered_args[1]["video"] == str(tmp_path / "section-02.mp4")
    assert rendered_args[1]["moment_start"] == pytest.approx(0.0)
    assert rendered_args[1]["moment_end"] == pytest.approx(10.0)
    assert rendered_args[1]["timeline_offset"] == pytest.approx(40.0)

    # Hasil klip tetap mempertahankan start/end absolut
    assert clips[0].start == 10.0 and clips[0].end == 20.0
    assert clips[1].start == 40.0 and clips[1].end == 50.0

    # File section dihapus setelah dirender (hemat disk host kecil).
    assert list(tmp_path.glob("section-*.mp4")) == []


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


def test_download_auto_downloads_full_source(tmp_path):
    job = JobData(
        job_id="jobauto1",
        url="https://youtube.com/watch?v=dummy",
        mode="auto",
    )

    run_calls = []

    def fake_run(cmd, cwd=None, timeout=None):
        run_calls.append(list(cmd))
        (tmp_path / "source.mp4").write_text("fullvideo")

    with patch.object(pipeline, "_run", side_effect=fake_run), \
         patch.object(pipeline, "_fetch_subtitles", return_value=str(tmp_path / "source.vtt")):
        (tmp_path / "source.vtt").write_text("WEBVTT\n")
        dl = asyncio.run(pipeline.download(job, str(tmp_path)))

    assert dl.video == str(tmp_path / "source.mp4")
    # Unduhan penuh tidak memakai batasan format section.
    assert not any("[protocol^=http]" in arg for cmd in run_calls for arg in cmd)
