import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { JobStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { unlink } from 'node:fs/promises';
import type {
  AspectRatio,
  CaptionLanguage,
  CaptionStyle,
  JobData,
  ManualRange,
  ReframeMode,
} from '@clipper/shared';
import {
  DEFAULT_ASPECT,
  DEFAULT_CAPTION_LANGUAGE,
  DEFAULT_REFRAME,
  normalizeCaptionStyle,
  normalizeCustomHashtags,
} from '@clipper/shared';
import { BriefHistoryService } from '../briefs/brief-history.service';
import { resolveClipPath } from '../clips/clip-path';
import { CLIP_PUBLICATION_SELECT } from '../clips/clip-publications';
import { latestPerAccount } from '../publish/publish-helpers';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { JobEventsService, JobSnapshot } from '../queue/job-events.service';
import { cancelKey, QUEUE_NAME } from '../queue/queue.constants';
import { CreateJobDto } from './dto/create-job.dto';
import { assertAllowedUrl, normalizeDescription } from './validation';
import { WatermarksService } from '../watermarks/watermarks.service';
import { OutrosService } from '../outros/outros.service';
import type { OutroJobPayload, StoredOutro } from '../outros/outro-helpers';
import {
  normalizeStoredWatermarks,
  serializeWatermarkValue,
  type StoredWatermark,
  type StoredWatermarkValue,
  type WatermarkJobPayload,
} from '../watermarks/watermark-helpers';

/** Payload worker memakai filePath + posisi, tanpa ID pustaka. */
type QueuedJobData = JobData & {
  watermark: WatermarkJobPayload | null;
  watermarks: WatermarkJobPayload[];
  outro: OutroJobPayload | null;
};

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobEvents: JobEventsService,
    private readonly config: AppConfig,
    private readonly watermarks: WatermarksService,
    private readonly outros: OutrosService,
    private readonly briefHistory: BriefHistoryService,
    @InjectQueue(QUEUE_NAME) private readonly queue: Queue<JobData>,
  ) {}

  async create(dto: CreateJobDto, userId: string) {
    const url = assertAllowedUrl(dto.url);
    const ranges = normalizeRanges(dto);
    const description =
      dto.mode === 'auto' ? normalizeDescription(dto.description) : null;
    const reframe = dto.reframe ?? DEFAULT_REFRAME;
    const captions = dto.captions ?? true;
    const captionStyle = captions ? normalizeCaptionStyle(dto.captionStyle) : null;
    const aspectRatio = dto.aspectRatio ?? DEFAULT_ASPECT;
    const captionLanguage = dto.captionLanguage ?? DEFAULT_CAPTION_LANGUAGE;
    const customHashtags = normalizeCustomHashtags(dto.customHashtags);
    // twoSpeakers hanya berlaku untuk 9:16; dinormalisasi false untuk 1:1/16:9.
    const twoSpeakers = aspectRatio === '9:16' ? (dto.twoSpeakers ?? false) : false;
    // facecam eksklusif dengan twoSpeakers; hanya berlaku untuk 9:16.
    const facecam =
      aspectRatio === '9:16' && !twoSpeakers ? (dto.facecam ?? false) : false;
    // Batas pemindaian sumber: null = durasi penuh; hanya dipakai mode auto.
    const maxSourceSec = dto.mode === 'auto' ? (dto.maxSourceSec ?? null) : null;
    // Cek kepemilikan dan simpan snapshot path dalam urutan layer.
    const storedWatermarks = await this.watermarks.resolveSettings(dto.watermark, userId);
    const persistedWatermark = serializeWatermarkValue(storedWatermarks);

    const storedOutro = await this.outros.resolveSettings(dto.outro, userId);

    const job = await this.prisma.job.create({
      data: {
        url,
        description,
        mode: dto.mode,
        reframe,
        captions,
        twoSpeakers,
        aspectRatio,
        clipCount: dto.clipCount,
        targetDurationSec: dto.targetDurationSec,
        maxSourceSec,
        facecam,
        captionLanguage,
        customHashtags,
        captionStyle: captionStyle ? (captionStyle as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        ranges: ranges as unknown as Prisma.InputJsonValue,
        watermark: persistedWatermark
          ? (persistedWatermark as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        outro: storedOutro
          ? (storedOutro as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        userId,
      },
    });

    // Riwayat brief bersifat best-effort: gagal menyimpan tidak boleh menggagalkan job.
    if (description) {
      try {
        await this.briefHistory.record(userId, description);
      } catch (error) {
        this.logger.warn(
          `Gagal menyimpan riwayat brief: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const toPayload = (wm: StoredWatermark): WatermarkJobPayload => ({
      filePath: wm.filePath,
      ...(wm.mimeType ? { mimeType: wm.mimeType } : {}),
      x: wm.x,
      y: wm.y,
      scale: wm.scale,
      opacity: wm.opacity,
      ...(wm.chromaKey ? { chromaKey: wm.chromaKey } : {}),
    });
    const watermarks = storedWatermarks.map(toPayload);
    const watermark = watermarks[0] ?? null;

    const outro: OutroJobPayload | null = storedOutro
      ? {
          filePath: storedOutro.filePath,
          durationSec: storedOutro.durationSec,
        }
      : null;

    const data: QueuedJobData = {
      jobId: job.id,
      url,
      mode: dto.mode,
      reframe,
      captions,
      twoSpeakers,
      facecam,
      aspectRatio,
      description,
      captionLanguage,
      customHashtags,
      captionStyle,
      maxSourceSec,
      params: {
        clipCount: dto.clipCount,
        targetDurationSec: dto.targetDurationSec,
      },
      ranges,
      watermark,
      watermarks,
      outro,
    };

    try {
      await this.queue.add('clip', data, {
        jobId: job.id,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      });
    } catch (error) {
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: 'Gagal memasukkan job ke antrean.',
          finishedAt: new Date(),
        },
      });
      throw new InternalServerErrorException(
        `Gagal memasukkan job ke antrean: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return job;
  }

  async findAll(userId: string) {
    const jobs = await this.prisma.job.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { clips: true } } },
    });

    return jobs.map(({ _count, ...job }) => ({
      ...job,
      clipsCount: _count.clips,
    }));
  }

  async findOne(id: string, userId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id, userId },
      include: {
        clips: {
          orderBy: { createdAt: 'asc' },
          include: { publications: CLIP_PUBLICATION_SELECT },
        },
      },
    });

    if (!job) throw new NotFoundException(`Job ${id} tidak ditemukan.`);
    return withPublicationSummaries(job);
  }

  async cancel(id: string, userId: string) {
    const job = await this.findOne(id, userId);

    if (
      job.status === JobStatus.done ||
      job.status === JobStatus.failed ||
      job.status === JobStatus.cancelled
    ) {
      return job;
    }

    // Set sinyal pembatalan di Redis agar worker memeriksa dan berhenti aman.
    try {
      const client = await this.queue.client;
      await client.set(cancelKey(id), '1', { EX: 86400 });
    } catch {
      // Redis error tidak boleh menggagalkan pembatalan di DB
    }

    // Cabut dari antrean BullMQ bila belum jalan.
    try {
      const bullJob = await this.queue.getJob(id);
      if (bullJob) {
        const state = await bullJob.getState();
        if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
          await bullJob.remove();
        }
      }
    } catch {
      // Abaikan bila job sudah selesai/tidak ada di BullMQ
    }

    const updated = await this.prisma.job.update({
      where: { id },
      data: {
        status: JobStatus.cancelled,
        message: 'Dibatalkan oleh pengguna.',
        finishedAt: new Date(),
      },
      include: {
        clips: {
          orderBy: { createdAt: 'asc' },
          include: { publications: CLIP_PUBLICATION_SELECT },
        },
      },
    });

    const result = withPublicationSummaries(updated);
    this.jobEvents.publish(toSnapshot(result));
    this.jobEvents.close(id);

    return result;
  }

  /**
   * Buat ulang job dari konfigurasi job lama (failed/cancelled) lewat jalur
   * create yang sama: validasi, normalisasi, dan payload antrean tidak diduplikasi.
   * Job lama tidak diubah.
   */
  async retry(id: string, userId: string) {
    const old = await this.findOne(id, userId);

    if (
      old.status !== JobStatus.failed &&
      old.status !== JobStatus.cancelled
    ) {
      throw new BadRequestException(
        `Job ${id} berstatus ${old.status}; hanya job failed atau cancelled yang bisa diulang.`,
      );
    }

    const dto = new CreateJobDto();
    dto.url = old.url;
    dto.mode = old.mode;
    dto.clipCount = old.clipCount;
    dto.targetDurationSec = old.targetDurationSec;
    dto.reframe = old.reframe as ReframeMode;
    dto.captions = old.captions;
    dto.twoSpeakers = old.twoSpeakers;
    dto.facecam = old.facecam;
    dto.aspectRatio = old.aspectRatio as AspectRatio;
    dto.captionLanguage = old.captionLanguage as CaptionLanguage;
    dto.customHashtags = old.customHashtags;
    dto.captionStyle = normalizeCaptionStyle(old.captionStyle);
    dto.description = old.description ?? undefined;
    dto.ranges = (old.ranges as ManualRange[] | null) ?? undefined;
    // maxSourceSec hanya relevan untuk mode auto; null = durasi penuh.
    dto.maxSourceSec = old.mode === 'auto' ? old.maxSourceSec : null;
    // Strip snapshot-only fields; create rechecks ownership and resolves the current path/MIME.
    const oldWatermarks = normalizeStoredWatermarks(old.watermark);
    dto.watermark = serializeWatermarkValue(oldWatermarks.map(({ watermarkId, x, y, scale, opacity, chromaKey }) => ({
      watermarkId, x, y, scale, opacity,
      ...(chromaKey !== undefined ? { chromaKey } : {}),
    })));
    dto.outro = (old.outro as StoredOutro | null) ?? null;

    return this.create(dto, userId);
  }

  async snapshot(id: string, userId: string): Promise<JobSnapshot> {
    const job = await this.findOne(id, userId);
    return toSnapshot(job);
  }

  /**
   * Hapus job milik user:
   * 1. Ambil job + klip untuk verifikasi kepemilikan.
   * 2. Bila job belum selesai/gagal/batal (masih queued/running), kirim sinyal cancel Redis dan cabut dari BullMQ bila ada.
   * 3. Hapus semua file fisik klip di disk menggunakan safe resolver (abaikan ENOENT).
   * 4. Hapus job dari DB (klip cascade terhapus otomatis di DB).
   * 5. Tutup subscription jobEvents bila ada.
   */
  async remove(id: string, userId: string): Promise<void> {
    const job = await this.findOne(id, userId);

    if (
      job.status !== JobStatus.done &&
      job.status !== JobStatus.failed &&
      job.status !== JobStatus.cancelled
    ) {
      try {
        const client = await this.queue.client;
        await client.set(cancelKey(id), '1', { EX: 86400 });
      } catch {
        // Redis error tidak boleh menggagalkan penghapusan
      }

      try {
        const bullJob = await this.queue.getJob(id);
        if (bullJob) {
          const state = await bullJob.getState();
          if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
            await bullJob.remove();
          }
        }
      } catch {
        // Abaikan bila job tidak ditemukan di antrean
      }
    }

    for (const clip of job.clips) {
      const target = resolveClipPath(this.config.clipsDir, clip.filePath);
      if (target) {
        try {
          await unlink(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }

    await this.prisma.job.delete({
      where: { id },
    });

    this.jobEvents.close(id);
  }
}

type JobWithClips = Prisma.JobGetPayload<{ include: { clips: true } }>;

type JobWithClipPublications = Prisma.JobGetPayload<{
  include: { clips: { include: { publications: typeof CLIP_PUBLICATION_SELECT } } };
}>;

/** Ganti daftar publikasi mentah per klip dengan ringkasan terbaru per akun. */
function withPublicationSummaries(job: JobWithClipPublications) {
  return {
    ...job,
    clips: job.clips.map(({ publications, ...clip }) => ({
      ...clip,
      publications: latestPerAccount(publications),
    })),
  };
}

type JobWithClipSummaries = ReturnType<typeof withPublicationSummaries>;

function toSnapshot(job: JobWithClips | JobWithClipSummaries): JobSnapshot {
  return {
    id: job.id,
    url: job.url,
    description: job.description ?? null,
    mode: job.mode,
    reframe: job.reframe,
    captions: job.captions,
    twoSpeakers: job.twoSpeakers,
    facecam: job.facecam,
    aspectRatio: job.aspectRatio,
    captionLanguage: job.captionLanguage,
    customHashtags: job.customHashtags,
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
    clips: job.clips.map((clip) => ({
      id: clip.id,
      title: clip.title,
      startSec: clip.startSec,
      endSec: clip.endSec,
      caption: clip.caption,
      hashtags: clip.hashtags,
      downloadedAt: clip.downloadedAt,
      deletedAt: clip.deletedAt,
      publications: 'publications' in clip ? clip.publications : [],
    })),
  };
}

function normalizeRanges(dto: CreateJobDto): ManualRange[] {
  const ranges = dto.ranges ?? [];

  if (dto.mode === 'manual') {
    if (ranges.length === 0) {
      throw new BadRequestException(
        'Mode manual butuh minimal satu rentang {start, end}.',
      );
    }
    if (ranges.length > 10) {
      throw new BadRequestException('Maksimal 10 rentang manual.');
    }
  }

  for (const range of ranges) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
      throw new BadRequestException('start dan end harus berupa angka.');
    }
    if (range.start >= range.end) {
      throw new BadRequestException(
        `Rentang tidak valid: start (${range.start}) harus lebih kecil dari end (${range.end}).`,
      );
    }
  }

  return ranges.map((range) => {
    const normalized: ManualRange = { start: range.start, end: range.end };
    const title = sanitizeMomentText(range.title, 70);
    const reason = sanitizeMomentText(range.reason, 200);
    if (title) normalized.title = title;
    if (reason) normalized.reason = reason;
    return normalized;
  });
}

/** trim + batas panjang; kosong -> undefined agar field opsional tidak ikut terkirim. */
function sanitizeMomentText(
  raw: string | undefined,
  max: number,
): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}
