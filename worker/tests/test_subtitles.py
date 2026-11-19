import pytest

from clipper.subtitles import (
    Cue,
    Word,
    clip_words,
    cue_to_words,
    parse_vtt,
    sanitize,
    split_long_cues,
    write_ass,
)

SAMPLE_VTT = """WEBVTT
Kind: captions
Language: id

NOTE ini catatan
baris kedua catatan

STYLE
::cue { color: yellow }

1
00:00:01.000 --> 00:00:04.500 align:start position:10%
Halo <c>semua</c>

2
00:00:05.000 --> 00:00:07.000
<00:00:05.500>kita mulai
"""


def test_parse_vtt_skips_header_note_style_and_tags():
    cues = parse_vtt(SAMPLE_VTT)

    assert len(cues) == 2
    assert cues[0].start == pytest.approx(1.0)
    assert cues[0].end == pytest.approx(4.5)
    assert cues[0].text == "Halo semua"
    assert cues[1].start == pytest.approx(5.0)
    assert cues[1].end == pytest.approx(7.0)
    assert cues[1].text == "kita mulai"


def test_parse_vtt_timestamp_without_hours():
    cues = parse_vtt("WEBVTT\n\n00:12.000 --> 00:15.500\nHalo dunia\n")

    assert len(cues) == 1
    assert cues[0].start == pytest.approx(12.0)
    assert cues[0].end == pytest.approx(15.5)
    assert cues[0].text == "Halo dunia"


def test_parse_vtt_drops_empty_cues_and_accepts_comma_fraction():
    vtt = (
        "WEBVTT\n\n"
        "00:00:01.000 --> 00:00:02.000\n<i></i>\n\n"
        "00:00:03,250 --> 00:00:04,750\nisi cue\n"
    )
    cues = parse_vtt(vtt)

    assert len(cues) == 1
    assert cues[0].start == pytest.approx(3.25)
    assert cues[0].text == "isi cue"


def test_parse_vtt_empty_input():
    assert parse_vtt("") == []


def test_sanitize_strips_tags_and_collapses_whitespace():
    assert sanitize(" <i>Halo</i>\n\n  dunia  ") == "Halo dunia"
    assert sanitize("<c></c>") == ""
    assert sanitize("") == ""
    assert sanitize("a &amp; b") == "a & b"


def test_write_ass_styles_hook_captions_one_event_per_word():
    ass = write_ass([Cue(1.0, 4.25, "Halo dunia")], 1080, 1920, 80, 180)

    assert "[Script Info]" in ass
    assert "[V4+ Styles]" in ass
    assert "[Events]" in ass
    # Font Anton besar, outline hitam 6px, shadow lembut.
    assert "Style: Default,Anton,80," in ass
    assert ",1,6,2,2,80,80," in ass  # BorderStyle, Outline, Shadow, Alignment(2=bawah)
    # Satu Dialogue per jendela kata, bukan satu event karaoke \k.
    dialogue = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
    assert len(dialogue) == 2
    assert "0:00:01.00,0:00:02.48" in dialogue[0]
    assert "0:00:02.48,0:00:04.25" in dialogue[1]
    # UPPERCASE + hanya kata aktif yang kuning.
    assert "{\\c&H0000FFFF&}HALO{\\c&H00FFFFFF&} DUNIA" in dialogue[0]
    assert "HALO {\\c&H0000FFFF&}DUNIA{\\c&H00FFFFFF&}" in dialogue[1]


def test_write_ass_two_speakers_aligns_middle_centre_without_margin():
    ass = write_ass([Cue(0.0, 1.0, "halo")], 1080, 1920, 80, 180, two_speakers=True)
    style = [line for line in ass.splitlines() if line.startswith("Style:")][0]

    assert ",1,6,2,5,80,80,0,1" in style  # Alignment 5 (tengah), MarginV 0


def test_write_ass_keeps_inline_word_timings_and_escapes_braces():
    words = [Word(0.0, 0.5, "kata"), Word(0.5, 1.2, "{kurung}")]
    ass = write_ass([Cue(0.0, 1.2, "kata {kurung}", words=words)], 1080, 1920, 80, 180)
    dialogue = [line for line in ass.splitlines() if line.startswith("Dialogue:")]

    assert len(dialogue) == 2
    assert "{\\c&H0000FFFF&}KATA{\\c&H00FFFFFF&} \\{KURUNG}" in dialogue[0]
    assert "KATA {\\c&H0000FFFF&}\\{KURUNG}{\\c&H00FFFFFF&}" in dialogue[1]


def test_write_ass_word_events_never_overlap():
    words = [Word(0.0, 0.5, "a"), Word(0.5, 0.7, "b"), Word(0.7, 1.0, "c")]
    ass = write_ass([Cue(0.0, 1.0, "a b c", words=words)], 1080, 1920, 80, 180)
    spans = [
        (line.split(",")[1], line.split(",")[2])
        for line in ass.splitlines()
        if line.startswith("Dialogue:")
    ]

    assert len(spans) == 3
    for (_, end), (next_start, _) in zip(spans, spans[1:]):
        assert end <= next_start


def test_write_ass_skips_invalid_cues():
    assert "Dialogue:" not in write_ass([Cue(2.0, 2.0, "kosong")], 1080, 1920, 80, 180)


def test_split_long_cues_splits_by_duration_and_keeps_words():
    cue = Cue(0.0, 10.0, "satu dua tiga empat lima enam tujuh delapan sembilan sepuluh")
    parts = split_long_cues([cue], max_chars=42, max_duration=4.0)

    assert len(parts) == 3
    assert parts[0].start == pytest.approx(0.0)
    assert parts[-1].end == pytest.approx(10.0)
    assert [word for part in parts for word in part.text.split()] == cue.text.split()
    for part in parts:
        assert part.end > part.start


def test_split_long_cues_leaves_short_cue_alone():
    cue = Cue(0.0, 3.0, "halo dunia")
    assert split_long_cues([cue]) == [cue]


def test_parse_vtt_word_level_reads_inline_timestamps():
    vtt = (
        "WEBVTT\n\n"
        "00:00:01.000 --> 00:00:03.000\n"
        "<00:00:01.000><c>halo</c> <00:00:02.000><c>dunia</c>\n"
    )
    cues = parse_vtt(vtt, word_level=True)

    assert len(cues) == 1
    assert cues[0].text == "halo dunia"
    assert [(w.text, w.start, w.end) for w in cues[0].words] == [
        ("halo", 1.0, 2.0),
        ("dunia", 2.0, 3.0),
    ]


def test_parse_vtt_word_level_falls_back_to_plain_cue():
    cues = parse_vtt("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nhalo dunia\n", word_level=True)

    assert len(cues) == 1
    assert cues[0].words == []


def test_cue_to_words_splits_duration_weighted_by_length():
    words = cue_to_words(Cue(0.0, 4.0, "a bbbbbbb"))

    assert len(words) == 2
    assert [w.text for w in words] == ["a", "bbbbbbb"]
    # "a" (bobot 2) < "bbbbbbb" (bobot 8)
    assert words[0].end < 1.5
    assert words[-1].end == pytest.approx(4.0)


def test_parse_vtt_dedupes_rolling_auto_subs():
    vtt = (
        "WEBVTT\n\n"
        "00:00:01.000 --> 00:00:02.000\nhalo semua\n\n"
        "00:00:02.000 --> 00:00:03.500\nsemua selamat datang\n"
    )
    cues = parse_vtt(vtt, word_level=True)

    assert len(cues) == 2
    assert cues[0].text == "halo semua"
    # "semua" yang overlap tidak diulang
    assert cues[1].text == "selamat datang"


def test_clip_words_shifts_to_zero_and_drops_out_of_window():
    cues = [Cue(0.0, 4.0, "satu dua tiga empat")]
    words = clip_words(cues, 1.0, 3.0)

    # Kata yang mulai sebelum jendela berakhir tetap ikut, dipotong di batas clip.
    assert [(w.text, round(w.start, 2), round(w.end, 2)) for w in words] == [
        ("dua", 0.0, 0.8),
        ("tiga", 0.8, 1.8),
        ("empat", 1.8, 2.0),
    ]
