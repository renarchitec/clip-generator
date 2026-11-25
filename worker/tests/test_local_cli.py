"""Unit tests untuk worker/clipper/local_cli.py dan fallback LLM desktop."""

from __future__ import annotations

import json
from unittest import mock

import pytest

from clipper import llm, local_cli


def test_resolve_llm_env_prefers_9router_and_keeps_fallbacks():
    env = {
        "DARTCLIP_9ROUTER_URL": "https://9router.example/v1",
        "NINEROUTER_API_KEY": "sk-router",
        "NINEROUTER_MODEL": "tabi-fixer",
        "GEMINI_API_KEY": "gk-123",
        "OPENAI_API_KEY": "ok-456",
    }
    with mock.patch.object(local_cli, "_reachable", return_value=True):
        source = local_cli.resolve_llm_env(env)

    assert source == "9router"
    assert env["LLM_BASE_URL"] == "https://9router.example/v1"
    assert env["LLM_API_KEY"] == "sk-router"
    assert env["LLM_MODEL"] == "tabi-fixer"
    fallbacks = json.loads(env["LLM_FALLBACK_JSON"])
    assert len(fallbacks) == 2
    assert fallbacks[0]["apiKey"] == "gk-123"
    assert fallbacks[1]["apiKey"] == "ok-456"


def test_resolve_llm_env_falls_back_when_9router_unreachable():
    env = {
        "NINEROUTER_API_KEY": "sk-router",
        "GEMINI_API_KEY": "gk-123",
        "OPENAI_API_KEY": "ok-456",
    }
    with mock.patch.object(local_cli, "_reachable", return_value=False):
        source = local_cli.resolve_llm_env(env)

    assert source == "gemini"
    assert env["LLM_API_KEY"] == "gk-123"
    assert env["LLM_MODEL"] == local_cli.DEFAULT_GEMINI_MODEL
    fallbacks = json.loads(env["LLM_FALLBACK_JSON"])
    assert len(fallbacks) == 1
    assert fallbacks[0]["apiKey"] == "ok-456"


def test_complete_falls_back_on_primary_error(monkeypatch):
    monkeypatch.setenv(
        "LLM_FALLBACK_JSON",
        json.dumps([{"baseUrl": "https://fallback/v1", "apiKey": "fb-key", "model": "fb-model"}]),
    )
    calls = []

    def fake_call(url, key, model, prompt, temperature, has_brief, timeout):
        calls.append((url, key, model))
        if url == "https://primary/v1":
            raise TimeoutError("9router timed out")
        return '{"brief": "ok"}'

    monkeypatch.setattr(llm, "_call_openai", fake_call)

    out = llm._complete("https://primary/v1", "p-key", "p-model", "hi", 0.2)
    assert out == '{"brief": "ok"}'
    assert calls == [
        ("https://primary/v1", "p-key", "p-model"),
        ("https://fallback/v1", "fb-key", "fb-model"),
    ]


def test_task_brief_emits_result_event(monkeypatch, capsys, tmp_path):
    payload_file = tmp_path / "brief.json"
    payload_file.write_text(json.dumps({"brief": "momen lucu"}))
    monkeypatch.setenv("LLM_BASE_URL", "https://example/v1")
    monkeypatch.setenv("LLM_API_KEY", "k")
    monkeypatch.setenv("LLM_MODEL", "m")
    monkeypatch.setattr(llm, "expand_brief", lambda data: "Pilih momen tawa penuh.")

    code = local_cli.main(
        ["--task", "brief", "--payload-file", str(payload_file), "--clips-dir", str(tmp_path)]
    )
    assert code == 0
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip()]
    events = {item["event"]: item for item in lines}
    assert events["result"]["data"] == {"brief": "Pilih momen tawa penuh."}
    assert events["llm_status"]["configured"] is True


def test_task_caption_emits_error_code_on_unavailable(monkeypatch, capsys, tmp_path):
    payload_file = tmp_path / "caption.json"
    payload_file.write_text(json.dumps({"title": "test"}))
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("NINEROUTER_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    code = local_cli.main(
        ["--task", "caption", "--payload-file", str(payload_file), "--clips-dir", str(tmp_path)]
    )
    assert code == 1
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip()]
    err = next(item for item in lines if item["event"] == "error")
    assert err["code"] == "caption_unavailable"
