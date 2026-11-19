import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import type {
  PreviewCandidate,
  PreviewCue,
  PreviewJobData,
  PreviewStatus,
} from '@clipper/shared';
import { PREVIEW_QUEUE_NAME } from '../queue/queue.constants';
import { assertAllowedUrl, normalizeDescription } from '../jobs/validation';
import { CreatePreviewDto } from './dto/create-preview.dto';

/** Hasil preview tidak disimpan di DB: job BullMQ dibuang otomatis setelah 1 jam. */
const PREVIEW_TTL_SECONDS = 3600;

@Injectable()
export class PreviewsService {
  constructor(
    @InjectQueue(PREVIEW_QUEUE_NAME)
    private readonly queue: Queue<PreviewJobData>,
  ) {}

  async create(dto: CreatePreviewDto, userId: string) {
    const id = randomUUID();
    const data: PreviewJobData = {
      url: assertAllowedUrl(dto.url),
      userId,
      description: normalizeDescription(dto.description),
      clipCount: dto.clipCount,
      targetDurationSec: dto.targetDurationSec,
      maxSourceSec: dto.maxSourceSec ?? null,
    };

    await this.queue.add('preview', data, {
      jobId: id,
      attempts: 1,
      removeOnComplete: { age: PREVIEW_TTL_SECONDS },
      removeOnFail: { age: PREVIEW_TTL_SECONDS },
    });

    return { id };
  }

  async findOne(id: string, userId: string) {
    const job = await this.queue.getJob(id);
    const data = job?.data as PreviewJobData | undefined;

    if (!job || data?.userId !== userId) {
      throw new NotFoundException(`Preview ${id} tidak ditemukan.`);
    }

    const state = await job.getState();
    const result = state === 'completed' ? parseResult(job.returnvalue) : null;

    return {
      id,
      url: data.url,
      status: toStatus(state),
      error:
        state === 'failed'
          ? job.failedReason || 'Preview gagal tanpa alasan yang dilaporkan.'
          : null,
      candidates: result?.candidates ?? null,
      cues: result?.cues ?? null,
    };
  }
}

function toStatus(state: string): PreviewStatus {
  if (state === 'completed') return 'done';
  if (state === 'failed') return 'failed';
  if (state === 'active') return 'running';
  return 'queued';
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseResult(
  value: unknown,
): { candidates: PreviewCandidate[]; cues: PreviewCue[] } | null {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== 'object') return null;

  const { candidates, cues } = parsed as {
    candidates?: unknown;
    cues?: unknown;
  };
  if (!Array.isArray(candidates) || !Array.isArray(cues)) return null;

  const validCandidates = candidates.filter(
    (item): item is PreviewCandidate =>
      !!item &&
      typeof item === 'object' &&
      typeof item.start === 'number' &&
      typeof item.end === 'number' &&
      typeof item.title === 'string' &&
      typeof item.reason === 'string',
  );
  const validCues = cues.filter(
    (item): item is PreviewCue =>
      !!item &&
      typeof item === 'object' &&
      typeof item.start === 'number' &&
      typeof item.end === 'number' &&
      typeof item.text === 'string',
  );

  return { candidates: validCandidates, cues: validCues };
}
