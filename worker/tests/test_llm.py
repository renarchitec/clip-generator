import json
import re
from threading import Barrier

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


@pytest.mark.parametrize(
    ("all_moments", "expected"),
    [(True, [(40, 95), (80, 85), (0, 75)]), (False, [(40, 95), (80, 85)])],
)
def test_validate_moments_keeps_ranked_non_overlapping_candidates(all_moments, expected):
    items = [
        {"start": 30, "end": 60, "viralScore": 80},  # overlaps the stronger moment at 40
        {"start": 0, "end": 30, "viralScore": 75},
        {"start": 80, "end": 110, "viralScore": 85},
        {"start": 40, "end": 70, "viralScore": 95},
        {"start": 110, "end": 140, "viralScore": 100},  # outside the transcript
    ]
    params = JobParams(clip_count=2, target_duration_sec=30.0)

    moments = llm.validate_moments(items, _cues(), params, all_moments=all_moments)

    assert [(moment.start, moment.viral_score) for moment in moments] == expected


def test_validate_all_unscored_moments_resolves_overlaps_by_start_without_count_warning(caplog):
    items = [{"start": 10, "end": 40}, {"start": 0, "end": 30}, {"start": 50, "end": 80}]
    params = JobParams(clip_count=3, target_duration_sec=30.0)

    moments = llm.validate_moments(items, _cues(), params, all_moments=True)

    assert [moment.start for moment in moments] == [0, 50]
    assert "LLM hanya menghasilkan" not in caplog.text


def test_build_prompt_only_caps_auto_mode():
    params = JobParams(clip_count=2, target_duration_sec=30.0)
    cues = _cues()

    preview = llm._build_prompt(cues, params, all_moments=True)
    auto = llm._build_prompt(cues, params, all_moments=False)

    assert "SEMUA kandidat momen kuat" in preview
    assert "seluruh transkrip" in preview
    assert "4 kandidat momen" not in preview
    assert "sistem memilih" not in preview
    assert "Kembalikan 4 kandidat momen dari transkrip" in auto
    assert "sistem memilih 2 terbaik" in auto


def _continuous_cues(count=1200):
    return [Cue(i * 3.0, (i + 1) * 3.0, f"cue {i}: " + "kata " * 15) for i in range(count)]


def _window_cues(count, text="kalimat."):
    return [Cue(i * 90.0, i * 90.0 + 45.0, text) for i in range(count)]


def test_build_scan_chunks_continuous_preserves_transcript_with_overlap():
    cues = _continuous_cues()
    chunks = llm._build_scan_chunks(cues)

    assert 1 < len(chunks) <= llm.MAX_SCAN_CHUNKS
    assert chunks[0].start == cues[0].start
    assert chunks[-1].end == cues[-1].end
    for left, right in zip(chunks, chunks[1:]):
        assert left.start < right.start < left.end < right.end
        assert left.end - right.start == llm.CHUNK_OVERLAP_SEC
    seen = dict.fromkeys(line for chunk in chunks for line in chunk.text.splitlines())
    assert list(seen) == llm._transcript_text(cues, max_chars=200_000).splitlines()


def test_build_scan_chunks_caps_long_continuous_scan():
    cues = _continuous_cues(10_000)
    chunks = llm._build_scan_chunks(cues)

    assert len(chunks) == llm.MAX_SCAN_CHUNKS
    assert all(len(chunk.text) <= llm.MAX_SINGLE_CHUNK_CHARS for chunk in chunks)
    assert chunks[-1].end == cues[-1].end
    assert chunks[-1].text.endswith(llm._transcript_text(cues[-1:]))


def test_build_scan_chunks_batches_twelve_short_windows():
    cues = _window_cues(12)
    chunks = llm._build_scan_chunks(cues)

    assert [len(chunk.segment_ranges) for chunk in chunks] == [4, 4, 4]
    assert [window for chunk in chunks for window in chunk.segment_ranges] == [
        (cue.start, cue.end) for cue in cues
    ]
    assert chunks[0].text.startswith("=== Segmen 1 (00:00–00:45 / 0.0–45.0s) ===\n")
    assert "=== Segmen 12 (16:30–17:15 / 990.0–1035.0s) ===" in chunks[-1].text
    prompt = llm._build_prompt(cues, JobParams(), chunk=chunks[-1], chunk_index=3, total_chunks=3)
    assert "Batch 3/3" in prompt
    assert "evaluasi SETIAP segmen satu per satu" in prompt
    assert "720.0 sampai 1035.0" in prompt
    example, = re.findall(r"^\[\{.*\}\]$", prompt, re.MULTILINE)
    assert len(json.loads(example)) == 2


def test_build_scan_chunks_splits_batches_at_character_target():
    chunks = llm._build_scan_chunks(_window_cues(5, text="x" * 10_000))
    assert [len(chunk.segment_ranges) for chunk in chunks] == [3, 2]
    assert all(len(chunk.text) <= llm.CHUNK_TARGET_CHARS for chunk in chunks)


def test_select_moments_rejects_candidates_outside_segments_and_retries_single_batch(monkeypatch):
    attempts = []

    def fake_complete(base_url, api_key, model, prompt, temperature, has_brief=False):
        attempts.append(temperature)
        candidates = [
            {"start": 35, "end": 95, "title": "Across segments", "viralScore": 100},
            {"start": 50, "end": 80, "title": "In the gap", "viralScore": 99},
            {"start": 84, "end": 114, "title": "Outside tolerance", "viralScore": 98},
        ]
        if temperature == 0.0:
            candidates.append({"start": 85, "end": 115, "title": "Inside tolerance"})
        return json.dumps(candidates)

    monkeypatch.setattr(llm, "_complete", fake_complete)
    moments = select_moments(
        _window_cues(2), JobParams(clip_count=1, target_duration_sec=30),
        {**ENV_LLM, "LLM_REFINE": "0"}, all_moments=True,
    )

    assert attempts == [0.2, 0.0]
    assert [moment.title for moment in moments] == ["Inside tolerance"]


@pytest.mark.parametrize(
    "all_moments, expected",
    [(True, ["Best overlap", "Early", "Late"]), (False, ["Best overlap", "Early"])],
)
def test_select_moments_merges_parallel_chunks_and_deduplicates(monkeypatch, all_moments, expected):
    cues = _continuous_cues(500)
    first, second = llm._build_scan_chunks(cues)
    shared_start = second.start + 12
    barrier = Barrier(2, timeout=5)
    attempts = {1: [], 2: []}

    def fake_complete(base_url, api_key, model, prompt, temperature, has_brief=False):
        index = 1 if "Bagian 1/2" in prompt else 2
        attempts[index].append(temperature)
        if temperature == 0.2:
            barrier.wait()
            if index == 2:
                return "invalid JSON"
        if index == 1:
            items = [
                {"start": shared_start, "end": shared_start + 30, "title": "Duplicate", "viralScore": 70},
                {"start": 12, "end": 42, "title": "Early", "viralScore": 85},
                {"start": second.end - 42, "end": second.end - 12, "title": "Wrong chunk", "viralScore": 100},
            ]
        else:
            items = [
                {"start": shared_start, "end": shared_start + 30, "title": "Best overlap", "viralScore": 95},
                {"start": first.end + 12, "end": first.end + 42, "title": "Late", "viralScore": 80},
            ]
        return json.dumps(items)

    monkeypatch.setattr(llm, "_complete", fake_complete)
    moments = select_moments(
        cues, JobParams(clip_count=2, target_duration_sec=30),
        {**ENV_LLM, "LLM_REFINE": "0"}, all_moments=all_moments,
    )

    assert attempts == {1: [0.2], 2: [0.2, 0.0]}
    assert [moment.title for moment in moments] == expected


def test_select_moments_keeps_success_when_other_batches_are_empty_or_fail(monkeypatch):
    attempts = {1: [], 2: [], 3: []}

    def fake_complete(base_url, api_key, model, prompt, temperature, has_brief=False):
        index = int(re.search(r"Batch (\d+)/3", prompt)[1])
        attempts[index].append(temperature)
        if index == 1:
            return "[]"
        if index == 2:
            raise RuntimeError("timeout")
        return '[{"start": 730, "end": 760, "title": "Last batch"}]'

    monkeypatch.setattr(llm, "_complete", fake_complete)
    moments = select_moments(
        _window_cues(12), JobParams(clip_count=1, target_duration_sec=30),
        {**ENV_LLM, "LLM_REFINE": "0"}, all_moments=True,
    )

    assert attempts == {1: [0.2], 2: [0.2, 0.0], 3: [0.2]}
    assert [moment.title for moment in moments] == ["Last batch"]


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


def test_select_all_moments_keeps_candidates_through_refine_and_snap(monkeypatch):
    cues = [
        Cue(cue.start + offset, cue.end + offset, cue.text)
        for offset in (0.0, 60.0)
        for cue in _cues_boundaries()
    ]
    responses = iter([
        '[{"start": 10, "end": 40, "title": "A"}, {"start": 70, "end": 100, "title": "B"}]',
        '[{"index": 0, "start": 12, "end": 42}, {"index": 1, "start": 72, "end": 102}]',
    ])
    prompts = []

    def fake_complete(base_url, api_key, model, prompt, temperature, has_brief=False):
        prompts.append(prompt)
        return next(responses)

    monkeypatch.setattr(llm, "_complete", fake_complete)
    params = JobParams(clip_count=1, target_duration_sec=30.0)

    moments = select_moments(cues, params, ENV_LLM, all_moments=True)

    assert len(prompts) == 2
    assert "SEMUA kandidat momen kuat" in prompts[0]
    assert "Kandidat 1" in prompts[1]
    assert [moment.title for moment in moments] == ["A", "B"]
    assert [moment.start for moment in moments] == pytest.approx([12 - START_PAD, 72 - START_PAD], abs=0.01)
    assert [moment.end for moment in moments] == pytest.approx([42 + END_PAD, 102 + END_PAD], abs=0.01)


def test_select_moments_refines_in_batches_with_local_indices(monkeypatch):
    cues = _cues(count=240)
    starts = [i * 60 + 10 for i in range(12)]
    candidates = [
        {"start": start, "end": start + 30, "title": f"Clip {i}"}
        for i, start in enumerate(starts)
    ]
    batches = []

    def fake_complete(base_url, api_key, model, prompt, temperature, has_brief=False):
        if temperature == 0.2:
            return json.dumps(candidates)
        indices = [int(i) for i in re.findall(r"^Kandidat (\d+):", prompt, re.MULTILINE)]
        offset = sum(len(batch) for batch in batches)
        batches.append(indices)
        return json.dumps([
            {"index": index, "start": starts[offset + index] + 5, "end": starts[offset + index] + 35}
            for index in indices
        ])

    monkeypatch.setattr(llm, "_complete", fake_complete)
    moments = select_moments(cues, JobParams(target_duration_sec=30), ENV_LLM, all_moments=True)

    assert batches == [list(range(10)), [0, 1]]
    assert [moment.title for moment in moments] == [f"Clip {i}" for i in range(12)]
    assert [moment.start for moment in moments] == pytest.approx([s + 5 - START_PAD for s in starts])


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
