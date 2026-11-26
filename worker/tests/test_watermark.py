"""Uji watermark gambar/video: parse payload, clamp, graph filter, smoke ffmpeg."""

import os
import shutil
import subprocess
from unittest.mock import patch

import pytest

from clipper import pipeline
from clipper.models import (
    WATERMARK_MAX_PER_JOB, JobData, Watermark, WatermarkChromaKey, job_data_from_dict,
)

BASE = {"jobId": "abc", "url": "https://youtu.be/x"}
MOMENT = pipeline.llm.Moment(0.0, 4.0, "t")


# ---------- parsing ----------

def test_watermark_absent_or_null_is_none():
    assert job_data_from_dict(BASE).watermark is None
    assert job_data_from_dict({**BASE, "watermark": None}).watermark is None
    assert job_data_from_dict({**BASE, "watermark": "x"}).watermark is None
    assert job_data_from_dict({**BASE, "watermark": {"x": 0.5}}).watermark is None  # tanpa filePath
    assert job_data_from_dict({**BASE, "watermark": {"filePath": "  "}}).watermark is None
    assert job_data_from_dict(BASE).to_dict()["watermark"] is None


def test_watermark_parses_camel_case():
    job = job_data_from_dict(
        {
            **BASE,
            "watermark": {
                "filePath": "watermarks/u1/w1.png",
                "x": 0.8,
                "y": 0.1,
                "scale": 0.3,
                "opacity": 0.5,
            },
        }
    )
    assert job.watermark == Watermark("watermarks/u1/w1.png", 0.8, 0.1, 0.3, 0.5)
    assert job.to_dict()["watermark"] == {
        "filePath": "watermarks/u1/w1.png",
        "x": 0.8,
        "y": 0.1,
        "scale": 0.3,
        "opacity": 0.5,
    }


@pytest.mark.parametrize("count", [2, 3, 4, 5])
def test_watermarks_array_takes_precedence_and_round_trips(count):
    expected = [Watermark(f"{idx}.png") for idx in range(count)]
    job = job_data_from_dict({
        **BASE,
        "watermark": {"filePath": "legacy.png"},
        "watermarks": [wm.to_dict() for wm in expected],
    })
    assert job.watermarks == expected
    assert job.watermark is job.watermarks[0]
    payload = job.to_dict()
    assert payload["watermarks"] == [wm.to_dict() for wm in expected]
    assert payload["watermark"] == payload["watermarks"][0]
    assert job_data_from_dict(payload) == job


@pytest.mark.parametrize("key", ["watermarks", "watermark"])
@pytest.mark.parametrize("container", [list, tuple])
def test_watermark_lists_drop_invalid_items_and_cap_at_five(key, container):
    items = [None, {"x": 0.2}, {"filePath": " "}, "not an object"]
    items.extend({"filePath": f"{idx}.png"} for idx in range(7))
    job = job_data_from_dict({**BASE, key: container(items)})
    assert WATERMARK_MAX_PER_JOB == 5
    assert job.watermarks == [Watermark(f"{idx}.png") for idx in range(5)]
    assert job.watermark is job.watermarks[0]


@pytest.mark.parametrize("raw", [None, [], [None], {"filePath": "not-an-array.png"}])
def test_watermarks_falls_back_to_single_legacy_dict(raw):
    job = job_data_from_dict({**BASE, "watermarks": raw, "watermark": {"filePath": "legacy.png"}})
    assert job.watermarks == [Watermark("legacy.png")]
    assert job.watermark is job.watermarks[0]


def test_job_constructor_syncs_watermark_fields_and_caps_layers():
    layers = [Watermark(f"{idx}.png") for idx in range(7)]
    assert JobData("abc", BASE["url"], watermark=layers[0]).watermarks == [layers[0]]
    job = JobData("abc", BASE["url"], watermarks=layers)
    assert job.watermarks == layers[:5]
    assert job.watermark is layers[0]


def test_watermark_clamps_and_defaults():
    wm = Watermark.from_dict(
        {"filePath": "a.png", "x": -3, "y": 9, "scale": 50, "opacity": 2}
    )
    assert (wm.x, wm.y, wm.scale, wm.opacity) == (0.0, 1.0, 1.0, 1.0)

    wm = Watermark.from_dict({"filePath": "a.png", "scale": 0, "opacity": -1})
    assert wm.scale == 0.0
    assert wm.opacity == 0.0

    # Nilai sampah / NaN / inf -> default.
    wm = Watermark.from_dict(
        {"filePath": "a.png", "x": "abc", "y": float("nan"), "scale": float("inf"), "opacity": None}
    )
    assert (wm.x, wm.y, wm.scale, wm.opacity) == (0.5, 0.5, 0.25, 1.0)


def test_watermark_chroma_key_defaults_and_validation():
    parse = WatermarkChromaKey.from_dict
    assert parse(None) is None
    assert parse([]) is None
    assert parse({}) == WatermarkChromaKey()
    assert parse({"enabled": "true", "color": "#00FF00\n", "similarity": float("nan"), "blend": "bad"}) == WatermarkChromaKey()
    assert parse({"enabled": True, "color": "#0000ff", "similarity": -1, "blend": 2}) == WatermarkChromaKey(True, "#0000FF", 0.01, 0.5)
    assert parse({"similarity": 2, "blend": -1}) == WatermarkChromaKey(similarity=0.5, blend=0.0)


@pytest.mark.parametrize("payload", [
    {"filePath": "w.asset", "mimeType": "video/webm", "chromaKey": {"enabled": True}},
    {"file_path": "w.asset", "mime_type": "video/webm", "chroma_key": {"enabled": True}},
])
def test_watermark_parses_video_fields(payload):
    watermark = Watermark.from_dict(payload)
    assert watermark == Watermark("w.asset", mime_type="video/webm", chroma_key=WatermarkChromaKey(enabled=True))
    assert Watermark.from_dict(watermark.to_dict()) == watermark


@pytest.mark.parametrize(("path", "mime_type", "expected"), [
    ("w.png", "image/png", False), ("w.jpg", None, False),
    ("w.MP4", None, True), ("w.WeBm", None, True), ("w.mov", "image/png", True),
    ("w.asset", "VIDEO/MP4", True),
])
def test_watermark_is_video(path, mime_type, expected):
    assert Watermark(path, mime_type=mime_type).is_video is expected


# ---------- resolusi path ----------

def test_resolve_path_ok_missing_and_traversal(tmp_path):
    root = tmp_path / "clips"
    (root / "watermarks" / "u").mkdir(parents=True)
    png = root / "watermarks" / "u" / "w.png"
    png.write_bytes(b"x")
    outside = tmp_path / "secret.png"
    outside.write_bytes(b"x")

    resolve = pipeline.resolve_watermark_path
    assert resolve(str(root), Watermark("watermarks/u/w.png")) == os.path.realpath(png)
    assert resolve(str(root), None) is None
    assert resolve(str(root), Watermark("watermarks/u/nope.png")) is None
    assert resolve(str(root), Watermark("../secret.png")) is None
    assert resolve(str(root), Watermark("watermarks/../../secret.png")) is None
    assert resolve(str(root), Watermark(str(outside))) is None
    assert resolve(str(root), Watermark("watermarks/u")) is None  # direktori

    # Symlink keluar dari clips dir ditolak.
    link = root / "watermarks" / "u" / "link.png"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("symlink tidak didukung")
    assert resolve(str(root), Watermark("watermarks/u/link.png")) is None


# ---------- graph ----------

def test_watermark_chain_and_overlay_expressions():
    wm = Watermark("a.png", x=0.8, y=0.1, scale=0.3, opacity=0.5)
    chain = pipeline._watermark_chain(1080, 1920, wm)
    # round(1080*0.3/2)*2 = 324
    assert chain == "[1:v]scale=w=324:h=-2,format=rgba,colorchannelmixer=aa=0.500[wm]"

    overlay = pipeline._watermark_overlay("[v]", wm)
    assert overlay.startswith("[v][wm]overlay=")
    assert "main_w*0.8000-overlay_w/2" in overlay
    assert "main_h*0.1000-overlay_h/2" in overlay
    assert "min(main_w-overlay_w" in overlay and "max(0," in overlay
    assert "shortest=1" in overlay
    assert overlay.endswith("[wmout]")


def test_with_watermarks_one_layer_keeps_legacy_labels():
    graph = ["[0:v]null[base]"]
    wm = Watermark("a.png")
    chain, label = pipeline._with_watermarks(graph, "[base]", 1080, 1920, [wm])
    assert (chain, label) == pipeline._with_watermark(graph, "[base]", 1080, 1920, wm)
    assert chain[1].startswith("[1:v]") and chain[1].endswith("[wm]")
    assert chain[2].startswith("[base][wm]overlay=") and chain[2].endswith("[wmout]")
    assert label == "[wmout]"


def test_with_watermarks_three_layers_chain_in_list_order():
    graph = ["[0:v]null[base]"]
    layers = [Watermark(f"{idx}.png", x=x) for idx, x in enumerate((0.2, 0.5, 0.8))]
    chain, label = pipeline._with_watermarks(graph, "[base]", 1080, 1920, layers)
    assert graph == ["[0:v]null[base]"]
    assert chain[:1] == graph and len(chain) == 7
    for idx, (cur, out) in enumerate((
        ("[base]", "[wmout0]"), ("[wmout0]", "[wmout1]"), ("[wmout1]", "[wmout]"),
    )):
        assert chain[2 * idx + 1].startswith(f"[{idx + 1}:v]")
        assert chain[2 * idx + 1].endswith(f"[wm{idx}]")
        overlay = chain[2 * idx + 2]
        assert overlay.startswith(f"{cur}[wm{idx}]overlay=") and overlay.endswith(out)
        assert f"main_w*{layers[idx].x:.4f}-overlay_w/2" in overlay
    assert label == "[wmout]"


def test_watermark_chain_uses_output_width_per_ratio():
    wm = Watermark("a.png", scale=0.25)
    assert "scale=w=480:h=-2" in pipeline._watermark_chain(1920, 1080, wm)  # 16:9
    assert "scale=w=270:h=-2" in pipeline._watermark_chain(1080, 1920, wm)  # 9:16


@pytest.mark.parametrize(("path", "mime", "codec", "decoder", "should_probe"), [
    ("w.png", None, None, [], False),
    ("w.mp4", None, None, [], False),
    ("w.mov", "video/quicktime", None, [], False),
    ("w.WEBM", None, "vp9", ["-c:v", "libvpx-vp9"], True),
    ("w.asset", "VIDEO/WEBM", "vp8", ["-c:v", "libvpx"], True),
    ("w.webm", None, None, [], True),
])
def test_watermark_input_args(path, mime, codec, decoder, should_probe):
    wm = Watermark(path, mime_type=mime)
    with patch.object(pipeline, "_probe_video_codec", return_value=codec) as probe:
        args = pipeline._watermark_input_args(path, 3.5, wm)
    if should_probe:
        probe.assert_called_once_with(path)
    else:
        probe.assert_not_called()
    if wm.is_video:
        assert args == [*decoder, "-stream_loop", "-1", "-t", "3.500", "-an", "-i", path]
    else:
        assert args == ["-loop", "1", "-t", "3.500", "-i", path]


@pytest.mark.parametrize(("path", "key_color", "expected"), [
    ("w.mp4", None, "setpts=PTS-STARTPTS,"),
    ("w.mp4", "#00FF00", "setpts=PTS-STARTPTS,chromakey=color=0x00FF00:similarity=0.180:blend=0.080,despill=type=green,"),
    ("w.webm", "#0000FF", "setpts=PTS-STARTPTS,chromakey=color=0x0000FF:similarity=0.180:blend=0.080,despill=type=blue,"),
    ("w.mov", "#000000", "setpts=PTS-STARTPTS,colorkey=color=0x000000:similarity=0.180:blend=0.080,"),
    ("w.png", "#FFFFFF", "colorkey=color=0xFFFFFF:similarity=0.180:blend=0.080,"),
])
def test_watermark_chain_video_or_chroma_key(path, key_color, expected):
    chroma_key = WatermarkChromaKey(enabled=True, color=key_color) if key_color else WatermarkChromaKey()
    wm = Watermark(path, opacity=0.5, chroma_key=chroma_key)
    assert pipeline._watermark_chain(1080, 1920, wm) == (
        f"[1:v]{expected}scale=w=270:h=-2,format=rgba,colorchannelmixer=aa=0.500[wm]"
    )


def _capture(tmp_path, **kwargs):
    commands = []

    def fake_run(cmd, cwd=None, timeout=None):
        commands.append(list(cmd))
        return ""

    wm_file = tmp_path / "wm.png"
    wm_file.write_bytes(b"x")
    with patch.object(pipeline, "_run", side_effect=fake_run):
        pipeline._render_one(
            str(tmp_path / "src.mp4"),
            MOMENT,
            [],
            str(tmp_path),
            "clip-01.mp4",
            **kwargs,
        )
    return commands[0]


def _wm_kwargs(tmp_path):
    return {
        "watermark": Watermark("wm.png", 0.9, 0.9, 0.2, 0.7),
        "watermark_path": str(tmp_path / "wm.png"),
    }


def test_render_one_without_watermark_unchanged(tmp_path):
    cmd = _capture(tmp_path, reframe="black_bars", captions=False)
    assert "-vf" in cmd and "-filter_complex" not in cmd
    assert cmd.count("-i") == 1


def test_render_one_watermark_none_path_ignored(tmp_path):
    cmd = _capture(
        tmp_path,
        reframe="black_bars",
        captions=False,
        watermark=Watermark("wm.png"),
        watermark_path=None,
    )
    assert "-vf" in cmd and cmd.count("-i") == 1


def test_render_one_plain_path_uses_filter_complex(tmp_path):
    cmd = _capture(tmp_path, reframe="black_bars", captions=False, **_wm_kwargs(tmp_path))

    assert "-vf" not in cmd
    assert cmd.count("-i") == 2
    # Input ke-2 = gambar, di-loop dan dibatasi durasi klip; -ss hanya untuk video.
    wm_i = len(cmd) - 1 - cmd[::-1].index("-i")
    assert cmd[wm_i + 1] == str(tmp_path / "wm.png")
    assert cmd[wm_i - 4 : wm_i] == ["-loop", "1", "-t", "4.000"]
    assert cmd.index("-ss") < cmd.index("-i") < wm_i

    graph = cmd[cmd.index("-filter_complex") + 1]
    assert graph.startswith("[0:v]setpts=PTS-STARTPTS,scale=1080:1920")
    assert "[base]" in graph and "[1:v]scale=w=216:h=-2" in graph
    assert graph.endswith("[wmout]")
    maps = [cmd[i + 1] for i, part in enumerate(cmd) if part == "-map"]
    assert maps == ["[wmout]", "0:a:0?"]


def test_render_one_plain_path_watermark_after_subtitles(tmp_path):
    cues = [pipeline.Cue(0.0, 3.0, "halo dunia")]
    commands = []

    def fake_run(cmd, cwd=None, timeout=None):
        commands.append(list(cmd))
        return ""

    (tmp_path / "wm.png").write_bytes(b"x")
    with patch.object(pipeline, "_run", side_effect=fake_run):
        pipeline._render_one(
            str(tmp_path / "src.mp4"), MOMENT, cues, str(tmp_path), "clip-01.mp4",
            reframe="black_bars", captions=True, **_wm_kwargs(tmp_path),
        )
    graph = commands[0][commands[0].index("-filter_complex") + 1]
    assert graph.index("subtitles=") < graph.index("overlay=")


def test_render_one_16_9_uses_landscape_output_width(tmp_path):
    cmd = _capture(
        tmp_path, reframe="blurred_fill", captions=False, aspect_ratio="16:9",
        **_wm_kwargs(tmp_path),
    )
    graph = cmd[cmd.index("-filter_complex") + 1]
    # round(1920*0.2/2)*2 = 384
    assert "scale=w=384:h=-2" in graph


def test_render_one_two_speakers_graph_with_watermark(tmp_path):
    with patch.object(pipeline.reframe_mod, "two_speaker_centers", return_value=None):
        cmd = _capture(tmp_path, two_speakers=True, captions=False, **_wm_kwargs(tmp_path))

    assert cmd.count("-i") == 2
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "vstack=inputs=2[vstacked]" in graph
    assert "[vstacked][wm]overlay=" in graph
    maps = [cmd[i + 1] for i, part in enumerate(cmd) if part == "-map"]
    assert maps == ["[wmout]", "0:a:0?"]


def test_render_one_facecam_graph_with_watermark(tmp_path):
    with patch.object(pipeline, "_facecam_box_for", return_value=(10, 20, 300, 200)):
        cmd = _capture(tmp_path, facecam=True, captions=False, **_wm_kwargs(tmp_path))

    assert cmd.count("-i") == 2
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "[top][bot]vstack=inputs=2[v]" in graph
    assert "[v][wm]overlay=" in graph
    maps = [cmd[i + 1] for i, part in enumerate(cmd) if part == "-map"]
    assert maps == ["[wmout]", "0:a:0?"]


def test_render_one_facecam_fallback_still_gets_watermark(tmp_path):
    with patch.object(pipeline, "_facecam_box_for", return_value=None):
        cmd = _capture(
            tmp_path, facecam=True, reframe="black_bars", captions=False,
            **_wm_kwargs(tmp_path),
        )
    assert "-vf" not in cmd and cmd.count("-i") == 2
    assert "[base][wm]overlay=" in cmd[cmd.index("-filter_complex") + 1]


def test_render_one_corrupt_watermark_retries_without_watermark(tmp_path, caplog):
    commands = []

    def fake_run(cmd, cwd=None, timeout=None):
        commands.append(list(cmd))
        if "-filter_complex" in cmd:
            raise RuntimeError("ffmpeg gagal: Invalid data found when processing input")
        return ""

    (tmp_path / "wm.png").write_bytes(b"not-a-png")
    with patch.object(pipeline, "_run", side_effect=fake_run):
        with caplog.at_level("WARNING"):
            pipeline._render_one(
                str(tmp_path / "src.mp4"), MOMENT, [], str(tmp_path), "clip-01.mp4",
                reframe="black_bars", captions=False, **_wm_kwargs(tmp_path),
            )

    assert len(commands) == 2
    assert "-filter_complex" in commands[0]
    assert "-vf" in commands[1] and commands[1].count("-i") == 1
    assert "tanpa watermark" in caplog.text.lower()


# ---------- penerusan lewat _render_clip_sync ----------

def _job(watermark):
    return JobData(job_id="jobwm", url="https://youtu.be/x", watermark=watermark)


def test_render_clip_sync_passes_resolved_watermark(tmp_path):
    clips = tmp_path / "clips"
    (clips / "watermarks").mkdir(parents=True)
    (clips / "watermarks" / "w.png").write_bytes(b"x")
    outdir = clips / "jobwm"
    outdir.mkdir()
    wm = Watermark("watermarks/w.png")
    seen = {}

    def fake_render_one(*args, **kwargs):
        seen.update(kwargs)

    with patch.object(pipeline, "_render_one", side_effect=fake_render_one):
        pipeline._render_clip_sync(_job(wm), MOMENT, [], "src.mp4", "clip-01.mp4", str(outdir), 0.0)

    assert seen["watermark"] == wm
    assert seen["watermark_path"] == os.path.realpath(clips / "watermarks" / "w.png")


def test_render_clip_sync_missing_watermark_renders_without(tmp_path, caplog):
    outdir = tmp_path / "clips" / "jobwm"
    outdir.mkdir(parents=True)
    seen = {"called": 0}

    def fake_render_one(*args, **kwargs):
        seen["called"] += 1
        seen.update(kwargs)

    with patch.object(pipeline, "_render_one", side_effect=fake_render_one):
        with caplog.at_level("WARNING"):
            pipeline._render_clip_sync(
                _job(Watermark("watermarks/gone.png")), MOMENT, [], "src.mp4",
                "clip-01.mp4", str(outdir), 0.0,
            )

    assert seen["called"] == 1
    assert "watermark" not in seen
    assert "watermark" in caplog.text.lower()


def test_render_clip_sync_skips_missing_layer_and_renders_valid_layer(tmp_path):
    clips = tmp_path / "clips"
    outdir = clips / "jobwm"
    outdir.mkdir(parents=True)
    valid = Watermark("valid.png")
    png = clips / valid.file_path
    png.write_bytes(b"x")
    job = JobData("jobwm", BASE["url"], watermarks=[Watermark("missing.png"), valid])

    with patch.object(pipeline, "_render_one") as render:
        pipeline._render_clip_sync(job, MOMENT, [], "src.mp4", "clip-01.mp4", str(outdir), 0.0)

    render.assert_called_once()
    assert render.call_args.kwargs["watermark"] == valid
    assert render.call_args.kwargs["watermark_path"] == os.path.realpath(png)
    assert "watermarks" not in render.call_args.kwargs


def test_render_clip_sync_no_watermark_adds_no_watermark_kwargs(tmp_path):
    seen = {}
    with patch.object(pipeline, "_render_one", side_effect=lambda *a, **k: seen.update(k)):
        pipeline._render_clip_sync(
            _job(None), MOMENT, [], "src.mp4", "clip-01.mp4", str(tmp_path / "jobwm"), 0.0
        )
    assert {"watermark", "watermark_path", "watermarks"}.isdisjoint(seen)


# ---------- smoke ffmpeg nyata ----------

needs_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg tidak ada"
)


def _probe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    ).stdout
    return float(out.strip())


def _frame_rgb(path, at=1.0):
    """Ambil satu frame (detik `at`) sebagai numpy RGB24 melalui ffmpeg."""
    import numpy as np

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip().split(",")
    w, h = int(probe[0]), int(probe[1])
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{at}", "-i", path,
         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.uint8)[: w * h * 3].reshape(h, w, 3), w, h


@needs_ffmpeg
@pytest.mark.parametrize("ratio", ["9:16", "16:9"])
def test_ffmpeg_smoke_renders_with_watermark(tmp_path, ratio):
    src = tmp_path / "src.mp4"
    png = tmp_path / "wm.png"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=4",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(src)],
        check=True,
    )
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", "color=c=red:s=200x100,format=rgba", "-frames:v", "1", str(png)],
        check=True,
    )

    wm = Watermark("wm.png", x=0.9, y=0.95, scale=0.2, opacity=1.0)
    for name, kwargs in (
        ("plain.mp4", {}),
        ("out.mp4", {"watermark": wm, "watermark_path": str(png)}),
    ):
        pipeline._render_one(
            str(src),
            pipeline.llm.Moment(0.0, 3.0, "t"),
            [],
            str(tmp_path),
            name,
            reframe="black_bars",
            captions=False,
            aspect_ratio=ratio,
            **kwargs,
        )

    out = tmp_path / "out.mp4"
    assert out.is_file() and out.stat().st_size > 0
    # Durasi output = durasi klip, bukan durasi input gambar.
    assert _probe_duration(str(out)) == pytest.approx(3.0, abs=0.25)
    assert _probe_duration(str(out)) == pytest.approx(
        _probe_duration(str(tmp_path / "plain.mp4")), abs=0.05
    )
    # Audio tetap terpetakan.
    streams = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    assert sorted(streams) == ["audio", "video"]

    # Watermark benar-benar tercetak di posisi yang diminta (bukan cuma graph valid).
    import numpy as np

    with_wm, w, h = _frame_rgb(str(out))
    without_wm, _, _ = _frame_rgb(str(tmp_path / "plain.mp4"))

    wm_w = round(w * wm.scale / 2) * 2
    wm_h = round(wm_w * 100 / 200)  # png 200x100
    cx = min(max(w * wm.x, wm_w / 2), w - wm_w / 2)
    cy = min(max(h * wm.y, wm_h / 2), h - wm_h / 2)
    top, left = int(cy - wm_h / 2), int(cx - wm_w / 2)

    inside = np.abs(
        with_wm[top + 5 : top + wm_h - 5, left + 5 : left + wm_w - 5].astype(int)
        - without_wm[top + 5 : top + wm_h - 5, left + 5 : left + wm_w - 5].astype(int)
    ).mean()
    outside = np.abs(with_wm.astype(int) - without_wm.astype(int)).mean()

    assert inside > 20, f"watermark tidak terlihat (diff={inside:.1f})"
    assert inside > outside * 5, f"watermark bocor keluar area (in={inside:.1f}, out={outside:.1f})"


def _require_ffmpeg_encoders(*names):
    available = subprocess.run(
        ["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True, check=True,
    ).stdout
    encoders = {parts[1] for line in available.splitlines() if len(parts := line.split()) > 2}
    missing = set(names) - encoders
    if missing:
        pytest.skip(f"FFmpeg encoders unavailable: {', '.join(sorted(missing))}")


@needs_ffmpeg
@pytest.mark.parametrize(("ext", "encoder", "encode_args"), [
    ("mp4", "libx264", ["-pix_fmt", "yuv420p"]),
    ("webm", "libvpx-vp9", ["-pix_fmt", "yuva420p", "-auto-alt-ref", "0"]),
    ("mov", "prores_ks", ["-profile:v", "4444", "-pix_fmt", "yuva444p10le"]),
])
def test_ffmpeg_smoke_video_watermark_loops_with_chroma_or_alpha(tmp_path, monkeypatch, ext, encoder, encode_args):
    _require_ffmpeg_encoders("libx264", encoder)
    src = tmp_path / "blue.mp4"
    overlay = tmp_path / f"wm.{ext}"
    options = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    subprocess.run(
        [*options, "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=20:d=3",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(src)],
        check=True, timeout=30,
    )
    # Move the opaque red box halfway through the one-second video. Sampling both
    # phases of each loop detects frozen frames as well as a truncated overlay.
    keyed = ext == "mp4"
    background = "lime" if keyed else "black@0.0"
    pattern = (
        f"color=c={background}:s=160x90:r=20:d=1,format=rgba,"
        "drawbox=x=44:y=29:w=32:h=32:color=red:t=fill:replace=1:enable='lt(t,0.5)',"
        "drawbox=x=84:y=29:w=32:h=32:color=red:t=fill:replace=1:enable='gte(t,0.5)'"
    )
    subprocess.run(
        [*options, "-f", "lavfi", "-i", pattern, "-c:v", encoder, *encode_args, str(overlay)],
        check=True, timeout=30,
    )

    monkeypatch.setitem(pipeline.OUTPUT_SIZES, "16:9", (320, 180))
    watermark = Watermark(
        overlay.name, scale=0.5,
        chroma_key=WatermarkChromaKey(enabled=True) if keyed else None,
    )
    out = tmp_path / "out.mp4"
    pipeline._render_one(
        str(src), pipeline.llm.Moment(0.0, 3.0, "t"), [], str(tmp_path), out.name,
        reframe="black_bars", captions=False, aspect_ratio="16:9", watermark=watermark,
        watermark_path=str(overlay), run_timeout=30,
    )
    assert _probe_duration(str(out)) == pytest.approx(3.0, abs=0.05)
    for cycle in range(3):
        for phase, red_x, blue_x in ((0.2, 140, 180), (0.7, 180, 140)):
            at = cycle + phase
            frame, _, _ = _frame_rgb(str(out), at=at)
            assert tuple(frame[90, red_x]) == pytest.approx((255, 0, 0), abs=25), (ext, at)
            # Both samples are inside the watermark's bounds, so source blue
            # must come from chroma keying or the preserved alpha channel.
            assert tuple(frame[90, blue_x]) == pytest.approx((0, 0, 255), abs=25), (ext, at)


@needs_ffmpeg
def test_ffmpeg_smoke_stacks_png_and_looping_chroma_key_video(tmp_path, monkeypatch):
    _require_ffmpeg_encoders("libx264", "png")
    clips = tmp_path / "clips"
    outdir = clips / "jobwm"
    outdir.mkdir(parents=True)
    src = tmp_path / "blue.mp4"
    png = clips / "red.png"
    overlay = clips / "green.mp4"
    options = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    subprocess.run(
        [*options, "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=20:d=3",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(src)],
        check=True, timeout=30,
    )
    subprocess.run(
        [*options, "-f", "lavfi", "-i", "color=c=red:s=80x40,format=rgba",
         "-frames:v", "1", str(png)],
        check=True, timeout=30,
    )
    # The box is visible only in the first half of each loop, so late frame
    # samples distinguish a looping input from a frozen or truncated one.
    pattern = (
        "color=c=lime:s=96x54:r=20:d=1,"
        "drawbox=x=32:y=11:w=32:h=32:color=yellow:t=fill:enable='lt(t,0.5)'"
    )
    subprocess.run(
        [*options, "-f", "lavfi", "-i", pattern,
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(overlay)],
        check=True, timeout=30,
    )

    monkeypatch.setitem(pipeline.OUTPUT_SIZES, "16:9", (320, 180))
    job = JobData(
        "jobwm", BASE["url"], reframe="black_bars", captions=False, aspect_ratio="16:9",
        watermarks=[
            Watermark(png.name, x=0.2, y=0.2, scale=0.25),
            Watermark(
                overlay.name, x=0.8, y=0.8, scale=0.3,
                chroma_key=WatermarkChromaKey(enabled=True, color="#00FF00"),
            ),
        ],
    )
    out = outdir / "out.mp4"
    pipeline._render_clip_sync(
        job, pipeline.llm.Moment(0.0, 3.0, "t"), [], str(src), out.name, str(outdir), 0.0,
    )
    assert _probe_duration(str(out)) == pytest.approx(3.0, abs=0.05)
    for at in (0.2, 1.2, 2.2):
        frame, _, _ = _frame_rgb(str(out), at=at)
        assert tuple(frame[36, 64]) == pytest.approx((255, 0, 0), abs=25), at
        # The existing green despill filter lowers the green channel of yellow.
        assert tuple(frame[144, 256]) == pytest.approx((255, 128, 0), abs=25), at
        # This sample is inside the video overlay but beside the yellow box.
        assert tuple(frame[144, 288]) == pytest.approx((0, 0, 255), abs=25), at
        assert tuple(frame[90, 160]) == pytest.approx((0, 0, 255), abs=25), at
    hidden, _, _ = _frame_rgb(str(out), at=2.7)
    assert tuple(hidden[144, 256]) == pytest.approx((0, 0, 255), abs=25)
