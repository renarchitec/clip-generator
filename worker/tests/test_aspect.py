"""Uji rasio output (aspectRatio): parse model, filter ffmpeg, ASS PlayRes."""

import pytest

from clipper import pipeline, reframe
from clipper.models import ASPECT_RATIOS, DEFAULT_ASPECT, job_data_from_dict
from clipper.subtitles import Cue, write_ass


BASE = {"jobId": "abc", "url": "https://youtu.be/x"}


def test_job_data_aspect_ratio_defaults_and_tolerant_parse():
    assert job_data_from_dict(BASE).aspect_ratio == "9:16"
    for ratio in ASPECT_RATIOS:
        assert job_data_from_dict({**BASE, "aspectRatio": ratio}).aspect_ratio == ratio
    # Toleran: nilai tidak dikenal / hilang / bukan string -> default 9:16.
    assert job_data_from_dict({**BASE, "aspectRatio": "4:5"}).aspect_ratio == DEFAULT_ASPECT
    assert job_data_from_dict({**BASE, "aspectRatio": None}).aspect_ratio == DEFAULT_ASPECT
    assert job_data_from_dict({**BASE, "aspect_ratio": "1:1"}).aspect_ratio == "1:1"
    assert job_data_from_dict(BASE).to_dict()["aspectRatio"] == "9:16"


def test_output_sizes_per_ratio():
    assert pipeline.OUTPUT_SIZES["9:16"] == (1080, 1920)
    assert pipeline.OUTPUT_SIZES["1:1"] == (1080, 1080)
    assert pipeline.OUTPUT_SIZES["16:9"] == (1920, 1080)


def test_portrait_crop_filter_targets_1_1():
    chain = reframe.portrait_crop_filter(0.4, 1080, 1080)

    assert chain.startswith("crop=ih*1.00000:ih:0.40000*in_w-")
    assert chain.endswith("scale=1080:1080")


def test_cut_crop_filter_targets_1_1():
    chain = reframe.cut_crop_filter([(0.0, 0.4), (1.5, 0.6)], 1080, 1080)

    # Waktu 3 desimal (presisi shot-cut) — sebelumnya 2 desimal.
    assert "0.4000*gte(t,0.000)*lt(t,1.500)" in chain
    assert chain.endswith("scale=1080:1080")


def test_crop_filters_default_to_portrait_9_16():
    assert reframe.portrait_crop_filter(None).endswith("scale=1080:1920")
    assert reframe.cut_crop_filter([(0.0, 0.5)]).endswith("scale=1080:1920")


def test_reframe_filters_landscape_ignores_reframe():
    # 16:9: skala pas 1920x1080 + pad hitam; face detection tidak dipanggil.
    filters = pipeline._reframe_filters(
        "face_tracking", "x.mp4", pipeline.llm.Moment(0.0, 4.0, "t"), 1920, 1080, landscape=True
    )

    assert filters[0].startswith("scale=1920:1080")
    assert "pad=1920:1080" in filters[1]
    assert filters[-1] == "setsar=1"


def test_reframe_filters_1_1_centered_modes_use_square_target():
    moment = pipeline.llm.Moment(0.0, 4.0, "t")
    bars = pipeline._reframe_filters("black_bars", "x.mp4", moment, 1080, 1080)
    blur = pipeline._reframe_filters("blurred_fill", "x.mp4", moment, 1080, 1080)

    assert "scale=1080:1080" in bars[0] and "pad=1080:1080" in bars[1]
    assert "scale=1080:1080" in blur[0]
    assert "crop=1080:1080" in blur[0]


def test_write_ass_playres_follows_output_size():
    ass_1_1 = write_ass([Cue(0.0, 1.0, "halo")], 1080, 1080, 45, 101)
    ass_16_9 = write_ass([Cue(0.0, 1.0, "halo")], 1920, 1080, 45, 101)

    assert "PlayResX: 1080\nPlayResY: 1080" in ass_1_1
    assert "PlayResX: 1920\nPlayResY: 1080" in ass_16_9


def test_write_ass_wide_allows_longer_chunks():
    words = " ".join(f"w{i}" for i in range(6))
    cue = Cue(0.0, 3.0, words)
    default_ass = write_ass([cue], 1920, 1080, 45, 101)
    wide_ass = write_ass([cue], 1920, 1080, 45, 101, max_words=6, max_chars=32)

    def max_words_per_dialogue(ass: str) -> int:
        return max(
            len(line.split(",")[-1].split())
            for line in ass.splitlines()
            if line.startswith("Dialogue:")
        )

    # 16:9 memuat seluruh 6 kata dalam satu chunk; default 4 kata/chunk memecah.
    assert max_words_per_dialogue(wide_ass) == 6
    assert max_words_per_dialogue(default_ass) <= 4
