import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { Queue } from 'bullmq';
import type { FrameJobData, FrameStatus } from '@clipper/shared';
import { AppConfig } from '../config/app-config.service';
import { resolveClipPath } from '../clips/clip-path';
import { assertAllowedUrl } from '../jobs/validation';
import { FRAME_QUEUE_NAME } from '../queue/queue.constants';
import { CreateFrameDto } from './dto/create-frame.dto';

const FRAME_TTL_SECONDS = 3600;

@Injectable()
export class FramesService {
  constructor(
    private readonly config: AppConfig,
    @InjectQueue(FRAME_QUEUE_NAME) private readonly queue: Queue<FrameJobData>,
  ) {}

  async create(dto: CreateFrameDto, userId: string) {
    const active = await this.queue.getJobs(['waiting', 'active']);
    if (active.some((job) => job.data?.userId === userId)) {
      throw new HttpException('Frame preview masih sedang diproses.', 429);
    }
    const id = randomUUID();
    const aspectRatio = dto.aspectRatio;
    const twoSpeakers = aspectRatio === '9:16' ? (dto.twoSpeakers ?? false) : false;
    const facecam = aspectRatio === '9:16' && !twoSpeakers ? (dto.facecam ?? false) : false;
    const data: FrameJobData = {
      url: assertAllowedUrl(dto.url), atSec: dto.atSec, aspectRatio,
      reframe: dto.reframe, twoSpeakers, facecam, captions: dto.captions ?? true,
      captionSample: 'Sample caption', outPath: `.frames/${id}.jpg`, userId,
    };
    await this.queue.add('frame', data, { jobId: id, attempts: 1,
      removeOnComplete: { age: FRAME_TTL_SECONDS }, removeOnFail: { age: FRAME_TTL_SECONDS } });
    return { id };
  }

  async findOne(id: string, userId: string) {
    const job = await this.ownedJob(id, userId);
    const state = await job.getState();
    const result = parseResult(job.returnvalue);
    return { id, status: toStatus(state),
      ...(state === 'failed' ? { error: job.failedReason || 'Frame gagal tanpa alasan yang dilaporkan.' } : {}),
      ...(result.width !== undefined ? { width: result.width } : {}),
      ...(result.height !== undefined ? { height: result.height } : {}),
      atSec: job.data.atSec,
      ...(state === 'completed' ? { imageUrl: `/api/frames/${id}/image` } : {}),
    };
  }

  async image(id: string, userId: string, res: Response): Promise<void> {
    await this.ownedJob(id, userId);
    const absolutePath = resolveClipPath(this.config.clipsDir, `.frames/${id}.jpg`);
    if (!absolutePath) throw new NotFoundException(`Frame ${id} tidak ditemukan.`);
    try { await access(absolutePath); } catch { throw new NotFoundException(`Frame ${id} tidak ditemukan.`); }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    createReadStream(absolutePath).pipe(res);
  }

  private async ownedJob(id: string, userId: string) {
    const job = await this.queue.getJob(id);
    if (!job || job.data?.userId !== userId) throw new NotFoundException(`Frame ${id} tidak ditemukan.`);
    return job;
  }
}
function toStatus(state: string): FrameStatus { if (state === 'completed') return 'done'; if (state === 'failed') return 'failed'; if (state === 'active') return 'running'; return 'queued'; }
function parseResult(value: unknown): { width?: number; height?: number } {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  if (!value || typeof value !== 'object') return {};
  const { width, height } = value as Record<string, unknown>;
  return { ...(typeof width === 'number' ? { width } : {}), ...(typeof height === 'number' ? { height } : {}) };
}
