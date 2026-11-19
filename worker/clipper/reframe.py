"""Reframe face_tracking: deteksi wajah MediaPipe di proxy low-res.

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
EMA_ALPHA = 0.35
MAX_PAN_PER_SEC = 0.15  # fraksi lebar frame per detik
PORTRAIT_RATIO = 9 / 16


def face_track_samples(
    video_path: str,
    start: float,
    end: float,
    sample_fps: float = SAMPLE_FPS,
) -> Optional[List[Tuple[float, float]]]:
    """Deret waktu (t_rel, pusat_x 0..1) dari proxy ~360p, ~5 fps.

    - Wajah terbesar dipakai, EMA meredam lompatan, pan dibatasi per detik.
    - Frame tanpa wajah: target kembali ke tengah (0.5), bukan error.
    - None bila tidak ada wajah sama sekali -> pipeline memakai crop tengah.
    """
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
        samples: List[Tuple[float, float]] = []
        ema: Optional[float] = None

        with mp.solutions.face_detection.FaceDetection(
            model_selection=1, min_detection_confidence=0.4
        ) as detector:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                timestamp = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
                if timestamp > limit:
                    break

                target = _largest_face_center(frame, detector)
                ema = target if ema is None else ema + EMA_ALPHA * (target - ema)
                samples.append((max(0.0, timestamp - start), ema))

                grabbed = True
                for _ in range(step - 1):
                    if not capture.grab():
                        grabbed = False
                        break
                if not grabbed:
                    break
                if capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0 > limit:
                    break

        if not samples:
            return None
        samples = _clamp_pan(samples, dt)
        # Keep the FFmpeg expression bounded for long clips; interpolation still
        # follows the smoothed path, just at a coarser sample rate.
        max_samples = 48
        if len(samples) > max_samples:
            stride = (len(samples) - 1) / (max_samples - 1)
            samples = [samples[round(index * stride)] for index in range(max_samples)]
        return samples
    finally:
        capture.release()


def _largest_face_center(frame, detector) -> float:
    import cv2

    height = frame.shape[0]
    if height > PROXY_HEIGHT:
        scale = PROXY_HEIGHT / height
        frame = cv2.resize(
            frame,
            (int(frame.shape[1] * scale), PROXY_HEIGHT),
            interpolation=cv2.INTER_AREA,
        )
    result = detector.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    detections = getattr(result, "detections", None) or []
    if not detections:
        return 0.5  # tanpa wajah: kembali ke tengah, bukan error
    best = max(
        detections,
        key=lambda item: item.location_data.relative_bounding_box.width
        * item.location_data.relative_bounding_box.height,
    )
    box = best.location_data.relative_bounding_box
    return max(0.0, min(1.0, float(box.xmin + box.width / 2)))


def _clamp_pan(samples: Sequence[Tuple[float, float]], dt: float) -> List[Tuple[float, float]]:
    """Batas kecepatan geser antar sampel EMA supaya pan tidak lompat."""
    max_step = MAX_PAN_PER_SEC * dt
    output: List[Tuple[float, float]] = []
    previous = samples[0][1]
    for timestamp, center in samples:
        delta = center - previous
        clamped = previous + max(-max_step, min(delta, max_step))
        output.append((timestamp, clamped))
        previous = clamped
    return output


def portrait_crop_filter(center_x: Optional[float]) -> str:
    """Crop jendela 9:16 statis di sumber lalu skala penuh ke 1080x1920.

    ffmpeg clamp sendiri x ke [0, in_w - w], jadi tidak perlu hitung batas.
    """
    center = 0.5 if center_x is None else max(0.0, min(1.0, center_x))
    return (
        f"crop=ih*{PORTRAIT_RATIO:.5f}:ih:{center:.5f}*in_w-ih*{PORTRAIT_RATIO / 2:.5f}:0,"
        "scale=1080:1920"
    )


def panning_crop_filter(samples: Sequence[Tuple[float, float]]) -> str:
    """Crop 9:16 yang bergerak mengikuti deret waktu sampel.

    x(t) = interpolasi linear antar sampel, dalam piksel, dengan clamp ffmpeg.
    """
    terms: List[str] = []
    first_time, first_x = samples[0]
    terms.append(f"{first_x:.4f}*lt(t,{first_time:.2f})")
    for (time_a, x_a), (time_b, x_b) in zip(samples, samples[1:]):
        span = max(1e-3, time_b - time_a)
        terms.append(
            f"({x_a:.4f}+({x_b:.4f}-{x_a:.4f})*(t-{time_a:.2f})/{span:.2f})"
            f"*gte(t,{time_a:.2f})*lt(t,{time_b:.2f})"
        )
    last_time, last_x = samples[-1]
    terms.append(f"{last_x:.4f}*gte(t,{last_time:.2f})")

    x_expr = (
        "max(0,min((" + "+".join(terms) + f")*in_w-ih*{PORTRAIT_RATIO / 2:.5f},"
        f"in_w-ih*{PORTRAIT_RATIO:.5f}))"
    )
    return (
        f"crop=w='ih*{PORTRAIT_RATIO:.5f}':h=ih:x='{x_expr}',scale=1080:1920"
    )
