import sys
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

    # waktu kini 3 desimal (sebelumnya 2) agar cut tepat di frame
    assert "0.4000*gte(t,0.000)*lt(t,1.500)" in chain
    assert "0.6000*gte(t,1.500)" in chain
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
    # x akhir diubah 0.3 -> 0.5: x sama berurutan kini digabung (dedupe), jadi
    # pakai x berbeda agar tetap menguji penggabungan segmen pendek.
    merged = reframe._normalize_segments([(0.0, 0.3), (0.4, 0.7), (2.0, 0.5)])

    assert merged == [(0.0, 0.3), (2.0, 0.5)]


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
    # Wajah besar di tengah: kotak full-width (1080), rasio tetap 9:7, di dalam frame.
    frames = _frames(lambda t, i: [(0.5, 0.5, 0.4, 0.0)])
    x, y, w, h = reframe.facecam_box(frames, 1080, 1920)

    assert w == 1080 and h == 840  # 9:7 dijaga saat clamp ke lebar frame
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

    graph, label = pipeline._facecam_graph((12, 34, 546, 388), None)

    joined = ";".join(graph)
    assert "split=2" in joined
    assert "crop=546:388:12:34" in joined
    assert "scale=1080:840" in joined
    assert "min(ih*1080/1080,in_w)" in joined
    assert "scale=1080:1080" in joined
    assert "boxblur" not in joined
    assert "vstack" in joined
    assert label == "[v]"


def test_facecam_graph_burns_subtitles_with_vout_label():
    from clipper import pipeline

    graph, label = pipeline._facecam_graph((0, 0, 1080, 840), "/tmp/sub.ass")

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


def test_facecam_candidate_rejects_fullscreen_scene_with_static_background():
    background = (0.64, 0.18, 0.08, 0.0)
    fullscreen = (0.5, 0.5, 0.30, 0.0)
    assert reframe._facecam_candidate(
        [background] * 6 + [fullscreen] * 4,
        [0, 1, 2, 3, 4, 5, 0, 1, 2, 2],
        total_keyframes=6,
    ) is None


def test_facecam_candidate_keeps_gameplay_facecam_with_one_large_npc_face():
    cam = (0.11, 0.46, 0.08, 0.0)
    assert reframe._facecam_candidate(
        [cam] * 6 + [(0.5, 0.51, 0.34, 0.0)],
        [0, 1, 2, 3, 4, 5, 3],
        total_keyframes=6,
    ) == cam


@pytest.mark.parametrize(
    "statuses, valid_size, expected",
    [
        ([(False, True)] * 3 + [(False, False)] * 2, True, True),
        ([(False, True)] * 2 + [(False, False)] * 3, True, False),
        ([(True, True)] * 3 + [(False, True)] * 2, True, False),
        ([(False, True)], False, False),
        ([], True, False),
    ],
)
def test_facecam_box_matches_window(monkeypatch, statuses, valid_size, expected):
    released, resized, processed = [], [], []
    box = (10, 20, 150, 120)
    capture = types.SimpleNamespace(isOpened=lambda: True, release=lambda: released.append(True))

    class Frame:
        shape = (360, 640 if valid_size else 1280, 3)

        def __init__(self, fullscreen, facecam):
            self.fullscreen, self.facecam = fullscreen, facecam

        def __getitem__(self, key):
            assert key == (slice(20, 140), slice(10, 160))
            return self

    def resize(frame, size, interpolation):
        assert size == (300, 240) and interpolation == cv2.INTER_CUBIC
        resized.append(frame)
        return (frame, "region")

    def process(image):
        frame, kind = image
        processed.append(kind)
        if kind == "proxy":
            detections = [_fake_detection(0.4, 0.3, 0.2, 0.34)] if frame.fullscreen else []
        else:
            height = 0.24 if frame.facecam else 0.06
            detections = [_fake_detection(0.4, 0.3, 0.2, height)]
        return types.SimpleNamespace(detections=detections)

    class Detector:
        def __init__(self, *, model_selection, min_detection_confidence):
            assert (model_selection, min_detection_confidence) == (0, 0.5)

        def __enter__(self):
            return types.SimpleNamespace(process=process)

        def __exit__(self, *exc):
            pass

    def iter_samples(cap, cv, start, end, fps, samples):
        assert (cap, cv, start, end, fps, samples) == (capture, cv2, 10, 20, 0.5, 5)
        return ((t, Frame(*status)) for t, status in enumerate(statuses))

    cv2 = types.SimpleNamespace(
        VideoCapture=lambda path: capture, resize=resize, cvtColor=lambda image, _: image,
        COLOR_BGR2RGB=0, INTER_CUBIC=1,
    )
    monkeypatch.setitem(sys.modules, "cv2", cv2)
    monkeypatch.setitem(sys.modules, "mediapipe", types.SimpleNamespace(solutions=types.SimpleNamespace(
        face_detection=types.SimpleNamespace(FaceDetection=Detector),
    )))
    monkeypatch.setattr(reframe, "_iter_samples", iter_samples)
    monkeypatch.setattr(reframe, "_facecam_proxy", lambda frame, _: (frame, "proxy"))

    assert not reframe.facecam_box_matches_window("video.mp4", 10, 20, (630, 20, 150, 120), 640, 360)
    assert not released
    assert reframe.facecam_box_matches_window("video.mp4", 10, 20, box, 640, 360) is expected
    checked = len(statuses) if valid_size else 0
    assert len(resized) == checked
    assert processed == ["proxy", "region"] * checked
    assert released == [True]


def test_iter_samples_seeks_instead_of_grabbing_when_step_is_large():
    # Video AV1 6,5 jam @60fps dengan sampling 240 sampel: step ~5840 frame.
    # Grab per frame akan membongkar ~1,4 juta frame; seek langsung tidak.
    class FakeCapture:
        def __init__(self):
            self.t = 0.0
            self.seeks = []
            self.grabs = 0

        def set(self, prop, value):
            assert prop == cv2.CAP_PROP_POS_MSEC
            self.t = value / 1000.0
            self.seeks.append(self.t)
            return True

        def get(self, prop):
            if prop == cv2.CAP_PROP_FPS:
                return 60.0
            assert prop == cv2.CAP_PROP_POS_MSEC
            return self.t * 1000.0

        def read(self):
            self.t += 1 / 60.0
            return True, "frame"

        def grab(self):
            self.grabs += 1
            return True

    cv2 = types.SimpleNamespace(CAP_PROP_POS_MSEC=0, CAP_PROP_FPS=5)
    sample_fps = 240 / 23366.0
    capture = FakeCapture()

    samples = list(
        reframe._iter_samples(capture, cv2, 0.0, 23366.0, sample_fps, 5)
    )

    assert len(samples) == 5
    assert capture.grabs == 0
    # Seek awal + satu seek untuk tiap langkah setelahnya.
    assert len(capture.seeks) == 5
    step = max(1, round(60 / sample_fps))
    assert capture.seeks[1:] == pytest.approx(
        [count * step / 60 for count in range(1, 5)]
    )


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

@pytest.fixture
def facecam_pipeline():
    from clipper import pipeline

    pipeline._clear_facecam_cache()
    yield pipeline
    pipeline._clear_facecam_cache()


def test_facecam_box_for_samples_whole_video_once(monkeypatch, facecam_pipeline):
    pipeline = facecam_pipeline
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


def test_facecam_box_for_verifies_reuse_and_redetects_moved_facecam(monkeypatch, facecam_pipeline):
    pipeline = facecam_pipeline
    scans, verifications, probes = [], [], []

    def probe(cmd):
        probes.append(cmd)
        return "640,360" if "stream=width,height" in cmd else "200"

    def scan(video, start, end, *, sample_fps, max_samples):
        scans.append((start, end, sample_fps, max_samples))
        return [(0.0, [(0.11 if start == 0 else 0.89, 0.46, 0.08, 0.0)])]

    def verify(video, start, end, box, width, height):
        verifications.append((start, end, box, width, height))
        return (start, box) in [(60, first), (140, moved), (160, first)]

    monkeypatch.setattr(pipeline, "_run", probe)
    monkeypatch.setattr(reframe, "facecam_face_frames", scan)
    first = pipeline._facecam_box_for("video.mp4", -10, 60)
    assert first is not None

    # Gunakan kotak kiri pada klip kedua; klip ketiga pindah ke kanan.
    moved = None
    monkeypatch.setattr(reframe, "facecam_box_matches_window", verify)
    assert pipeline._facecam_box_for("video.mp4", 60, 80) == first
    moved = pipeline._facecam_box_for("video.mp4", 80, 140)
    assert moved is not None and moved != first
    assert pipeline._facecam_box_for("video.mp4", 140, 160) == moved
    assert pipeline._facecam_box_for("video.mp4", 160, 250) == first
    assert scans == [(0, 60, 0.5, 30), (80, 140, 0.5, 30)]
    assert verifications == [
        (60, 80, first, 640, 360), (80, 140, first, 640, 360),
        (140, 160, moved, 640, 360), (160, 200, moved, 640, 360),
        (160, 200, first, 640, 360),
    ]
    assert len(probes) == 2
    assert pipeline._FACECAM_BOX_CACHE == {"video.mp4": first}
    assert pipeline._FACECAM_KNOWN_BOXES == [(moved, 640, 360), (first, 640, 360)]


def test_facecam_box_for_fullscreen_miss_does_not_poison_gameplay(monkeypatch, facecam_pipeline):
    pipeline = facecam_pipeline
    monkeypatch.setattr(pipeline, "_probe_video_meta", lambda _, *, cache: (640, 360, 60))
    monkeypatch.setattr(reframe, "facecam_face_frames", lambda video, start, end, **kw: (
        [] if start == 10 else [(0, [(0.11, 0.46, 0.08, 0.0)])]
    ))

    assert pipeline._facecam_box_for("video.mp4", 10, 20) is None
    assert not pipeline._FACECAM_BOX_CACHE and not pipeline._FACECAM_KNOWN_BOXES
    box = pipeline._facecam_box_for("video.mp4", 30, 40)
    assert box is not None
    assert pipeline._FACECAM_BOX_CACHE == {"video.mp4": box}
    assert pipeline._FACECAM_KNOWN_BOXES == [(box, 640, 360)]


def test_facecam_box_for_skips_cache_on_resolution_mismatch_or_preview(monkeypatch, facecam_pipeline):
    pipeline = facecam_pipeline
    def probe(cmd):
        if "stream=width,height" in cmd:
            return "1280,720" if cmd[-1] == "large.mp4" else "640,360"
        return "60"

    monkeypatch.setattr(pipeline, "_run", probe)
    scans = []

    def scan(video, start, end, **kwargs):
        scans.append((video, start, end))
        return [(0, [(0.11, 0.46, 0.08, 0.0)])]

    def unexpected_verify(*args):
        pytest.fail("kotak beda resolusi atau preview tidak boleh diverifikasi")

    monkeypatch.setattr(reframe, "facecam_face_frames", scan)
    monkeypatch.setattr(reframe, "facecam_box_matches_window", unexpected_verify)
    small = pipeline._facecam_box_for("small.mp4", 10, 20)
    large = pipeline._facecam_box_for("large.mp4", 10, 20)
    assert small is not None and large is not None and small != large
    assert pipeline._facecam_box_for("preview.mp4", 0, 0.1, reuse_known=False) == small
    assert scans == [("small.mp4", 10, 20), ("large.mp4", 10, 20), ("preview.mp4", 0, 60)]
    assert pipeline._FACECAM_KNOWN_BOXES == [(small, 640, 360), (large, 1280, 720)]
    assert pipeline._FACECAM_BOX_CACHE == {"small.mp4": small, "large.mp4": large}
    assert pipeline._VIDEO_META_CACHE == {"small.mp4": (640, 360, 60), "large.mp4": (1280, 720, 60)}


def test_facecam_box_centers_corner_face_by_zooming_in():
    # Regresi job 9ce6198c: facecam di tepi kiri (cx ~0.12 di 2560x1440). Kotak
    # 3x wajah dijepit ke x=0 sehingga wajah di ~37% lebar panel. Kotak harus
    # diperkecil supaya wajah di tengah panel.
    frames = [(t, [(0.12, 0.47, 0.114, 0.0)]) for t in range(10)]

    x, y, w, h = reframe.facecam_box(frames, 2560, 1440)

    face_x = 0.12 * 2560
    face_y = 0.47 * 1440
    assert (face_x - x) / w == pytest.approx(0.5, abs=0.02)
    assert (face_y - y) / h == pytest.approx(reframe.FACECAM_FACE_Y, abs=0.02)
    assert w * reframe.FACECAM_PANEL_H == pytest.approx(
        h * reframe.FACECAM_PANEL_W, rel=0.01
    )  # rasio 45:32 tetap
    assert 0 <= x and x + w <= 2560 and 0 <= y and y + h <= 1440


@pytest.mark.parametrize(
    "W,H,cx,cy,fh",
    [
        (2560, 1440, 2334 / 2560, 988 / 1440, 178.9 / 1440),  # regresi wJVeWiqMJ-M 40:30
        (2560, 1440, 0.12, 0.47, 0.114),
        (1920, 1080, 0.88, 0.80, 0.13),
        (1920, 1080, 0.50, 0.35, 0.15),
    ],
)
def test_facecam_face_centered_in_bounds_and_below_tiktok_top_ui(W, H, cx, cy, fh):
    # Wajah tetap di tengah horizontal, kotak sepenuhnya di dalam frame (tanpa
    # overflow/blur), dan puncak rambut (~0.62x tinggi kotak wajah di atas alis)
    # berada >=170px dari tepi atas (di bawah badge/search bar TikTok).
    x, y, w, h = reframe.facecam_box([(t, [(cx, cy, fh, 0.0)]) for t in range(10)], W, H)
    assert 0 <= x and x + w <= W and 0 <= y and y + h <= H
    assert (cx * W - x) / w == pytest.approx(0.5, abs=0.06)
    s = reframe.FACECAM_PANEL_H / h
    face_px = fh * H * s
    eyebrows_top = (cy * H - y) * s - face_px / 2
    hair_top = eyebrows_top - 0.62 * face_px
    assert eyebrows_top >= 380
    assert hair_top >= 170


# --- shot-cut aware speaker selection -------------------------------------------


def test_cut_filter_uses_three_decimals():
    chain = reframe.cut_crop_filter([(0.0, 0.4), (1.2345, 0.6)])

    assert "gte(t,1.234)" in chain or "gte(t,1.235)" in chain
    assert "lt(t,1.234)" in chain


def test_shot_cut_switches_to_new_face_immediately():
    # Close-up A (x=0.3) lalu hard cut di 1.4s ke close-up B (x=0.7). Tanpa
    # gerak bibir; MIN_HOLD (0.9s) tidak boleh menunda crop baru.
    def speakers(t, index):
        return [(0.3, 0.4, 0.0)] if t < 1.4 else [(0.7, 0.4, 0.0)]

    segments = reframe.select_speaker_segments(
        _frames(speakers, duration=3.0), cut_times=[1.4]
    )

    assert segments == [(0.0, 0.3), (1.4, 0.7)]


def test_cut_shorter_than_min_hold_is_preserved():
    def speakers(t, index):
        return [(0.7, 0.4, 0.0)] if 1.0 <= t < 1.4 else [(0.3, 0.4, 0.0)]

    segments = reframe.select_speaker_segments(
        _frames(speakers, duration=3.0), cut_times=[1.0, 1.4]
    )

    assert segments == [(0.0, 0.3), (1.0, 0.7), (1.4, 0.3)]


def test_shot_without_face_goes_to_center_not_stale_x():
    def speakers(t, index):
        return [(0.2, 0.4, 0.0)] if t < 1.0 else []

    segments = reframe.select_speaker_segments(
        _frames(speakers, duration=3.0), cut_times=[1.0]
    )

    assert segments == [(0.0, 0.2), (1.0, 0.5)]


def test_face_appearing_late_in_shot_updates_from_center():
    def speakers(t, index):
        return [(0.8, 0.4, 0.0)] if t >= 1.8 else []

    segments = reframe.select_speaker_segments(
        _frames(speakers, duration=3.0), cut_times=[]
    )

    assert segments == [(0.0, 0.5), (1.8, 0.8)]


def test_wide_shot_group_midpoint_when_faces_fit_crop():
    # Dua wajah x=0.4 & 0.55 (span 0.15 < 0.316) -> titik tengah 0.475.
    def speakers(t, index):
        if t < 1.0:
            return [(0.2, 0.4, 0.0)]
        return [(0.4, 0.1, 0.0), (0.55, 0.12, 0.0)]

    segments = reframe.select_speaker_segments(
        _frames(speakers, duration=3.0), cut_times=[1.0]
    )

    assert segments[1][0] == 1.0
    assert segments[1][1] == pytest.approx(0.475)


def test_wide_shot_wide_group_uses_largest_face():
    def speakers(t, index):
        return [(0.15, 0.1, 0.0), (0.8, 0.14, 0.0)]

    segments = reframe.select_speaker_segments(
        _frames(speakers, duration=2.0), cut_times=[]
    )

    assert segments == [(0.0, 0.8)]


def test_many_shot_cuts_exceed_old_segment_limit_and_are_kept():
    cuts = [round(1.0 + i * 1.0, 3) for i in range(30)]

    def speakers(t, index):
        shot = int(t)  # tiap detik = shot baru; x bergantian
        return [(0.3 if shot % 2 == 0 else 0.7, 0.4, 0.0)]

    segments = reframe.select_speaker_segments(
        _frames(speakers, duration=31.0), cut_times=cuts
    )

    assert len(segments) == 31 > 16
    assert [t for t, _ in segments[1:]] == cuts


def test_normalize_never_drops_cut_segments_when_trimming():
    segs = [(i * 0.3, 0.1 + 0.8 * (i % 2), reframe._KIND_CUT) for i in range(100)]

    merged = reframe._normalize_segments(segs)

    assert len(merged) == reframe.MAX_SEGMENTS


def test_normalize_trims_speaker_switch_before_cuts():
    segs = [(0.0, 0.2, reframe._KIND_CUT)]
    segs += [(i * 1.0, 0.2 + 0.1 * (i % 2) * 3, reframe._KIND_CUT) for i in range(1, 80)]
    segs.append((79.95, 0.9, reframe._KIND_SWITCH))  # terlalu dekat cut sebelumnya

    merged = reframe._normalize_segments(segs)

    assert (79.95, 0.9) not in merged


def test_normalize_drops_consecutive_same_x():
    merged = reframe._normalize_segments([(0.0, 0.5), (1.5, 0.51), (3.0, 0.8)])

    assert merged == [(0.0, 0.5), (3.0, 0.8)]


def test_drift_recenter_allowed_after_half_second():
    # Satu wajah bergeser dari 0.3 ke 0.4 pada t=1.0 (tanpa cut): recenter segera (hold 0.5s).
    def speakers(t, index):
        return [(0.3 if t < 1.0 else 0.4, 0.4, 0.0)]

    segments = reframe.select_speaker_segments(_frames(speakers, duration=3.0))

    assert len(segments) == 2
    assert segments[1][0] < 1.0 + reframe.MIN_HOLD_SEC
    assert segments[1][1] == pytest.approx(0.4)
