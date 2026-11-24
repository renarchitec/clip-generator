"""Uji outro: parse payload, resolusi path, penerusan lewat _render_clip_sync, smoke ffmpeg nyata."""

import os
import shutil
import subprocess
from unittest.mock import patch

import pytest

from clipper import pipeline
from clipper.models import JobData, Outro, job_data_from_dict

BASE = {"jobId": "abc", "url": "https://youtu.be/x"}
MOMENT = pipeline.llm.Moment(0.0, 3.0, "t")


# ---------- parsing ----------

def test_outro_absent_or_invalid_is_none():
    assert job_data_from_dict(BASE).outro is None
    assert job_data_from_dict({**BASE, "outro": None}).outro is None
    assert job_data_from_dict({**BASE, "outro": "x"}).outro is None
    assert job_data_from_dict({**BASE, "outro": {"durationSec": 3}}).outro is None
    assert job_data_from_dict({**BASE, "outro": {"filePath": "  "}}).outro is None
    assert job_data_from_dict(BASE).to_dict()["outro"] is None


def test_outro_parses_camel_case_and_tolerates_bad_duration():
    job = job_data_from_dict({**BASE, "outro": {"filePath": "outros/u/o.mp4", "durationSec": 4.5}})
    assert job.outro == Outro("outros/u/o.mp4", 4.5)
    assert job.to_dict()["outro"] == {"filePath": "outros/u/o.mp4", "durationSec": 4.5}
    assert Outro.from_dict({"filePath": "a.mp4", "durationSec": "abc"}).duration_sec is None
    assert Outro.from_dict({"filePath": "a.mp4"}).duration_sec is None


# ---------- resolusi path ----------

def test_resolve_outro_path_ok_missing_and_traversal(tmp_path):
    root = tmp_path / "clips"
    (root / "outros" / "u").mkdir(parents=True)
    mp4 = root / "outros" / "u" / "o.mp4"
    mp4.write_bytes(b"x")
    outside = tmp_path / "secret.mp4"
    outside.write_bytes(b"x")

    resolve = pipeline.resolve_outro_path
    assert resolve(str(root), Outro("outros/u/o.mp4")) == os.path.realpath(mp4)
    assert resolve(str(root), None) is None
    assert resolve(str(root), Outro("outros/u/nope.mp4")) is None
    assert resolve(str(root), Outro("../secret.mp4")) is None
    assert resolve(str(root), Outro(str(outside))) is None
    assert resolve(str(root), Outro("outros/u")) is None  # direktori


# ---------- penerusan lewat _render_clip_sync ----------

def _job(outro):
    return JobData(job_id="jobo", url="https://youtu.be/x", outro=outro)


def test_render_clip_sync_applies_outro_after_render(tmp_path):
    clips = tmp_path / "clips"
    (clips / "outros").mkdir(parents=True)
    (clips / "outros" / "o.mp4").write_bytes(b"x")
    outdir = clips / "jobo"
    outdir.mkdir()
    order = []
    seen = {}

    def fake_append(clip_path, outro_path, **kwargs):
        order.append("append")
        seen["clip"], seen["outro"] = clip_path, outro_path
        return True

    with patch.object(pipeline, "_render_one", side_effect=lambda *a, **k: order.append("render")), \
         patch.object(pipeline, "append_outro", side_effect=fake_append):
        clip = pipeline._render_clip_sync(
            _job(Outro("outros/o.mp4")), MOMENT, [], "src.mp4", "clip-01.mp4", str(outdir), 0.0
        )

    assert order == ["render", "append"]
    assert seen["clip"] == str(outdir / "clip-01.mp4")
    assert seen["outro"] == os.path.realpath(clips / "outros" / "o.mp4")
    # startSec/endSec tidak berubah oleh outro.
    assert (clip.start, clip.end) == (0.0, 3.0)


def test_render_clip_sync_missing_outro_skips_without_failing(tmp_path, caplog):
    outdir = tmp_path / "clips" / "jobo"
    outdir.mkdir(parents=True)
    with patch.object(pipeline, "_render_one"), patch.object(pipeline, "append_outro") as append:
        with caplog.at_level("WARNING"):
            pipeline._render_clip_sync(
                _job(Outro("outros/gone.mp4")), MOMENT, [], "src.mp4", "clip-01.mp4", str(outdir), 0.0
            )
    append.assert_not_called()
    assert "outro" in caplog.text.lower()


def test_render_clip_sync_no_outro_never_calls_append(tmp_path):
    with patch.object(pipeline, "_render_one"), patch.object(pipeline, "append_outro") as append:
        pipeline._render_clip_sync(
            _job(None), MOMENT, [], "src.mp4", "clip-01.mp4", str(tmp_path / "jobo"), 0.0
        )
    append.assert_not_called()


def test_frame_preview_render_never_includes_outro():
    import inspect

    assert "outro" not in inspect.getsource(pipeline.run_frame).lower()
    assert "outro" not in inspect.getsource(pipeline._render_one).lower()


# ---------- ffmpeg nyata ----------

needs_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg tidak ada"
)


def _ff(*args):
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args], check=True)


def _probe(path, entries, stream=None):
    cmd = ["ffprobe", "-v", "error"]
    if stream:
        cmd += ["-select_streams", stream]
    cmd += ["-show_entries", entries, "-of", "csv=p=0", str(path)]
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip()


def _duration(path):
    return float(_probe(path, "format=duration"))


def _make_clip(path, seconds=3, audio=True, size="320x180", rate=25):
    args = ["-f", "lavfi", "-i", f"testsrc=size={size}:rate={rate}:duration={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}"]
    args += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if audio:
        args += ["-c:a", "aac", "-shortest"]
    _ff(*args, str(path))


def _make_outro(path, seconds=2, audio=True, size="640x360", rate=30):
    args = ["-f", "lavfi", "-i", f"color=c=blue:s={size}:r={rate}:d={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=880:duration={seconds}"]
    args += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if audio:
        args += ["-c:a", "aac", "-shortest"]
    _ff(*args, str(path))


@needs_ffmpeg
@pytest.mark.parametrize(
    "clip_audio,outro_audio,clip_size,outro_size",
    [
        (True, True, "320x180", "640x360"),
        (True, False, "180x320", "640x360"),  # outro tanpa audio, klip vertikal
        (False, True, "320x180", "360x640"),  # klip tanpa audio
        (False, False, "320x180", "320x180"),
    ],
)
def test_ffmpeg_append_outro_duration_and_streams(tmp_path, clip_audio, outro_audio, clip_size, outro_size):
    clip, outro = tmp_path / "clip.mp4", tmp_path / "outro.mp4"
    _make_clip(clip, 3, audio=clip_audio, size=clip_size)
    _make_outro(outro, 2, audio=outro_audio, size=outro_size)
    w, h = clip_size.split("x")

    assert pipeline.append_outro(str(clip), str(outro)) is True

    assert _duration(clip) == pytest.approx(5.0, abs=0.3)
    # Ukuran output klip dipertahankan; audio selalu ada setelah concat.
    assert _probe(clip, "stream=width,height", "v:0") == f"{w},{h}"
    assert _probe(clip, "stream=codec_name", "a:0") == "aac"
    assert _probe(clip, "stream=codec_name", "v:0") == "h264"
    assert not os.path.exists(str(clip) + ".outro.tmp")


@needs_ffmpeg
def test_ffmpeg_append_outro_shows_outro_frames_at_end(tmp_path):
    import numpy as np

    clip, outro = tmp_path / "clip.mp4", tmp_path / "outro.mp4"
    _make_clip(clip, 3)
    _make_outro(outro, 2)  # layar biru solid
    assert pipeline.append_outro(str(clip), str(outro))

    def frame(at):
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{at}", "-i", str(clip), "-frames:v", "1",
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            capture_output=True, check=True,
        ).stdout
        return np.frombuffer(raw, dtype=np.uint8).reshape(180, 320, 3).astype(int)

    end = frame(4.0)  # di dalam outro
    assert end[..., 2].mean() > 150 and end[..., 0].mean() < 60  # dominan biru
    start = frame(0.5)  # masih klip asli (testsrc beragam warna)
    assert start.std() > 20


@needs_ffmpeg
def test_ffmpeg_broken_outro_keeps_clip_unchanged(tmp_path, caplog):
    clip, outro = tmp_path / "clip.mp4", tmp_path / "outro.mp4"
    _make_clip(clip, 3)
    outro.write_bytes(b"this is not a video")
    before = clip.read_bytes()

    with caplog.at_level("WARNING"):
        assert pipeline.append_outro(str(clip), str(outro)) is False

    assert clip.read_bytes() == before
    assert not os.path.exists(str(clip) + ".outro.tmp")
    assert "outro dilewati" in caplog.text


@needs_ffmpeg
def test_ffmpeg_render_clip_sync_end_to_end_with_outro(tmp_path):
    """Jalur nyata: render klip dari sumber lalu outro ditempel; broken outro -> klip tetap ada."""
    src = tmp_path / "src.mp4"
    _make_clip(src, 4, size="640x360")
    clips = tmp_path / "clips"
    (clips / "outros" / "u").mkdir(parents=True)
    _make_outro(clips / "outros" / "u" / "ok.mp4", 2)
    (clips / "outros" / "u" / "bad.mp4").write_bytes(b"garbage")

    def render(outro_rel, name):
        outdir = clips / "jobx"
        outdir.mkdir(exist_ok=True)
        job = JobData(
            job_id="jobx", url="https://youtu.be/x", reframe="black_bars", captions=False,
            outro=Outro(outro_rel),
        )
        res = pipeline._render_clip_sync(
            job, pipeline.llm.Moment(0.0, 3.0, "t"), [], str(src), name, str(outdir), 0.0
        )
        return outdir / name, res

    ok_path, ok_res = render("outros/u/ok.mp4", "clip-01.mp4")
    assert _duration(ok_path) == pytest.approx(5.0, abs=0.3)
    assert _probe(ok_path, "stream=width,height", "v:0") == "1080,1920"
    assert (ok_res.start, ok_res.end) == (0.0, 3.0)

    bad_path, bad_res = render("outros/u/bad.mp4", "clip-02.mp4")
    assert _duration(bad_path) == pytest.approx(3.0, abs=0.3)
    assert (bad_res.start, bad_res.end) == (0.0, 3.0)
