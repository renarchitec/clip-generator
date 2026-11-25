import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { AppConfig } from '../config/app-config.service';
import { LLM_STATUS_KEY } from '../system/llm-status.constants';
import {
  CAPTION_QUEUE_NAME,
  FRAME_QUEUE_NAME,
  PREVIEW_QUEUE_NAME,
  PUBLISH_QUEUE_NAME,
  QUEUE_NAME,
  REFERENCE_QUEUE_NAME,
} from './queue.constants';

export type LocalJobState = 'waiting' | 'active' | 'completed' | 'failed';

export interface LocalJobRecord {
  id: string;
  queueName: string;
  name: string;
  data: unknown;
  state: LocalJobState;
  returnvalue?: unknown;
  failedReason?: string;
  createdAt: number;
  finishedAt?: number;
  child?: ChildProcess;
  cancelFile?: string;
  cancelled?: boolean;
  resolveDone?: (value: unknown) => void;
  rejectDone?: (reason: Error) => void;
  donePromise: Promise<unknown>;
}

/**
 * Kredensial/konfigurasi LLM desktop yang dibaca dari file lokal (diisi oleh Electron).
 * Di luar repositori; tidak pernah di-commit.
 */
export interface DesktopLlmConfig {
  nineRouterUrl?: string;
  nineRouterApiKey?: string;
  nineRouterModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  videoEncoder?: 'libx264' | 'h264_videotoolbox';
}

const MAX_RETAINED_JOBS = 200;

/**
 * Adapter antrean lokal pengganti BullMQ/Redis di mode desktop.
 *
 * Menyediakan subset API BullMQ (`Queue` + `QueueEvents` + `queue.client` KV sederhana)
 * sehingga seluruh service API (`JobsService`, `QueueListener`, `PreviewsService`,
 * `FramesService`, `ClipCaptionsService`, `BriefsService`, `LlmStatusService`,
 * `ReferenceJobsService`) bekerja tanpa mengubah perilaku mode server.
 *
 * Konkurensi per antrean:
 * - `clip-jobs` dan `reference-jobs`: 1 (render video maks 1 bersamaan)
 * - `previews`, `clip-frames`, `captions`: 2 (ringan / non-render paralel)
 */
@Injectable()
export class LocalQueueBackend implements OnApplicationShutdown {
  private readonly logger = new Logger(LocalQueueBackend.name);
  private readonly kv = new Map<string, string>();
  private readonly events = new Map<string, EventEmitter>();
  private readonly queues = new Map<string, LocalQueueAdapter>();
  private readonly jobsByQueue = new Map<string, Map<string, LocalJobRecord>>();
  private readonly waitingByQueue = new Map<string, LocalJobRecord[]>();
  private readonly activeCountByQueue = new Map<string, number>();

  /** Provider env LLM opsional (disuntik Electron saat runtime jika pakai safeStorage). */
  private llmEnvProvider: (() => Record<string, string>) | null = null;

  /** Konfigurasi LLM/encoder in-memory yang didorong oleh proses utama Electron. */
  private runtimeConfig: DesktopLlmConfig | null = null;

  constructor(private readonly config: AppConfig) {}

  setLlmEnvProvider(provider: () => Record<string, string>): void {
    this.llmEnvProvider = provider;
  }

  setRuntimeConfig(config: DesktopLlmConfig): void {
    this.runtimeConfig = { ...config };
    this.refreshLlmStatus();
  }

  getQueue<T = unknown>(name: string): LocalQueueAdapter<T> {
    let adapter = this.queues.get(name);
    if (!adapter) {
      adapter = new LocalQueueAdapter<T>(name, this);
      this.queues.set(name, adapter);
    }
    return adapter as LocalQueueAdapter<T>;
  }

  getQueueEvents(name: string): LocalQueueEventsAdapter {
    return new LocalQueueEventsAdapter(this.emitterFor(name));
  }

  /** Klien KV pengganti ioredis untuk cancel key & LLM status. */
  get kvClient() {
    return {
      get: async (key: string): Promise<string | null> => {
        if (key === LLM_STATUS_KEY) {
          return this.kv.get(key) ?? JSON.stringify(this.buildFallbackLlmStatus());
        }
        return this.kv.get(key) ?? null;
      },
      set: async (key: string, value: string, _opts?: unknown): Promise<'OK'> => {
        this.kv.set(key, value);
        if (key.startsWith('cancel:')) {
          const jobId = key.slice('cancel:'.length);
          this.cancelActiveJob(jobId);
        }
        return 'OK';
      },
      del: async (key: string): Promise<number> => {
        return this.kv.delete(key) ? 1 : 0;
      },
    };
  }

  async onApplicationShutdown(): Promise<void> {
    for (const records of this.jobsByQueue.values()) {
      for (const record of records.values()) {
        if (record.child && !record.child.killed) {
          record.child.kill('SIGTERM');
        }
      }
    }
  }

  /** Cek status LLM saat ini berdasarkan env/konfigurasi desktop (tanpa memanggil API eksternal). */
  buildFallbackLlmStatus(): {
    configured: boolean;
    model: string | null;
    lastCall: { ok: boolean; at: string; error?: string } | null;
    updatedAt: string;
  } {
    const env = this.resolveLlmEnv();
    const hasRouter = Boolean(env.NINEROUTER_API_KEY);
    const hasGemini = Boolean(env.GEMINI_API_KEY);
    const hasOpenai = Boolean(env.OPENAI_API_KEY);
    const hasDirect = Boolean(env.LLM_BASE_URL && env.LLM_API_KEY);
    const configured = hasRouter || hasGemini || hasOpenai || hasDirect;
    const model = hasDirect
      ? env.LLM_MODEL || null
      : hasRouter
        ? env.NINEROUTER_MODEL || 'tabi-fixer'
        : hasGemini
          ? env.GEMINI_MODEL || 'gemini-2.5-flash'
          : hasOpenai
            ? env.OPENAI_MODEL || 'gpt-4o-mini'
            : null;
    return {
      configured,
      model,
      lastCall: null,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Perbarui cache status LLM setelah pengguna mengubah Settings desktop. */
  refreshLlmStatus(): void {
    const prevRaw = this.kv.get(LLM_STATUS_KEY);
    let prevLastCall: { ok: boolean; at: string; error?: string } | null = null;
    if (prevRaw) {
      try {
        prevLastCall = (JSON.parse(prevRaw) as { lastCall?: typeof prevLastCall }).lastCall ?? null;
      } catch {
        prevLastCall = null;
      }
    }
    const next = { ...this.buildFallbackLlmStatus(), lastCall: prevLastCall };
    this.kv.set(LLM_STATUS_KEY, JSON.stringify(next));
  }

  /** @internal */
  enqueue(
    queueName: string,
    name: string,
    data: unknown,
    opts?: { jobId?: string },
  ): LocalJobRecord {
    const id = opts?.jobId ?? randomUUID();
    let resolveDone!: (value: unknown) => void;
    let rejectDone!: (reason: Error) => void;
    const donePromise = new Promise<unknown>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    // Cegah unhandledRejection bila tidak ada pemanggil waitUntilFinished.
    donePromise.catch(() => undefined);

    const record: LocalJobRecord = {
      id,
      queueName,
      name,
      data,
      state: 'waiting',
      createdAt: Date.now(),
      resolveDone,
      rejectDone,
      donePromise,
    };

    const map = this.recordsFor(queueName);
    map.set(id, record);
    this.pruneOldRecords(map);

    if (queueName === PUBLISH_QUEUE_NAME) {
      record.state = 'failed';
      record.failedReason = 'Publish sosial belum aktif di mode desktop (fase 3).';
      record.finishedAt = Date.now();
      record.rejectDone?.(new Error(record.failedReason));
      return record;
    }

    const waiting = this.waitingFor(queueName);
    waiting.push(record);
    this.pump(queueName);
    return record;
  }

  /** @internal */
  getJobRecord(queueName: string, jobId: string): LocalJobRecord | undefined {
    return this.recordsFor(queueName).get(jobId);
  }

  /** @internal */
  getJobsByStates(queueName: string, states: string[]): LocalJobRecord[] {
    const wanted = new Set(states);
    const out: LocalJobRecord[] = [];
    for (const rec of this.recordsFor(queueName).values()) {
      if (wanted.has(rec.state)) out.push(rec);
    }
    return out;
  }

  /** @internal */
  removeWaitingJob(queueName: string, jobId: string): void {
    const waiting = this.waitingFor(queueName);
    const idx = waiting.findIndex((item) => item.id === jobId);
    if (idx !== -1) {
      const [removed] = waiting.splice(idx, 1);
      removed.cancelled = true;
      removed.state = 'failed';
      removed.failedReason = 'Dibatalkan oleh pengguna.';
      removed.finishedAt = Date.now();
      removed.rejectDone?.(new Error(removed.failedReason));
    }
    this.recordsFor(queueName).delete(jobId);
  }

  private cancelActiveJob(jobId: string): void {
    for (const [queueName, records] of this.jobsByQueue.entries()) {
      const rec = records.get(jobId);
      if (!rec) continue;
      rec.cancelled = true;
      if (rec.state === 'waiting') {
        this.removeWaitingJob(queueName, jobId);
        continue;
      }
      if (rec.state === 'active') {
        if (rec.cancelFile) {
          try {
            mkdirSync(path.dirname(rec.cancelFile), { recursive: true });
            writeFileSync(rec.cancelFile, '1');
          } catch {
            // abaikan
          }
        }
        if (rec.child && !rec.child.killed) {
          rec.child.kill('SIGTERM');
        }
      }
    }
  }

  private concurrencyFor(queueName: string): number {
    if (queueName === QUEUE_NAME || queueName === REFERENCE_QUEUE_NAME) return 1;
    return 2;
  }

  private pump(queueName: string): void {
    const max = this.concurrencyFor(queueName);
    let active = this.activeCountByQueue.get(queueName) ?? 0;
    const waiting = this.waitingFor(queueName);

    while (active < max && waiting.length > 0) {
      const next = waiting.shift()!;
      if (next.cancelled) continue;
      active += 1;
      this.activeCountByQueue.set(queueName, active);
      void this.runWorkerJob(next).finally(() => {
        const cur = (this.activeCountByQueue.get(queueName) ?? 1) - 1;
        this.activeCountByQueue.set(queueName, Math.max(0, cur));
        this.pump(queueName);
      });
    }
  }

  private taskTypeFor(record: LocalJobRecord): string {
    switch (record.queueName) {
      case QUEUE_NAME:
        return 'job';
      case PREVIEW_QUEUE_NAME:
        return 'preview';
      case FRAME_QUEUE_NAME:
        return 'frame';
      case CAPTION_QUEUE_NAME:
        return record.name === 'brief' ? 'brief' : 'caption';
      case REFERENCE_QUEUE_NAME:
        return 'reference';
      default:
        throw new Error(`Antrean lokal tidak dikenal: ${record.queueName}`);
    }
  }

  private async runWorkerJob(record: LocalJobRecord): Promise<void> {
    record.state = 'active';
    const task = this.taskTypeFor(record);
    const clipsDir = this.config.clipsDir;
    const tempDir = this.config.tempRoot || path.join(clipsDir, 'tmp');
    mkdirSync(clipsDir, { recursive: true });
    mkdirSync(tempDir, { recursive: true });

    const payloadFile = path.join(tempDir, `payload-${record.id}-${Date.now()}.json`);
    const cancelFile = path.join(tempDir, `cancel-${record.id}.flag`);
    record.cancelFile = cancelFile;
    writeFileSync(payloadFile, JSON.stringify(record.data ?? {}), 'utf8');

    const { command, baseArgs, cwd } = this.resolveWorkerCommand();
    const args = [
      ...baseArgs,
      '--task',
      task,
      '--payload-file',
      payloadFile,
      '--clips-dir',
      clipsDir,
      '--temp-dir',
      tempDir,
      '--cancel-file',
      cancelFile,
    ];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.resolveLlmEnv(),
      CLIPS_DIR: clipsDir,
      TEMP_ROOT: tempDir,
      PYTHONUNBUFFERED: '1',
    };

    const emitter = this.emitterFor(record.queueName);

    let resultPayload: unknown = undefined;
    let errorMessage: string | null = null;
    let cancelled = false;
    const stderrTail: string[] = [];

    try {
      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        record.child = child;

        const outRl = readline.createInterface({ input: child.stdout });
        outRl.on('line', (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            this.logger.debug(`[worker:${task}] ${trimmed}`);
            return;
          }

          const type = evt.event;
          if (type === 'progress') {
            const { event: _ignored, ...progressData } = evt;
            emitter.emit('progress', { jobId: record.id, data: progressData });
          } else if (type === 'result') {
            resultPayload = evt.data;
          } else if (type === 'llm_status') {
            const { event: _ignored, ...status } = evt;
            this.kv.set(LLM_STATUS_KEY, JSON.stringify(status));
          } else if (type === 'cancelled') {
            cancelled = true;
          } else if (type === 'error') {
            errorMessage =
              typeof evt.message === 'string' && evt.message.trim()
                ? evt.message.trim()
                : typeof evt.code === 'string'
                  ? evt.code
                  : 'Worker gagal.';
          }
        });

        const errRl = readline.createInterface({ input: child.stderr });
        errRl.on('line', (line) => {
          if (stderrTail.length >= 25) stderrTail.shift();
          stderrTail.push(line);
        });

        child.on('error', (err) => reject(err));
        child.on('close', (code) => {
          record.child = undefined;
          resolve(code ?? 1);
        });
      });

      if (cancelled || record.cancelled || exitCode === 130) {
        record.state = 'failed';
        record.failedReason = 'Job dibatalkan oleh pengguna.';
        record.finishedAt = Date.now();
        record.rejectDone?.(new Error(record.failedReason));
        return;
      }

      if (exitCode === 0 && resultPayload !== undefined) {
        record.state = 'completed';
        record.returnvalue = resultPayload;
        record.finishedAt = Date.now();
        emitter.emit('completed', { jobId: record.id, returnvalue: resultPayload });
        record.resolveDone?.(resultPayload);
      } else {
        const reason =
          errorMessage ||
          stderrTail.slice(-3).join(' | ').trim() ||
          `Worker keluar dengan kode ${exitCode}`;
        record.state = 'failed';
        record.failedReason = reason;
        record.finishedAt = Date.now();
        emitter.emit('failed', { jobId: record.id, failedReason: reason });
        record.rejectDone?.(new Error(reason));
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      record.state = 'failed';
      record.failedReason = reason;
      record.finishedAt = Date.now();
      emitter.emit('failed', { jobId: record.id, failedReason: reason });
      record.rejectDone?.(new Error(reason));
    } finally {
      try {
        unlinkSync(payloadFile);
      } catch {
        // abaikan
      }
      try {
        unlinkSync(cancelFile);
      } catch {
        // abaikan
      }
    }
  }

  private resolveWorkerCommand(): { command: string; baseArgs: string[]; cwd?: string } {
    const candidates = [
      this.config.workerBin,
      process.env.DARTCLIP_WORKER_BIN,
      path.resolve(__dirname, '../../../../worker/desktop/dist/dartclip-worker/dartclip-worker'),
      path.resolve(process.cwd(), 'worker/desktop/dist/dartclip-worker/dartclip-worker'),
      path.resolve(process.cwd(), '../../worker/desktop/dist/dartclip-worker/dartclip-worker'),
    ].filter((p): p is string => Boolean(p));

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return { command: candidate, baseArgs: [] };
      }
    }

    // Fallback dev: jalankan modul Python langsung dari venv worker bila binary belum dibuild.
    const repoRoot = path.resolve(__dirname, '../../../..');
    const devVenvPython = path.join(repoRoot, 'worker', 'desktop', '.venv', 'bin', 'python');
    if (existsSync(devVenvPython)) {
      return {
        command: devVenvPython,
        baseArgs: ['-m', 'clipper.local_cli'],
        cwd: path.join(repoRoot, 'worker'),
      };
    }

    throw new Error(
      'Worker binary dartclip-worker tidak ditemukan. Jalankan worker/desktop/build-mac.sh atau set DARTCLIP_WORKER_BIN.',
    );
  }

  private resolveLlmEnv(): Record<string, string> {
    if (this.llmEnvProvider) {
      return this.llmEnvProvider();
    }

    const env: Record<string, string> = {};
    const apply = (parsed: DesktopLlmConfig) => {
      if (parsed.nineRouterUrl) env.DARTCLIP_9ROUTER_URL = parsed.nineRouterUrl;
      if (parsed.nineRouterApiKey) env.NINEROUTER_API_KEY = parsed.nineRouterApiKey;
      if (parsed.nineRouterModel) env.NINEROUTER_MODEL = parsed.nineRouterModel;
      if (parsed.geminiApiKey) env.GEMINI_API_KEY = parsed.geminiApiKey;
      if (parsed.geminiModel) env.GEMINI_MODEL = parsed.geminiModel;
      if (parsed.openaiApiKey) env.OPENAI_API_KEY = parsed.openaiApiKey;
      if (parsed.openaiModel) env.OPENAI_MODEL = parsed.openaiModel;
      if (parsed.videoEncoder) env.VIDEO_ENCODER = parsed.videoEncoder;
    };

    const cfgPath = this.config.llmConfigPath || process.env.DARTCLIP_LLM_CONFIG_PATH;
    if (cfgPath && existsSync(cfgPath)) {
      try {
        apply(JSON.parse(readFileSync(cfgPath, 'utf8')) as DesktopLlmConfig);
      } catch (error) {
        this.logger.warn(
          `Gagal membaca konfigurasi LLM desktop: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (this.runtimeConfig) {
      apply(this.runtimeConfig);
    }
    return env;
  }

  /** Jalankan pemeriksaan koneksi LLM singkat melalui worker binary. */
  async testLlmConnection(): Promise<{
    ok: boolean;
    configured: boolean;
    provider?: string | null;
    model?: string | null;
    baseUrl?: string | null;
    error?: string | null;
  }> {
    const { command, baseArgs, cwd } = this.resolveWorkerCommand();
    const clipsDir = this.config.clipsDir;
    const tempDir = this.config.tempRoot || path.join(clipsDir, 'tmp');
    mkdirSync(clipsDir, { recursive: true });
    mkdirSync(tempDir, { recursive: true });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.resolveLlmEnv(),
      CLIPS_DIR: clipsDir,
      TEMP_ROOT: tempDir,
      PYTHONUNBUFFERED: '1',
    };

    return new Promise((resolve) => {
      const child = spawn(command, [...baseArgs, '--task', 'llm-check'], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let result: Record<string, unknown> | null = null;
      let errMsg: string | null = null;
      const outRl = readline.createInterface({ input: child.stdout });
      outRl.on('line', (line) => {
        try {
          const evt = JSON.parse(line.trim()) as Record<string, unknown>;
          if (evt.event === 'result' && evt.data && typeof evt.data === 'object') {
            result = evt.data as Record<string, unknown>;
          } else if (evt.event === 'llm_status') {
            const { event: _ignored, ...status } = evt;
            this.kv.set(LLM_STATUS_KEY, JSON.stringify(status));
          } else if (evt.event === 'error' && typeof evt.message === 'string') {
            errMsg = evt.message;
          }
        } catch {
          // abaikan baris log non-JSON
        }
      });
      child.on('error', (err) => {
        resolve({ ok: false, configured: false, error: err.message });
      });
      child.on('close', () => {
        if (result) {
          resolve({
            ok: Boolean(result.ok),
            configured: Boolean(result.configured),
            provider: (result.provider as string | null) ?? null,
            model: (result.model as string | null) ?? null,
            baseUrl: (result.baseUrl as string | null) ?? null,
            error: (result.error as string | null) ?? null,
          });
          return;
        }
        resolve({
          ok: false,
          configured: this.buildFallbackLlmStatus().configured,
          error: errMsg || 'Gagal menjalankan pemeriksaan LLM.',
        });
      });
    });
  }

  private emitterFor(queueName: string): EventEmitter {
    let emitter = this.events.get(queueName);
    if (!emitter) {
      emitter = new EventEmitter();
      this.events.set(queueName, emitter);
    }
    return emitter;
  }

  private recordsFor(queueName: string): Map<string, LocalJobRecord> {
    let map = this.jobsByQueue.get(queueName);
    if (!map) {
      map = new Map<string, LocalJobRecord>();
      this.jobsByQueue.set(queueName, map);
    }
    return map;
  }

  private waitingFor(queueName: string): LocalJobRecord[] {
    let list = this.waitingByQueue.get(queueName);
    if (!list) {
      list = [];
      this.waitingByQueue.set(queueName, list);
    }
    return list;
  }

  private pruneOldRecords(map: Map<string, LocalJobRecord>): void {
    if (map.size <= MAX_RETAINED_JOBS) return;
    for (const [id, rec] of map.entries()) {
      if (rec.state === 'completed' || rec.state === 'failed') {
        map.delete(id);
        if (map.size <= MAX_RETAINED_JOBS) break;
      }
    }
  }
}

export class LocalJobHandle<T = unknown> {
  constructor(
    private readonly record: LocalJobRecord,
    private readonly backend: LocalQueueBackend,
  ) {}

  get id(): string {
    return this.record.id;
  }

  get name(): string {
    return this.record.name;
  }

  get data(): T {
    return this.record.data as T;
  }

  get returnvalue(): unknown {
    return this.record.returnvalue;
  }

  get failedReason(): string | undefined {
    return this.record.failedReason;
  }

  async getState(): Promise<LocalJobState> {
    return this.record.state;
  }

  async remove(): Promise<void> {
    this.backend.removeWaitingJob(this.record.queueName, this.record.id);
  }

  async waitUntilFinished(_events: unknown, ttlMs = 60_000): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.record.donePromise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('timeout menunggu worker lokal')), ttlMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export class LocalQueueAdapter<T = unknown> {
  constructor(
    readonly name: string,
    private readonly backend: LocalQueueBackend,
  ) {}

  get client() {
    return Promise.resolve(this.backend.kvClient);
  }

  async add(
    name: string,
    data: T,
    opts?: { jobId?: string; [key: string]: unknown },
  ): Promise<LocalJobHandle<T>> {
    const record = this.backend.enqueue(this.name, name, data, { jobId: opts?.jobId });
    return new LocalJobHandle<T>(record, this.backend);
  }

  async getJob(jobId: string): Promise<LocalJobHandle<T> | undefined> {
    const record = this.backend.getJobRecord(this.name, jobId);
    return record ? new LocalJobHandle<T>(record, this.backend) : undefined;
  }

  async getJobs(states: string[]): Promise<LocalJobHandle<T>[]> {
    return this.backend
      .getJobsByStates(this.name, states)
      .map((record) => new LocalJobHandle<T>(record, this.backend));
  }

  async close(): Promise<void> {
    // Tidak ada koneksi eksternal untuk ditutup.
  }
}

export class LocalQueueEventsAdapter {
  constructor(private readonly emitter: EventEmitter) {}

  async waitUntilReady(): Promise<void> {
    return undefined;
  }

  on(event: string, listener: (...args: any[]) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  off(event: string, listener: (...args: any[]) => void): this {
    this.emitter.off(event, listener);
    return this;
  }

  async close(): Promise<void> {
    return undefined;
  }
}
