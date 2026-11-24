import types

import pytest

from clipper import reframe
from clipper.models import REFRAME_MODES, job_data_from_dict


def _frames(speakers, duration=4.0, fps=5.0):
    """speakers(t) -> list[(cx, height, mouth_openness)]; cy default 0.5."""
    frames = []
    steps = int(duration * fps)
    for index in range(steps):
        t = index / fps
        faces = [
            face if len(face) == 4 else (face[0], 0.5, face[1], face[2])
            for face in speakers(t, index)
        ]
        frames.append((t, faces))
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


def test_job_data_facecam_defaults_false_and_parses_tolerantly():
    base = {"jobId": "abc", "url": "https://youtu.be/x"}
    assert job_data_from_dict(base).facecam is False
    assert job_data_from_dict({**base, "facecam": True}).facecam is True
    assert job_data_from_dict({**base, "facecam": "false"}).facecam is False
    assert job_data_from_dict({**base, "facecam": "1"}).facecam is True
    assert job_data_from_dict({**base, "facecam": 0}).facecam is False


def test_facecam_box_pinned_corner_face_clamps_to_corner():
    # Wajah menempel sudut kiri atas: kotak dijepit ke (0,0), tetap di dalam frame.
    frames = _frames(lambda t, i: [(0.05, 0.05, 0.08, 0.0)])
    box = reframe.facecam_box(frames, 1920, 1080)

    assert box is not None
    x, y, w, h = box
    assert (x, y) == (0, 0)
    assert 0 < w <= 1920 and 0 < h <= 1080
    assert w % 2 == 0 and h % 2 == 0


def test_facecam_box_empty_or_rare_faces_returns_none():
    assert reframe.facecam_box(_frames(lambda t, i: []), 1920, 1080) is None
    assert reframe.facecam_box([], 1920, 1080) is None

    # Wajah hanya di 2 dari 10 sampel (<50%) -> None.
    def sparse(t, i):
        return [(0.5, 0.5, 0.3, 0.0)] if i < 2 else []

    assert reframe.facecam_box(_frames(sparse, duration=2.0), 1920, 1080) is None


def test_facecam_box_centers_and_stays_in_bounds():
    # Wajah besar di tengah: kotak full-width (1080), rasio tetap 27:16, di dalam frame.
    frames = _frames(lambda t, i: [(0.5, 0.5, 0.4, 0.0)])
    x, y, w, h = reframe.facecam_box(frames, 1080, 1920)

    assert w == 1080 and h == 640  # 27:16 dijaga saat clamp ke lebar frame
    assert 0 <= x <= 1080 - w and 0 <= y <= 1920 - h


def test_facecam_box_picks_smallest_face_per_frame():
    # Dua wajah per frame: ambil yang paling kecil (cx=0.7) sebagai wajah facecam.
    def two(t, i):
        return [(0.3, 0.5, 0.4, 0.0), (0.7, 0.4, 0.1, 0.0)]

    x, y, w, h = reframe.facecam_box(_frames(two), 1920, 1080)

    face_h = 3 * 0.1 * 1080  # tinggi kotak = 3x tinggi wajah terkecil
    assert h == pytest.approx(face_h, abs=2)
    assert x == pytest.approx(0.7 * 1920 - w / 2, abs=2)


def test_facecam_graph_vstacks_face_panel_over_gameplay():
    from clipper import pipeline

    graph, label = pipeline._facecam_graph((12, 34, 546, 324), None)

    joined = ";".join(graph)
    assert "split=2" in joined
    assert "crop=546:324:12:34" in joined
    assert "min(ih*27/32,in_w)" in joined
    assert "scale=1080:640" in joined
    assert "scale=1080:1280" in joined
    assert "vstack" in joined
    assert label == "[v]"


def test_facecam_graph_burns_subtitles_with_vout_label():
    from clipper import pipeline

    graph, label = pipeline._facecam_graph((0, 0, 1080, 640), "/tmp/sub.ass")

    assert label == "[vout]"
    assert any("subtitles=" in line for line in graph)


class _FakeBox:
    def __init__(self, xmin, ymin, width, height):
        self.xmin, self.ymin, self.width, self.height = xmin, ymin, width, height


def _fake_detection(xmin, ymin, width, height):
    return types.SimpleNamespace(
        location_data=types.SimpleNamespace(
            relative_bounding_box=_FakeBox(xmin, ymin, width, height)
        )
    )


def test_facecam_faces_from_detections_maps_tile_to_full_frame():
    # Deteksi di tile (0,100)-(120,195) pada frame 640x360 (video repro asli):
    # kotak relatif tile (0.44, 0.59, 0.17, 0.21) -> wajah di sudut frame.
    faces = reframe.facecam_faces_from_detections(
        [_fake_detection(0.44, 0.59, 0.17, 0.21)], 0, 100, 120, 95, 640, 360
    )

    assert len(faces) == 1
    cx, cy, height, mouth = faces[0]
    assert cx == pytest.approx((0.44 + 0.17 / 2) * 120 / 640, abs=1e-9)
    assert cy == pytest.approx((100 + (0.59 + 0.21 / 2) * 95) / 360, abs=1e-9)
    assert height == pytest.approx(0.21 * 95 / 360, abs=1e-9)
    assert mouth == 0.0

    # Wajah di bawah ambang kecil dibuang.
    tiny = reframe.facecam_faces_from_detections(
        [_fake_detection(0.4, 0.5, 0.05, 0.01)], 0, 0, 320, 180, 640, 360
    )
    assert tiny == []


def test_facecam_candidate_needs_two_similar_occurrences():
    # Wajah facecam muncul 3x di posisi yang sama (0.10, 0.46, 0.059);
    # false positive sekecil 0.03 yang muncul sekali tidak boleh menang.
    candidates = [(0.1, 0.46, 0.059, 0.0)] * 3 + [(0.5, 0.2, 0.03, 0.0)]

    face = reframe._facecam_candidate(candidates)

    assert face is not None
    assert face[0] == pytest.approx(0.1)
    assert face[2] == pytest.approx(0.059)

    # Regresi q1jR850CE_o: karakter game kecil muncul 3x (tile overlap) di SATU
    # keyframe; facecam lebih besar muncul di 4 keyframe berbeda -> facecam menang.
    game = [(0.455, 0.707, 0.07, 0.0)] * 3
    cam = [(0.075, 0.46, 0.08, 0.0)] * 4
    face = reframe._facecam_candidate(game + cam, [2, 2, 2, 0, 1, 3, 4])
    assert face is not None
    assert face[0] == pytest.approx(0.075)

    # Kandidat tunggal tanpa pengulangan -> None.
    assert reframe._facecam_candidate([(0.1, 0.46, 0.059, 0.0)]) is None
    assert reframe._facecam_candidate([]) is None


def test_facecam_box_from_corner_facecam_sizes_returns_panel_not_none():
    # Regresi video nyata: wajah facecam kecil (tinggi ~0.059 dari frame) yang
    # muncul di hampir semua sampel harus menghasilkan kotak panel di sudut,
    # bukan None (fallback reframe diam-diam).
    frames = [(t, [(0.1, 0.46, 0.059, 0.0)]) for t in range(10)]

    box = reframe.facecam_box(frames, 640, 360)

    assert box is not None
    x, y, w, h = box
    assert 0 <= x and x + w <= 640 and 0 <= y and y + h <= 360
    assert h == pytest.approx(3 * 0.059 * 360, abs=3)

def test_facecam_sample_fps_spreads_max_samples_over_video():
    from clipper import pipeline

    # Video sedang: 1 sampel/detik.
    assert pipeline._facecam_sample_fps(100) == pytest.approx(1.0)
    # Video panjang: sampel menyebar agar total tetap <= FACECAM_MAX_SAMPLES.
    for duration in (600.0, 2400.0, 7200.0):
        fps = pipeline._facecam_sample_fps(duration)
        assert fps * duration <= reframe.FACECAM_MAX_SAMPLES + 1e-6
    assert pipeline._facecam_sample_fps(2400.0) == pytest.approx(0.1)

def test_facecam_box_for_samples_whole_video_once(monkeypatch):
    from clipper import pipeline

    pipeline._FACECAM_BOX_CACHE.clear()
    calls = []

    def fake_run(cmd):
        return "640,360\n" if "stream=width,height" in cmd else "600.0\n"

    def fake_frames(video, start, end, sample_fps=None):
        calls.append((start, end, sample_fps))
        return [(t, [(0.1, 0.46, 0.059, 0.0)]) for t in range(10)]

    monkeypatch.setattr(pipeline, "_run", fake_run)
    monkeypatch.setattr(pipeline.reframe_mod, "facecam_face_frames", fake_frames)

    first = pipeline._facecam_box_for("/tmp/video.mp4")
    second = pipeline._facecam_box_for("/tmp/video.mp4")

    assert first is not None and first == second
    # Satu deteksi untuk seluruh video, bukan per klip.
    assert calls == [(0.0, 600.0, pipeline._facecam_sample_fps(600.0))]


def test_facecam_box_centers_corner_face_by_zooming_in():
    # Regresi job 9ce6198c: facecam di tepi kiri (cx ~0.12 di 2560x1440). Kotak
    # 3x wajah dijepit ke x=0 sehingga wajah di ~37% lebar panel. Kotak harus
    # diperkecil supaya wajah di tengah panel.
    frames = [(t, [(0.12, 0.47, 0.114, 0.0)]) for t in range(10)]

    x, y, w, h = reframe.facecam_box(frames, 2560, 1440)

    face_x = 0.12 * 2560
    face_y = 0.47 * 1440
    assert (face_x - x) / w == pytest.approx(0.5, abs=0.02)
    assert (face_y - y) / h == pytest.approx(0.5, abs=0.02)
    assert w * 640 == pytest.approx(h * 1080, rel=0.01)  # rasio 27:16 tetap
    assert 0 <= x and x + w <= 2560 and 0 <= y and y + h <= 1440
