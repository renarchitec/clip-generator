import pytest

from clipper import reframe
from clipper.models import REFRAME_MODES, job_data_from_dict


def _frames(speakers, duration=4.0, fps=5.0):
    """speakers(t) -> list[(cx, height, mouth_openness)]."""
    frames = []
    steps = int(duration * fps)
    for index in range(steps):
        t = index / fps
        frames.append((t, speakers(t, index)))
    return frames


def test_portrait_crop_centers_on_face_and_scales():
    chain = reframe.portrait_crop_filter(0.4)

    assert chain.startswith("crop=ih*0.56250:ih:0.40000*in_w-")
    assert chain.endswith(",scale=1080:1920")


def test_portrait_crop_defaults_to_center_without_face():
    assert "0.50000*in_w" in reframe.portrait_crop_filter(None)


def test_cut_crop_filter_is_piecewise_static():
    chain = reframe.cut_crop_filter([(0.0, 0.4), (1.5, 0.6)])

    assert "0.4000*gte(t,0.00)*lt(t,1.50)" in chain
    assert "0.6000*gte(t,1.50)" in chain
    assert "lerp" not in chain  # cut statis, bukan pan halus
    assert chain.endswith("scale=1080:1920")


def test_selects_active_speaker_and_cuts_once():
    def speakers(t, index):
        a_open = 0.02 if (index % 2 == 0 and t < 2) else 0.0
        b_open = 0.02 if (index % 2 == 0 and t >= 2) else 0.0
        return [(0.3, 0.4, a_open), (0.7, 0.4, b_open)]

    segments = reframe.select_speaker_segments(_frames(speakers))

    assert segments[0] == (0.0, 0.3)
    assert len(segments) == 2
    assert segments[1][0] == 2.0
    assert segments[1][1] == 0.7


def test_hysteresis_keeps_louder_speaker():
    def speakers(t, index):
        a_open = 0.02 if index % 2 == 0 else 0.0
        b_open = 0.005 if index % 2 == 1 else 0.0
        return [(0.3, 0.4, a_open), (0.7, 0.4, b_open)]

    segments = reframe.select_speaker_segments(_frames(speakers))

    assert len(segments) == 1
    assert segments[0][1] == 0.3


def test_short_cut_is_absorbed_by_min_hold():
    # B bicara hanya 0.4 detik: terlalu pendek untuk memicu cut yang bertahan
    def speakers(t, index):
        b_open = 0.02 if (2.0 <= t < 2.4 and index % 2 == 0) else 0.0
        return [(0.3, 0.4, 0.02 if index % 2 == 0 else 0.0), (0.7, 0.4, b_open)]

    segments = reframe.select_speaker_segments(_frames(speakers))

    assert segments == [(0.0, 0.3)]


def test_normalize_merges_segments_shorter_than_min_hold():
    merged = reframe._normalize_segments([(0.0, 0.3), (0.4, 0.7), (2.0, 0.3)])

    assert merged == [(0.0, 0.3), (2.0, 0.3)]


def test_no_faces_returns_none_for_center_fallback():
    assert reframe.select_speaker_segments(_frames(lambda t, i: [])) is None


def test_job_data_defaults_to_face_tracking_and_accepts_modes():
    base = {"jobId": "abc", "url": "https://youtu.be/x"}
    assert job_data_from_dict(base).reframe == "face_tracking"

    for mode in REFRAME_MODES:
        assert job_data_from_dict({**base, "reframe": mode}).reframe == mode


def test_job_data_two_speakers_defaults_false_and_parses_tolerantly():
    base = {"jobId": "abc", "url": "https://youtu.be/x"}
    assert job_data_from_dict(base).two_speakers is False
    assert job_data_from_dict({**base, "twoSpeakers": True}).two_speakers is True
    assert job_data_from_dict({**base, "twoSpeakers": "false"}).two_speakers is False
    assert job_data_from_dict({**base, "twoSpeakers": "1"}).two_speakers is True
    assert job_data_from_dict({**base, "two_speakers": True}).two_speakers is True


def test_two_speaker_centers_clusters_left_and_right_faces():
    frames = [
        (0.0, [(0.2, 0.4, 0.0), (0.8, 0.4, 0.0)]),
        (0.2, [(0.22, 0.4, 0.0), (0.78, 0.4, 0.0)]),
        (0.4, [(0.18, 0.4, 0.0), (0.82, 0.4, 0.0)]),
    ]
    centers = reframe.two_speaker_centers_from_frames(frames)

    assert centers is not None
    left, right = centers
    assert left == pytest.approx(0.2, abs=0.02)
    assert right == pytest.approx(0.8, abs=0.02)


def test_two_speaker_centers_needs_two_distinct_faces():
    # Satu wajah saja -> None (fallback separuh frame di pipeline).
    single = [(t, [(0.3, 0.4, 0.0)]) for t in (0.0, 0.2, 0.4)]
    assert reframe.two_speaker_centers_from_frames(single) is None

    # Dua wajah berimpit -> anggap satu pembicara -> None.
    overlapping = [(0.0, [(0.4, 0.4, 0.0), (0.42, 0.4, 0.0)])]
    assert reframe.two_speaker_centers_from_frames(overlapping) is None

    assert reframe.two_speaker_centers_from_frames([]) is None


def test_panel_crop_filter_crops_9_8_and_scales_to_panel():
    chain = reframe.panel_crop_filter(0.3)

    assert chain.startswith("crop=w='min(ih*1.125,in_w)'")
    assert "0.30000*in_w-out_w/2" in chain  # x di tengah pembicara
    assert chain.endswith(",scale=1080:960,setsar=1")


def test_panel_crop_filter_defaults_to_center():
    assert "0.50000*in_w" in reframe.panel_crop_filter(None)
