"""Unit tests for the Reference Edit worker path."""

import asyncio
import base64
import json
import subprocess
import sys
import types
from pathlib import Path

import pytest

from clipper import llm, models, reference_pipeline
from clipper.models import reference_job_data_from_dict

FOOTAGE = [
    {
        "id": "f1",
        "name": "footage-1.mp4",
        "filePath": "reference/footage-1.mp4",
        "mimeType": "video/mp4",
        "sizeBytes": 1000,
        "durationSec": 10,
        "width": 1920,
        "height": 1080,
    }
]


def _raw_job(**overrides):
    payload = {
        "jobId": "ref-1",
        "userId": "u1",
        "title": "Contoh",
        "brief": "gaya energik",
        "aspectRatio": "9:16",
        "reframe": "face_tracking",
        "captions": True,
        "beatSync": False,
        "referenceUrl": None,
        "referenceFilePath": "reference/ref.mp4",
        "referenceDurationSec": 8,
        "footage": FOOTAGE,
    }
    payload.update(overrides)
    return payload


def test_reference_constants_match_shared_contract(monkeypatch):
    assert models.REFERENCE_QUEUE_NAME == "reference-jobs"
    assert models.REFERENCE_STAGES == (
        "analyze_reference", "analyze_footage", "plan_edit", "render", "save"
    )
    if "redis" not in sys.modules:
        fake_redis_mod = types.ModuleType("redis")
        fake_redis_async = types.ModuleType("redis.asyncio")
        fake_redis_async.Redis = object
        fake_redis_mod.asyncio = fake_redis_async
        monkeypatch.setitem(sys.modules, "redis", fake_redis_mod)
        monkeypatch.setitem(sys.modules, "redis.asyncio", fake_redis_async)
    if "bullmq" not in sys.modules:
        fake_bullmq = types.ModuleType("bullmq")
        fake_bullmq.Worker = object
        monkeypatch.setitem(sys.modules, "bullmq", fake_bullmq)
    import importlib
    worker_mod = importlib.import_module("clipper.worker")
    assert worker_mod.REFERENCE_QUEUE_NAME == "reference-jobs"
    assert worker_mod.DEFAULT_CLIPS_DIR == worker_mod.clips_dir()


def test_reference_job_data_from_dict_parses_tolerant_payload():
    data = reference_job_data_from_dict(_raw_job())

    assert isinstance(data, models.ReferenceJobData)
    assert data.job_id == "ref-1"
    assert data.reference_file_path == "reference/ref.mp4"
    assert data.beat_sync is False
    assert data.footage[0].file_path == "reference/footage-1.mp4"
    assert data.footage[0].size_bytes == 1000
    assert data.to_dict()["footage"][0]["filePath"] == "reference/footage-1.mp4"


def test_reference_job_data_from_dict_accepts_snake_case_and_rejects_invalid():
    data = reference_job_data_from_dict(
        {
            "job_id": "ref-2",
            "reference_url": "https://example.invalid/video",
            "footage": [{"id": "x", "name": "x", "file_path": "x.mp4"}],
        }
    )
    assert data.reference_url == "https://example.invalid/video"
    assert data.footage[0].file_path == "x.mp4"

    with pytest.raises(ValueError):
        reference_job_data_from_dict({"jobId": "x", "footage": FOOTAGE})
    with pytest.raises(ValueError):
        reference_job_data_from_dict({"jobId": "x", "referenceUrl": "u", "footage": []})
    with pytest.raises(ValueError):
        reference_job_data_from_dict({"jobId": "../bad", "referenceUrl": "u", "footage": FOOTAGE})


def test_reference_progress_and_result_to_dict():
    slot = models.ReferenceTemplateSlot(0, 0, 3, 3, shot_type="hook", overlay_text="Halo")
    plan = models.ReferencePlanSlot(0, "f1", "footage", 1, 4, 3, shot_type="hook")

    progress = models.ReferenceJobProgress(
        stage="plan_edit", percent=90, template_slots=[slot], plan_slots=[plan]
    ).to_dict()
    assert progress["stage"] == "plan_edit"
    assert progress["templateSlots"][0]["shotType"] == "hook"
    assert progress["planSlots"][0]["sourceStartSec"] == 1

    result = models.ReferenceJobResult(
        output_file_path="ref-1/reference-edit.mp4",
        duration_sec=3.0,
        template_slots=[slot],
        plan_slots=[plan],
        caption="caption",
        hashtags=["shorts"],
    ).to_dict()
    assert result["outputFilePath"] == "ref-1/reference-edit.mp4"
    assert result["caption"] == "caption"
    assert result["hashtags"] == ["shorts"]


def test_vision_model_from_env_defaults_to_clipper_vision():
    assert llm.vision_model_from_env({}) == "clipper-vision"
    assert llm.vision_model_from_env({"LLM_VISION_MODEL": "  "}) == "clipper-vision"
    assert llm.vision_model_from_env({"LLM_VISION_MODEL": " custom-vision "}) == "custom-vision"


def test_parse_llm_object_strips_fences_and_trailing_commas():
    raw = '```json\n{"slots": [{"index": 0, "zoom": "in",},],}\n```'
    assert llm.parse_llm_object(raw) == {"slots": [{"index": 0, "zoom": "in"}]}
    with pytest.raises(ValueError):
        llm.parse_llm_object("not json")


def test_complete_vision_builds_multimodal_messages(monkeypatch):
    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured["create"] = kwargs
            return types.SimpleNamespace(
                choices=[types.SimpleNamespace(message=types.SimpleNamespace(content='{"ok": true}'))]
            )

    class FakeOpenAI:
        def __init__(self, **kwargs):
            captured["client"] = kwargs
            self.chat = types.SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=FakeOpenAI))
    text = llm.complete_vision(
        "system", "describe", ["AAA", "BBB"],
        base_url="http://x/v1", api_key="k", model="clipper-vision",
    )

    assert text == '{"ok": true}'
    assert captured["client"] == {
        "base_url": "http://x/v1", "api_key": "k", "timeout": 180.0, "max_retries": 0
    }
    create = captured["create"]
    assert create["model"] == "clipper-vision"
    assert create["messages"][0] == {"role": "system", "content": "system"}
    assert create["messages"][1]["content"] == [
        {"type": "text", "text": "describe"},
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,AAA"}},
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,BBB"}},
    ]
    assert llm.last_llm_call()["ok"] is True


def test_complete_vision_records_failure(monkeypatch):
    class FakeCompletions:
        def create(self, **kwargs):
            raise RuntimeError("boom")

    class FakeOpenAI:
        def __init__(self, **kwargs):
            self.chat = types.SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=FakeOpenAI))
    with pytest.raises(RuntimeError, match="boom"):
        llm.complete_vision("s", "p", [], base_url="x", api_key="k", model="m")
    assert llm.last_llm_call()["ok"] is False


def _fake_subprocess_run(monkeypatch, calls: list):
    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))
        binary = cmd[0]
        if binary == "ffprobe":
            return subprocess.CompletedProcess(
                cmd, 0,
                stdout=json.dumps(
                    {
                        "streams": [
                            {"codec_type": "video", "width": 1920, "height": 1080,
                             "duration": "8.0"},
                            {"codec_type": "audio", "width": 0, "height": 0},
                        ],
                        "format": {"duration": "8.0"},
                    }
                ),
                stderr="",
            )
        if binary in ("ffmpeg", "yt-dlp"):
            output = str(cmd[-1])
            path = Path(output)
            if path.suffix in (".mp4", ".jpg"):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"fake-media")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        raise AssertionError(f"unexpected binary: {binary}")

    monkeypatch.setattr(reference_pipeline.subprocess, "run", fake_run)


def test_run_reference_job_end_to_end_with_mocked_calls(monkeypatch, tmp_path):
    calls: list = []
    _fake_subprocess_run(monkeypatch, calls)

    monkeypatch.setattr(
        reference_pipeline, "_detect_shot_boundaries", lambda video, duration: [0.0, 4.0, 8.0]
    )
    monkeypatch.setattr(
        reference_pipeline, "_frame_stats", lambda video, at: (base64.b64encode(b"frame").decode(), 0.8)
    )

    vision_calls = []

    def fake_vision(system, prompt, images_b64, *, base_url, api_key, model, temperature=0.1):
        vision_calls.append((prompt, len(images_b64), model))
        if "Berikut adalah keyframe" in prompt:
            return json.dumps(
                {
                    "slots": [
                        {"index": 0, "shotType": "hook", "description": "Hook",
                         "overlayText": "Mulai", "zoom": "in", "beatSync": False},
                        {"index": 1, "shotType": "cta", "description": "CTA",
                         "overlayText": None, "zoom": "none", "beatSync": False},
                    ]
                }
            )
        if "Pilih footage terbaik" in prompt:
            return json.dumps(
                {"plan": [
                    {"slotIndex": 0, "footageId": "f1", "sourceStartSec": 1.0,
                     "sourceEndSec": 5.0, "reason": "paling relevan"},
                    {"slotIndex": 1, "footageId": "f1", "sourceStartSec": 2.0,
                     "sourceEndSec": 6.0, "reason": "closing kuat"},
                ]}
            )
        return json.dumps(
            {"footage": [
                {"id": "f1", "description": "Orang berbicara", "sourceStartSec": 0.0,
                 "sourceEndSec": 8.0}
            ]}
        )

    monkeypatch.setattr(reference_pipeline.llm, "complete_vision", fake_vision)
    monkeypatch.setattr(
        reference_pipeline.llm, "generate_captions",
        lambda *args, **kwargs: [llm.Caption(caption="Keren", hashtags=["shorts"]), None],
    )

    clips_dir = tmp_path / "clips"
    (clips_dir / "reference").mkdir(parents=True)
    (clips_dir / "reference" / "ref.mp4").write_bytes(b"fake-reference")
    (clips_dir / "reference" / "footage-1.mp4").write_bytes(b"fake-footage")
    temp_root = tmp_path / "tmp"
    temp_root.mkdir()

    progress = []
    job = reference_job_data_from_dict(_raw_job())
    result = asyncio.run(
        reference_pipeline.run_reference_job(
            job,
            clips_dir=clips_dir,
            temp_root=temp_root,
            on_progress=lambda update: progress.append(update.to_dict()),
            env={"LLM_BASE_URL": "http://x/v1", "LLM_API_KEY": "k"},
        )
    )

    assert result.output_file_path == "ref-1/reference-edit.mp4"
    assert result.duration_sec == 8.0
    assert result.caption == "Keren"
    assert result.hashtags == ["shorts"]
    assert [slot.shot_type for slot in result.template_slots] == ["hook", "cta"]
    assert result.template_slots[0].overlay_text == "Mulai"
    assert result.plan_slots[0].footage_id == "f1"
    assert result.plan_slots[0].source_start_sec == 1.0
    assert (clips_dir / "ref-1" / "reference-edit.mp4").exists()
    assert not list(temp_root.glob("ref-*"))  # workdir cleaned up

    stages = [entry["stage"] for entry in progress]
    assert stages[0] == "analyze_reference"
    assert "analyze_footage" in stages
    assert any(entry["stage"] == "plan_edit" and entry.get("planSlots") for entry in progress)
    assert stages[-1] == "save"

    assert vision_calls and all(call[2] == "clipper-vision" for call in vision_calls)
    commands = [" ".join(call) for call in calls]
    assert any("-ss 1.000" in command and "-t 4.000" in command for command in commands)
    assert any("-ar 44100" in command and "-ac 2" in command for command in commands)
    assert any("subtitles=" in command for command in commands)
    assert any("+faststart" in command and "concat" in command for command in commands)


def test_run_reference_job_falls_back_without_llm(monkeypatch, tmp_path):
    calls: list = []
    _fake_subprocess_run(monkeypatch, calls)
    monkeypatch.setattr(
        reference_pipeline, "_detect_shot_boundaries", lambda video, duration: [0.0, 4.0, 8.0]
    )
    monkeypatch.setattr(reference_pipeline, "_frame_stats", lambda video, at: (None, 0.0))

    clips_dir = tmp_path / "clips"
    (clips_dir / "reference").mkdir(parents=True)
    (clips_dir / "reference" / "ref.mp4").write_bytes(b"fake-reference")
    (clips_dir / "reference" / "footage-1.mp4").write_bytes(b"fake-footage")

    job = reference_job_data_from_dict(_raw_job(captions=False))
    result = asyncio.run(
        reference_pipeline.run_reference_job(
            job, clips_dir=clips_dir, temp_root=tmp_path, env={}
        )
    )

    assert len(result.template_slots) == 2
    assert result.plan_slots[0].footage_id == "f1"
    assert result.caption is None
    assert result.hashtags == []
