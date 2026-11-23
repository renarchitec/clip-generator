import json

from clipper import llm
from clipper.models import ClipResult
from clipper.subtitles import Cue


ENV_LLM = {"LLM_BASE_URL": "http://x", "LLM_API_KEY": "k", "LLM_MODEL": "m"}


def _moments():
    return [
        llm.Moment(start=0.0, end=10.0, title="Klip pertama"),
        llm.Moment(start=20.0, end=30.0, title="Klip kedua"),
    ]


def _cues():
    return [
        Cue(0.0, 10.0, "Pembuka klip pertama"),
        Cue(20.0, 30.0, "Isi klip kedua"),
    ]


def test_caption_items_parse_sanitize_and_keep_missing_indices():
    raw = json.dumps(
        {
            "captions": [
                {
                    "index": "0",
                    "caption": "  " + "x" * 2300 + "  ",
                    "hashtags": [
                        "#Python",
                        "python",
                        "#AI",
                        "two words",
                        "",
                        7,
                        "#C++",
                        "#DataScience",
                        "#Coding",
                        "#OpenAI",
                        "#Tech",
                        "#Shorts",
                    ],
                },
                {"index": 1, "caption": "", "hashtags": ["valid"]},
                {"caption": "index wajib ada", "hashtags": ["valid"]},
            ]
        }
    )

    captions = llm._caption_items(llm.parse_llm_json(raw), 3)

    assert len(captions) == 3
    assert captions[0] is not None
    assert len(captions[0].caption) == llm.MAX_CAPTION_CHARS
    assert captions[0].hashtags == [
        "python",
        "ai",
        "c++",
        "datascience",
        "coding",
        "openai",
        "tech",
        "shorts",
    ]
    assert captions[1] is None
    assert captions[2] is None


def test_generate_captions_uses_one_batch_and_preserves_clip_order(monkeypatch):
    calls = []

    def fake_complete(base_url, api_key, model, prompt, temperature, has_brief=False):
        calls.append((base_url, api_key, model, prompt, temperature))
        return '[{"index": 1, "caption": "Hook kedua!", "hashtags": ["#Kedua"]}]'

    monkeypatch.setattr(llm, "_complete", fake_complete)
    captions = llm.generate_captions(
        _moments(),
        _cues(),
        description="Sorot bagian praktis",
        env=ENV_LLM,
    )

    assert len(calls) == 1
    prompt = calls[0][3]
    assert "Klip 0" in prompt and "Klip 1" in prompt
    assert "Pembuka klip pertama" in prompt and "Isi klip kedua" in prompt
    assert "Sorot bagian praktis" in prompt
    assert captions[0] is None
    assert captions[1] == llm.Caption(caption="Hook kedua!", hashtags=["kedua"])


def test_caption_prompt_caps_each_transcript_excerpt():
    cues = [Cue(0.0, 10.0, "Z" * 5000)]
    expected = llm._excerpt(cues, 0.0, 10.0)[: llm.MAX_CAPTION_EXCERPT_CHARS]

    prompt = llm._caption_prompt(_moments()[:1], cues)

    assert len(expected) == llm.MAX_CAPTION_EXCERPT_CHARS
    assert expected in prompt
    assert cues[0].text not in prompt


def test_generate_captions_without_llm_env_returns_none(monkeypatch):
    for key in ENV_LLM:
        monkeypatch.delenv(key, raising=False)

    def unexpected_complete(*args, **kwargs):
        raise AssertionError("LLM tidak boleh dipanggil tanpa konfigurasi")

    monkeypatch.setattr(llm, "_complete", unexpected_complete)

    assert llm.generate_captions(_moments(), _cues()) == [None, None]


def test_generate_captions_bad_json_returns_none(monkeypatch):
    monkeypatch.setattr(llm, "_complete", lambda *args, **kwargs: "bukan JSON")

    assert llm.generate_captions(_moments(), _cues(), env=ENV_LLM) == [None, None]
    assert llm.last_llm_call()["ok"] is False


def test_clip_result_serializes_optional_social_fields_only_when_set():
    clip = ClipResult(title="A", start=0.0, end=10.0, file="clip-01.mp4")
    assert "caption" not in clip.to_dict()
    assert "hashtags" not in clip.to_dict()

    clip.caption = "Hook"
    clip.hashtags = ["python", "shorts"]
    payload = clip.to_dict()
    assert payload["caption"] == "Hook"
    assert payload["hashtags"] == ["python", "shorts"]
