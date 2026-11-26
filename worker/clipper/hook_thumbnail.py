"""Render a clean editorial cover and prepend it to a finished clip."""

from __future__ import annotations

import logging
import math
import os
from itertools import combinations
from typing import Any, Mapping, Optional

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

HOOK_INTRO_DURATION_SEC = 0.9
HOOK_INTRO_TIMEOUT_SEC = 180.0
HOOK_AUDIO_RATE = 44100

log = logging.getLogger(__name__)
_GOLD = (250, 204, 21)
_WHITE = (255, 255, 255)
_STROKE = (8, 12, 22, 255)


def _load_font(size: int):
    fonts_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fonts")
    system_dir = "/usr/share/fonts/truetype/anton"
    for path in (
        os.path.join(fonts_dir, "Montserrat-Bold.ttf"),
        os.path.join(system_dir, "Montserrat-Bold.ttf"),
        os.path.join(fonts_dir, "PlusJakartaSans-Bold.ttf"),
        os.path.join(system_dir, "PlusJakartaSans-Bold.ttf"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def extract_cover_frame(video_path: str, start_sec: float, end_sec: float) -> Optional[np.ndarray]:
    """Pick the sharpest non-dark frame, or the brightest dark frame."""
    cap = cv2.VideoCapture(video_path)
    best_lit = brightest = None
    best_sharpness = best_brightness = -1.0
    try:
        if not cap.isOpened():
            return None
        dur = max(0.5, end_sec - start_sec)
        upper = max(start_sec, end_sec - 0.1)
        timestamps = dict.fromkeys(
            max(start_sec, min(start_sec + offset, upper))
            for offset in (0.25, 0.8, 1.6, min(3.0, dur * 0.35))
        )
        for timestamp in timestamps:
            cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            brightness = gray.mean()
            sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
            if brightness > best_brightness:
                brightest, best_brightness = frame, brightness
            if brightness >= 16 and sharpness > best_sharpness:
                best_lit, best_sharpness = frame, sharpness
        return best_lit if best_lit is not None else brightest
    finally:
        cap.release()


def _detect_face_focus(frame_bgr: np.ndarray) -> tuple[float, float]:
    fallback = (0.5, 0.38)
    try:
        data_dir = getattr(getattr(cv2, "data", None), "haarcascades", None)
        if not data_dir:
            return fallback
        cascade_path = os.path.join(data_dir, "haarcascade_frontalface_default.xml")
        if not os.path.isfile(cascade_path):
            return fallback
        detector = cv2.CascadeClassifier(cascade_path)
        if detector.empty():
            return fallback
        h, w = frame_bgr.shape[:2]
        if w > 360:
            frame_bgr = cv2.resize(frame_bgr, (360, max(1, round(h * 360 / w))), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5)
        if len(faces):
            x, y, fw, fh = max(faces, key=lambda face: int(face[2]) * int(face[3]))
            h, w = gray.shape
            return (max(0.2, min(0.8, (x + fw / 2) / w)), max(0.25, min(0.48, (y + fh / 2) / h)))
    except cv2.error:
        pass  # Detection is optional; keep the upper-center bias.
    return fallback


def _cover_crop(img: Image.Image, target_w: int, target_h: int, focus_x: float, focus_y: float) -> Image.Image:
    scale = max(target_w / img.width, target_h / img.height)
    w, h = max(target_w, math.ceil(img.width * scale)), max(target_h, math.ceil(img.height * scale))
    resized = img.resize((w, h), Image.Resampling.LANCZOS)
    left = max(0, min(w - target_w, round(w * focus_x - target_w / 2)))
    top = max(0, min(h - target_h, round(h * focus_y - target_h / 2)))
    return resized.crop((left, top, left + target_w, top + target_h))


def _smoothstep(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def _thumbnail_background(frame_bgr: Optional[np.ndarray], width: int, height: int) -> Image.Image:
    x = np.linspace(-1, 1, width, dtype=np.float32)[None, :]
    y = np.linspace(0, 1, height, dtype=np.float32)[:, None]
    radius = np.hypot(x, 2 * y - 1)
    if frame_bgr is not None:
        focus_x, focus_y = _detect_face_focus(frame_bgr)
        img = Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
        img = _cover_crop(img, width, height, focus_x, focus_y)
        img = ImageEnhance.Contrast(img).enhance(1.12)
        img = ImageEnhance.Color(img).enhance(1.14)
        img = ImageEnhance.Sharpness(img).enhance(1.10)
    else:
        mix = _smoothstep(radius)[..., None]
        center = np.array((17, 24, 39), dtype=np.float32)
        edge = np.array((2, 6, 23), dtype=np.float32)
        img = Image.fromarray(np.rint(center + mix * (edge - center)).astype(np.uint8))

    top = 0.38 * np.clip(1 - y / 0.20, 0, 1)
    bottom = (
        0.58 * _smoothstep((y - 0.36) / 0.20)
        + 0.26 * _smoothstep((y - 0.56) / 0.22)
        + 0.10 * _smoothstep((y - 0.78) / 0.22)
    )
    edges = 0.22 * _smoothstep((radius - 0.48) / (math.sqrt(2) - 0.48))
    scrim = np.empty((height, width, 4), dtype=np.uint8)
    scrim[..., :3] = (5, 8, 17)
    scrim[..., 3] = np.rint(255 * (1 - (1 - top - bottom) * (1 - edges))).astype(np.uint8)
    return Image.alpha_composite(img.convert("RGBA"), Image.fromarray(scrim))


def _balanced_lines(words: list[str], measure, max_width: int) -> list[str]:
    """Find the fewest fitting lines, then minimize imbalance and orphans."""
    widths: dict[tuple[int, int], int] = {}
    for count in range(1, min(3, len(words)) + 1):
        best, best_score = [], float("inf")
        for cuts in combinations(range(1, len(words)), count - 1):
            bounds = (0, *cuts, len(words))
            spans = list(zip(bounds, bounds[1:]))
            sizes = []
            for start, end in spans:
                if (start, end) not in widths:
                    widths[start, end] = measure(" ".join(words[start:end]))
                size = widths[start, end]
                if size > max_width:
                    break
                sizes.append(size)
            else:
                mean = sum(sizes) / count
                score = sum((size - mean) ** 2 for size in sizes)
                if count > 1 and spans[-1][1] - spans[-1][0] == 1 and sizes[-1] < mean * 0.65:
                    score += max_width ** 2
                if score < best_score:
                    best = [" ".join(words[start:end]) for start, end in spans]
                    best_score = score
        if best:
            return best
    return []


def render_hook_thumbnail(
    frame_bgr: Optional[np.ndarray], hook_text: str, width: int, height: int, out_png_path: str
) -> str:
    img = _thumbnail_background(frame_bgr, width, height)
    text = " ".join(hook_text.split()).strip("\"'“”‘’«»").strip().upper()[:80].rstrip()
    if not text:
        img.save(out_png_path, format="PNG")
        return out_png_path

    if height > width:
        max_text_w, bottom, start_size = int(width * 0.80), int(height * 0.765), round(width * 0.082)
    elif height == width:
        max_text_w, bottom, start_size = int(width * 0.84), int(height * 0.84), round(width * 0.068)
    else:
        max_text_w, bottom, start_size = int(width * 0.78), int(height * 0.85), round(height * 0.080)
    min_size = max(1, round(min(width, height) * 0.048))
    draw = ImageDraw.Draw(img)
    words = text.split()
    size = max(min_size, start_size)
    while True:
        font = _load_font(size)
        stroke = max(2, round(size * 0.05))

        def bbox(line):
            return draw.textbbox((0, 0), line, font=font, stroke_width=stroke)

        def measure(line):
            left, _, right, _ = bbox(line)
            return right - left

        lines = _balanced_lines(words, measure, max_text_w)
        if lines or size == min_size:
            break
        size = max(min_size, size - 4)

    if not lines:
        tokens = words[:]
        while tokens:
            lines = _balanced_lines(tokens[:-1] + [tokens[-1] + "…"], measure, max_text_w)
            if lines:
                break
            tokens.pop()
        if not lines:
            prefix = words[0]
            while prefix and measure(prefix + "…") > max_text_w:
                prefix = prefix[:-1]
            lines = [prefix + "…"]

    boxes = [bbox(line) for line in lines]
    line_heights = [lower - upper for _, upper, _, lower in boxes]
    line_gap = round(size * 0.13)
    headline_top = bottom - sum(line_heights) - line_gap * (len(lines) - 1)
    y = headline_top
    positions = []
    for (left, upper, right, _), line_height in zip(boxes, line_heights):
        positions.append((round((width - (right - left)) / 2 - left), y - upper))
        y += line_height + line_gap

    pill_w, pill_h = max(1, round(width * 0.105)), max(6, round(height * 0.005))
    pill_left = (width - pill_w) // 2
    pill_bottom = headline_top - round(size * 0.38)
    pill = (pill_left, pill_bottom - pill_h + 1, pill_left + pill_w - 1, pill_bottom)
    glow = Image.new("RGBA", img.size)
    ImageDraw.Draw(glow).rounded_rectangle(pill, radius=pill_h / 2, fill=(*_GOLD, 90))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(12)))

    shadow = Image.new("RGBA", img.size)
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_offset = max(6, round(size * 0.10))
    for line, (x, y) in zip(lines, positions):
        shadow_draw.text((x, y + shadow_offset), line, font=font, fill=(0, 0, 0, 225), stroke_width=stroke)
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(max(8, round(size * 0.18)))))

    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(pill, radius=pill_h / 2, fill=_GOLD)

    def typeset(position, line, color):
        draw.text(position, line, font=font, fill=color, stroke_width=stroke, stroke_fill=_STROKE)

    if len(lines) == 1 and len(lines[0].split()) > 1:
        tokens = lines[0].split()
        split = len(tokens) // 2
        first, second = " ".join(tokens[:split]), " ".join(tokens[split:])
        x, y = positions[0]
        second_x = x + draw.textlength(lines[0], font=font) - draw.textlength(second, font=font)
        typeset((x, y), first, _WHITE)
        typeset((second_x, y), second, _GOLD)
    else:
        for index, (line, position) in enumerate(zip(lines, positions)):
            typeset(position, line, _GOLD if index == len(lines) - 1 else _WHITE)

    img.save(out_png_path, format="PNG")
    return out_png_path


def _hook_intro_command(
    clip_path: str, thumb_png_path: str, out_path: str, clip_meta: Mapping[str, Any], duration_sec: float
) -> list[str]:
    w, h, fps = clip_meta["width"], clip_meta["height"], clip_meta["fps"]
    clip_dur = clip_meta["duration"]
    frames = max(1, round(duration_sec * fps))
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", thumb_png_path, "-i", clip_path]

    def silence(duration: float) -> list[str]:
        return ["-f", "lavfi", "-t", f"{duration:.3f}", "-i", f"anullsrc=r={HOOK_AUDIO_RATE}:cl=stereo"]

    cmd += silence(duration_sec)
    clip_audio = "1:a:0"
    if not clip_meta["has_audio"]:
        cmd += silence(clip_dur)
        clip_audio = "3:a:0"

    def audio(src: str, dest: str, duration: float, fade: str = "") -> str:
        return (
            f"[{src}]aresample={HOOK_AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,"
            f"{fade}apad=whole_dur={duration:.3f},atrim=end={duration:.3f},asetpts=PTS-STARTPTS[{dest}]"
        )

    graph = [
        f"[0:v]scale={w}:{h},setsar=1,zoompan=z='1.06-0.06*(1-pow(1-on/{frames},2))':"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={w}x{h}:fps={fps:.3f},"
        "format=yuv420p,setpts=PTS-STARTPTS[iv]",
        f"[1:v]scale={w}:{h},setsar=1,fps={fps:.3f},format=yuv420p,setpts=PTS-STARTPTS[cv]",
        audio("2:a:0", "ia", duration_sec),
        audio(clip_audio, "ca", clip_dur, "afade=t=in:st=0:d=0.04," if clip_meta["has_audio"] else ""),
        "[iv][ia][cv][ca]concat=n=2:v=1:a=1[v][a]",
    ]
    return cmd + [
        "-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "22",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-sn", "-f", "mp4", out_path,
    ]


def prepend_hook_intro(
    clip_path: str, thumb_png_path: str, duration_sec: float = HOOK_INTRO_DURATION_SEC,
    timeout: float = HOOK_INTRO_TIMEOUT_SEC,
) -> bool:
    """Prepend the cover atomically, preserving the original on any failure."""
    tmp_path = None
    try:
        # Import lazily: pipeline calls this module after rendering and owns the shared probe/runner.
        from .pipeline import _probe_media, _run

        tmp_path = os.fspath(clip_path) + ".hook.tmp"
        clip_meta = _probe_media(clip_path)
        command = _hook_intro_command(clip_path, thumb_png_path, tmp_path, clip_meta, duration_sec)
        _run(command, timeout=timeout)
        if not os.path.isfile(tmp_path) or os.path.getsize(tmp_path) <= 0:
            raise RuntimeError("hook intro output is empty")
        os.replace(tmp_path, clip_path)
        return True
    except Exception as exc:
        log.warning("hook intro skipped; keeping original clip: %s", exc)
        return False
    finally:
        if tmp_path is not None:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
