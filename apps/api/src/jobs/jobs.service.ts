import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import type { JobData, ManualRange } from '@clipper/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAME } from '../queue/queue.constants';
import { JobSnapshot } from '../queue/job-events.service';
import { CreateJobDto } from './dto/create-job.dto';

const ALLOWED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'instagram.com',
];

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAME) private readonly queue: Queue<JobData>,
  ) {}

  async create(dto: CreateJobDto) {
    const url = assertAllowedUrl(dto.url);
    const ranges = normalizeRanges(dto);

    const job = await this.prisma.job.create({
      data: {
        url,
        mode: dto.mode,
        clipCount: dto.clipCount,
        targetDurationSec: dto.targetDurationSec,
        ranges: ranges as unknown as Prisma.InputJsonValue,
      },
    });

    const data: JobData = {
      jobId: job.id,
      url,
      mode: dto.mode,
      params: {
        clipCount: dto.clipCount,
        targetDurationSec: dto.targetDurationSec,
      },
      ranges,
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

  async findAll() {
    const jobs = await this.prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { clips: true } } },
    });

    return jobs.map(({ _count, ...job }) => ({
      ...job,
      clipsCount: _count.clips,
    }));
  }

  async findOne(id: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: { clips: { orderBy: { createdAt: 'asc' } } },
    });

    if (!job) throw new NotFoundException(`Job ${id} tidak ditemukan.`);
    return job;
  }

  async snapshot(id: string): Promise<JobSnapshot> {
    const job = await this.findOne(id);

    return {
      id: job.id,
      url: job.url,
      mode: job.mode,
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
        downloadedAt: clip.downloadedAt,
        deletedAt: clip.deletedAt,
      })),
    };
  }
}

function assertAllowedUrl(raw: string): string {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException(`URL tidak valid: ${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('URL harus memakai http atau https.');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const allowed = ALLOWED_HOSTS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );

  if (!allowed) {
    throw new BadRequestException(
      `Host ${host} tidak didukung. Gunakan tautan YouTube, TikTok, atau Instagram.`,
    );
  }

  return url.toString();
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

  return ranges.map((range) => ({ start: range.start, end: range.end }));
}
