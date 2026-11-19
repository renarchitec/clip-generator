import pytest

from clipper.snap import END_PAD, START_PAD, snap_window, snap_windows
from clipper.subtitles import Cue


def _cues():
    return [
        Cue(0.0, 5.0, "Halo semua."),
        Cue(5.0, 9.0, "Hari ini kita bahas"),
        Cue(9.0, 14.0, "topik penting?"),
        Cue(14.0, 18.0, "lanjut lagi."),
    ]


def test_snap_start_prefers_sentence_boundary():
    start, _ = snap_window(_cues(), 6.5, 12.0, 1.0, 100.0)
    # Awal cue 5.0 dipilih (kalimat sebelumnya berakhir titik), bukan 0.0.
    assert start == pytest.approx(5.0 - START_PAD)


def test_snap_end_prefers_sentence_end():
    _, end = snap_window(_cues(), 6.5, 12.0, 1.0, 100.0)
    # Akhir 14.0 (kalimat '?') menang atas 9.0; 18.0 di luar jendela.
    assert end == pytest.approx(14.0 + END_PAD)


def test_snap_uses_pause_gap():
    cues = [Cue(0.0, 4.0, "tanpa tanda baca"), Cue(5.0, 8.0, "tetap dianggap batas")]
    # Jeda 1.0s > PAUSE_GAP: awal cue kedua adalah batas kuat.
    start, _ = snap_window(cues, 6.0, 8.0, 1.0, 100.0)
    assert start == pytest.approx(5.0 - START_PAD)


def test_snap_out_of_window_keeps_value():
    cues = [Cue(10.0, 20.0, "kalimat.")]
    # 2.0 dan 12.0 jauh (8s) dari batas cue: tidak digeser, hanya kena bantalan.
    start, end = snap_window(cues, 2.0, 12.0, 1.0, 100.0)
    assert start == pytest.approx(2.0 - START_PAD)
    assert end == pytest.approx(12.0 + END_PAD)


def test_snap_pad_clamped_to_zero():
    start, _ = snap_window(_cues(), 0.05, 4.0, 1.0, 100.0)
    assert start == 0.0


def test_snap_end_clamped_to_transcript_end():
    cues = [Cue(0.0, 10.0, "satu kalimat panjang.")]
    _, end = snap_window(cues, 2.0, 9.95, 1.0, 100.0)
    assert end == pytest.approx(10.0)


def test_snap_duration_max_bound():
    cues = [Cue(i * 5.0, i * 5.0 + 5.0, "kalimat.") for i in range(4)]
    start, end = snap_window(cues, 5.0, 10.0, 1.0, 3.0)
    assert end - start <= 3.0 + 1e-9
    assert end > start


def test_snap_duration_min_bound():
    cues = [Cue(0.0, 60.0, "kalimat panjang sekali tanpa henti")]
    start, end = snap_window(cues, 10.0, 12.0, 30.0, 100.0)
    # Cue tunggal: snap gagal menemukan batas dalam, durasi dijaga >= min.
    assert end - start >= 30.0 - 1e-9
    assert end <= 60.0


def test_snap_windows_trims_overlap():
    cues = [Cue(i * 5.0, i * 5.0 + 5.0, "kalimat.") for i in range(4)]
    windows = [(5.0, 15.0), (10.0, 20.0)]
    result = snap_windows(cues, windows, 1.0, 100.0)
    starts = [start for start, _ in result]
    # Jendela kedua ditarik ke end jendela pertama, urutan input dipertahankan.
    assert starts[1] == pytest.approx(result[0][1])


def test_snap_windows_no_cues_passthrough():
    assert snap_windows([], [(1.0, 2.0), (3.0, 4.0)], 1.0, 10.0) == [(1.0, 2.0), (3.0, 4.0)]


# --- Batas akhir: utamakan kalimat/jeda selesai, bukan cue arbitrer ---


def test_snap_end_extends_to_sentence_boundary_beyond_window():
    cues = [
        Cue(0.0, 2.0, "intro."),
        Cue(2.0, 6.0, "dan kemudian dia"),
        Cue(6.0, 9.0, "mulai bercerita"),
        Cue(9.0, 10.0, "tentang masa kecilnya."),
        Cue(10.0, 13.0, "sisa transkrip."),
    ]
    _, end = snap_window(cues, 1.0, 5.0, 1.0, 100.0)
    # Target jatuh di tengah pemikiran: batas kuat 10.0 (kalimat selesai,
    # 5s dari target, di luar SNAP_WINDOW) menang atas cue arbitrer 6.0.
    assert end == pytest.approx(10.0 + END_PAD)


def test_snap_end_extends_to_pause_boundary_beyond_window():
    cues = [
        Cue(0.0, 3.0, "tanpa tanda baca"),
        Cue(3.0, 6.0, "masih satu pemikiran"),
        Cue(6.0, 9.0, "cerita berlanjut"),
        Cue(9.5, 11.0, "topik baru"),  # jeda 0.5s >= PAUSE_GAP setelah 9.0
    ]
    _, end = snap_window(cues, 1.0, 5.0, 1.0, 100.0)
    # Jeda 0.5s dianggap batas pemikiran: end ditarik ke 9.0, bukan 6.0.
    assert end == pytest.approx(9.0 + END_PAD)


def test_snap_end_without_strong_keeps_nearby_cue():
    cues = [Cue(i * 5.0, i * 5.0 + 5.0, "tanpa titik") for i in range(4)]
    _, end = snap_window(cues, 0.0, 8.0, 1.0, 100.0)
    # Tidak ada batas kuat sama sekali: jatuh ke cue terdekat (10.0),
    # tidak memaksakan geseran jauh.
    assert end == pytest.approx(10.0 + END_PAD)


def test_snap_end_extension_respects_max_duration():
    cues = [
        Cue(0.0, 5.0, "intro."),
        Cue(5.0, 9.9, "isi tanpa titik"),
        Cue(10.0, 11.0, "payoff."),
    ]
    start, end = snap_window(cues, 4.0, 8.0, 1.0, 5.0)
    # End tetap sampai kalimat selesai (cue 11.0 = akhir transkrip,
    # pad di-clamp), durasi maksimum dijaga.
    assert end == pytest.approx(11.0)
    assert end - start <= 5.0 + 1e-9


def test_snap_end_never_exceeds_transcript_end():
    cues = [Cue(0.0, 9.9, "hampir akhir"), Cue(10.0, 12.0, "kalimat penutup.")]
    _, end = snap_window(cues, 1.0, 9.0, 1.0, 100.0)
    assert end <= cues[-1].end + 1e-9
    assert end == pytest.approx(12.0)
