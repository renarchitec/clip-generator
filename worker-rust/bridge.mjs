import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { Worker } from 'bullmq';
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL wajib diisi');
const frameConcurrency = Number(process.env.FRAME_CONCURRENCY || 1);
if (!Number.isSafeInteger(frameConcurrency) || frameConcurrency < 1) {
  throw new Error('FRAME_CONCURRENCY harus bilangan bulat positif');
}

const binary = process.env.DARTCLIP_WORKER_BIN || 'dartclip-worker';
const statusKey = 'worker:status:llm';
const shutdown = new AbortController();
const children = new Set();
const workers = [];
const warn = (where, error) => console.warn(`${where}:`, error?.message ?? error);
const redis = new Redis(redisUrl, {
  connectTimeout: 5_000,
  commandTimeout: 5_000,
  maxRetriesPerRequest: 1,
});
redis.on('error', () => {}); // Commands and the startup probe report failures.
let queueRedis;
let heartbeat;
const envText = (name) => (process.env[name] || '').trim();
const envUrl = (name) => envText(name).replace(/\/+$/, '');

// Mirror SttConfig::from_env() until a Rust worker reports its status.
function initialSttStatus() {
  const llmUrl = envUrl('LLM_BASE_URL');
  const llmKey = envText('LLM_API_KEY');
  const sttUrl = envUrl('STT_BASE_URL') || llmUrl;
  const sttKey = envText('STT_API_KEY') || llmKey;
  const whisperModel = envText('STT_MODEL') || 'groq/whisper-large-v3-turbo';
  const fallbackUrl = envUrl('STT_FALLBACK_BASE_URL') || llmUrl || sttUrl;
  const fallbackKey = envText('STT_FALLBACK_API_KEY') || llmKey || sttKey;
  const fallbackModel = process.env.STT_FALLBACK_MODEL === undefined
    ? 'ag/gemini-4-hydrogen-low'
    : envText('STT_FALLBACK_MODEL');
  const whisperConfigured = Boolean(sttUrl.trim() && sttKey && whisperModel);
  const fallbackConfigured = Boolean(fallbackUrl.trim() && fallbackKey && fallbackModel);
  return {
    sttConfigured: whisperConfigured || fallbackConfigured,
    sttModel: whisperConfigured ? whisperModel : fallbackConfigured ? fallbackModel : null,
  };
}

let llmStatus = {
  configured: ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'].every(envText),
  model: envText('LLM_MODEL') || null,
  ...initialSttStatus(),
  lastCall: null,
};

function recordStatus(status) {
  if (typeof status?.configured !== 'boolean') return;
  const last = llmStatus.lastCall;
  const next = status.lastCall;
  llmStatus = {
    configured: status.configured,
    model: status.model ?? null,
    sttConfigured: typeof status.sttConfigured === 'boolean' ? status.sttConfigured : llmStatus.sttConfigured,
    sttModel: typeof status.sttModel === 'string' || status.sttModel === null ? status.sttModel : llmStatus.sttModel,
    lastCall: next && (!last || Date.parse(next.at) >= Date.parse(last.at)) ? next : last,
  };
}

async function publishStatus() {
  try {
    await redis.set(statusKey, JSON.stringify({
      ...llmStatus, updatedAt: new Date().toISOString(),
    }), 'EX', 90);
  } catch (error) {
    warn('gagal memperbarui status LLM di Redis', error);
  }
}

async function waitForRedis() {
  for (let attempt = 1; attempt <= 60; attempt++) {
    if (shutdown.signal.aborted) return;
    try {
      await redis.ping();
      return;
    } catch (error) {
      warn(`Redis belum siap (percobaan ${attempt})`, error);
    }
    if (attempt < 60) await sleep(5_000, undefined, { signal: shutdown.signal });
  }
  throw new Error('Redis tidak bisa dihubungi');
}

async function runTask(task, job, cancelKey) {
  if (shutdown.signal.aborted) throw new Error('worker_shutdown');
  async function isCancelled() {
    if (!cancelKey) return false;
    try {
      return Boolean(await redis.exists(cancelKey));
    } catch (error) {
      warn(`gagal cek pembatalan job ${job.id}`, error);
      return false;
    }
  }
  if (await isCancelled()) throw new Error('job dibatalkan');
  if (shutdown.signal.aborted) throw new Error('worker_shutdown');

  const payload = JSON.stringify(job.data ?? {});
  // A separate process group lets us reap orphan tool processes after cancellation.
  const group = process.platform !== 'win32';
  const child = spawn(binary, ['--task', task, '--payload-stdin'], {
    detached: group,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let result;
  let workerError;
  let spawnError;
  let stopReason;
  let killTimer;
  let closed = false;
  function killGroup() {
    if (!child.pid) return;
    try {
      if (group) process.kill(-child.pid, 'SIGKILL');
      else if (!closed) child.kill('SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') warn(`gagal menghentikan subprocess job ${job.id}`, error);
    }
  }
  function stop(reason) {
    if (closed || stopReason) return;
    stopReason = reason;
    child.kill('SIGTERM');
    killTimer = setTimeout(killGroup, 5_000);
  }
  children.add(stop);
  const exited = new Promise((resolve) => {
    child.once('close', (code) => {
      closed = true;
      children.delete(stop);
      clearTimeout(killTimer);
      if (stopReason || code !== 0) killGroup();
      resolve(code);
    });
    child.on('error', (error) => { spawnError = error; });
  });
  child.stdin.on('error', (error) => {
    if (error.code !== 'EPIPE') warn(`gagal kirim payload job ${job.id}`, error);
  });
  child.stdin.end(payload);

  let checking = false;
  const poller = cancelKey && setInterval(async () => {
    if (checking || closed || stopReason) return;
    checking = true;
    try {
      if (await isCancelled()) stop('job dibatalkan');
    } finally {
      checking = false;
    }
  }, 1_000);
  const timeout = task === 'frame' && setTimeout(() => stop('frame_render_failed'), 120_000);
  try {
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        stop('invalid_worker_protocol');
        continue;
      }
      recordStatus(event?.llmStatus);
      if (event?.type === 'progress') {
        try {
          await job.updateProgress(event.data);
        } catch (error) {
          warn(`gagal kirim progress job ${job.id}`, error);
        }
      } else if (event?.type === 'result') {
        result = event.data;
      } else if (event?.type === 'error') {
        workerError = event.message;
      } else {
        stop('invalid_worker_protocol');
      }
    }
    const code = await exited;
    if (stopReason) throw new Error(stopReason);
    if (spawnError) throw spawnError;
    if (code !== 0 || !result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error(workerError || 'dartclip_worker_failed');
    }
    return result;
  } finally {
    clearInterval(poller);
    clearTimeout(timeout);
    if (!closed) stop('dartclip_worker_failed');
    await exited;
  }
}

function processor(taskForJob) {
  return async (job) => {
    const task = taskForJob(job);
    const cancelKey = task === 'job' ? `cancel:${job.data?.jobId ?? job.data?.job_id ?? job.id}` : null;
    try {
      return await runTask(task, job, cancelKey);
    } catch (error) {
      if (task === 'caption' || task === 'brief') {
        warn(`caption job ${job.id} gagal`, error);
        throw new Error('caption_unavailable');
      }
      throw error;
    } finally {
      if (cancelKey) {
        try {
          await redis.del(cancelKey);
        } catch (error) {
          warn(`gagal hapus tanda pembatalan job ${job.id}`, error);
        }
      }
      await publishStatus();
    }
  };
}

function requestShutdown() {
  shutdown.abort();
  for (const stop of children) stop('worker_shutdown');
}
process.on('SIGTERM', requestShutdown);
process.on('SIGINT', requestShutdown);

try {
  await waitForRedis();
  if (!shutdown.signal.aborted) {
    await publishStatus();
    if (!shutdown.signal.aborted) {
      heartbeat = setInterval(() => void publishStatus(), 30_000);
      queueRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
      queueRedis.on('error', (error) => warn('Redis BullMQ', error));
      for (const [queue, concurrency, task] of [
        ['clip-jobs', 1, () => 'job'],
        ['previews', 2, () => 'preview'],
        ['captions', 2, (job) => {
          if (job.name === 'brief') return 'brief';
          if (job.name === 'generate-image') return 'generate-image';
          if (job.name === 'find-moment') return 'find-moment';
          if (job.name === 'capture-frame') return 'capture-frame';
          return 'caption';
        }],
        ['clip-frames', frameConcurrency, () => 'frame'],
      ]) {
        const worker = new Worker(queue, processor(task), { connection: queueRedis, concurrency });
        workers.push(worker);
        worker.on('error', (error) => warn(queue, error));
      }
      console.log('dartclip-worker: consumer BullMQ siap');
      await new Promise((resolve) => shutdown.signal.addEventListener('abort', resolve, { once: true }));
    }
  }
} catch (error) {
  if (!shutdown.signal.aborted) {
    warn('dartclip-worker bridge', error);
    process.exitCode = 1;
  }
} finally {
  requestShutdown();
  clearInterval(heartbeat);
  // Don't wait forever for Redis after a network partition during shutdown.
  const deadline = setTimeout(() => {
    queueRedis?.disconnect();
    redis.disconnect();
    process.exit(1);
  }, 20_000);
  await Promise.allSettled(workers.map((worker) => worker.close()));
  queueRedis?.disconnect();
  redis.disconnect();
  clearTimeout(deadline);
}
