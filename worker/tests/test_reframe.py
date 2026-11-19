import pytest

from clipper import reframe
from clipper.models import REFRAME_MODES, job_data_from_dict


def test_portrait_crop_centers_on_face_and_scales():
    chain = reframe.portrait_crop_filter(0.4)

    assert chain.startswith("crop=ih*0.56250:ih:0.40000*in_w-")
    assert chain.endswith(",scale=1080:1920")


def test_portrait_crop_defaults_to_center_without_face():
    assert "0.50000*in_w" in reframe.portrait_crop_filter(None)


def test_panning_crop_filter_produces_valid_ffmpeg_expression():
    chain = reframe.panning_crop_filter([(0.0, 0.4), (1.0, 0.6)])

    assert "lerp(0.4000,0.6000" in chain
    assert "scale=1080:1920" in chain


def test_clamp_pan_limits_large_jumps():
    samples = [(0.0, 0.0), (1.0, 1.0)]
    clamped = reframe._clamp_pan(samples, dt=1.0)

    # MAX_PAN_PER_SEC = 0.15, lompat 1.0 dibatasi ke 0.15
    assert clamped[1][1] == pytest.approx(0.15)


def test_job_data_defaults_to_face_tracking_and_accepts_modes():
    base = {"jobId": "abc", "url": "https://youtu.be/x"}
    assert job_data_from_dict(base).reframe == "face_tracking"

    for mode in REFRAME_MODES:
        assert job_data_from_dict({**base, "reframe": mode}).reframe == mode
