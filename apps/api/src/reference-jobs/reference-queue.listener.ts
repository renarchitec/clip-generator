import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { JobStatus, Prisma } from '@prisma/client';
import { QueueEvents } from 'bullmq';
import type { ReferenceJobProgress, ReferenceJobResult } from '@clipper/shared';
import { PrismaService } from '../prisma/prisma.service';
import { REFERENCE_QUEUE_EVENTS } from '../queue/queue.constants';
import { ReferenceEventsService } from './reference-events.service';
import { toResponse } from './reference-jobs.service';

@Injectable()
export class ReferenceQueueListener implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReferenceQueueListener.name);

  constructor(
    @Inject(REFERENCE_QUEUE_EVENTS) private readonly events: QueueEvents,
    private readonly prisma: PrismaService,
    private readonly referenceEvents: ReferenceEventsService,
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
  }

  async onApplicationShutdown(): Promise<void> {
    await this.events.close();
  }

  private async onProgress(jobId: string, data: unknown): Promise<void> {
    const progress = parseProgress(data);
    if (!progress) return;

    const current = await this.prisma.referenceJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (
      !current ||
      current.status === JobStatus.cancelled ||
      current.status === JobStatus.done ||
      current.status === JobStatus.failed
    ) {
      return;
    }

    await this.prisma.referenceJob.updateMany({
      where: { id: jobId, startedAt: null },
      data: { startedAt: new Date() },
    });

    const extra: Prisma.ReferenceJobUpdateManyMutationInput = {};
    if (progress.templateSlots !== undefined) {
      extra.templateSlots = progress.templateSlots as unknown as Prisma.InputJsonValue;
    }
    if (progress.planSlots !== undefined) {
      extra.planSlots = progress.planSlots as unknown as Prisma.InputJsonValue;
    }

    await this.prisma.referenceJob.updateMany({
      where: {
        id: jobId,
        status: { in: [JobStatus.queued, JobStatus.running] },
      },
      data: {
        status: JobStatus.running,
        stage: progress.stage,
        progress: Math.min(100, Math.max(0, Math.round(progress.percent))),
        message: progress.message ?? null,
        ...extra,
      },
    });

    const updated = await this.prisma.referenceJob.findUnique({
      where: { id: jobId },
    });
    if (updated) this.referenceEvents.publish(toResponse(updated));
  }

  private async onCompleted(jobId: string, returnvalue: unknown): Promise<void> {
    const result = parseResult(returnvalue);
    if (!result) return;

    const updated = await this.prisma.referenceJob.updateMany({
      where: {
        id: jobId,
        status: { in: [JobStatus.queued, JobStatus.running] },
      },
      data: {
        status: JobStatus.done,
        stage: 'save',
        progress: 100,
        message: null,
        error: null,
        finishedAt: new Date(),
        outputFilePath: result.outputFilePath,
        outputDurationSec: result.durationSec,
        templateSlots: result.templateSlots as unknown as Prisma.InputJsonValue,
        planSlots: result.planSlots as unknown as Prisma.InputJsonValue,
        caption: result.caption ?? null,
        hashtags: result.hashtags ?? [],
      },
    });

    if (updated.count === 0) return;
    await this.emitAndClose(jobId);
  }

  private async onFailed(jobId: string, failedReason: string): Promise<void> {
    const updated = await this.prisma.referenceJob.updateMany({
      where: {
        id: jobId,
        status: { in: [JobStatus.queued, JobStatus.running] },
      },
      data: {
        status: JobStatus.failed,
        error: humanizeError(failedReason),
        finishedAt: new Date(),
      },
    });

    if (updated.count === 0) return;
    await this.emitAndClose(jobId);
  }

  private async emitAndClose(jobId: string): Promise<void> {
    const job = await this.prisma.referenceJob.findUnique({
      where: { id: jobId },
    });
    if (!job) return;
    this.referenceEvents.publish(toResponse(job));
    this.referenceEvents.close(jobId);
  }
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

function parseProgress(data: unknown): ReferenceJobProgress | null {
  const parsed = parseJson(data);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as ReferenceJobProgress).stage !== 'string' ||
    typeof (parsed as ReferenceJobProgress).percent !== 'number'
  ) {
    return null;
  }
  return parsed as ReferenceJobProgress;
}

function parseResult(value: unknown): ReferenceJobResult | null {
  const parsed = parseJson(value);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as ReferenceJobResult).outputFilePath !== 'string'
  ) {
    return null;
  }
  return parsed as ReferenceJobResult;
}

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
