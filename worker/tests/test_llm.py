import pytest

from clipper import llm
from clipper.llm import fallback_moments, parse_llm_json, select_moments
from clipper.models import JobParams
from clipper.snap import END_PAD, START_PAD
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


# --- Pass refinement LLM + snap deterministik ---

ENV_LLM = {"LLM_BASE_URL": "http://x", "LLM_API_KEY": "k", "LLM_MODEL": "m"}

PASS1 = '[{"start": 10.0, "end": 40.0, "title": "A", "reason": "r"}]'


def _cues_boundaries():
    """Cue dengan batas kalimat jelas pada 0, 12, 42, 60."""
    return [
        Cue(0.0, 12.0, "pembuka."),
        Cue(12.0, 42.0, "isi utama?"),
        Cue(42.0, 60.0, "penutup."),
    ]


def _run(monkeypatch, responses, env):
    """select_moments dengan _complete palsu; kembalikan (moments, jumlah panggilan)."""
    calls = []

    def fake_complete(base_url, api_key, model, prompt, temperature, has_brief=False):
        calls.append(prompt)
        return responses[len(calls) - 1] if len(calls) <= len(responses) else responses[-1]

    monkeypatch.setattr(llm, "_complete", fake_complete)
    moments = select_moments(_cues_boundaries(), JobParams(clip_count=1, target_duration_sec=30.0), env)
    return moments, len(calls)


def test_select_moments_refine_and_snap(monkeypatch):
    refined = '[{"index": 0, "start": 12.0, "end": 42.0}]'
    moments, calls = _run(monkeypatch, [PASS1, refined], ENV_LLM)

    assert calls == 2
    # Snap: start 12.0 -> awal cue 12.0 minus pad; end 42.0 -> akhir cue 42.0 plus pad.
    assert moments[0].start == pytest.approx(12.0 - START_PAD, abs=0.01)
    assert moments[0].end == pytest.approx(42.0 + END_PAD, abs=0.01)


def test_select_moments_refine_disabled_keeps_pass1(monkeypatch):
    moments, calls = _run(monkeypatch, [PASS1], {**ENV_LLM, "LLM_REFINE": "0"})

    assert calls == 1
    # Tanpa refinement; snap tetap jalan: tidak ada batas cue dekat 10.0.
    assert moments[0].start == pytest.approx(10.0 - START_PAD, abs=0.01)


def test_select_moments_refine_invalid_kept_pass1(monkeypatch):
    # Durasi 500 tidak dalam batas target: refinement ditolak, pass-1 dipakai.
    refined = '[{"index": 0, "start": 5.0, "end": 505.0}]'
    moments, calls = _run(monkeypatch, [PASS1, refined], ENV_LLM)

    assert calls == 2
    assert moments[0].start == pytest.approx(10.0 - START_PAD, abs=0.01)
    assert moments[0].end == pytest.approx(42.0 + END_PAD, abs=0.01)


def test_select_moments_refine_error_kept_pass1(monkeypatch):
    calls = []

    def flaky(base_url, api_key, model, prompt, temperature, has_brief=False):
        calls.append(prompt)
        if len(calls) == 1:
            return PASS1
        raise RuntimeError("timeout")

    monkeypatch.setattr(llm, "_complete", flaky)
    moments = select_moments(_cues_boundaries(), JobParams(clip_count=1, target_duration_sec=30.0), ENV_LLM)

    # Pass-2 gagal -> pass-1 tetap dipakai (tanpa error ke atas), lalu di-snap.
    assert len(calls) == 2
    assert moments[0].end == pytest.approx(42.0 + END_PAD, abs=0.01)


def test_select_moments_refine_prompt_contains_brief(monkeypatch):
    calls = []
    refined = '[{"index": 0, "start": 12.0, "end": 42.0}]'

    def fake_complete(base_url, api_key, model, prompt, temperature, has_brief=False):
        calls.append(prompt)
        return [PASS1, refined][len(calls) - 1]

    monkeypatch.setattr(llm, "_complete", fake_complete)
    moments = select_moments(
        _cues_boundaries(),
        JobParams(clip_count=1, target_duration_sec=30.0),
        ENV_LLM,
        description="momen tentang membangun kebiasaan baru",
    )

    assert len(calls) == 2
    assert "<preferensi>" in calls[1]
    assert "membangun kebiasaan baru" in calls[1]
    assert "relevan" in calls[1]
    # Pass-2 gagal harusnya tidak terjadi: refinement valid tetap dipakai.
    assert moments[0].start == pytest.approx(12.0 - START_PAD, abs=0.01)


def test_refine_prompt_without_brief_omits_block():
    from clipper.llm import Moment, _refine_prompt

    prompt = _refine_prompt(
        _cues_boundaries(),
        [Moment(start=10.0, end=40.0, title="A")],
        JobParams(clip_count=1, target_duration_sec=30.0),
    )
    assert "<preferensi>" not in prompt


def test_refine_items_out_of_window_rejected():
    from clipper.llm import Moment, _refine_items

    cues = _cues_boundaries()
    moments = [Moment(start=10.0, end=40.0, title="A")]
    items = [
        {"index": 0, "start": 11.0, "end": 39.0},  # valid
        {"index": 0, "start": 5.0, "end": 500.0},  # invalid, diabaikan
    ]
    result = _refine_items(items, cues, moments, JobParams(clip_count=1, target_duration_sec=30.0))
    assert result[0].start == 11.0
    assert result[0].end == 39.0


def test_refine_items_nonfinite_rejected():
    from clipper.llm import Moment, _refine_items

    cues = _cues_boundaries()
    moments = [Moment(start=10.0, end=40.0, title="A")]
    result = _refine_items(
        [{"index": 0, "start": "NaN", "end": 39.0}],
        cues,
        moments,
        JobParams(clip_count=1, target_duration_sec=30.0),
    )
    assert result[0].start == 10.0
    assert result[0].end == 40.0
