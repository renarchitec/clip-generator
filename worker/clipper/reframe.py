"""Reframe `face_tracking` (kini: active speaker) — potong statis per segmen.

Perilaku tersimpan `face_tracking` didefinisikan ulang sebagai "pembicara aktif":
worker menganalisis frame proxy ~360p/5 fps dengan MediaPipe FaceMesh, mengukur
bukaan/gerak bibir tiap wajah, lalu memilih wajah yang sedang bicara dengan
hysteresis + minimal hold. Hasilnya bukan pan halus, melainkan deretan crop
statis (cut) per segmen pembicara, sebagai ekspresi filter ffmpeg piecewise.

Modul ini juga menyediakan `two_speaker_centers` (klaster 2-means pusat_x wajah
untuk mode dua pembicara), `panel_crop_filter` (crop panel 9:8 per pembicara),
dan `facecam_box` (kotak panel wajah 27:16 untuk layout facecam).

Kontrak API/DB tidak berubah: nilai `face_tracking` tetap diterima dan tetap
default; fallback crop tengah tetap ada bila tidak ada wajah sama sekali.

Dependency opsional: kalau mediapipe/opencv tidak terpasang, job gagal dengan
pesan jelas — bukan fallback diam-diam ke mode lain.
"""

from __future__ import annotations

import logging
from statistics import median
from typing import Any, List, Optional, Sequence, Tuple

log = logging.getLogger(__name__)

FACE_DEPS_ERROR = (
    "Reframe face_tracking butuh mediapipe di worker "
    "(wheel cp312 linux x86_64 ada sejak 0.10.14; tidak ada wheel linux/arm64). "
    "Pasang dependency tersebut atau pilih reframe black_bars/blurred_fill."
)
SAMPLE_FPS = 5.0
PROXY_HEIGHT = 360

# Pemilihan pembicara aktif
MAX_FACES = 4
MOTION_ALPHA = 0.5  # EMA energi gerak bibir per wajah
SWITCH_MARGIN = 1.25  # kandidat harus jelas lebih "bicara" dari aktif saat ini
SPEECH_FLOOR = 0.003  # gerak bibir minimal agar dianggap bicara (bukan noise)
MIN_HOLD_SEC = 0.9  # minimal durasi satu cut
DRIFT_CUT = 0.08  # potong ulang bila wajah aktif bergeser cukup jauh
MISSING_TTL_SEC = 1.0  # wajah hilang se lama ini -> wajib pilih ulang
MAX_SEGMENTS = 16  # batas panjang ekspresi filter ffmpeg
MAX_SAMPLES = 1200  # batas runtime: ~4 menit pada 5 fps
MIN_FACE_HEIGHT = 0.05  # abaikan deteksi wajah terlalu kecil
MIN_SPEAKER_SEPARATION = 0.08  # jarak minimum dua klaster pembicara x

# Landmark bibir dalam FaceMesh (inner lips): 13 atas, 14 bawah.
LIP_UPPER, LIP_LOWER = 13, 14

# Face tuple: (cx 0..1, cy 0..1, tinggi relatif, bukaan mulut relatif thd tinggi wajah)
Face = Tuple[float, float, float, float]
# Frame sampel: (t_rel, daftar wajah terdeteksi)
SampledFrame = Tuple[float, List[Face]]
# Segmen cut: (t_mulai, pusat_x 0..1) — x statis sampai segmen berikutnya
Segment = Tuple[float, float]


def face_track_samples(
    video_path: str,
    start: float,
    end: float,
    sample_fps: float = SAMPLE_FPS,
) -> Optional[List[Segment]]:
    """Segmen cut (t_rel, pusat_x) dari proxy ~360p ~5 fps.

    - FaceMesh per sampel; wajah aktif dipilih dari gerak bibir (hysteresis).
    - Tidak ada wajah sama sekali -> None -> pipeline memakai crop tengah.
    """
    frames = sample_face_frames(video_path, start, end, sample_fps)
    return select_speaker_segments(frames)

def sample_face_frames(
    video_path: str,
    start: float,
    end: float,
    sample_fps: float = SAMPLE_FPS,
) -> List[SampledFrame]:
    """Deteksi FaceMesh pada frame proxy ~360p ~5 fps (dipakai mode satu & dua pembicara)."""
    try:
        import cv2
        import mediapipe as mp
    except ImportError as exc:  # dependency hilang = gagal jelas, bukan fallback
        raise RuntimeError(FACE_DEPS_ERROR) from exc

    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        raise RuntimeError(f"tidak bisa membuka video untuk face_tracking: {video_path}")

    try:
        if not capture.set(cv2.CAP_PROP_POS_MSEC, start * 1000):
            raise RuntimeError(f"tidak bisa seek ke {start:.2f}s di video: {video_path}")

        fps = capture.get(cv2.CAP_PROP_FPS) or 0.0
        step = 1 if fps <= 0 else max(1, round(fps / sample_fps))
        dt = step / fps if fps > 0 else 1.0 / sample_fps
        limit = end + 0.5 * dt
        frames: List[SampledFrame] = []

        with mp.solutions.face_mesh.FaceMesh(
            max_num_faces=MAX_FACES,
            refine_landmarks=False,
            min_detection_confidence=0.4,
        ) as mesh:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                timestamp = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
                if timestamp > limit:
                    break

                frames.append((max(0.0, timestamp - start), _detect_faces(frame, cv2, mesh)))
                if len(frames) >= MAX_SAMPLES:
                    break

                grabbed = True
                for _ in range(step - 1):
                    if not capture.grab():
                        grabbed = False
                        break
                if not grabbed:
                    break
                if capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0 > limit:
                    break

        return frames
    finally:
        capture.release()

def two_speaker_centers(
    video_path: str,
    start: float,
    end: float,
    sample_fps: float = SAMPLE_FPS,
) -> Optional[Tuple[float, float]]:
    """Pusat_x dua pembicara dominan (kiri, kanan); None bila <2 wajah terdeteksi."""
    return two_speaker_centers_from_frames(
        sample_face_frames(video_path, start, end, sample_fps)
    )

def two_speaker_centers_from_frames(
    frames: Sequence[SampledFrame],
) -> Optional[Tuple[float, float]]:
    """1D 2-means atas pusat_x semua wajah di semua sampel.

    Kiri -> panel atas, kanan -> panel bawah. Terpisah dari deteksi agar bisa diuji
    tanpa mediapipe (seperti select_speaker_segments).
    """
    xs = [face[0] for _, faces in frames for face in faces]
    if len(xs) < 2:
        return None

    left, right = min(xs), max(xs)
    if right - left < MIN_SPEAKER_SEPARATION:
        return None  # semua wajah di titik yang sama: anggap satu pembicara

    for _ in range(20):
        groups: Tuple[List[float], List[float]] = ([], [])
        for x in xs:
            groups[0 if abs(x - left) <= abs(x - right) else 1].append(x)
        if not groups[0] or not groups[1]:
            return None
        new_left = sum(groups[0]) / len(groups[0])
        new_right = sum(groups[1]) / len(groups[1])
        if (new_left, new_right) == (left, right):
            break
        left, right = new_left, new_right

    return (min(left, right), max(left, right))

FACECAM_PANEL_W, FACECAM_PANEL_H = 1080, 640  # panel atas 27:16
FACECAM_FACE_SCALE = 3.0  # tinggi panel = 3x tinggi wajah
FACECAM_MIN_PANEL_H = 64  # piksel; di bawah ini upscale terlalu kasar


def facecam_box(
    frames: Sequence[SampledFrame],
    src_w: int,
    src_h: int,
) -> Optional[Tuple[int, int, int, int]]:
    """Kotak crop panel wajah (x, y, w, h piksel) dari sampel `sample_face_frames`.

    Wajah per frame: pilih yang paling kecil (paling statis/jauh). Butuh wajah di
    >=50% sampel, kalau tidak -> None (pipeline pakai reframe biasa). Kotak
    27:16 (1080x640), tinggi ~3x wajah, di tengah wajah, dijepit ke dalam frame,
    dimensi genap.
    """
    if not frames or src_w <= 0 or src_h <= 0:
        return None
    hits = [min(faces, key=lambda face: face[2]) for _, faces in frames if faces]
    if not hits or len(hits) * 2 < len(frames):
        return None

    cx = median(face[0] for face in hits)
    cy = median(face[1] for face in hits)
    face_h = median(face[2] for face in hits)

    h = max(FACECAM_MIN_PANEL_H, int(round(face_h * FACECAM_FACE_SCALE * src_h)))
    w = int(round(h * FACECAM_PANEL_W / FACECAM_PANEL_H))
    # Jaga rasio 27:16 bila kotak lebih besar dari frame.
    if w > src_w:
        h = int(round(h * src_w / w))
        w = src_w
    if h > src_h:
        w = int(round(w * src_h / h))
        h = src_h
    w, h = max(2, w - w % 2), max(2, h - h % 2)  # dimensi genap untuk x264

    x = int(round(cx * src_w - w / 2))
    y = int(round(cy * src_h - h / 2))
    x = min(max(0, x), max(0, src_w - w))
    y = min(max(0, y), max(0, src_h - h))
    return (x, y, w, h)


# Wajah facecam streamer kecil: FaceMesh di proxy 360 (sample_face_frames) hanya
# menemukan 3/100 sampel pada video streamer nyata, sehingga facecam_box selalu
# None -> fallback reframe diam-diam. Deteksi dua tahap dengan BlazeFace:
# (1) grid tile kecil diperbesar menemukan wajah kecil (teruji 100/100 pada video
# yang sama), (2) crop ketat sekitar kandidat dilacak per sampel (murah).
# BlazeFace mengecilkan input apa pun ke ~128px: wajah kecil hanya terdeteksi di
# dalam tile kecil, bukan di frame utuh — jadi grid diperlukan.
# Jendela sampling adalah video penuh (dipanggil pipeline sekali per file),
# karena panel facecam statis: satu kotak berlaku untuk semua klip.
FACECAM_TILE_UP = 3.0
FACECAM_MIN_FACE_HEIGHT = 0.03  # relatif tinggi frame utuh
FACECAM_SAMPLE_FPS = 1.0  # panel facecam statis: 1 sampel/detik cukup
FACECAM_MAX_SAMPLES = 240
FACECAM_KEYFRAMES = 6  # jumlah frame fase pencarian kandidat


def _facecam_proxy(frame, cv2):
    """Frame dikecilkan ke ~360p seperti deteksi lain."""
    height = frame.shape[0]
    if height > PROXY_HEIGHT:
        scale = PROXY_HEIGHT / height
        frame = cv2.resize(
            frame,
            (int(frame.shape[1] * scale), PROXY_HEIGHT),
            interpolation=cv2.INTER_AREA,
        )
    return frame


def _facecam_tiles(proxy, cv2) -> List[Tuple[Any, int, int, int, int]]:
    """Tile per-1/4 frame dengan langkah setengah tile (overlap 50%), diperbesar.

    Tiap tile dibawa (ox, oy, w_region, h_region) di proxy agar deteksi bisa
    dipetakan balik ke koordinat frame utuh.
    """
    h, w = proxy.shape[:2]
    tw, th = max(32, w // 4), max(24, h // 4)
    stride_x, stride_y = max(8, tw // 2), max(6, th // 2)
    xs = list(range(0, w - tw + 1, stride_x)) or [0]
    ys = list(range(0, h - th + 1, stride_y)) or [0]
    if xs[-1] != w - tw:
        xs.append(w - tw)
    if ys[-1] != h - th:
        ys.append(h - th)
    tiles: List[Tuple[Any, int, int, int, int]] = [(proxy, 0, 0, w, h)]
    for oy in ys:
        for ox in xs:
            region = proxy[oy : oy + th, ox : ox + tw]
            tiles.append(
                (
                    cv2.resize(
                        region,
                        None,
                        fx=FACECAM_TILE_UP,
                        fy=FACECAM_TILE_UP,
                        interpolation=cv2.INTER_CUBIC,
                    ),
                    ox,
                    oy,
                    tw,
                    th,
                )
            )
    return tiles


def facecam_faces_from_detections(
    detections: Sequence[Any],
    ox: int,
    oy: int,
    region_w: int,
    region_h: int,
    frame_w: int,
    frame_h: int,
) -> List[Face]:
    """Peta kotak deteksi BlazeFace (relatif tile) ke wajah relatif frame utuh."""
    faces: List[Face] = []
    for detection in detections:
        box = detection.location_data.relative_bounding_box
        height = box.height * region_h / frame_h
        if height < FACECAM_MIN_FACE_HEIGHT:
            continue
        cx = (ox + (box.xmin + box.width / 2) * region_w) / frame_w
        cy = (oy + (box.ymin + box.height / 2) * region_h) / frame_h
        faces.append(
            (
                float(min(1.0, max(0.0, cx))),
                float(min(1.0, max(0.0, cy))),
                float(height),
                0.0,
            )
        )
    return faces


def _facecam_candidate(
    candidates: Sequence[Face],
    frame_ids: Optional[Sequence[int]] = None,
) -> Optional[Face]:
    """Wajah yang paling sering muncul di posisi tetap lintas keyframe.

    Facecam statis, wajah karakter game berpindah. Hitung keyframe *berbeda*
    tempat wajah serupa muncul (tile yang overlap memberi duplikat dalam satu
    frame, jadi duplikat tidak boleh dihitung). Butuh >=2 keyframe; seri ->
    wajah terkecil. `frame_ids` None = tiap kandidat dianggap frame sendiri.
    """
    ids = list(frame_ids) if frame_ids is not None else list(range(len(candidates)))
    best: Optional[Tuple[int, float, List[Face]]] = None
    for face in candidates:
        near_idx = [
            i
            for i, other in enumerate(candidates)
            if abs(other[0] - face[0]) < 0.08
            and abs(other[1] - face[1]) < 0.08
            and 0.6 * face[2] <= other[2] <= 1.6 * face[2]
        ]
        distinct = len({ids[i] for i in near_idx})
        if distinct < 2:
            continue
        if best is None or (distinct, -face[2]) > (best[0], -best[1]):
            best = (distinct, face[2], [candidates[i] for i in near_idx])
    if best is None:
        return None
    near = best[2]
    return (
        median(item[0] for item in near),
        median(item[1] for item in near),
        median(item[2] for item in near),
        0.0,
    )


def _iter_samples(capture, cv2, start: float, end: float, sample_fps: float, limit_n: int):
    """Yield (t_rel, frame) tiap 1/sample_fps detik dalam jendela start..end."""
    if not capture.set(cv2.CAP_PROP_POS_MSEC, start * 1000):
        raise RuntimeError(f"tidak bisa seek ke {start:.2f}s di video")
    fps = capture.get(cv2.CAP_PROP_FPS) or 0.0
    step = 1 if fps <= 0 else max(1, round(fps / sample_fps))
    dt = step / fps if fps > 0 else 1.0 / sample_fps
    stop = end + 0.5 * dt
    count = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        timestamp = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        if timestamp > stop:
            break
        yield max(0.0, timestamp - start), frame
        count += 1
        if count >= limit_n:
            break
        grabbed = True
        for _ in range(step - 1):
            if not capture.grab():
                grabbed = False
                break
        if not grabbed:
            break
        if capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0 > stop:
            break


def facecam_face_frames(
    video_path: str,
    start: float,
    end: float,
    sample_fps: float = FACECAM_SAMPLE_FPS,
) -> List[SampledFrame]:
    """Sampel wajah khusus layout facecam (BlazeFace dua tahap).

    `sample_face_frames` (FaceMesh + landmark) tidak bisa diandalkan untuk wajah
    facecam streamer yang kecil; `facecam_box` atas hasilnya selalu None.
    Fase 1: grid tile diperbesar pada beberapa keyframe menemukan wajah kecil
    terkecil yang stabil. Fase 2: crop ketat sekitar kandidat itu dideteksi per
    sampel jendela video.
    """
    try:
        import cv2
        import mediapipe as mp
    except ImportError as exc:
        raise RuntimeError(FACE_DEPS_ERROR) from exc

    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        raise RuntimeError(f"tidak bisa membuka video untuk facecam: {video_path}")

    try:
        with mp.solutions.face_detection.FaceDetection(
            model_selection=0,
            min_detection_confidence=0.5,
        ) as detection:
            duration = max(0.5, end - start)
            key_fps = max(0.05, FACECAM_KEYFRAMES / duration)
            candidates: List[Face] = []
            frame_ids: List[int] = []
            proxy_w = proxy_h = 0
            for key_idx, (_, frame) in enumerate(
                _iter_samples(capture, cv2, start, end, key_fps, FACECAM_KEYFRAMES)
            ):
                proxy = _facecam_proxy(frame, cv2)
                proxy_h, proxy_w = proxy.shape[:2]
                for tile, ox, oy, region_w, region_h in _facecam_tiles(proxy, cv2):
                    result = detection.process(cv2.cvtColor(tile, cv2.COLOR_BGR2RGB))
                    found = facecam_faces_from_detections(
                        getattr(result, "detections", None) or [],
                        ox,
                        oy,
                        region_w,
                        region_h,
                        proxy_w,
                        proxy_h,
                    )
                    candidates.extend(found)
                    frame_ids.extend([key_idx] * len(found))

            face = _facecam_candidate(candidates, frame_ids)
            if face is None or proxy_w <= 0:
                return []

            # Crop ketat sekitar kandidat: lebar ~6x tinggi wajah, tinggi ~4x.
            face_px = max(1.0, face[2] * proxy_h)
            region_w = min(proxy_w, max(80, int(round(face_px * 6))))
            region_h = min(proxy_h, max(60, int(round(face_px * 4))))
            x0 = int(min(max(0.0, face[0] * proxy_w - region_w / 2), proxy_w - region_w))
            y0 = int(min(max(0.0, face[1] * proxy_h - region_h / 2), proxy_h - region_h))

            frames: List[SampledFrame] = []
            for t, frame in _iter_samples(
                capture, cv2, start, end, sample_fps, FACECAM_MAX_SAMPLES
            ):
                proxy = _facecam_proxy(frame, cv2)
                region = proxy[y0 : y0 + region_h, x0 : x0 + region_w]
                big = cv2.resize(
                    region,
                    None,
                    fx=FACECAM_TILE_UP,
                    fy=FACECAM_TILE_UP,
                    interpolation=cv2.INTER_CUBIC,
                )
                result = detection.process(cv2.cvtColor(big, cv2.COLOR_BGR2RGB))
                faces = facecam_faces_from_detections(
                    getattr(result, "detections", None) or [],
                    x0,
                    y0,
                    region_w,
                    region_h,
                    proxy_w,
                    proxy_h,
                )
                frames.append((t, faces))
            return frames
    finally:
        capture.release()


def panel_crop_filter(center_x: Optional[float]) -> str:
    """Crop statis 9:8 (w=ih*9/8, h=ih; atau lebih pendek bila terlalu lebar),
    di tengah pembicara, lalu skala ke panel 1080x960. ffmpeg meng-clamp x/y."""
    center = 0.5 if center_x is None else max(0.0, min(1.0, center_x))
    return (
        "crop=w='min(ih*1.125,in_w)':h='if(gt(ih*1.125,in_w),in_w*0.88889,ih)'"
        f":x='max(0,min({center:.5f}*in_w-out_w/2,in_w-out_w))'"
        ":y='max(0,(in_h-out_h)/2)',scale=1080:960,setsar=1"
    )



def _detect_faces(frame, cv2, mesh) -> List[Face]:
    height = frame.shape[0]
    if height > PROXY_HEIGHT:
        scale = PROXY_HEIGHT / height
        frame = cv2.resize(
            frame,
            (int(frame.shape[1] * scale), PROXY_HEIGHT),
            interpolation=cv2.INTER_AREA,
        )
    result = mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    faces: List[Face] = []
    for landmarks in getattr(result, "multi_face_landmarks", None) or []:
        xs = [point.x for point in landmarks.landmark]
        ys = [point.y for point in landmarks.landmark]
        face_height = max(ys) - min(ys)
        if face_height < MIN_FACE_HEIGHT:
            continue
        cx = (max(xs) + min(xs)) / 2
        cy = (max(ys) + min(ys)) / 2
        mouth = (landmarks.landmark[LIP_LOWER].y - landmarks.landmark[LIP_UPPER].y) / face_height
        faces.append((float(cx), float(cy), float(face_height), max(0.0, float(mouth))))
    return faces


class _Track:
    """Wajah yang diikuti antar sampel: posisi, ukuran, energi gerak bibir."""

    __slots__ = ("cx", "cy", "height", "mouth", "score", "last_seen")

    def __init__(self, face: Face, t: float) -> None:
        self.cx, self.cy, self.height, self.mouth = face
        self.score = 0.0
        self.last_seen = t

    def update(self, face: Face, t: float) -> None:
        cx, cy, height, mouth = face
        self.score = MOTION_ALPHA * abs(mouth - self.mouth) + (1 - MOTION_ALPHA) * self.score
        self.cx, self.cy, self.height, self.mouth, self.last_seen = cx, cy, height, mouth, t


def select_speaker_segments(
    frames: Sequence[SampledFrame],
) -> Optional[List[Segment]]:
    """Pilih wajah aktif per sampel -> segmen cut statis.

    Terpisah dari deteksi agar bisa diuji tanpa mediapipe.
    """
    tracks: List[_Track] = []
    active: Optional[_Track] = None
    last_cut_t: Optional[float] = None
    segments: List[Segment] = []

    for t, faces in frames:
        # pasangkan deteksi ke track lama berdasar kedekatan posisi
        for track in tracks:
            track.score *= 0.8  # meluruh kalau bibir berhenti bergerak
        pending = list(tracks)
        tracks = []
        for face in faces:
            match = None
            if pending:
                match = min(pending, key=lambda track: abs(track.cx - face[0]))
                if abs(match.cx - face[0]) > 0.18:
                    match = None
                else:
                    pending.remove(match)
            if match is None:
                match = _Track(face, t)
            else:
                match.update(face, t)
            tracks.append(match)
        tracks = [track for track in tracks if t - track.last_seen <= 2 * MISSING_TTL_SEC]

        visible = [track for track in tracks if t - track.last_seen <= MISSING_TTL_SEC]

        forced = active is None or t - active.last_seen > MISSING_TTL_SEC
        if visible:
            candidate = max(visible, key=lambda track: (track.score, track.height))
            switch = forced or (
                candidate is not active
                and candidate.score > max(SPEECH_FLOOR, active.score * SWITCH_MARGIN)
                and last_cut_t is not None
                and t - last_cut_t >= MIN_HOLD_SEC
            )
            drift = (
                active is not None
                and not switch
                and abs(active.cx - segments[-1][1]) > DRIFT_CUT
                and t - last_cut_t >= MIN_HOLD_SEC
            )
            if switch or drift:
                active, last_cut_t = candidate, t
                segments.append((t, active.cx))

    if not segments:
        return None
    return _normalize_segments(segments)


def _normalize_segments(segments: List[Segment]) -> List[Segment]:
    """Gabungkan segmen terlalu pendek, batasi jumlah segmen, mulai dari t=0."""
    merged: List[Segment] = [segments[0]]
    for t, x in segments[1:]:
        if t - merged[-1][0] < MIN_HOLD_SEC - 1e-6:
            continue  # cut terlalu pendek: biarkan cut sebelumnya berlanjut
        merged.append((t, x))
    while len(merged) > MAX_SEGMENTS:
        # buang cut dengan rentang terpendek (cut sebelumnya diperpanjang)
        shortest = min(
            range(1, len(merged)), key=lambda i: merged[i][0] - merged[i - 1][0]
        )
        merged.pop(shortest)
    merged[0] = (0.0, merged[0][1])
    return merged


def portrait_crop_filter(
    center_x: Optional[float],
    width: int = 1080,
    height: int = 1920,
) -> str:
    """Crop jendela statis (rasio width:height) di sumber lalu skala ke width x height.

    ffmpeg clamp sendiri x ke [0, in_w - w], jadi tidak perlu hitung batas.
    9:16 = 1080x1920 (default, perilaku lama); 1:1 = 1080x1080.
    """
    ratio = width / height
    center = 0.5 if center_x is None else max(0.0, min(1.0, center_x))
    return (
        f"crop=ih*{ratio:.5f}:ih:{center:.5f}*in_w-ih*{ratio / 2:.5f}:0,"
        f"scale={width}:{height}"
    )


def cut_crop_filter(
    segments: Sequence[Segment],
    width: int = 1080,
    height: int = 1920,
) -> str:
    """Crop statis per segmen (cut, tanpa pan halus) ke width x height.

    x(t) konstan dalam tiap segmen: jumlah suku `x*gte(t,a)*lt(t,b)`; ffmpeg
    sendiri meng-clamp x ke rentang valid.
    """
    ratio = width / height
    terms: List[str] = []
    for index, (t, x) in enumerate(segments):
        cond = f"gte(t,{t:.2f})"
        if index + 1 < len(segments):
            cond += f"*lt(t,{segments[index + 1][0]:.2f})"
        terms.append(f"{max(0.0, min(1.0, x)):.4f}*{cond}")

    x_expr = (
        "max(0,min((" + "+".join(terms) + f")*in_w-ih*{ratio / 2:.5f},"
        f"in_w-ih*{ratio:.5f}))"
    )
    return (
        f"crop=w='ih*{ratio:.5f}':h=ih:x='{x_expr}',scale={width}:{height}"
    )


# Alias kompatibilitas mundur
panning_crop_filter = cut_crop_filter
