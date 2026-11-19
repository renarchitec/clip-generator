import pytest

from clipper.llm import fallback_moments, parse_llm_json
from clipper.models import JobParams
from clipper.subtitles import Cue


def _cues(count=40, step=3.0):
    return [Cue(i * step, i * step + step, "kata " * 8) for i in range(count)]


def test_parse_llm_json_fenced():
    raw = '```json\n[{"start": 1, "end": 5, "title": "A"}]\n```'
    assert parse_llm_json(raw) == [{"start": 1, "end": 5, "title": "A"}]


def test_parse_llm_json_prose_wrapped():
    raw = 'Berikut hasilnya:\n[{"start": 0, "end": 2, "title": "B"}]\nSemoga membantu.'
    assert parse_llm_json(raw)[0]["title"] == "B"


def test_parse_llm_json_wrapped_in_object():
    raw = '{"moments": [{"start": 2, "end": 9, "title": "C"}]}'
    assert parse_llm_json(raw)[0]["end"] == 9


def test_parse_llm_json_trailing_comma():
    raw = '[{"start": 0, "end": 2,},]'
    assert parse_llm_json(raw) == [{"start": 0, "end": 2}]


def test_parse_llm_json_invalid_raises():
    with pytest.raises(ValueError):
        parse_llm_json("maaf, saya tidak bisa membantu")
    with pytest.raises(ValueError):
        parse_llm_json("")
    with pytest.raises(ValueError):
        parse_llm_json('["bukan object"]')


def test_fallback_moments_count_and_bounds():
    cues = _cues()
    total = cues[-1].end
    params = JobParams(clip_count=3, target_duration_sec=30.0)

    moments = fallback_moments(cues, params)

    assert len(moments) == 3
    for moment in moments:
        assert 0.0 <= moment.start < moment.end <= total
        assert moment.title


def test_fallback_moments_fills_requested_count():
    cues = _cues()
    total = cues[-1].end

    moments = fallback_moments(cues, JobParams(clip_count=5, target_duration_sec=30.0))

    assert len(moments) == 5
    starts = [moment.start for moment in moments]
    assert starts == sorted(starts)
    for moment in moments:
        assert moment.end <= total


def test_fallback_moments_no_cues():
    assert fallback_moments([], JobParams()) == []


def test_fallback_moments_titles_use_timestamp_not_transcript():
    cues = [Cue(0.0, 30.0, "halo semua selamat datang"), Cue(30.0, 60.0, "lanjut")]
    moments = fallback_moments(cues, JobParams(clip_count=1, target_duration_sec=30.0))
    assert moments
    for moment in moments:
        assert moment.title.startswith("Clip ")
        assert "halo" not in moment.title
        assert moment.title.count(":") == 2
