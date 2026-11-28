import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException, Inject, Injectable, NotFoundException, OnApplicationShutdown, ServiceUnavailableException,
} from '@nestjs/common';
import type {
  CaptureFrameJobData, CaptureFrameJobResult, FindMomentJobData, FindMomentJobResult, GenerateImageJobData,
  GenerateImageJobResult, MediaAssetResponse,
} from '@clipper/shared';
import { MEDIA_IMAGE_MAX_BYTES } from '@clipper/shared';
import type { Job, Queue, QueueEvents } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import * as path from 'node:path';
import { AppConfig } from '../config/app-config.service';
import { CAPTION_QUEUE_NAME } from '../queue/queue.constants';
import type { CaptureMediaFrameDto, FindMediaMomentDto, GenerateMediaImageDto } from './media.dto';
import { captureLocalFrame, ensureMediaDirectory, isImageMime, resolveExistingMediaFile } from './media-helpers';
import { MediaResolverService } from './media-resolver.service';
import { MediaService } from './media.service';

export const MEDIA_QUEUE_EVENTS = 'MEDIA_QUEUE_EVENTS';
type MediaJobs = {
  'capture-frame': CaptureFrameJobData;
  'generate-image': GenerateImageJobData;
  'find-moment': FindMomentJobData;
};
type ImageJobResult = GenerateImageJobResult | CaptureFrameJobResult;
const WORKER_WAIT_MS = 120_000;

@Injectable()
export class MediaActionsService implements OnApplicationShutdown {
  constructor(
    private readonly media: MediaService,
    private readonly resolver: MediaResolverService,
    private readonly config: AppConfig,
    @InjectQueue(CAPTION_QUEUE_NAME) private readonly queue: Queue<MediaJobs[keyof MediaJobs]>,
    @Inject(MEDIA_QUEUE_EVENTS) private readonly events: QueueEvents,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.events.close().catch(() => undefined);
  }

  async captureFrame(dto: CaptureMediaFrameDto, userId: string): Promise<MediaAssetResponse> {
    const source = await this.resolver.resolveVideoActionSource(userId, dto);
    const name = `Frame ${dto.atSec}s`;
    if (source.kind === 'url') {
      return this.createImage(userId, name, 'jpg', true, (outPath) =>
        this.runJob('capture-frame', { kind: source.kind, url: source.url, atSec: dto.atSec, outPath }));
    }
    const input = await this.existingSource(source.filePath);
    if (dto.atSec >= source.durationSec) throw new BadRequestException('Timestamp harus berada dalam durasi video.');
    return this.createImage(userId, name, 'jpg', false, async (_outPath, output) => {
      try {
        await captureLocalFrame(input, output, dto.atSec);
      } catch {
        throw new BadRequestException('Frame tidak dapat diambil dari video.');
      }
      return null;
    });
  }

  async generateImage(dto: GenerateMediaImageDto, userId: string): Promise<MediaAssetResponse> {
    return this.createImage(userId, dto.prompt, 'png', true, (outPath) =>
      this.runJob('generate-image', { prompt: dto.prompt, aspectRatio: dto.aspectRatio ?? undefined, outPath }));
  }

  async findMoment(dto: FindMediaMomentDto, userId: string): Promise<FindMomentJobResult> {
    const source = await this.resolver.resolveVideoActionSource(userId, dto);
    if (source.kind !== 'url') await this.existingSource(source.filePath);
    const input = source.kind === 'url' ? { url: source.url } : { filePath: source.filePath };
    const result = asRecord(await this.runJob('find-moment', {
      kind: source.kind, ...input, prompt: dto.prompt, targetDurationSec: dto.targetDurationSec ?? undefined,
    }));
    const { startSec, endSec, reason, durationSec } = result ?? {};
    // Allow a small tolerance for container/clip duration rounding.
    const durationLimit = Math.min(nonnegative(durationSec) ? durationSec : Infinity,
      source.kind === 'url' ? Infinity : source.durationSec);
    if (!nonnegative(startSec) || !nonnegative(endSec) || endSec <= startSec ||
        endSec > durationLimit + 0.25 ||
        (durationSec !== undefined && (!nonnegative(durationSec) || durationSec === 0))) {
      throw unavailable('find-moment');
    }
    return { startSec, endSec, ...(typeof reason === 'string' ? { reason: reason.slice(0, 2000) } : {}),
      ...(typeof durationSec === 'number' ? { durationSec } : {}) };
  }

  private async existingSource(filePath: string): Promise<string> {
    const resolved = await resolveExistingMediaFile(this.config.clipsDir, filePath);
    if (!resolved) throw new NotFoundException('File sumber video tidak tersedia.');
    return resolved;
  }

  private async createImage(
    userId: string,
    name: string,
    extension: string,
    workerOutput: boolean,
    produce: (outPath: string, output: string) => Promise<unknown>,
  ): Promise<MediaAssetResponse> {
    await this.media.assertQuota(userId);
    const bucket = workerOutput ? '.tmp-media' : '.tmp-media-local';
    const requestDir = `action-${randomUUID()}`;
    const filename = `output.${extension}`;
    const outPath = `${bucket}/${requestDir}/${filename}`;
    const parent = await ensureMediaDirectory(this.config.clipsDir, workerOutput ? 0o755 : 0o700, bucket);
    // Grant the separate worker UID write access only to this request directory.
    // After cleanup, the worker cannot recreate it under the API-owned parent.
    const directory = await ensureMediaDirectory(parent, workerOutput ? 0o1777 : 0o700, requestDir);
    const output = path.join(directory, filename);
    try {
      const value = await produce(outPath, output);
      // Only use the API-assigned location; never dereference a path supplied by a job result.
      const actual = await resolveExistingMediaFile(this.config.clipsDir, outPath);
      if (!workerOutput) {
        if (actual !== output) throw new BadRequestException('Frame tidak ditemukan pada timestamp tersebut.');
        return await this.media.storeImage(output, name, userId);
      }
      if (actual !== output || !validImageResult(value, outPath)) throw new ServiceUnavailableException('media_output_invalid');
      return await this.media.storeImage(output, name, userId, undefined, value);
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async runJob<K extends keyof MediaJobs>(name: K, data: MediaJobs[K]): Promise<unknown> {
    let job: Job<MediaJobs[keyof MediaJobs]> | undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async () => {
      job = await this.queue.add(name, data, { attempts: 1, removeOnComplete: true, removeOnFail: true });
      if (stopped) {
        void job.remove().catch(() => undefined);
        return;
      }
      return job.waitUntilFinished(this.events, WORKER_WAIT_MS);
    };
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(unavailable(name)), WORKER_WAIT_MS);
      })]);
    } catch {
      stopped = true;
      if (job) void job.remove().catch(() => undefined); // A running job cannot be removed.
      throw unavailable(name);
    } finally {
      clearTimeout(timer);
    }
  }
}

function unavailable(name: keyof MediaJobs): ServiceUnavailableException {
  return new ServiceUnavailableException(`${name.replaceAll('-', '_')}_unavailable`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validImageResult(value: unknown, outPath: string): value is ImageJobResult {
  const image = asRecord(value);
  return !!image && image.file === outPath && typeof image.mimeType === 'string' && isImageMime(image.mimeType) &&
    typeof image.width === 'number' && Number.isInteger(image.width) && image.width > 0 &&
    typeof image.height === 'number' && Number.isInteger(image.height) && image.height > 0 &&
    typeof image.sizeBytes === 'number' && Number.isInteger(image.sizeBytes) && image.sizeBytes > 0 && image.sizeBytes <= MEDIA_IMAGE_MAX_BYTES;
}
