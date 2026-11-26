import asyncio
from contextlib import nullcontext
from pathlib import Path
from threading import Barrier, Event, Lock
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from clipper import pipeline, stt
from clipper.llm import Moment
from clipper.subtitles import Cue

ENV = {"LLM_BASE_URL": "https://router.test/v1/", "LLM_API_KEY": "testing"}
URL = "https://www.youtube.com/watch?v=example"
VTT = "WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nYouTube dialog\n"


def test_stt_config_defaults_and_overrides():
    cfg = stt.stt_config(ENV)
    assert (cfg.base_url, cfg.api_key) == ("https://router.test/v1", "testing")
    assert (cfg.model, cfg.fallback_model) == ("groq/whisper-large-v3-turbo", "ag/gemini-4-hydrogen-low")
    assert stt.is_stt_configured(ENV)
    assert not stt.is_stt_configured({})
    assert not stt.is_stt_configured({"LLM_BASE_URL": ENV["LLM_BASE_URL"]})
    assert stt.stt_config({**ENV, "STT_BASE_URL": " https://override/v1/ ", "STT_API_KEY": "new",
                           "STT_MODEL": "custom", "STT_FALLBACK_MODEL": ""}) == stt.SttConfig(
        "https://override/v1", "new", "custom", "", "https://router.test/v1", "testing",
    )


GROQ_ENV = {**ENV, "STT_BASE_URL": "https://api.groq.com/openai/v1/", "STT_API_KEY": "groq-key",
            "STT_MODEL": "whisper-large-v3-turbo"}


def test_direct_groq_keeps_gemini_on_9router_with_optional_overrides():
    cfg = stt.stt_config(GROQ_ENV)
    assert (cfg.base_url, cfg.api_key, cfg.model) == (
        "https://api.groq.com/openai/v1", "groq-key", "whisper-large-v3-turbo",
    )
    assert (cfg.fallback_base_url, cfg.fallback_api_key) == ("https://router.test/v1", "testing")
    override = stt.stt_config({**GROQ_ENV, "STT_FALLBACK_BASE_URL": "https://override.test/v1/",
                               "STT_FALLBACK_API_KEY": "other-key"})
    assert (override.fallback_base_url, override.fallback_api_key) == ("https://override.test/v1", "other-key")
    standalone = stt.stt_config({key: value for key, value in GROQ_ENV.items() if key.startswith("STT_")})
    assert (standalone.fallback_base_url, standalone.fallback_api_key) == (cfg.base_url, cfg.api_key)


def test_gemini_only_configuration_skips_whisper(tmp_path, monkeypatch):
    env = {"STT_FALLBACK_BASE_URL": "https://router.test/v1", "STT_FALLBACK_API_KEY": "fallback-key"}
    assert stt.is_stt_configured(env)
    assert not stt.is_stt_configured({**env, "STT_FALLBACK_MODEL": ""})
    assert not stt.is_stt_configured({**env, "STT_FALLBACK_API_KEY": ""})
    extract, whisper, gemini = Mock(), Mock(), Mock(return_value=[Cue(0, 1, "dialog")])
    monkeypatch.setattr(stt, "extract_audio_chunk", extract)
    monkeypatch.setattr(stt, "_transcribe_whisper", whisper)
    monkeypatch.setattr(stt, "_transcribe_gemini_audio", gemini)
    assert stt.transcribe_media_file("media.mp4", str(tmp_path), end=2, env=env)[0].text == "dialog"
    whisper.assert_not_called()
    gemini.assert_called_once()


def test_words_filter_annotations_preserve_timings_and_split_on_pause():
    raw = [{"word": word, "start": start, "end": end} for word, start, end in [
        ("Halo", 0.5, 0.9), ("[tertawa]", 0.9, 1.1), ("[", 1.1, 1.2),
        ("__", 1.2, 1.3), ("]", 1.3, 1.35), ("f***", 1.35, 1.4), ("***", 1.4, 1.45),
        ("♪", 1.45, 1.5), ("dunia", 1.5, 1.5), ("[Musik]", 2, 2.2), ("Lanjut", 3.0, 20.0),
    ]]
    cues = stt.words_to_cues(raw, offset_sec=40)
    assert [cue.text for cue in cues] == ["Halo dunia", "Lanjut"]
    assert [w.start for w in cues[0].words] == pytest.approx([40.5, 41.5])
    assert [w.end for w in cues[0].words] == pytest.approx([40.9, 41.55])
    assert cues[1].end == pytest.approx(43 + stt.MAX_TAIL_WORD_SEC)


def test_words_group_by_sentence_word_count_and_duration():
    texts = "I have four words. one two three four five six seven eight nine ten eleven twelve last".split()
    raw = [{"word": text, "start": i / 4, "end": i / 4 + 0.1} for i, text in enumerate(texts)]
    assert [len(cue.words) for cue in stt.words_to_cues(raw)] == [4, 12, 1]
    raw = [{"word": "yes", "start": i / 1.5, "end": i / 1.5 + 0.25} for i in range(11)]
    assert [len(cue.words) for cue in stt.words_to_cues(raw)] == [9, 2]


def test_segments_sanitize_and_synthesize_word_timings():
    cues = stt.segments_to_cues([
        {"start": 1.5, "end": 3.0, "text": "Halo [tertawa] f*** dunia"},
        {"start": 3.0, "end": 4.0, "text": "[Musik]"},
        {"start": 4.0, "end": 4.0, "text": "no duration"},
    ], offset_sec=10)
    assert len(cues) == 1
    cue = cues[0]
    assert cue.start == 11.5
    assert (cue.end, cue.text) == (13.0, "Halo dunia")
    assert [word.text for word in cue.words] == ["Halo", "dunia"]
    assert all(cue.start <= word.start < word.end <= cue.end for word in cue.words)


def test_whisper_segment_timing_trims_only_stretched_leading_silence():
    cues = stt.segments_to_cues([
        {"start": 14.26, "end": 21.46, "text": "Ternyata semuanya masih berjalan"},
        {"start": 22.0, "end": 23.8, "text": "Ini masih normal"},
        {"start": 25.0, "end": 26.56, "text": "Semut"},
    ], offset_sec=100)
    assert [cue.start for cue in cues] == pytest.approx([121.46 - (29 / 9 + 0.6), 122.0, 125.36])
    assert [cue.end for cue in cues] == pytest.approx([121.46, 123.8, 126.56])
    for cue in cues:
        assert cue.words[0].start == cue.start
        assert all(cue.start <= word.start < word.end <= cue.end for word in cue.words)


def test_whisper_warns_once_when_gateway_drops_word_timestamps(tmp_path, monkeypatch, caplog):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"mp3")
    create = Mock(return_value={"words": [], "segments": [{"start": 1, "end": 2, "text": "hello"}]})
    client = SimpleNamespace(audio=SimpleNamespace(transcriptions=SimpleNamespace(create=create)))
    open_client = Mock(side_effect=lambda base_url, api_key: nullcontext(client))
    monkeypatch.setattr(stt, "_openai_client_for", open_client)
    monkeypatch.setattr(stt, "_WARNED_SEGMENT_ONLY_MODELS", set())
    cfg = stt.stt_config(GROQ_ENV)
    for _ in range(2):
        assert stt._transcribe_whisper(str(audio), cfg)[0].text == "hello"
    assert open_client.call_count == 2
    assert open_client.call_args.args == ("https://api.groq.com/openai/v1", "groq-key")
    assert caplog.text.count("tidak mengembalikan timestamp per kata") == 1


def test_ffmpeg_extraction_seek_duration_and_codec(monkeypatch):
    run = Mock()
    monkeypatch.setattr(stt.subprocess, "run", run)
    assert stt.extract_audio_chunk("input.mp4", "audio.mp3", start=2, end=4) == "audio.mp3"
    cmd = run.call_args.args[0]
    assert cmd.index("-ss") < cmd.index("-i")
    assert float(cmd[cmd.index("-t") + 1]) == 2
    assert "libmp3lame" in cmd and "32k" in cmd and "16000" in cmd
    stt.extract_audio_chunk("input.mp4", "audio.wav", end=4, audio_format="wav")
    assert "pcm_s16le" in run.call_args.args[0]
    assert "-ss" not in run.call_args.args[0]


@pytest.mark.parametrize("language", ["auto", "id", "en"])
def test_whisper_response_supports_object_words_and_dict_segments(monkeypatch, tmp_path, language):
    file = tmp_path / "audio.mp3"
    file.write_bytes(b"audio")
    create = Mock(side_effect=[
        SimpleNamespace(words=[SimpleNamespace(word="halo", start=0.0, end=0.5)]),
        {"segments": [{"start": 1, "end": 2, "text": "[Musik] hello"}]},
        SimpleNamespace(model_dump=lambda: {"words": [{"word": "dumped", "start": 0, "end": 1}]}),
    ])
    client = SimpleNamespace(audio=SimpleNamespace(transcriptions=SimpleNamespace(create=create)))
    monkeypatch.setattr(stt, "_openai_client_for", lambda base_url, api_key: nullcontext(client))
    for expected in ("halo", "hello", "dumped"):
        cues = stt._transcribe_whisper(str(file), stt.stt_config(ENV), language, 10)
        assert [cue.text for cue in cues] == [expected]
        kwargs = create.call_args.kwargs
        assert kwargs["response_format"] == "verbose_json"
        assert kwargs["timestamp_granularities"] == ["word", "segment"]
        assert kwargs.get("language") == (None if language == "auto" else language)


def test_whisper_failure_falls_back_to_gemini_wav_slices_and_clamps(monkeypatch, tmp_path):
    def fake_extract(media, out, **kwargs):
        Path(out).write_bytes(b"wav" if kwargs.get("audio_format") == "wav" else b"mp3")
        return out

    extraction = Mock(side_effect=fake_extract)
    whisper = Mock(side_effect=ConnectionError("offline"))
    monkeypatch.setattr(stt, "extract_audio_chunk", extraction)
    monkeypatch.setattr(stt, "_transcribe_whisper", whisper)
    create = Mock(return_value={"choices": [{"message": {"content":
        '```json\n{"segments": [{"start": -2, "end": 100, "text": "[tertawa] halo"}]}\n```'}}]})
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    open_client = Mock(side_effect=lambda base_url, api_key: nullcontext(client))
    monkeypatch.setattr(stt, "_openai_client_for", open_client)
    cues = stt.transcribe_media_file("media.mp4", str(tmp_path), start=10, end=60, offset_sec=80, env=GROQ_ENV)
    open_client.assert_called_once_with("https://router.test/v1", "testing")
    assert [(c.start, c.end, c.text) for c in cues] == [(80, 125, "halo"), (125, 130, "halo")]
    assert [call.kwargs for call in extraction.call_args_list] == [
        {"start": 10, "end": 60}, {"start": 0.0, "end": 45.0, "audio_format": "wav"},
        {"start": 45.0, "end": 50, "audio_format": "wav"},
    ]
    for call in create.call_args_list:
        assert call.kwargs["model"] == "ag/gemini-4-hydrogen-low"
        assert call.kwargs["messages"][0]["content"][1] == {
            "type": "input_audio", "input_audio": {"data": "d2F2", "format": "wav"},
        }
    with pytest.raises(ConnectionError):
        stt.transcribe_media_file("media.mp4", str(tmp_path), end=1, env={**ENV, "STT_FALLBACK_MODEL": ""})
    assert create.call_count == 2


def test_stt_chunks_preserve_absolute_offsets(monkeypatch, tmp_path):
    extract = Mock()
    monkeypatch.setattr(stt, "extract_audio_chunk", extract)
    monkeypatch.setattr(stt, "_probe_duration", lambda path: 400)
    monkeypatch.setattr(stt, "_transcribe_whisper", lambda path, cfg, language, offset_sec: [
        Cue(offset_sec, offset_sec + 1, "voice"),
    ])
    cues = stt.transcribe_media_file("video.mp4", str(tmp_path), start=30, offset_sec=17, env=ENV)
    assert [cue.start for cue in cues] == [17, 197, 377]
    assert [c.kwargs for c in extract.call_args_list] == [
        {"start": 30, "end": 210.0}, {"start": 210.0, "end": 390.0}, {"start": 390.0, "end": 400},
    ]


@pytest.mark.parametrize("whisper_fails", [False, True])
def test_short_mp3_is_transcribed_without_reencoding(tmp_path, monkeypatch, whisper_fails):
    path = tmp_path / "audio.MP3"
    path.write_bytes(b"audio")
    monkeypatch.setattr(stt, "_probe_duration", lambda path: 30.0)
    extract = Mock()
    cue = Cue(25, 26, "dialog")
    whisper = Mock(return_value=[cue], side_effect=ConnectionError if whisper_fails else None)
    gemini = Mock(return_value=[cue])
    monkeypatch.setattr(stt, "extract_audio_chunk", extract)
    monkeypatch.setattr(stt, "_transcribe_whisper", whisper)
    monkeypatch.setattr(stt, "_transcribe_gemini_audio", gemini)
    assert stt.transcribe_media_file(str(path), str(tmp_path), offset_sec=25, language="id", env=ENV) == [cue]
    extract.assert_not_called()
    cfg = stt.stt_config(ENV)
    whisper.assert_called_once_with(str(path), cfg, language="id", offset_sec=25)
    if whisper_fails:
        gemini.assert_called_once_with(str(path), 30.0, cfg, offset_sec=25, workdir=str(tmp_path))
    else:
        gemini.assert_not_called()


@pytest.mark.parametrize("duration,size,bounds,expected_chunks", [
    (181, 10, {}, 2),
    (30, 20 * 1024 * 1024 + 1, {}, 1),
    (30, 10, {"start": 0}, 1),
    (30, 10, {"end": 20}, 1),
])
def test_mp3_outside_fast_path_still_extracts_chunks(tmp_path, monkeypatch, duration, size, bounds, expected_chunks):
    path = str(tmp_path / "audio.mp3")
    extract, whisper = Mock(), Mock(return_value=[])
    monkeypatch.setattr(stt, "_probe_duration", lambda path: duration)
    monkeypatch.setattr(stt.os.path, "getsize", lambda path: size)
    monkeypatch.setattr(stt, "extract_audio_chunk", extract)
    monkeypatch.setattr(stt, "_transcribe_whisper", whisper)
    stt.transcribe_media_file(path, str(tmp_path), env=ENV, **bounds)
    assert extract.call_count == whisper.call_count == expected_chunks
    assert all(call.args[0] != path for call in whisper.call_args_list)


def _hls_format(format_id="233", **overrides):
    return {"format_id": format_id, "url": f"https://media.test/{format_id}.m3u8",
            "protocol": "m3u8_native", "acodec": "aac", "vcodec": "none", **overrides}


def test_pick_hls_audio_stream_filters_and_ranks_formats():
    rejected = [
        _hls_format("video", vcodec="avc1", abr=1),
        _hls_format("dash", protocol="http_dash_segments", abr=1),
        _hls_format("no-url", url="", abr=1),
        _hls_format("no-audio", acodec="none", abr=1),
    ]
    assert pipeline._pick_hls_audio_stream({"formats": rejected}) is None
    assert pipeline._pick_hls_audio_stream({}) is None
    headers = {"User-Agent": "Test Agent", "Referer": "https://www.youtube.com/"}
    formats = [
        *rejected, _hls_format("234", abr=48, tbr=1), _hls_format("235", abr=32),
        _hls_format("233", protocol="M3U8", tbr=32, http_headers=headers), _hls_format("unknown"),
    ]
    assert pipeline._pick_hls_audio_stream({"formats": formats}) == ("https://media.test/233.m3u8", headers)
    assert pipeline._pick_hls_audio_stream({"formats": [_hls_format()]}) == ("https://media.test/233.m3u8", {})


@pytest.mark.parametrize("acodec", [None, ""])
def test_pick_hls_audio_stream_accepts_youtube_233_with_unknown_audio_codec(acodec):
    yt_audio = {"format_id": "233", "vcodec": "none", "acodec": acodec,
                "protocol": "m3u8_native", "abr": None, "url": "https://media.test/233.m3u8"}
    no_audio = {**yt_audio, "format_id": "000", "audio_ext": "none", "abr": 1}
    higher_format = {**yt_audio, "format_id": "234", "url": "https://media.test/234.m3u8"}
    assert pipeline._pick_hls_audio_stream({"formats": [no_audio, higher_format, yt_audio]}) == (yt_audio["url"], {})
    assert pipeline._pick_hls_audio_stream({"formats": [no_audio]}) is None


def test_extract_remote_hls_audio_passes_input_options_and_checks_output(tmp_path, monkeypatch):
    url = _hls_format()["url"]
    path = tmp_path / "stt-hls-02.mp3"
    run = Mock(side_effect=lambda cmd, timeout: Path(cmd[-1]).write_bytes(b"mp3"))
    monkeypatch.setattr(pipeline, "_run", run)
    assert pipeline._extract_remote_hls_audio(url, {"User-Agent": "Test", "Referer": URL},
                                             22.5, 22.6, str(tmp_path), 2) == str(path)
    run.assert_called_once_with([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-headers", f"User-Agent: Test\r\nReferer: {URL}\r\n",
        "-ss", "22.500", "-t", "0.500", "-i", url,
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", str(path),
    ], timeout=60)
    path.write_bytes(b"")
    run.side_effect = None
    assert pipeline._extract_remote_hls_audio(url, {}, 1, 3, str(tmp_path), 2) is None
    assert "-headers" not in run.call_args.args[0]
    run.side_effect = RuntimeError("ffmpeg failed")
    assert pipeline._extract_remote_hls_audio(url, {}, 1, 3, str(tmp_path), 2) is None


@pytest.fixture
def routing(monkeypatch):
    state = SimpleNamespace(vtt=None, duration=1800, windows=[(5, 15)], heatmap=None, section_failure=False)

    def fetch(url, workdir):
        if state.vtt is None:
            return None
        path = Path(workdir) / "source.en.vtt"
        path.write_text(state.vtt)
        return str(path)

    def fake_yt_dlp(cmd):
        assert cmd[0] == "yt-dlp"
        Path(cmd[cmd.index("-o") + 1].replace("%(ext)s", "mp4")).touch()

    async def manual_section(job, index, moment, workdir):
        if state.section_failure:
            raise RuntimeError("section unavailable")
        return str(Path(workdir) / "section.mp4"), moment.start

    def render_one(video, moment, cues, outdir, filename, *args, **kwargs):
        Path(outdir, filename).write_bytes(b"clip")

    state.fetch = Mock(side_effect=fetch)
    state.audio = Mock(return_value="audio.m4a")
    state.stt = Mock(side_effect=lambda path, wd, **kw: [
        Cue(kw["offset_sec"], kw["offset_sec"] + 1, "STT dialog"),
    ])
    state.scan = Mock(side_effect=lambda *args, **kwargs: state.windows)
    state.select = Mock(return_value=[Moment(start=5, end=10, title="test")])
    state.captions = Mock(return_value=[])
    state.render = Mock(side_effect=render_one)
    monkeypatch.setattr(pipeline, "_fetch_subtitles", state.fetch)
    monkeypatch.setattr(pipeline, "_run", fake_yt_dlp)
    monkeypatch.setattr(pipeline, "_download_one_section", manual_section)
    monkeypatch.setattr(pipeline, "_probe_duration", lambda path: state.duration)
    monkeypatch.setattr(pipeline, "_fetch_video_meta", lambda url: {"duration": state.duration, "heatmap": state.heatmap})
    monkeypatch.setattr(pipeline, "_download_audio_section", state.audio)
    monkeypatch.setattr(pipeline.live_chat, "probe_live_chat_windows", state.scan)
    monkeypatch.setattr(stt, "is_stt_configured", lambda: True)
    monkeypatch.setattr(stt, "transcribe_media_file", state.stt)
    monkeypatch.setattr(pipeline.llm, "select_moments", state.select)
    monkeypatch.setattr(pipeline.llm, "generate_captions", state.captions)
    monkeypatch.setattr(pipeline, "_render_one", state.render)
    monkeypatch.setattr(pipeline, "_check_free_space", lambda path: None)
    return state


@pytest.mark.parametrize("operation", ["preview", "auto", "manual"])
@pytest.mark.parametrize("source,vtt,expected,fetches", [
    ("youtube", VTT, "YouTube dialog", 1),
    ("youtube", None, None, 1),
    ("auto", VTT, "YouTube dialog", 1),
    ("auto", None, "STT dialog", 1),
    ("auto", "WEBVTT\n", "STT dialog", 1),
    ("live_chat_stt", VTT, "STT dialog", 0),
])
def test_transcript_source_routing(tmp_path, routing, operation, source, vtt, expected, fetches):
    routing.vtt = vtt
    data = {"jobId": "test-job", "url": URL, "transcriptSource": source, "captionLanguage": "id"}
    progress = Mock()
    if operation == "preview":
        run = pipeline.run_preview(data, str(tmp_path), on_progress=progress)
    else:
        run = pipeline.run_job({**data, "mode": operation, "ranges": [{"start": 5, "end": 10}]},
                               progress, clips_dir=str(tmp_path), temp_root=str(tmp_path))
    if expected:
        result = asyncio.run(run)
        if operation == "preview":
            assert [cue["text"] for cue in result["cues"]] == [expected]
        else:
            assert result.clips and result.clips[0].transcript == expected
            assert [cue.text for cue in routing.captions.call_args.args[1]] == [expected]
            assert [cue.text for cue in routing.render.call_args.args[2]] == [expected]
    else:
        with pytest.raises(RuntimeError, match=pipeline.NO_SUBTITLE_ERROR):
            asyncio.run(run)
    assert routing.fetch.call_count == fetches
    assert routing.stt.call_count == (expected == "STT dialog")
    if expected == "STT dialog":
        assert routing.scan.call_count == (operation != "manual")
        assert routing.audio.call_count == (operation == "preview")
        assert routing.stt.call_args.kwargs == {"offset_sec": 5, "language": "id", **(
            {"start": 5, "end": 15} if operation == "auto" else {}
        )}
        assert any(call.args[0] == "transcribe" for call in progress.call_args_list)


@pytest.mark.parametrize("operation", ["preview", "auto"])
def test_long_live_chat_stt_tries_youtube_as_last_resort(tmp_path, routing, operation):
    routing.windows = []
    data = {"jobId": "test-job", "url": URL, "transcript_source": "live_chat_stt"}

    def run():
        if operation == "preview":
            return asyncio.run(pipeline.run_preview(data, str(tmp_path)))
        return asyncio.run(pipeline.run_job(data, clips_dir=str(tmp_path), temp_root=str(tmp_path)))

    with pytest.raises(RuntimeError, match=pipeline.NO_LIVE_CHAT_LONG_VIDEO_ERROR.split(".")[0]):
        run()
    routing.vtt = VTT
    assert run()
    assert routing.fetch.call_count == 2
    routing.stt.assert_not_called()


def test_download_audio_section_prefers_audio_only(monkeypatch, tmp_path):
    def fake_run(cmd, timeout):
        assert cmd[cmd.index("-f") + 1] == "ba[ext=m4a]/ba/b"
        assert cmd[cmd.index("--download-sections") + 1] == "*12.500-41.000"
        prefix = cmd[cmd.index("-o") + 1]
        Path(prefix.replace("%(ext)s", "m4a.part")).touch()
        Path(prefix.replace("%(ext)s", "m4a")).touch()

    monkeypatch.setattr(pipeline, "_run", fake_run)
    assert pipeline._download_audio_section(URL, 12.5, 41, str(tmp_path), 1) == str(tmp_path / "stt-section-01.m4a")


@pytest.mark.parametrize("hls", ["available", "failed", "absent"])
def test_preview_hls_falls_back_to_section_download(tmp_path, monkeypatch, routing, hls):
    fmt = _hls_format(abr=32, http_headers={"User-Agent": "Test"})
    meta = Mock(return_value={"duration": 1800, "formats": [fmt] if hls != "absent" else []})
    remote = Mock(return_value="fast.mp3" if hls == "available" else None)
    monkeypatch.setattr(pipeline, "_fetch_video_meta", meta)
    monkeypatch.setattr(pipeline, "_extract_remote_hls_audio", remote)
    result = asyncio.run(pipeline.run_preview({"url": URL, "transcriptSource": "live_chat_stt"}, str(tmp_path)))
    assert result["cues"][0]["start"] == 5
    meta.assert_called_once_with(URL)
    if hls == "absent":
        remote.assert_not_called()
    else:
        assert remote.call_args.args[:4] == (fmt["url"], fmt["http_headers"], 5, 15)
        assert remote.call_args.args[-1] == 1
    if hls == "available":
        routing.audio.assert_not_called()
        assert routing.stt.call_args.args[0] == "fast.mp3"
    else:
        assert routing.audio.call_args.args[:3] == (URL, 5, 15)
        assert routing.stt.call_args.args[0] == "audio.m4a"


def test_auto_windows_run_concurrently_with_bounded_slots_and_sorted_cues(tmp_path, monkeypatch, routing):
    routing.windows = [(start, start + 10) for start in (80, 20, 70, 30, 60, 40)]
    monkeypatch.setattr(pipeline, "MAX_STT_WINDOW_CONCURRENCY", 2)
    first_pair = Barrier(2, timeout=5)
    later_finished = Event()
    guard = Lock()
    active = peak = 0
    progress = []

    async def on_progress(stage, percent, message):
        await asyncio.sleep(0)
        progress.append((stage, percent, message))

    def transcribe(path, workdir, *, start, end, offset_sec, language):
        nonlocal active, peak
        with guard:
            active += 1
            peak = max(peak, active)
        try:
            if start in (80, 20):
                first_pair.wait()
                if start == 80:
                    assert later_finished.wait(timeout=5)
            return [Cue(start, end, "dialog")]
        finally:
            with guard:
                active -= 1
            if start == 20:
                later_finished.set()

    monkeypatch.setattr(stt, "transcribe_media_file", transcribe)
    cues = asyncio.run(pipeline._transcribe_auto_windows(
        URL, str(tmp_path), "video.mp4", None, 3, "auto", "en", on_progress,
    ))
    assert peak == 2
    assert [cue.start for cue in cues] == [20, 30, 40, 60, 70, 80]
    assert [entry for entry in progress if entry[2].startswith("mentranskrip segmen")] == [
        ("transcribe", index * 100 / 6, f"mentranskrip segmen {index}/6...") for index in range(1, 7)
    ]
    routing.audio.assert_not_called()


def test_auto_uses_heatmap_or_bounded_direct_stt(tmp_path, routing):
    routing.windows = []
    routing.heatmap = [{"start_time": 100, "end_time": 120, "value": 1}]
    data = {"url": URL, "transcript_source": "auto"}
    asyncio.run(pipeline.run_preview(data, str(tmp_path)))
    assert routing.audio.call_args.args[1:3] == (70.0, 150.0)
    routing.heatmap = None
    asyncio.run(pipeline.run_preview({**data, "maxSourceSec": 1200}, str(tmp_path)))
    assert routing.audio.call_args.args[1:3] == (0.0, 1200.0)


def test_manual_full_video_fallback_transcribes_only_each_range(tmp_path, routing):
    routing.section_failure = True
    data = {"jobId": "test-job", "url": URL, "mode": "manual", "transcriptSource": "live_chat_stt",
            "ranges": [{"start": 0, "end": 10}, {"start": 20, "end": 35}]}
    asyncio.run(pipeline.run_job(data, clips_dir=str(tmp_path), temp_root=str(tmp_path)))
    assert [call.kwargs for call in routing.stt.call_args_list] == [
        {"start": 0, "end": 10, "offset_sec": 0, "language": "auto"},
        {"start": 20, "end": 35, "offset_sec": 20, "language": "auto"},
    ]
    assert [cue.start for cue in routing.captions.call_args.args[1]] == [0, 20]
    assert [[cue.start for cue in call.args[2]] for call in routing.render.call_args_list] == [[0], [20]]


def test_preview_reports_clear_error_when_stt_is_unconfigured_or_empty(tmp_path, monkeypatch, routing):
    data = {"url": URL, "transcript_source": "auto"}
    routing.stt.side_effect = None
    routing.stt.return_value = []
    with pytest.raises(RuntimeError, match=pipeline.NO_STT_CUES_ERROR):
        asyncio.run(pipeline.run_preview(data, str(tmp_path)))
    monkeypatch.setattr(stt, "is_stt_configured", lambda: False)
    with pytest.raises(RuntimeError, match=pipeline.STT_NOT_CONFIGURED_ERROR):
        asyncio.run(pipeline.run_preview(data, str(tmp_path)))
