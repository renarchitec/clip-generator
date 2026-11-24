import asyncio

import pytest

from clipper import llm, models
from clipper.models import ClipResult, job_data_from_dict
from clipper.subtitles import Cue

ENV_LLM = {"LLM_BASE_URL": "http://x", "LLM_API_KEY": "k", "LLM_MODEL": "m"}


def _moments():
    return [llm.Moment(start=0.0, end=10.0, title="Klip pertama")]


def _cues():
    return [Cue(0.0, 5.0, "Halo  semua"), Cue(5.0, 10.0, "ini klip"), Cue(20.0, 30.0, "lain")]


def test_job_data_caption_language_defaults_and_parses():
    base = {"jobId": "abc", "url": "https://x"}
    assert job_data_from_dict(base).caption_language == "auto"
    assert job_data_from_dict({**base, "captionLanguage": "EN"}).caption_language == "en"
    assert job_data_from_dict({**base, "captionLanguage": "id"}).caption_language == "id"
    assert job_data_from_dict({**base, "captionLanguage": "fr"}).caption_language == "auto"
    assert job_data_from_dict({**base, "captionLanguage": 7}).caption_language == "auto"
    assert job_data_from_dict({**base, "captionLanguage": "en"}).to_dict()["captionLanguage"] == "en"


def test_caption_queue_name_matches_shared():
    assert models.CAPTION_QUEUE_NAME == "captions"
    assert models.CAPTION_LANGUAGES == ("auto", "id", "en")


@pytest.mark.parametrize(
    "language, expected, hashtag",
    [
        ("auto", "bahasa yang sama dengan transkrip", None),
        (None, "bahasa yang sama dengan transkrip", None),
        ("xx", "bahasa yang sama dengan transkrip", None),
        ("id", "Bahasa Indonesia", "Hashtag boleh berbahasa Indonesia"),
        ("en", "bahasa Inggris/English", "Hashtag boleh berbahasa Inggris"),
    ],
)
def test_caption_prompt_language_selection(language, expected, hashtag):
    prompt = llm._caption_prompt(_moments(), _cues(), None, language)
    assert expected in prompt
    if hashtag:
        assert hashtag in prompt
    else:
        assert "Hashtag boleh" not in prompt


def test_generate_captions_passes_language_to_prompt(monkeypatch):
    prompts = []

    def fake_complete(base_url, api_key, model, prompt, temperature, has_brief=False):
        prompts.append(prompt)
        return '[{"index": 0, "caption": "Hello!", "hashtags": ["#Hi"]}]'

    monkeypatch.setattr(llm, "_complete", fake_complete)
    captions = llm.generate_captions(_moments(), _cues(), env=ENV_LLM, language="en")
    assert captions[0] is not None and captions[0].caption == "Hello!"
    assert "bahasa Inggris/English" in prompts[0]


def test_clip_transcript_and_clip_result_to_dict():
    text = llm.clip_transcript(_cues(), 0.0, 10.0)
    assert text == "Halo semua ini klip"
    assert len(llm.clip_transcript([Cue(0.0, 1.0, "x" * 5000)], 0.0, 1.0)) == 2000

    clip = ClipResult(title="t", start=0, end=1, file="a.mp4", transcript="  isi  ")
    assert clip.to_dict()["transcript"] == "isi"
    assert "transcript" not in ClipResult(title="t", start=0, end=1, file="a.mp4").to_dict()
    assert "transcript" not in ClipResult(title="t", start=0, end=1, file="a.mp4", transcript="  ").to_dict()
    long = ClipResult(title="t", start=0, end=1, file="a.mp4", transcript="y" * 3000)
    assert len(long.to_dict()["transcript"]) == 2000


def test_caption_request_from_bad_input_never_raises():
    for bad in (None, 5, "x", [], {"title": 3, "transcript": ["a"], "language": None}):
        request = llm.CaptionRequest.from_dict(bad)
        assert request.language == "auto"
        assert request.title == ""
        assert request.transcript is None


def test_single_prompt_uses_transcript_or_falls_back_to_title_caption():
    with_transcript = llm._single_caption_prompt(
        llm.CaptionRequest(title="Judul", transcript="isi transkrip", current_caption="lama", language="id")
    )
    assert "<transkrip>\nisi transkrip\n</transkrip>" in with_transcript
    assert "Bahasa Indonesia" in with_transcript

    without = llm._single_caption_prompt(
        llm.CaptionRequest(title="Judul", transcript=None, current_caption="Caption lama", language="en")
    )
    assert "<transkrip>" not in without
    assert "Transkrip klip tidak tersedia" in without
    assert "Caption lama" in without
    assert "bahasa Inggris/English" in without


@pytest.mark.parametrize(
    "raw",
    [
        '[{"index": 0, "caption": " Hook! ", "hashtags": ["#A", "a", "b c"]}]',
        '{"caption": " Hook! ", "hashtags": ["#A", "a", "b c"]}',
        'Sure:\n```json\n{"caption": " Hook! ", "hashtags": ["#A"]}\n```',
    ],
)
def test_parse_single_caption_variants(raw):
    caption = llm.parse_single_caption(raw)
    assert caption is not None
    assert caption.caption == "Hook!"
    assert caption.hashtags == ["a"]


@pytest.mark.parametrize("raw", ["", "bukan json", '[{"caption": ""}]', '{"caption": 5}', None, 12])
def test_parse_single_caption_invalid_returns_none(raw):
    assert llm.parse_single_caption(raw) is None


def test_regenerate_caption_success(monkeypatch):
    prompts = []

    def fake_complete(base_url, api_key, model, prompt, temperature, has_brief=False):
        prompts.append(prompt)
        return '{"caption": "New hook", "hashtags": ["#Tag"]}'

    monkeypatch.setattr(llm, "_complete", fake_complete)
    caption = llm.regenerate_caption(
        {"title": "T", "transcript": None, "currentCaption": "Lama", "language": "en"}, env=ENV_LLM
    )
    assert caption.caption == "New hook"
    assert caption.hashtags == ["tag"]
    assert len(prompts) == 1


def test_regenerate_caption_retries_then_unavailable(monkeypatch):
    calls = []

    def fake_complete(*args, **kwargs):
        calls.append(1)
        return "tidak valid"

    monkeypatch.setattr(llm, "_complete", fake_complete)
    with pytest.raises(llm.CaptionUnavailable):
        llm.regenerate_caption({"title": "T", "language": "id"}, env=ENV_LLM)
    assert len(calls) == 2


def test_regenerate_caption_unavailable_without_llm_or_on_error(monkeypatch):
    with pytest.raises(llm.CaptionUnavailable):
        llm.regenerate_caption({"title": "T"}, env={})

    def boom(*args, **kwargs):
        raise RuntimeError("network down sk-secret")

    monkeypatch.setattr(llm, "_complete", boom)
    env = {**ENV_LLM, "LLM_API_KEY": "sk-secret"}
    with pytest.raises(llm.CaptionUnavailable) as info:
        llm.regenerate_caption({"title": "T"}, env=env)
    assert "sk-secret" not in str(info.value)

    with pytest.raises(llm.CaptionUnavailable):
        llm.regenerate_caption("garbage", env=ENV_LLM)


def test_handle_caption_job_maps_failures(monkeypatch):
    worker = pytest.importorskip("clipper.worker")

    class FakeJob:
        id = "1"
        data = {"title": "T", "language": "en"}

    monkeypatch.setattr(
        llm, "regenerate_caption", lambda data, env=None: llm.Caption("Hi", ["x"])
    )
    result = asyncio.run(worker.handle_caption_job(FakeJob()))
    assert result == {"caption": "Hi", "hashtags": ["x"]}

    def bad(data, env=None):
        raise KeyError("oops")

    monkeypatch.setattr(llm, "regenerate_caption", bad)
    with pytest.raises(RuntimeError, match="caption_unavailable"):
        asyncio.run(worker.handle_caption_job(FakeJob()))
