import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import type {
  PreviewCandidate,
  PreviewCue,
  PreviewJobData,
  PreviewJobResult,
  PreviewResponse,
  PreviewStatus,
  UserRole,
} from '@clipper/shared';
import { DEFAULT_ASPECT, DEFAULT_TRANSCRIPT_SOURCE } from '@clipper/shared';
import { DemoService } from '../demo/demo.service';
import { PREVIEW_QUEUE_NAME } from '../queue/queue.constants';
import { normalizeDescription } from '../jobs/validation';
import { MediaResolverService } from '../media/media-resolver.service';
import { CreatePreviewDto } from './dto/create-preview.dto';

/** Hasil preview tidak disimpan di DB: job BullMQ dibuang otomatis setelah 1 jam. */
const PREVIEW_TTL_SECONDS = 3600;

@Injectable()
export class PreviewsService {
  constructor(
    @InjectQueue(PREVIEW_QUEUE_NAME)
    private readonly queue: Queue<PreviewJobData>,
    private readonly mediaResolver: MediaResolverService,
    @Optional() private readonly demo?: DemoService,
  ) {}

  async create(dto: CreatePreviewDto, userId: string, role?: UserRole) {
    const transcriptSource = dto.transcriptSource ?? DEFAULT_TRANSCRIPT_SOURCE;
    const allowed = this.demo
      ? await this.demo.assertPreviewAllowed(userId, role, {
          transcriptSource,
          maxSourceSec: dto.maxSourceSec ?? null,
          targetDurationSec: dto.targetDurationSec,
        })
      : { maxSourceSec: dto.maxSourceSec ?? null };

    const id = randomUUID();
    const aspectRatio = dto.aspectRatio ?? DEFAULT_ASPECT;
    const { url, primarySource } = await this.mediaResolver.resolvePrimarySource(userId, dto.url, dto.primarySource);
    const splitScreen = await this.mediaResolver.resolveSplitScreen(userId, dto.splitScreen, {
      aspectRatio, twoSpeakers: dto.twoSpeakers, facecam: dto.facecam,
    });
    const data: PreviewJobData = {
      url,
      primarySource,
      splitScreen,
      transcriptSource,
      userId,
      description: normalizeDescription(dto.description),
      clipCount: dto.clipCount,
      targetDurationSec: dto.targetDurationSec,
      maxSourceSec: allowed.maxSourceSec,
    };

    await this.queue.add('preview', data, {
      jobId: id,
      attempts: 1,
      removeOnComplete: { age: PREVIEW_TTL_SECONDS },
      removeOnFail: { age: PREVIEW_TTL_SECONDS },
    });

    await this.demo?.recordEvent(userId, 'preview_created', {
      maxSourceSec: data.maxSourceSec,
      transcriptSource,
    });

    return { id };
  }

  async findOne(id: string, userId: string): Promise<PreviewResponse & { description: string | null }> {
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
      primarySource: data.primarySource ?? null,
      splitScreen: data.splitScreen ?? null,
      transcriptSource: data.transcriptSource ?? DEFAULT_TRANSCRIPT_SOURCE,
      description: data.description ?? null,
      status: toStatus(state),
      error:
        state === 'failed'
          ? job.failedReason || 'Preview gagal tanpa alasan yang dilaporkan.'
          : null,
      candidates: result?.candidates ?? null,
      cues: result?.cues ?? null,
      brollSummaries: result?.brollSummaries ?? null,
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

function parseResult(value: unknown): PreviewJobResult | null {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== 'object') return null;

  const { candidates, cues, brollSummaries } = parsed as {
    candidates?: unknown;
    cues?: unknown;
    brollSummaries?: unknown;
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

  const summaries = brollSummaries && typeof brollSummaries === 'object' && !Array.isArray(brollSummaries)
    ? Object.fromEntries(Object.entries(brollSummaries).filter(([, summary]) => typeof summary === 'string'))
    : undefined;
  return { candidates: validCandidates, cues: validCues, brollSummaries: summaries };
}
