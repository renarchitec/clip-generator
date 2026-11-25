import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { JobStatus, Prisma, type ReferenceJob } from '@prisma/client';
import { Queue } from 'bullmq';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Response } from 'express';
import type {
  ReferenceFootageItem,
  ReferenceJobData,
  ReferenceJobResponse,
} from '@clipper/shared';
import { REFERENCE_MAX_FOOTAGE_FILES } from '@clipper/shared';
import { AppConfig } from '../config/app-config.service';
import { assertAllowedUrl } from '../jobs/validation';
import { OUTRO_EXT, readOutroInfo, sniffOutroMime } from '../outros/outro-helpers';
import { PrismaService } from '../prisma/prisma.service';
import { cancelKey, REFERENCE_QUEUE_NAME } from '../queue/queue.constants';
import { ReferenceEventsService } from './reference-events.service';
import {
  normalizeAspectRatio,
  normalizeReframeMode,
  REFERENCE_MAX_DURATION_SEC,
  REFERENCE_MAX_FILE_BYTES,
  REFERENCE_MIN_DURATION_SEC,
  sanitizeReferenceBrief,
  sanitizeReferenceTitle,
} from './reference-helpers';

export interface CreateReferenceDto {
  title?: string;
  brief?: string;
  aspectRatio?: string;
  reframe?: string;
  captions?: boolean;
  beatSync?: boolean;
  referenceUrl?: string;
  referenceFile?: ReferenceFootageItem | null;
  footage: ReferenceFootageItem[];
}

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

@Injectable()
export class ReferenceJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly events: ReferenceEventsService,
    @InjectQueue(REFERENCE_QUEUE_NAME) private readonly queue: Queue<ReferenceJobData>,
  ) {}

  async upload(
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    userId: string,
  ): Promise<ReferenceFootageItem> {
    if (!file) throw new BadRequestException('Field file wajib diisi.');
    if (
      file.size > REFERENCE_MAX_FILE_BYTES ||
      file.buffer.length > REFERENCE_MAX_FILE_BYTES
    ) {
      throw new BadRequestException('File maksimal 100 MB.');
    }

    const mimeType = sniffOutroMime(file.buffer);
    if (!mimeType) {
      throw new BadRequestException('File harus berupa video MP4 atau MOV yang valid.');
    }

    const info = readOutroInfo(file.buffer);
    if (
      !info ||
      info.durationSec < REFERENCE_MIN_DURATION_SEC ||
      info.durationSec > REFERENCE_MAX_DURATION_SEC
    ) {
      throw new BadRequestException('Durasi video harus antara 0,5 dan 600 detik.');
    }

    const id = randomUUID();
    const filePath = `reference/uploads/${userId}/${id}.${OUTRO_EXT[mimeType]}`;
    const absolute = this.absolute(filePath);
    if (!absolute) throw new BadRequestException('Path upload tidak valid.');

    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, file.buffer, { flag: 'wx' });

    return {
      id,
      name: path.parse(file.originalname).name || 'Video',
      filePath,
      mimeType,
      sizeBytes: file.buffer.length,
      durationSec: info.durationSec,
      width: info.width,
      height: info.height,
    };
  }

  async create(dto: CreateReferenceDto, userId: string): Promise<ReferenceJobResponse> {
    const aspectRatio = normalizeAspectRatio(dto.aspectRatio);
    if (!aspectRatio) {
      throw new BadRequestException('aspectRatio tidak valid.');
    }

    const reframe = normalizeReframeMode(dto.reframe);
    if (!reframe) {
      throw new BadRequestException('reframe tidak valid.');
    }

    const referenceUrl = dto.referenceUrl?.trim()
      ? assertAllowedUrl(dto.referenceUrl)
      : null;
    const referenceFile = dto.referenceFile ?? null;
    if (!referenceUrl && !referenceFile) {
      throw new BadRequestException('referenceUrl atau referenceFile wajib diisi.');
    }
    if (referenceFile) {
      await this.assertOwnedUpload(referenceFile, userId);
    }

    if (
      !Array.isArray(dto.footage) ||
      dto.footage.length < 1 ||
      dto.footage.length > REFERENCE_MAX_FOOTAGE_FILES
    ) {
      throw new BadRequestException(
        `footage harus berisi 1 hingga ${REFERENCE_MAX_FOOTAGE_FILES} file.`,
      );
    }
    await Promise.all(dto.footage.map((item) => this.assertOwnedUpload(item, userId)));

    const title = sanitizeReferenceTitle(dto.title);
    const brief = sanitizeReferenceBrief(dto.brief);
    const captions = dto.captions ?? true;
    const beatSync = dto.beatSync ?? true;

    const job = await this.prisma.referenceJob.create({
      data: {
        userId,
        title,
        brief,
        aspectRatio,
        reframe,
        captions,
        beatSync,
        referenceUrl,
        referenceFilePath: referenceFile?.filePath ?? null,
        referenceDurationSec: referenceFile?.durationSec ?? null,
        footage: dto.footage as unknown as Prisma.InputJsonValue,
        status: JobStatus.queued,
        stage: 'analyze_reference',
        progress: 0,
      },
    });

    const data: ReferenceJobData = {
      jobId: job.id,
      userId,
      title: job.title,
      brief: job.brief,
      aspectRatio,
      reframe,
      captions: job.captions,
      beatSync: job.beatSync,
      referenceUrl,
      referenceFilePath: job.referenceFilePath,
      referenceDurationSec: job.referenceDurationSec,
      footage: dto.footage,
    };

    try {
      await this.queue.add('reference', data, {
        jobId: job.id,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      });
    } catch (error) {
      await this.prisma.referenceJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.failed,
          error: 'Gagal memasukkan job ke antrean.',
          finishedAt: new Date(),
        },
      });
      throw new InternalServerErrorException(
        `Gagal memasukkan job ke antrean: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return toResponse(job);
  }

  async findAll(userId: string): Promise<ReferenceJobResponse[]> {
    const jobs = await this.prisma.referenceJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return jobs.map(toResponse);
  }

  async findOne(id: string, userId: string): Promise<ReferenceJobResponse> {
    const job = await this.prisma.referenceJob.findFirst({
      where: { id, userId },
    });
    if (!job) {
      throw new NotFoundException(`Reference job ${id} tidak ditemukan.`);
    }
    return toResponse(job);
  }

  async cancel(id: string, userId: string): Promise<ReferenceJobResponse> {
    const current = await this.findOne(id, userId);
    if (
      current.status === 'done' ||
      current.status === 'failed' ||
      current.status === 'cancelled'
    ) {
      return current;
    }

    try {
      const client = await this.queue.client;
      await client.set(cancelKey(id), '1', { EX: 86400 });
    } catch {
      // Redis error tidak boleh menggagalkan pembatalan di DB
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
      // Abaikan bila job sudah selesai/tidak ada di BullMQ
    }

    const job = await this.prisma.referenceJob.update({
      where: { id },
      data: {
        status: JobStatus.cancelled,
        message: 'Dibatalkan oleh pengguna.',
        finishedAt: new Date(),
      },
    });

    const result = toResponse(job);
    this.events.publish(result);
    this.events.close(id);
    return result;
  }

  async remove(id: string, userId: string): Promise<void> {
    const job = await this.findOne(id, userId);
    if (
      job.status !== 'done' &&
      job.status !== 'failed' &&
      job.status !== 'cancelled'
    ) {
      await this.cancel(id, userId);
    }

    if (job.outputFilePath) {
      const file = this.absolute(job.outputFilePath);
      if (file) {
        await unlink(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }

    await this.prisma.referenceJob.delete({ where: { id } });
    this.events.close(id);
  }

  async sendOutput(
    id: string,
    userId: string,
    res: Response,
    download = false,
  ): Promise<void> {
    const job = await this.findOne(id, userId);
    if (!job.outputFilePath) {
      throw new NotFoundException('Output belum tersedia.');
    }
    return this.sendPath(job.outputFilePath, res, download);
  }

  async sendUpload(fileId: string, userId: string, res: Response): Promise<void> {
    if (!/^[0-9a-f-]{1,64}$/i.test(fileId)) {
      throw new NotFoundException('Upload tidak ditemukan.');
    }
    const prefix = `reference/uploads/${userId}/`;
    const found = await this.findUploadById(fileId, prefix);
    if (!found) {
      throw new NotFoundException('Upload tidak ditemukan.');
    }
    return this.sendPath(found, res, false);
  }

  private async findUploadById(id: string, prefix: string): Promise<string | null> {
    for (const ext of ['mp4', 'mov']) {
      const relative = `${prefix}${id}.${ext}`;
      const abs = this.absolute(relative);
      if (!abs) continue;
      try {
        const info = await stat(abs);
        if (info.isFile()) return relative;
      } catch {
        // Coba ekstensi berikutnya
      }
    }
    return null;
  }

  private async sendPath(
    filePath: string,
    res: Response,
    download: boolean,
  ): Promise<void> {
    const absolute = this.absolute(filePath);
    if (!absolute) throw new NotFoundException('File tidak tersedia.');

    try {
      const info = await stat(absolute);
      if (!info.isFile()) throw new Error('not file');
    } catch {
      throw new NotFoundException('File tidak tersedia.');
    }

    const ext = path.extname(absolute).toLowerCase();
    res.setHeader('Content-Type', MIME_BY_EXT[ext] ?? 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (download) {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${path.basename(absolute)}"`,
      );
    }

    await new Promise<void>((resolve) => {
      res.sendFile(absolute, { acceptRanges: true, dotfiles: 'deny' }, (error) => {
        if (error && !res.headersSent) res.status(404).end();
        else if (error) res.destroy();
        resolve();
      });
    });
  }

  private async assertOwnedUpload(
    item: ReferenceFootageItem,
    userId: string,
  ): Promise<void> {
    if (!item || typeof item.filePath !== 'string') {
      throw new BadRequestException('File upload tidak valid.');
    }

    const abs = this.absolute(item.filePath);
    const expectedPrefix =
      path.resolve(this.config.clipsDir, `reference/uploads/${userId}`) + path.sep;
    if (!abs || !abs.startsWith(expectedPrefix)) {
      throw new BadRequestException('File upload tidak valid.');
    }

    try {
      const info = await stat(abs);
      if (!info.isFile()) throw new Error('not file');
    } catch {
      throw new BadRequestException('File upload tidak tersedia.');
    }
  }

  private absolute(filePath: string): string | null {
    const root = path.resolve(this.config.clipsDir);
    const target = path.resolve(root, filePath);
    return target !== root && target.startsWith(root + path.sep) ? target : null;
  }
}

export function toResponse(job: ReferenceJob): ReferenceJobResponse {
  return {
    id: job.id,
    title: job.title,
    brief: job.brief ?? null,
    aspectRatio: job.aspectRatio as ReferenceJobResponse['aspectRatio'],
    reframe: job.reframe as ReferenceJobResponse['reframe'],
    captions: job.captions,
    beatSync: job.beatSync,
    referenceUrl: job.referenceUrl ?? null,
    referenceFilePath: job.referenceFilePath ?? null,
    referenceDurationSec: job.referenceDurationSec ?? null,
    footage: (job.footage as unknown as ReferenceFootageItem[]) ?? [],
    status: job.status,
    stage: (job.stage as ReferenceJobResponse['stage']) ?? null,
    progress: job.progress,
    message: job.message ?? null,
    error: job.error ?? null,
    templateSlots:
      (job.templateSlots as unknown as ReferenceJobResponse['templateSlots']) ??
      null,
    planSlots:
      (job.planSlots as unknown as ReferenceJobResponse['planSlots']) ?? null,
    outputFilePath: job.outputFilePath ?? null,
    outputDurationSec: job.outputDurationSec ?? null,
    caption: job.caption ?? null,
    hashtags: job.hashtags,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}
