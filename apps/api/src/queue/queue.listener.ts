import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { JobStatus, Prisma } from '@prisma/client';
import { Queue, QueueEvents } from 'bullmq';
import type { ClipResult, JobData, JobProgress, JobResult, TranscriptSource } from '@clipper/shared';
import { DEFAULT_TRANSCRIPT_SOURCE, normalizeCaptionStyle } from '@clipper/shared';
import { CLIP_PUBLICATION_SELECT } from '../clips/clip-publications';
import { PrismaService } from '../prisma/prisma.service';
import { latestPerAccount } from '../publish/publish-helpers';
import { platformCaptionsJson, sanitizeClipSocialMetadata, sanitizeClipTranscript, sanitizePlatformCaptions } from './clip-social';
import { JobEventsService } from './job-events.service';
import type { StoredWatermarkValue } from '../watermarks/watermark-helpers';
import type { StoredOutro } from '../outros/outro-helpers';
import { QUEUE_EVENTS, QUEUE_NAME } from './queue.constants';

/** Interval pemeriksaan job basi (ms). */
const RECOVERY_INTERVAL_MS = 60_000;
/** Umur minimum job yang hilang dari Redis sebelum ditandai gagal. */
const STALE_JOB_MAX_AGE_MS = 3_600_000;

/**
 * Satu-satunya penulis status job selain endpoint create. Setiap update menulis
 * ke database lalu mem-publish snapshot, jadi kolom DB dan SSE tidak pernah
 * berbeda.
 */
@Injectable()
export class QueueListener implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(QueueListener.name);
  private recoveryTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(QUEUE_EVENTS) private readonly events: QueueEvents,
    @InjectQueue(QUEUE_NAME) private readonly queue: Queue<JobData>,
    private readonly prisma: PrismaService,
    private readonly jobEvents: JobEventsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.events.waitUntilReady();

    this.events.on('progress', ({ jobId, data }) => {
      void this.onProgress(jobId, data).catch((error) =>
        this.logger.error(`progress ${jobId}: ${errorMessage(error)}`),
      );
    });

    this.events.on('completed', ({ jobId, returnvalue }) => {
      void this.onCompleted(jobId, returnvalue).catch((error) =>
        this.logger.error(`completed ${jobId}: ${errorMessage(error)}`),
      );
    });

    this.events.on('failed', ({ jobId, failedReason }) => {
      void this.onFailed(jobId, failedReason).catch((error) =>
        this.logger.error(`failed ${jobId}: ${errorMessage(error)}`),
      );
    });

    this.events.on('error', (error) =>
      this.logger.warn(`queue events: ${errorMessage(error)}`),
    );

    // Pulihkan status job basi: event BullMQ bisa hilang saat Redis/worker restart.
    void this.recoverStaleJobs().catch((error) =>
      this.logger.error(`recovery: ${errorMessage(error)}`),
    );
    this.recoveryTimer = setInterval(() => {
      void this.recoverStaleJobs().catch((error) =>
        this.logger.error(`recovery: ${errorMessage(error)}`),
      );
    }, RECOVERY_INTERVAL_MS);
    this.recoveryTimer.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    await this.events.close();
    await this.queue.close();
  }

  private async onProgress(jobId: string, data: unknown): Promise<void> {
    if (await this.isCancelled(jobId)) return; // jangan hidupkan ulang job yang dibatalkan

    const progress = parseJobProgress(data);
    if (!progress) return;

    // Worker mengirim payload `clip` tepat setelah file klip selesai dirender.
    // Simpan lebih awal supaya snapshot SSE sudah memuat klip yang sedang jadi.
    if (progress.clip) await this.saveProgressClip(jobId, progress.clip);

    await this.prisma.job.updateMany({
      where: { id: jobId, startedAt: null },
      data: { startedAt: new Date() },
    });

    await this.prisma.job.updateMany({
      where: { id: jobId },
      data: {
        status: JobStatus.running,
        stage: progress.stage,
        progress: Math.min(100, Math.max(0, Math.round(progress.percent))),
        message: progress.message ?? null,
      },
    });

    await this.emit(jobId);
  }

  private async onCompleted(
    jobId: string,
    returnvalue: unknown,
  ): Promise<void> {
    if (await this.isCancelled(jobId)) return; // abaikan hasil worker setelah dibatalkan

    let result = parseJobResult(returnvalue);

    if (!result) {
      const job = await this.queue.getJob(jobId);
      result = parseJobResult(job?.returnvalue);
    }

    if (!result) {
      await this.fail(jobId, 'Worker selesai tanpa hasil clip yang valid.');
      return;
    }

    const clips = result.clips.flatMap((clip) => {
      const filePath = clipFilePath(jobId, clip.file);
      if (!filePath) return [];

      return [{
        title: clip.title,
        startSec: clip.start,
        endSec: clip.end,
        filePath,
        ...sanitizeClipSocialMetadata(clip),
        platformCaptions: platformCaptionsJson(sanitizePlatformCaptions(clip.platformCaptions)) ?? Prisma.DbNull,
        ...sanitizeClipRetentionMetadata(clip),
        transcript: sanitizeClipTranscript(clip.transcript),
      }];
    });

    // Idempoten: recovery bisa memanggil ini ulang setelah event `completed`
    // pertama hilang, dan klip bisa sudah dibuat lebih awal lewat progress.
    // Upsert per filePath: buat yang belum ada, perbarui metadata yang sudah
    // ada, dan jangan hidupkan ulang klip yang sudah dihapus pengguna.
    const existing = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        clips: { select: { id: true, filePath: true, deletedAt: true } },
      },
    });
    if (!existing) return;

    await this.prisma.$transaction(async (tx) => {
      const byFilePath = new Map(
        existing.clips.map((clip) => [clip.filePath, clip]),
      );

      for (const clip of clips) {
        const found = byFilePath.get(clip.filePath);

        if (!found) {
          const created = await tx.clip.create({ data: { ...clip, jobId } });
          byFilePath.set(clip.filePath, {
            id: created.id,
            filePath: clip.filePath,
            deletedAt: null,
          });
          continue;
        }

        if (found.deletedAt) continue; // klip yang dihapus tidak dibangkitkan

        await tx.clip.update({
          where: { id: found.id },
          data: {
            caption: clip.caption,
            hashtags: clip.hashtags,
            platformCaptions: clip.platformCaptions,
            transcript: clip.transcript,
            viralScore: clip.viralScore,
            hookText: clip.hookText,
          },
        });
      }

      await tx.job.updateMany({
        where: { id: jobId, status: { in: [JobStatus.queued, JobStatus.running] } },
        data: {
          status: JobStatus.done,
          stage: 'save',
          progress: 100,
          message: null,
          error: null,
          finishedAt: new Date(),
        },
      });
    });

    await this.emit(jobId);
    this.jobEvents.close(jobId);
  }

  /**
   * Simpan satu klip dari payload progress worker. Idempoten per jobId+filePath:
   * klip yang sudah ada (mis. event progress terkirim dua kali) tidak
   * diduplikasi. Schema tidak punya unique constraint di (jobId, filePath), jadi
   * pemeriksaan keberadaan dilakukan di transaksi yang sama dengan insert.
   */
  private async saveProgressClip(jobId: string, clip: ClipResult): Promise<void> {
    const filePath = clipFilePath(jobId, clip.file);
    if (!filePath) return;

    const data = {
      title: clip.title,
      startSec: clip.start,
      endSec: clip.end,
      filePath,
      ...sanitizeClipSocialMetadata(clip),
      platformCaptions: platformCaptionsJson(sanitizePlatformCaptions(clip.platformCaptions)) ?? Prisma.DbNull,
      ...sanitizeClipRetentionMetadata(clip),
      transcript: sanitizeClipTranscript(clip.transcript),
    };

    await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({
        where: { id: jobId },
        select: { id: true },
      });
      if (!job) return; // job sudah dihapus

      const found = await tx.clip.findFirst({
        where: { jobId, filePath },
        select: { id: true },
      });
      if (found) return;

      await tx.clip.create({ data: { ...data, jobId } });
    });
  }

  private async onFailed(jobId: string, failedReason: string): Promise<void> {
    if (await this.isCancelled(jobId)) return; // worker berhenti karena pembatalan, bukan gagal
    await this.fail(jobId, humanizeError(failedReason));
  }

  /**
   * Pulihkan job yang status DB-nya tertinggal (queued/running) padahal BullMQ
   * sudah selesai/gagal — biasanya karena event `completed`/`failed` hilang
   * saat Redis atau worker restart. Dijalankan saat init dan tiap 60 detik.
   */
  private async recoverStaleJobs(): Promise<void> {
    const jobs = await this.prisma.job.findMany({
      where: { status: { in: [JobStatus.queued, JobStatus.running] } },
      select: { id: true, createdAt: true },
    });

    for (const job of jobs) {
      try {
        const bullJob = await this.queue.getJob(job.id);

        if (!bullJob) {
          // Job sudah hilang dari Redis; hanya gagalkan yang cukup tua agar
          // job yang baru dibuat (race dengan queue.add) tidak ikut tersentuh.
          if (Date.now() - job.createdAt.getTime() > STALE_JOB_MAX_AGE_MS) {
            await this.fail(
              job.id,
              'Job hilang dari antrean (worker/redis restart). Jalankan ulang.',
            );
          }
          continue;
        }

        const state = await bullJob.getState();
        if (state === 'completed') {
          await this.onCompleted(job.id, bullJob.returnvalue);
        } else if (state === 'failed') {
          await this.onFailed(
            job.id,
            bullJob.failedReason || 'Job gagal tanpa alasan yang dilaporkan.',
          );
        }
      } catch (error) {
        this.logger.warn(`recovery ${job.id}: ${errorMessage(error)}`);
      }
    }
  }

  /**
   * Pembatalan diklaim lewat kolom status (updateMany bersyarat), jadi job yang
   * sudah cancelled tidak pernah ditimpa progress/done/failed di belakang.
   */
  private async isCancelled(jobId: string): Promise<boolean> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    return job?.status === JobStatus.cancelled;
  }

  private async fail(jobId: string, message: string): Promise<void> {
    const updated = await this.prisma.job.updateMany({
      // Hanya job yang masih berjalan yang boleh digagalkan; job done/cancelled
      // tidak disentuh walau event datang terlambat.
      where: { id: jobId, status: { in: [JobStatus.queued, JobStatus.running] } },
      data: {
        status: JobStatus.failed,
        error: message,
        finishedAt: new Date(),
      },
    });

    if (updated.count === 0) return; // sudah selesai/dibatalkan: biarkan statusnya

    await this.emit(jobId);
    this.jobEvents.close(jobId);
  }

  private async emit(jobId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        clips: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            title: true,
            startSec: true,
            endSec: true,
            caption: true,
            hashtags: true,
            platformCaptions: true,
            viralScore: true,
            hookText: true,
            downloadedAt: true,
            deletedAt: true,
            publications: CLIP_PUBLICATION_SELECT,
          },
        },
      },
    });

    if (!job) return;

    this.jobEvents.publish({
      id: job.id,
      url: job.url,
      description: job.description ?? null,
      mode: job.mode,
      reframe: job.reframe,
      captions: job.captions,
      hookBanner: job.hookBanner,
      normalizeAudio: job.normalizeAudio,
      twoSpeakers: job.twoSpeakers,
      facecam: job.facecam,
      aspectRatio: job.aspectRatio,
      captionLanguage: job.captionLanguage,
      transcriptSource: (job.transcriptSource ?? DEFAULT_TRANSCRIPT_SOURCE) as TranscriptSource,
      customHashtags: job.customHashtags,
      captionStyle: normalizeCaptionStyle(job.captionStyle),
      clipCount: job.clipCount,
      targetDurationSec: job.targetDurationSec,
      maxSourceSec: job.maxSourceSec ?? null,
      ranges: job.ranges ?? null,
      watermark: (job.watermark as StoredWatermarkValue | null) ?? null,
      outro: (job.outro as StoredOutro | null) ?? null,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      message: job.message,
      error: job.error,
      clips: job.clips.map(({ publications, ...clip }) => ({
        ...clip,
        platformCaptions: sanitizePlatformCaptions(clip.platformCaptions),
        publications: latestPerAccount(publications),
      })),
    });
  }
}

function sanitizeClipRetentionMetadata({ viralScore, hookText }: {
  viralScore?: unknown;
  hookText?: unknown;
}) {
  return {
    viralScore: typeof viralScore === 'number' && Number.isFinite(viralScore)
      ? Math.min(100, Math.max(0, Math.round(viralScore)))
      : null,
    hookText: typeof hookText === 'string'
      ? Array.from(hookText.trim()).slice(0, 80).join('').trimEnd() || null
      : null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJobProgress(data: unknown): JobProgress | null {
  const parsed = parseJson(data);
  if (!parsed || typeof parsed !== 'object') return null;

  const candidate = parsed as Partial<JobProgress>;
  if (typeof candidate.stage !== 'string') return null;
  if (typeof candidate.percent !== 'number') return null;

  const clip = parseClipResult(candidate.clip);

  return {
    stage: candidate.stage,
    percent: candidate.percent,
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
    // Klip yang tidak valid diabaikan; progress-nya tetap dipakai.
    ...(clip ? { clip } : {}),
  };
}

/** Validasi minimal satu klip hasil worker (dipakai progress & returnvalue). */
function parseClipResult(value: unknown): ClipResult | null {
  if (!value || typeof value !== 'object') return null;

  const clip = value as Partial<ClipResult>;
  if (
    typeof clip.title !== 'string' ||
    typeof clip.start !== 'number' ||
    typeof clip.end !== 'number' ||
    typeof clip.file !== 'string'
  ) {
    return null;
  }

  return clip as ClipResult;
}

function parseJobResult(value: unknown): JobResult | null {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== 'object') return null;

  const clips = (parsed as Partial<JobResult>).clips;
  if (!Array.isArray(clips)) return null;

  const valid = clips.flatMap((clip) => {
    const parsedClip = parseClipResult(clip);
    return parsedClip ? [parsedClip] : [];
  });

  if (valid.length === 0) return null;

  return { clips: valid };
}

/** Path disimpan relatif terhadap CLIPS_DIR: <jobId>/<file>. */
function clipFilePath(jobId: string, file: string): string | null {
  const relative = file.replace(/^[/\\]+/, '');
  const normalized = relative.split(/[/\\]+/).filter((part) => part && part !== '.');

  if (normalized.length === 0 || normalized.includes('..')) return null;

  return [jobId, ...normalized].join('/');
}

/** failedReason BullMQ bisa berupa stack trace atau JSON; ambil bagian yang terbaca. */
function humanizeError(failedReason: string): string {
  const parsed = parseJson(failedReason);
  if (parsed && typeof parsed === 'object' && 'message' in parsed) {
    const message = (parsed as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim().slice(0, 1000);
    }
  }

  const firstLine = failedReason.split('\n')[0]?.trim();
  return (firstLine || 'Job gagal tanpa alasan yang dilaporkan.').slice(0, 1000);
}
