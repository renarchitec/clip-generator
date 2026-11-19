import asyncio

import pytest

from clipper import pipeline
from clipper.models import JobData, JobParams


def test_check_cancel_not_cancelled():
    assert asyncio.run(pipeline._check_cancel(lambda: False)) is None
    assert asyncio.run(pipeline._check_cancel(lambda: False)) is None


def test_check_cancel_triggered():
    with pytest.raises(pipeline.JobCancelled):
        asyncio.run(pipeline._check_cancel(lambda: True))


def test_run_job_aborts_before_download(tmp_path):
    calls = {"n": 0}

    async def should_cancel():
        calls["n"] += 1
        return True

    job = JobData(
        job_id="jobcancel1",
        url="https://youtube.com/watch?v=x",
        mode="manual",
        params=JobParams(),
        ranges=[],
    )

    with pytest.raises(pipeline.JobCancelled):
        asyncio.run(
            pipeline.run_job(
                job,
                clips_dir=str(tmp_path / "clips"),
                temp_root=str(tmp_path),
                should_cancel=should_cancel,
            )
        )

    assert calls["n"] == 1  # berhenti di batas tahap pertama, tidak sampai download
    # folder sementara tetap dibersihkan walau dibatalkan
    assert list(tmp_path.glob("clip-jobcancel1-*")) == []
