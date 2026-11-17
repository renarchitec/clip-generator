import pytest

from clipper.subtitles import Cue, parse_vtt, sanitize, split_long_cues, write_ass

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


def test_write_ass_has_styles_and_centisecond_dialogue():
    ass = write_ass([Cue(1.0, 4.25, "Halo dunia")], 1080, 1920, 64, 180)

    assert "[Script Info]" in ass
    assert "[V4+ Styles]" in ass
    assert "Style: Default" in ass
    assert "Outline" in ass
    assert "[Events]" in ass
    assert "Dialogue: 0,0:00:01.00,0:00:04.25,Default,,0,0,0,,Halo dunia" in ass


def test_write_ass_wraps_long_text_and_escapes_braces():
    long_text = " ".join(["kata"] * 30)
    ass = write_ass([Cue(0.0, 2.0, long_text + " {kurung}")], 1080, 1920, 64, 180)
    dialogue = [line for line in ass.splitlines() if line.startswith("Dialogue:")]

    assert len(dialogue) == 1
    assert "\\N" in dialogue[0]
    assert "\\{kurung}" in dialogue[0]


def test_write_ass_skips_invalid_cues():
    assert "Dialogue:" not in write_ass([Cue(2.0, 2.0, "kosong")], 1080, 1920, 64, 180)


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
