from clipper import pipeline


def test_default_encoder_is_libx264(monkeypatch):
    monkeypatch.delenv("VIDEO_ENCODER", raising=False)
    args = pipeline._video_codec_args(23)
    assert args == ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23"]


def test_videotoolbox_when_available(monkeypatch):
    monkeypatch.setenv("VIDEO_ENCODER", "h264_videotoolbox")
    monkeypatch.setattr(pipeline, "_ENCODER_CACHE", {})
    monkeypatch.setattr(pipeline, "_run", lambda cmd, **kw: " V....D h264_videotoolbox  VT\n")
    args = pipeline._video_codec_args(23)
    assert args[:2] == ["-c:v", "h264_videotoolbox"]
    assert "-crf" not in args and "-q:v" in args


def test_unavailable_encoder_falls_back(monkeypatch):
    monkeypatch.setenv("VIDEO_ENCODER", "h264_videotoolbox")
    monkeypatch.setattr(pipeline, "_ENCODER_CACHE", {})
    monkeypatch.setattr(pipeline, "_run", lambda cmd, **kw: " V....D libx264  x264\n")
    assert pipeline._video_encoder() == "libx264"


def test_subtitles_filter_fontsdir(monkeypatch):
    monkeypatch.delenv("FONTS_DIR", raising=False)
    assert pipeline._subtitles_filter("/t/a.ass") == "subtitles=/t/a.ass"
    monkeypatch.setenv("FONTS_DIR", "/f")
    assert pipeline._subtitles_filter("/t/a.ass") == "subtitles=/t/a.ass:fontsdir=/f"
