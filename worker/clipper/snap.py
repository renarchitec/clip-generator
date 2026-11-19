"""Penyesuaian deterministik batas momen ke batas cue/kalimat terdekat.

Fungsi murni: tanpa LLM, tanpa I/O. Dipakai setelah pemilihan momen (LLM
maupun fallback) supaya klip tidak mulai/berhenti di tengah kalimat.
"""

from __future__ import annotations

from typing import List, Sequence, Tuple

from .subtitles import Cue

# Geseran maksimum yang masih diterima saat mencari batas cue.
SNAP_WINDOW = 3.0
# Batas akhir boleh melihat lebih jauh: lebih baik memanjang sampai kalimat
# selesai daripada berhenti di cue arbitrer di tengah pemikiran.
END_SNAP_WINDOW = 6.0
# Jeda antar-cue yang dianggap batas pemikiran.
PAUSE_GAP = 0.4
# Bantalan kecil: jangan memotong konsonan pertama / ekor kata terakhir.
START_PAD = 0.15
END_PAD = 0.25
# Di bawah ini clip terlalu pendek untuk dirender.
MIN_SNAP_SECONDS = 1.0

_SENTENCE_END = (".", "?", "!", "\u2026")


def _ends_sentence(text: str) -> bool:
    return text.strip().endswith(_SENTENCE_END)


def _start_candidates(cues: Sequence[Cue]) -> List[Tuple[float, bool]]:
    """(waktu mulai cue, batas kuat?) — kuat bila cue sebelumnya menutup kalimat
    atau ada jeda >= PAUSE_GAP."""
    result: List[Tuple[float, bool]] = []
    for index, cue in enumerate(cues):
        strong = False
        if index > 0:
            previous = cues[index - 1]
            strong = _ends_sentence(previous.text) or cue.start - previous.end >= PAUSE_GAP
        result.append((cue.start, strong))
    return result


def _end_candidates(cues: Sequence[Cue]) -> List[Tuple[float, bool]]:
    """(waktu akhir cue, batas kuat?) — kuat bila cue menutup kalimat atau
    diikuti jeda >= PAUSE_GAP."""
    result: List[Tuple[float, bool]] = []
    for index, cue in enumerate(cues):
        strong = _ends_sentence(cue.text)
        if not strong and index + 1 < len(cues):
            strong = cues[index + 1].start - cue.end >= PAUSE_GAP
        result.append((cue.end, strong))
    return result


def _nearest(items: Sequence[Tuple[float, bool]], target: float) -> float:
    return min(items, key=lambda item: abs(item[0] - target))[0]


def _pick_start(candidates: Sequence[Tuple[float, bool]], target: float) -> float:
    """Batas terdekat <= target dalam SNAP_WINDOW; batas kuat diutamakan."""
    inside = [item for item in candidates if target - SNAP_WINDOW <= item[0] <= target]
    if not inside:
        return target
    strong = [item for item in inside if item[1]]
    return _nearest(strong or inside, target)


def _pick_end(candidates: Sequence[Tuple[float, bool]], target: float) -> float:
    """Batas kuat (kalimat selesai / jeda) dicari sampai END_SNAP_WINDOW;
    tanpa batas kuat, jatuh ke cue terdekat dalam SNAP_WINDOW saja."""
    strong = [item for item in candidates if item[1] and target <= item[0] <= target + END_SNAP_WINDOW]
    if strong:
        return _nearest(strong, target)
    inside = [item for item in candidates if target <= item[0] <= target + SNAP_WINDOW]
    return _nearest(inside, target) if inside else target


def _clamp(start: float, end: float, min_duration: float, max_duration: float, total: float) -> Tuple[float, float]:
    start = max(0.0, start)
    end = min(total, end)
    if end - start > max_duration:
        start = max(0.0, end - max_duration)
    elif end - start < min_duration:
        end = min(total, start + min_duration)
        start = max(0.0, end - min_duration)
    return start, end


def snap_window(
    cues: Sequence[Cue],
    start: float,
    end: float,
    min_duration: float,
    max_duration: float,
) -> Tuple[float, float]:
    """Geser start ke awal cue terdekat (<= start) dalam SNAP_WINDOW dan end ke
    batas kuat terdekat (>= end) sampai END_SNAP_WINDOW, beri bantalan, jaga
    durasi, clamp ke rentang transkrip."""
    if not cues:
        return start, end

    total = cues[-1].end
    start = _pick_start(_start_candidates(cues), start) - START_PAD
    end = _pick_end(_end_candidates(cues), end) + END_PAD
    return _clamp(start, end, min_duration, max_duration, total)


def snap_windows(
    cues: Sequence[Cue],
    windows: Sequence[Tuple[float, float]],
    min_duration: float,
    max_duration: float,
) -> List[Tuple[float, float]]:
    """Snap tiap jendela lalu rapikan tumpang tindih: start jendela berikutnya
    ditarik ke end jendela sebelumnya. Urutan hasil sama dengan input."""
    snapped = [snap_window(cues, start, end, min_duration, max_duration) for start, end in windows]
    order = sorted(range(len(snapped)), key=lambda index: snapped[index][0])
    previous_end = 0.0
    for index in order:
        start, end = snapped[index]
        start = max(start, previous_end)
        if end - start < MIN_SNAP_SECONDS:
            end = start  # jendela habis termakan tetangga
        snapped[index] = (start, end)
        previous_end = end
    return snapped
