import { Inject, Injectable, Logger, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import type { BriefJobData, BriefJobResult } from '@clipper/shared';
import { CAPTION_QUEUE_NAME, CAPTION_WAIT_TIMEOUT_MS } from '../queue/queue.constants';

export const BRIEF_QUEUE_EVENTS = 'BRIEF_QUEUE_EVENTS';

@Injectable()
export class BriefsService implements OnApplicationShutdown {
  private readonly logger = new Logger(BriefsService.name);

  constructor(
    @InjectQueue(CAPTION_QUEUE_NAME) private readonly queue: Queue<BriefJobData>,
    @Inject(BRIEF_QUEUE_EVENTS) private readonly events: QueueEvents,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.events.close().catch(() => undefined);
  }

  async expand(brief: string): Promise<BriefJobResult> {
    try {
      const job = await this.queue.add('brief', { brief }, {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      });
      const value = await job.waitUntilFinished(this.events, CAPTION_WAIT_TIMEOUT_MS);
      const expanded = typeof value === 'object' && value !== null && typeof (value as { brief?: unknown }).brief === 'string'
        ? (value as { brief: string }).brief.trim().slice(0, 500)
        : '';
      if (expanded) return { brief: expanded };
    } catch (error) {
      this.logger.warn(`brief: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw new ServiceUnavailableException({ message: 'brief_unavailable' });
  }
}
