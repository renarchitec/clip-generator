"""Reframe `face_tracking` (kini: active speaker) — potong statis per segmen.

Perilaku tersimpan `face_tracking` didefinisikan ulang sebagai "pembicara aktif":
worker menganalisis frame proxy ~360p/5 fps dengan MediaPipe FaceMesh, mengukur
bukaan/gerak bibir tiap wajah, lalu memilih wajah yang sedang bicara dengan
hysteresis + minimal hold. Hasilnya bukan pan halus, melainkan deretan crop
statis (cut) per segmen pembicara, sebagai ekspresi filter ffmpeg piecewise.

Modul ini juga menyediakan `two_speaker_centers` (klaster 2-means pusat_x wajah
untuk mode dua pembicara) dan `panel_crop_filter` (crop panel 9:8 per pembicara).

Kontrak API/DB tidak berubah: nilai `face_tracking` tetap diterima dan tetap
default; fallback crop tengah tetap ada bila tidak ada wajah sama sekali.

Dependency opsional: kalau mediapipe/opencv tidak terpasang, job gagal dengan
pesan jelas — bukan fallback diam-diam ke mode lain.
"""

from __future__ import annotations

import logging
from typing import List, Optional, Sequence, Tuple

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

# Face tuple: (cx 0..1, tinggi relatif, bukaan mulut relatif thd tinggi wajah)
Face = Tuple[float, float, float]
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
        mouth = (landmarks.landmark[LIP_LOWER].y - landmarks.landmark[LIP_UPPER].y) / face_height
        faces.append((float(cx), float(face_height), max(0.0, float(mouth))))
    return faces


class _Track:
    """Wajah yang diikuti antar sampel: posisi, ukuran, energi gerak bibir."""

    __slots__ = ("cx", "height", "mouth", "score", "last_seen")

    def __init__(self, face: Face, t: float) -> None:
        self.cx, self.height, self.mouth = face
        self.score = 0.0
        self.last_seen = t

    def update(self, face: Face, t: float) -> None:
        cx, height, mouth = face
        self.score = MOTION_ALPHA * abs(mouth - self.mouth) + (1 - MOTION_ALPHA) * self.score
        self.cx, self.height, self.mouth, self.last_seen = cx, height, mouth, t


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
