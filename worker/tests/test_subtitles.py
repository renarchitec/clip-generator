import pytest

from clipper.models import CaptionStyle
from clipper.pipeline import _clip_cues
from clipper.subtitles import (
    Cue,
    Word,
    clip_words,
    hex_to_ass_color,
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


@pytest.mark.parametrize(("raw", "expected"), [
    ({"positionY": 0.123456}, 0.1235), ({"position_y": 0.4}, 0.4),
    ({"positionY": -1}, 0.05), ({"positionY": 2}, 0.95),
    ({}, None), ({"positionY": True}, None), ({"positionY": "0.4"}, None),
    ({"positionY": float("nan")}, None), ({"positionY": float("inf")}, None),
])
def test_caption_style_parses_position_y(raw, expected):
    style = CaptionStyle.from_dict(raw)
    assert style.position_y == expected
    assert CaptionStyle.from_dict(style.to_dict()) == style


@pytest.mark.parametrize("two_speakers", [False, True])
def test_write_ass_positions_every_dialogue_at_custom_y(two_speakers):
    style = CaptionStyle.from_dict({"position": "top", "positionY": 0.4})
    ass = write_ass([Cue(0, 2, "dua kata")], style=style, two_speakers=two_speakers)
    style_fields = next(line for line in ass.splitlines() if line.startswith("Style:")).split(",")
    assert style_fields[18:22] == ["5", "80", "80", "0"]
    dialogue = [line.split(",", 9)[-1] for line in ass.splitlines() if line.startswith("Dialogue:")]
    assert len(dialogue) == 2
    assert all(text.startswith(r"{\an5\pos(540,768)}") for text in dialogue)
    assert dialogue[0].startswith(r"{\an5\pos(540,768)}{\c")


def test_write_ass_without_custom_y_keeps_legacy_placement():
    style = CaptionStyle.from_dict({"position": "top", "animate": False})
    ass = write_ass([Cue(0, 2, "dua kata")], style=style)
    style_fields = next(line for line in ass.splitlines() if line.startswith("Style:")).split(",")
    assert style_fields[18:22] == ["8", "80", "80", "230"]
    assert r"\pos(" not in ass
    assert r",,{\c&H0000FFFF&}DUA{\c&H00FFFFFF&} KATA" in ass


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
    pop = r"{\c&H0000FFFF&\fscx110\fscy110\t(0,120,\fscx100\fscy100)}"
    restore = r"{\c&H00FFFFFF&\fscx100\fscy100}"
    assert f"{pop}HALO{restore} DUNIA" in dialogue[0]
    assert f"HALO {pop}DUNIA{restore}" in dialogue[1]
    assert r"\r" not in ass


def test_write_ass_two_speakers_aligns_middle_centre_without_margin():
    ass = write_ass([Cue(0.0, 1.0, "halo")], 1080, 1920, 80, 180, two_speakers=True)
    style = [line for line in ass.splitlines() if line.startswith("Style:")][0]

    assert ",1,6,2,5,80,80,0,1" in style  # Alignment 5 (tengah), MarginV 0


def test_write_ass_keeps_inline_word_timings_and_escapes_braces():
    words = [Word(0.0, 0.5, "kata"), Word(0.5, 1.2, "{kurung}")]
    style = CaptionStyle.from_dict({"preset": "hook", "animate": False})
    ass = write_ass([Cue(0.0, 1.2, "kata {kurung}", words=words)], 1080, 1920, 80, 180, style=style)
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


def test_parse_vtt_youtube_rolling_cues_and_silence():
    vtt = (
        "WEBVTT\n\n"
        "00:02:41.000 --> 00:02:43.000\n \nDean<00:02:42.239><c> KT.</c>\n\n"
        "00:02:43.000 --> 00:02:43.010\nDean KT.\n\n"
        "00:02:43.010 --> 00:02:50.000\nDean KT.\nAku<00:02:43.500><c> pergi</c>\n\n"
        "00:02:50.000 --> 00:02:50.010\npergi\n\n"
        "00:02:51.599 --> 00:02:55.550\n \nLiburkah<00:02:52.080><c> kita?</c>\n\n"
        "00:02:58.000 --> 00:02:58.500\n \nYa.\n\n"
        "00:03:01.000 --> 00:03:10.000\n \n<00:03:01.250><c> Nah.</c>\n"
    )
    cues = parse_vtt(vtt, word_level=True)

    assert cues == [
        Cue(161, 163, "Dean KT.", [Word(161, 162.239, "Dean"), Word(162.239, 163, "KT.")]),
        Cue(163.01, 164.7, "Aku pergi", [Word(163.01, 163.5, "Aku"), Word(163.5, 164.7, "pergi")]),
        Cue(171.599, 173.28, "Liburkah kita?", [Word(171.599, 172.08, "Liburkah"), Word(172.08, 173.28, "kita?")]),
        Cue(178, 178.5, "Ya."),
        Cue(181.25, 182.45, "Nah.", [Word(181.25, 182.45, "Nah.")]),
    ]
    assert parse_vtt(vtt)[0].text == "Dean KT."


def test_parse_vtt_word_level_moves_start_after_trimming_overlap():
    vtt = (
        "WEBVTT\n\n"
        "00:00:01.000 --> 00:00:02.000\nHalo<00:00:01.500><c> semua</c>\n\n"
        "00:00:02.000 --> 00:00:03.000\nsemua<00:00:02.500><c> datang</c>\n"
    )
    assert parse_vtt(vtt, word_level=True)[1] == Cue(2.5, 3, "datang", [Word(2.5, 3, "datang")])


def test_parse_vtt_note_can_contain_whitespace_only_line():
    vtt = (
        "WEBVTT\n\nNOTE\n \n00:00:01.000 --> 00:00:02.000\nignored\n\n"
        "00:00:02.000 --> 00:00:03.000\nspoken\n"
    )
    assert parse_vtt(vtt) == [Cue(2, 3, "spoken")]


def test_sanitize_filters_annotations_and_censors_but_keeps_speech():
    source = (
        "Halo [tertawa] [Musik] [tepuk tangan] [Laughter] [&nbsp;__&nbsp;] [ __ ] "
        "(tertawa) (APPLAUSE) (clears throat) (_) (***) ♪♫♬♩ f*** an***g __ *** "
        "b*tch! -*ck- ? , {kurung} &amp; (katanya) 2*3 &lt;3 &gt;2 &#39;ya&#39; &quot;oke&quot;"
    )
    assert sanitize(source) == "Halo {kurung} & (katanya) 2*3 <3 >2 'ya' \"oke\""


@pytest.mark.parametrize("hidden", ["[&nbsp;__&nbsp;]", "[tertawa]", "(tepuk tangan)", "f***!", "__", "♪"])
def test_parse_vtt_filters_timed_tokens_without_stretching_neighbors(hidden):
    vtt = (
        "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nrollup\n"
        f"{hidden}<00:00:01.500><c> sebelum</c><00:00:02.000><c> {hidden}</c>"
        "<00:00:02.500><c> sesudah</c><00:00:03.000><c> [Musik]</c>\n"
    )
    assert parse_vtt(vtt, word_level=True) == [
        Cue(1.5, 3, "sebelum sesudah", [Word(1.5, 2, "sebelum"), Word(2.5, 3, "sesudah")])
    ]


def test_parse_vtt_drops_fully_filtered_tagged_line_without_falling_back_to_rollup():
    vtt = (
        "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nprevious caption\n"
        "[Musik]<00:00:02.000><c> [__]</c><00:00:03.000><c> f***</c>\n"
    )
    assert parse_vtt(vtt, word_level=True) == []


@pytest.mark.parametrize("cue", [
    Cue(0, 2, "[tertawa] halo [ __ ]"),
    Cue(0, 2, "[tertawa] halo [ __ ]", [
        Word(0, 0.5, "[tertawa]"), Word(0.5, 1, "halo"), Word(1, 1.2, "["),
        Word(1.2, 1.4, "__"), Word(1.4, 2, "]"),
    ]),
])
def test_write_ass_defensively_filters_annotations(cue):
    dialogue = [line for line in write_ass([cue]).splitlines() if line.startswith("Dialogue:")]
    assert len(dialogue) == 1
    assert "HALO" in dialogue[0]
    assert "[" not in dialogue[0] and "]" not in dialogue[0] and "__" not in dialogue[0]
    if cue.words:
        assert "0:00:00.50,0:00:01.00" in dialogue[0]


@pytest.mark.parametrize("timed", [True, False])
def test_clip_cues_keeps_only_words_in_window(timed):
    words = [Word(i, i + 1, text) for i, text in enumerate("aa bb cc dd".split())]
    cue = Cue(0, 4, "aa bb cc dd", words if timed else [])
    assert _clip_cues([cue], 1.5, 2.5) == [
        Cue(0, 1, "bb cc", [Word(0, 0.5, "bb"), Word(0.5, 1, "cc")])
    ]


def test_clip_cues_drops_silence_only_and_uses_word_bounds():
    silent_overlap = Cue(0, 20, "dulu", [Word(0, 2, "dulu")])
    spoken_overlap = Cue(2, 20, "sekarang", [Word(6, 7, "sekarang")])
    assert _clip_cues([silent_overlap, spoken_overlap], 5, 9) == [
        Cue(1, 2, "sekarang", [Word(1, 2, "sekarang")])
    ]


def test_clip_words_shifts_to_zero_and_drops_out_of_window():
    cues = [Cue(0.0, 4.0, "satu dua tiga empat")]
    words = clip_words(cues, 1.0, 3.0)

    # Kata yang mulai sebelum jendela berakhir tetap ikut, dipotong di batas clip.
    assert [(w.text, round(w.start, 2), round(w.end, 2)) for w in words] == [
        ("dua", 0.0, 0.8),
        ("tiga", 0.8, 1.8),
        ("empat", 1.8, 2.0),
    ]


def test_caption_style_parses_presets_custom_values_and_clamps():
    hook = CaptionStyle.from_dict({"preset": "hook"})
    assert hook and hook.to_dict()["preset"] == "hook"
    custom = CaptionStyle.from_dict({"preset": "hook", "fontFamily": "Bangers", "fontSize": 999, "primaryColor": "#aabbcc", "highlightColor": "bad"})
    assert custom and custom.preset == "custom"
    assert custom.font_family == "Bangers" and custom.font_size == 120
    assert custom.primary_color == "#AABBCC" and custom.highlight_color == "#FFFF00"
    assert CaptionStyle.from_dict(["hook"]) is None


def test_hex_to_ass_color_uses_ass_bgr_order():
    assert hex_to_ass_color("#FFFFFF") == "&H00FFFFFF"
    assert hex_to_ass_color("#FFFF00") == "&H0000FFFF"
    assert hex_to_ass_color("#123456", 0x60) == "&H60563412"


@pytest.mark.parametrize("position,alignment", [("top", 8), ("center", 5), ("bottom", 2)])
def test_write_ass_custom_style_applies_font_colors_case_effect_and_position(position, alignment):
    style = CaptionStyle.from_dict({"preset": "hook", "fontFamily": "Bangers", "uppercase": False, "effect": "box", "position": position, "animate": False, "primaryColor": "#112233", "highlightColor": "#445566"})
    assert style
    ass = write_ass([Cue(0.0, 1.0, "Halo dunia")], style=style)
    assert "Style: Default,Bangers,68,&H00332211,&H00665544," in ass
    assert f",3,14,0,{alignment},80,80," in ass
    dialogue = next(line for line in ass.splitlines() if line.startswith("Dialogue:"))
    assert "{\\c&H00665544&}Halo{\\c&H00332211&} dunia" in dialogue


def test_parse_vtt_splits_tied_inline_timestamps_and_drops_10ms_suffix_snapshot():
    vtt = (
        "WEBVTT\n\n"
        "00:00:01.000 --> 00:00:02.000\n"
        "awal<00:00:01.500><c> kata</c>\n\n"
        "00:00:02.000 --> 00:00:03.200\n"
        "awal kata\n"
        "kata<00:00:02.400><c> ada ada</c><00:00:03.000><c> lagi</c>\n\n"
        "00:00:03.200 --> 00:00:03.210\n"
        "kata ada ada lagi\n"
        " \n"
    )
    cues = parse_vtt(vtt, word_level=True)

    assert [cue.text for cue in cues] == ["awal kata", "ada ada lagi"]
    assert all(word.end > word.start for cue in cues for word in cue.words)
    assert cues[1].words[0].start == pytest.approx(2.4)
    assert cues[1].words[0].end == pytest.approx(2.7)
    assert cues[1].words[1].start == pytest.approx(2.7)
    assert cues[1].words[1].end == pytest.approx(3.0)
