import asyncio
import json
from types import SimpleNamespace

import pytest

from clipper import llm
from clipper.models import ClipResult


PLATFORM_COPY = {
    "youtube": {"title": "SEO title", "caption": "YouTube description", "hashtags": ["video"]},
    "tiktok": {"caption": "What do you think?", "hashtags": ["question"]},
    "instagram": {"caption": "Save for later", "hashtags": ["reels"]},
}


@pytest.fixture(params=["batch", "single"])
def parse(request):
    def parse_item(item, *, title=None, custom_hashtags=None):
        if request.param == "batch":
            return llm._caption_items(
                [{**item, "index": 0}],
                1,
                custom_hashtags=custom_hashtags,
                fallback_titles=[title] if title is not None else (),
            )[0]
        return llm.parse_single_caption(
            json.dumps(item), fallback_title=title, custom_hashtags=custom_hashtags
        )

    return parse_item


def test_parses_platform_copy(parse):
    caption = parse({
        "caption": " Generic hook ",
        "hashtags": ["#General"],
        "platforms": {
            "youtube": {
                "title": " <SEO title> ",
                "caption": " YouTube description ",
                "hashtags": ["#Video", "video", "two words", None],
            },
            "tiktok": {"caption": "What do you think?", "hashtags": ["#Question"]},
            "instagram": {"caption": "Save for later", "hashtags": ["#Reels"]},
            "unknown": {"caption": "Ignored"},
        },
    })
    assert caption is not None
    assert caption.caption == "Generic hook"
    assert caption.hashtags == ["general"]
    assert caption.platforms == PLATFORM_COPY


@pytest.mark.parametrize("partial", [False, True])
def test_synthesizes_missing_platforms(parse, partial):
    item = {"caption": " Generic hook ", "hashtags": ["#General"]}
    if partial:
        item["platforms"] = {key: PLATFORM_COPY[key] for key in ("youtube", "tiktok")}
    caption = parse(item, title=" <Clip title> ")
    assert caption is not None
    fallback = {"caption": "Generic hook", "hashtags": ["general"]}
    assert caption.platforms == {
        "youtube": PLATFORM_COPY["youtube"] if partial else {**fallback, "title": "Clip title"},
        "tiktok": PLATFORM_COPY["tiktok"] if partial else fallback,
        "instagram": fallback,
    }


def test_platform_lengths_and_invalid_values(parse):
    caption = parse({
        "caption": "Fallback",
        "hashtags": ["#General"],
        "platforms": {
            "youtube": {"title": "<" + "t" * 120 + ">", "caption": " " + "c" * 2500},
            "tiktok": {"caption": 42, "hashtags": []},
            "instagram": False,
        },
    })
    assert caption is not None
    assert caption.platforms["youtube"] == {
        "title": "t" * 100, "caption": "c" * 2200, "hashtags": ["general"]
    }
    assert caption.platforms["tiktok"] == {"caption": "Fallback", "hashtags": []}
    assert caption.platforms["instagram"] == {"caption": "Fallback", "hashtags": ["general"]}


def test_custom_hashtags_apply_to_all_platforms(parse):
    caption = parse({
        "caption": "Generic #generic hook",
        "hashtags": ["llm"],
        "platforms": {
            "youtube": {"caption": "Watch #video now", "hashtags": ["llm"]},
            "tiktok": {"caption": "#onlytag", "hashtags": ["llm"]},
            "instagram": {"caption": "Save #reels this", "hashtags": ["llm"]},
        },
    }, title="Clip title", custom_hashtags=["#Brand", "Fyp"])
    assert caption is not None
    tags = ["Brand", "Fyp"]
    assert caption.caption == "Generic hook"
    assert caption.hashtags == tags
    assert caption.platforms == {
        "youtube": {"title": "Clip title", "caption": "Watch now", "hashtags": tags},
        "tiktok": {"caption": "Generic hook", "hashtags": tags},
        "instagram": {"caption": "Save this", "hashtags": tags},
    }


@pytest.mark.parametrize("custom_hashtags", [[], ["Brand"]])
def test_prompts_show_platform_schema(custom_hashtags):
    prompts = (
        llm._caption_prompt([llm.Moment(0, 1, "Title")], [], custom_hashtags=custom_hashtags),
        llm._single_caption_prompt(llm.CaptionRequest(title="Title", custom_hashtags=custom_hashtags)),
    )
    for prompt in prompts:
        example = json.loads(next(line for line in prompt.splitlines() if line.startswith("[{")))[0]
        assert set(example["platforms"]) == set(PLATFORM_COPY)
        assert "title" in example["platforms"]["youtube"]
        expected = [] if custom_hashtags else ["..."]
        assert all(entry["hashtags"] == expected for entry in [example, *example["platforms"].values()])


def test_clip_result_serializes_only_non_empty_platform_copy():
    clip = ClipResult("Title", 0, 1, "a.mp4")
    assert "platformCaptions" not in clip.to_dict()
    clip.platform_captions = {}
    assert "platformCaptions" not in clip.to_dict()
    clip.platform_captions = PLATFORM_COPY
    assert clip.to_dict()["platformCaptions"] == PLATFORM_COPY


def test_handle_caption_job_returns_platform_copy(monkeypatch):
    worker = pytest.importorskip("clipper.worker")
    job = SimpleNamespace(id="1", data={"title": "Title"})
    monkeypatch.setattr(llm, "regenerate_caption", lambda data: llm.Caption("Hook", ["tag"], PLATFORM_COPY))
    assert asyncio.run(worker.handle_caption_job(job)) == {
        "caption": "Hook", "hashtags": ["tag"], "platformCaptions": PLATFORM_COPY
    }
