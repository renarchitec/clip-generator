import pytest

from clipper.models import DEFAULT_TRANSCRIPT_SOURCE, job_data_from_dict, to_transcript_source


@pytest.mark.parametrize("value,expected", [
    (" YouTube ", "youtube"), (" AUTO ", "auto"), ("LIVE_CHAT_STT", "live_chat_stt"),
    ("unknown", "youtube"), (None, "youtube"), (1, "youtube"), ([], "youtube"),
])
def test_parse_transcript_source_tolerantly(value, expected):
    assert to_transcript_source(value) == expected


def test_job_defaults_and_round_trips_transcript_source():
    data = {"jobId": "my-job", "url": "https://youtu.be/example"}
    assert job_data_from_dict(data).transcript_source == DEFAULT_TRANSCRIPT_SOURCE == "youtube"
    for key, value in [("transcriptSource", "auto"), ("transcript_source", "live_chat_stt")]:
        job = job_data_from_dict({**data, key: value})
        assert job.transcript_source == value
        assert job.to_dict()["transcriptSource"] == value
        assert job_data_from_dict(job.to_dict()) == job
