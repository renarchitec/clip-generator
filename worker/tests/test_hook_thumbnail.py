import shutil
import subprocess

import numpy as np
import pytest
from PIL import Image

from clipper import hook_thumbnail as hook, pipeline


@pytest.mark.parametrize("width,height", [(1080, 1920), (1080, 1080), (1920, 1080)])
@pytest.mark.parametrize("with_frame,text", [
    (True, '  “Tunggu\n dulu!”  '),
    (False, "Tunggu sampai kamu melihat bagaimana semuanya berubah tepat sebelum kejadian itu"),
])
def test_render_hook_thumbnail(tmp_path, width, height, with_frame, text):
    frame = np.full((180, 320, 3), (190, 125, 70), dtype=np.uint8) if with_frame else None
    png = str(tmp_path / "hook.png")
    assert hook.render_hook_thumbnail(frame, text, width, height, png) == png
    with Image.open(png) as image:
        assert image.format == "PNG"
        assert image.size == (width, height)
        rgb = np.array(image.convert("RGB"))
    gold_y, gold_x = np.where(np.all(rgb == (250, 204, 21), axis=-1))
    assert gold_x.size > 100
    assert np.count_nonzero(np.all(rgb == (255, 255, 255), axis=-1)) > 100
    bottom = int(height * (0.765 if height > width else 0.84 if height == width else 0.85))
    assert height * 0.5 < gold_y.min() < gold_y.max() <= bottom
    assert rgb[height // 4, width // 2].mean() > rgb[-1, width // 2].mean()


def test_extract_cover_frame_ranks_candidates_and_releases(monkeypatch):
    dark = np.full((12, 12, 3), 10, dtype=np.uint8)
    bright = np.full((12, 12, 3), 127, dtype=np.uint8)
    sharp = (np.indices((12, 12)).sum(axis=0) % 2 * 255).astype(np.uint8)
    sharp = np.repeat(sharp[..., None], 3, axis=2)
    positions = []
    released = []

    class Capture:
        frames = iter([dark, bright, sharp])

        def isOpened(self):
            return True

        def set(self, prop, ms):
            assert prop == hook.cv2.CAP_PROP_POS_MSEC
            positions.append(ms)

        def read(self):
            return True, next(self.frames)

        def release(self):
            released.append(True)

    monkeypatch.setattr(hook.cv2, "VideoCapture", lambda path: Capture())
    assert hook.extract_cover_frame("src.mp4", 2, 2.8) is sharp
    assert positions == pytest.approx([2250, 2700, 2280])
    assert released == [True]


@pytest.mark.parametrize("has_audio", [True, False])
def test_hook_intro_command(has_audio):
    meta = {"width": 360, "height": 640, "fps": 30.0, "duration": 1.5, "has_audio": has_audio}
    cmd = hook._hook_intro_command("clip.mp4", "cover.png", "out.tmp", meta, 0.9)
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert cmd[cmd.index("-i"):][:4] == ["-i", "cover.png", "-i", "clip.mp4"]
    assert cmd[-3:] == ["-f", "mp4", "out.tmp"]
    assert "zoompan=z='1.06-0.06*(1-pow(1-on/27,2))'" in graph
    assert "d=27:s=360x640:fps=30.000" in graph
    assert "[iv][ia][cv][ca]concat=n=2:v=1:a=1[v][a]" in graph
    assert "[2:a:0]aresample=44100" in graph
    assert "apad=whole_dur=0.900,atrim=end=0.900" in graph
    assert cmd.count("anullsrc=r=44100:cl=stereo") == (1 if has_audio else 2)
    assert ("afade=t=in:st=0:d=0.04" in graph) is has_audio
    assert ("[1:a:0]" if has_audio else "[3:a:0]") in graph


def test_prepend_hook_intro_preserves_original_on_error(tmp_path, monkeypatch):
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"original")
    temp = tmp_path / "clip.mp4.hook.tmp"
    monkeypatch.setattr(pipeline, "_probe_media", lambda path: {
        "width": 360, "height": 640, "fps": 30.0, "duration": 1.5, "has_audio": True,
    })

    def fail(command, timeout):
        assert command[-1] == str(temp)
        temp.write_bytes(b"partial")
        raise RuntimeError("ffmpeg failed")

    monkeypatch.setattr(pipeline, "_run", fail)
    assert hook.prepend_hook_intro(str(clip), "cover.png") is False
    assert clip.read_bytes() == b"original"
    assert not temp.exists()


@pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="FFmpeg is required")
@pytest.mark.parametrize("has_audio", [True, False])
def test_prepend_hook_intro_smoke(tmp_path, has_audio):
    clip = str(tmp_path / "clip.mp4")
    cover = str(tmp_path / "cover.png")
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=30",
        *(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"] if has_audio else []),
        "-t", "1.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", clip,
    ], check=True, timeout=30)
    before = pipeline._probe_media(clip)
    assert before["has_audio"] is has_audio
    frame = hook.extract_cover_frame(clip, 0, before["duration"])
    assert frame is not None
    hook.render_hook_thumbnail(frame, "Jangan lewatkan ini!", 360, 640, cover)
    assert hook.prepend_hook_intro(clip, cover, timeout=30)
    after = pipeline._probe_media(clip)
    assert after["duration"] >= 2.2
    assert after["duration"] - before["duration"] == pytest.approx(0.9, abs=0.1)
    assert (after["width"], after["height"]) == (360, 640)
    assert after["has_audio"] is True
    assert not (tmp_path / "clip.mp4.hook.tmp").exists()
