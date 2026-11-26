import asyncio
import os
import shutil
import subprocess
from unittest.mock import patch

import cv2
import pytest

from clipper import pipeline
from clipper.models import FRAME_QUEUE_NAME


def frame_payload(**overrides):
    payload = {
        "url": "https://youtube.com/watch?v=dummy",
        "atSec": 12.5,
        "aspectRatio": "9:16",
        "reframe": "black_bars",
        "twoSpeakers": False,
        "facecam": False,
        "captions": True,
        "captionSample": "Contoh takarir",
        "outPath": ".frames/frame-1.jpg",
    }
    payload.update(overrides)
    return payload


def test_queue_name_and_concurrency_default():
    worker = pytest.importorskip("clipper.worker")
    assert FRAME_QUEUE_NAME == worker.FRAME_QUEUE_NAME == "clip-frames"
    assert worker.FRAME_CONCURRENCY == int(os.getenv("FRAME_CONCURRENCY", "1"))


def test_parse_frame_payload_normalizes_and_guards_paths():
    parsed = pipeline.parse_frame_payload(frame_payload())
    assert parsed["url"].startswith("https://")
    assert parsed["atSec"] == 12.5
    assert parsed["aspectRatio"] == "9:16"
    assert parsed["captionSample"] == "Contoh takarir"
    assert parsed["outPath"] == os.path.join(".frames", "frame-1.jpg")

    with pytest.raises(RuntimeError, match="invalid_frame_path"):
        pipeline.parse_frame_payload(frame_payload(outPath="../escape.jpg"))
    with pytest.raises(RuntimeError, match="invalid_frame_payload"):
        pipeline.parse_frame_payload(frame_payload(outPath="/tmp/escape.jpg"))
    with pytest.raises(RuntimeError, match="invalid_frame_payload"):
        pipeline.parse_frame_payload(frame_payload(aspectRatio="4:3"))
    with pytest.raises(RuntimeError, match="invalid_frame_payload"):
        pipeline.parse_frame_payload(frame_payload(atSec=-1))
    with pytest.raises(RuntimeError, match="invalid_frame_payload"):
        pipeline.parse_frame_payload({"atSec": 1})


@pytest.mark.parametrize("facecam, expected_kwargs", [(False, {}), (True, {"facecam_reuse_cache": False})])
def test_run_frame_downloads_section_and_calls_render_with_job_args(tmp_path, facecam, expected_kwargs):
    calls = {"download": [], "render": [], "run": []}

    async def fake_download(url, at_sec, workdir):
        calls["download"].append((url, at_sec, workdir))
        return os.path.join(workdir, "section.mp4"), 11.5

    def fake_render(*args, **kwargs):
        calls["render"].append((args, kwargs))

    def fake_run(cmd, cwd=None, timeout=None):
        calls["run"].append(list(cmd))
        with open(cmd[-1], "wb") as handle:
            handle.write(b"fake jpeg")

    with patch.object(pipeline, "_download_preview_section", side_effect=fake_download), \
         patch.object(pipeline, "_render_one", side_effect=fake_render), \
         patch.object(pipeline, "_run", side_effect=fake_run), \
         patch.object(pipeline, "_cleanup_old_frames") as cleanup:
        result = asyncio.run(pipeline.run_frame(frame_payload(facecam=facecam), str(tmp_path)))

    assert result == {
        "file": os.path.join(".frames", "frame-1.jpg"),
        "width": 1080, "height": 1920, "atSec": 12.5,
    }
    assert calls["download"][0][:2] == ("https://youtube.com/watch?v=dummy", 12.5)
    args, kwargs = calls["render"][0]
    assert args[0].endswith("section.mp4")
    assert (args[1].start, args[1].end) == (0.0, 2.0)
    assert [(cue.start, cue.end, cue.text) for cue in args[2]] == [
        (11.5, 13.5, "Contoh takarir")
    ]
    assert args[3] == calls["download"][0][2]
    assert args[4:] == (
        "render.mp4", "black_bars", True, False, facecam, 11.5, "9:16", None, None, 100.0,
    )
    assert kwargs == expected_kwargs
    cmd = calls["run"][0]
    assert cmd[cmd.index("-ss") + 1] == "1.000"
    assert cmd[cmd.index("-q:v") + 1] == "3"
    assert cmd[-1] == str(tmp_path / ".frames" / "frame-1.jpg")
    cleanup.assert_called_once_with(str(tmp_path / ".frames"))


def test_run_frame_rejects_traversal_before_writing(tmp_path):
    with pytest.raises(RuntimeError, match="invalid_frame_path"):
        asyncio.run(pipeline.run_frame(frame_payload(outPath="../escape.jpg"), str(tmp_path)))
    assert list(tmp_path.iterdir()) == []


def _make_source_video(path):
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25", "-t", "6",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path),
    ], check=True)


@pytest.mark.parametrize("aspect,expected", [("9:16", (1080, 1920)), ("16:9", (1920, 1080))])
def test_frame_smoke_uses_real_ffmpeg(tmp_path, aspect, expected):
    source = tmp_path / "source.mp4"
    _make_source_video(source)
    real_run = pipeline._run

    def fake_run(cmd, cwd=None, timeout=None):
        if cmd[0] == "yt-dlp":
            # yt-dlp diganti file lokal; ffmpeg asli tetap dipakai untuk render.
            out = cmd[cmd.index("-o") + 1].replace("%(ext)s", "mp4")
            shutil.copyfile(source, out)
            return ""
        return real_run(cmd, cwd=cwd, timeout=timeout)

    clips = tmp_path / "clips"
    temp_root = tmp_path / "tmp"
    temp_root.mkdir()
    with patch.object(pipeline, "_run", side_effect=fake_run):
        result = asyncio.run(pipeline.run_frame(
            frame_payload(
                url="https://example.test/watch?v=local",
                atSec=2.0, aspectRatio=aspect, captions=False,
                outPath=f".frames/{aspect.replace(':', '-')}.jpg",
            ),
            str(clips), temp_root=str(temp_root),
        ))

    jpeg = clips / ".frames" / f"{aspect.replace(':', '-')}.jpg"
    assert jpeg.is_file()
    image = cv2.imread(str(jpeg))
    assert image is not None
    assert (image.shape[1], image.shape[0]) == expected
    assert result == {
        "file": f".frames/{aspect.replace(':', '-')}.jpg",
        "width": expected[0], "height": expected[1], "atSec": 2.0,
    }
    assert list(temp_root.iterdir()) == []
