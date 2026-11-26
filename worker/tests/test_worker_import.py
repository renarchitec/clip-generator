"""Regression test for worker initialization without Redis or BullMQ."""

import importlib.util
import sys
import types


def test_worker_import_initializes_default_clips_dir(monkeypatch):
    fake_redis = types.ModuleType("redis")
    fake_redis_async = types.ModuleType("redis.asyncio")
    fake_redis_async.Redis = object
    fake_redis.asyncio = fake_redis_async
    fake_bullmq = types.ModuleType("bullmq")
    fake_bullmq.Worker = object
    monkeypatch.setitem(sys.modules, "redis", fake_redis)
    monkeypatch.setitem(sys.modules, "redis.asyncio", fake_redis_async)
    monkeypatch.setitem(sys.modules, "bullmq", fake_bullmq)

    # Execute a fresh module without leaving a worker backed by stubs cached.
    spec = importlib.util.find_spec("clipper.worker")
    assert spec is not None and spec.loader is not None
    worker = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, worker)
    spec.loader.exec_module(worker)

    assert worker.DEFAULT_CLIPS_DIR == worker.clips_dir()
