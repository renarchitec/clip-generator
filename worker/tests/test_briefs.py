import json

import pytest

from clipper import llm

ENV_LLM = {"LLM_BASE_URL": "http://x", "LLM_API_KEY": "k", "LLM_MODEL": "m"}

def test_expand_brief_prompt_contains_input_and_language_rule():
    prompt = llm.expand_brief_prompt("  Funny moment  ")

    assert "Funny moment" in prompt
    assert "<brief>" in prompt and "</brief>" in prompt
    assert "bahasa yang SAMA dengan bahasa input" in prompt
    assert "480" in prompt
    assert "JSON object" in prompt

def test_expand_brief_parses_json_and_records_call(monkeypatch):
    captured = {}

    def fake_complete(base_url, api_key, model, prompt, temperature, has_brief=False):
        captured["prompt"] = prompt
        return '```json\n{"brief": "  Pilih momen lucu   yang utuh.\\nMulai dari setup.  "}\n```'

    monkeypatch.setattr(llm, "_complete", fake_complete)

    result = llm.expand_brief({"brief": "Funny moment"}, env=ENV_LLM)

    assert result == "Pilih momen lucu yang utuh. Mulai dari setup."
    assert "Funny moment" in captured["prompt"]
    assert llm.last_llm_call()["ok"] is True

def test_expand_brief_truncates_long_answer_at_boundary(monkeypatch):
    long_text = ("Kalimat pertama yang cukup panjang untuk mengisi ruang. " * 20).strip()
    monkeypatch.setattr(
        llm,
        "_complete",
        lambda *args, **kwargs: json.dumps({"brief": long_text}),
    )

    result = llm.expand_brief({"brief": "Funny moment"}, env=ENV_LLM)

    assert len(result) <= llm.MAX_BRIEF_CHARS
    assert result.endswith(".")
    assert long_text.startswith(result)

def test_expand_brief_retries_then_raises_when_answer_invalid(monkeypatch):
    calls = []

    def fake_complete(*args, **kwargs):
        calls.append(kwargs.get("temperature"))
        return "bukan JSON"

    monkeypatch.setattr(llm, "_complete", fake_complete)

    with pytest.raises(llm.CaptionUnavailable):
        llm.expand_brief({"brief": "Funny moment"}, env=ENV_LLM)

    assert len(calls) == 2
    assert llm.last_llm_call()["ok"] is False

def test_expand_brief_raises_without_llm_env(monkeypatch):
    for key in ENV_LLM:
        monkeypatch.delenv(key, raising=False)

    def unexpected_complete(*args, **kwargs):
        raise AssertionError("LLM tidak boleh dipanggil tanpa konfigurasi")

    monkeypatch.setattr(llm, "_complete", unexpected_complete)

    with pytest.raises(llm.CaptionUnavailable):
        llm.expand_brief({"brief": "Funny moment"})

def test_expand_brief_rejects_empty_input():
    with pytest.raises(llm.CaptionUnavailable):
        llm.expand_brief({"brief": "   "}, env=ENV_LLM)
