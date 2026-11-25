import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import type { CaptionJobData, CaptionLanguage } from '@clipper/shared';
import { normalizeCustomHashtags } from '@clipper/shared';
import { PrismaService } from '../prisma/prisma.service';
import { parseCaptionResult, RegeneratedCaption } from '../queue/clip-social';
import {
  CAPTION_QUEUE_NAME,
  CAPTION_WAIT_TIMEOUT_MS,
} from '../queue/queue.constants';

export const CAPTION_QUEUE_EVENTS = 'CAPTION_QUEUE_EVENTS';

/**
 * Regenerasi caption sosial satu klip. Kredensial LLM hanya ada di worker,
 * jadi API mengantrekan job `captions` lalu menunggu hasilnya (maks 60 detik).
 */
@Injectable()
export class ClipCaptionsService implements OnApplicationShutdown {
  private readonly logger = new Logger(ClipCaptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(CAPTION_QUEUE_NAME)
    private readonly queue: Queue<CaptionJobData>,
    @Inject(CAPTION_QUEUE_EVENTS) private readonly events: QueueEvents,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.events.close().catch(() => undefined);
  }

  async regenerate(
    id: string,
    language: CaptionLanguage,
    userId: string,
  ): Promise<RegeneratedCaption> {
    const clip = await this.prisma.clip.findFirst({
      where: { id, deletedAt: null, job: { userId } },
      select: {
        id: true,
        title: true,
        caption: true,
        transcript: true,
        job: { select: { description: true, customHashtags: true } },
      },
    });
    if (!clip) throw new NotFoundException(`Clip ${id} tidak ditemukan.`);

    const customHashtags = normalizeCustomHashtags(clip.job.customHashtags);

    const data: CaptionJobData = {
      clipId: clip.id,
      title: clip.title,
      transcript: clip.transcript ?? null,
      currentCaption: clip.caption ?? null,
      description: clip.job.description ?? null,
      language,
      customHashtags,
    };

    let result: RegeneratedCaption | null = null;
    try {
      const job = await this.queue.add('caption', data, {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      });
      const value = await job.waitUntilFinished(this.events, CAPTION_WAIT_TIMEOUT_MS);
      result = parseCaptionResult(value);
      if (result && customHashtags.length > 0) {
        result = { caption: result.caption, hashtags: customHashtags };
      }
    } catch (error) {
      this.logger.warn(
        `caption ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      result = null;
    }

    if (!result) {
      throw new ServiceUnavailableException({ message: 'caption_unavailable' });
    }

    // Klip bisa dihapus selama menunggu LLM: update bersyarat, 404 bila hilang.
    const updated = await this.prisma.clip.updateMany({
      where: { id, deletedAt: null, job: { userId } },
      data: { caption: result.caption, hashtags: result.hashtags },
    });
    if (updated.count === 0) throw new NotFoundException(`Clip ${id} tidak ditemukan.`);

    return { caption: result.caption, hashtags: result.hashtags };
  }
}
