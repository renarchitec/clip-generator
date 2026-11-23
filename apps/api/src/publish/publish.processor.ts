import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { PublicationStatus } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { stat } from 'node:fs/promises';
import type { PublishJobData } from '@clipper/shared';
import { resolveClipPath } from '../clips/clip-path';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLISH_QUEUE_NAME } from '../queue/queue.constants';
import { SocialProviderError } from '../social/social-provider';
import { SocialService } from '../social/social.service';
import {
  MAX_PROCESSING_CHECKS,
  PROCESSING_CHECK_DELAY_MS,
  PublishError,
  RECONNECT_MESSAGE,
  shortsUrl,
  STALE_UPLOAD_MS,
  uploadPercent,
} from './publish-helpers';
import { publishJobId, PublishService } from './publish.service';
import { YoutubeUploader } from './youtube-uploader';

/**
 * Pemroses antrean `publish` di dalam API. Semua status publikasi ditulis ke DB
 * di sini; galat dipetakan ke pesan singkat dan job BullMQ selalu selesai
 * normal (tidak ada retry otomatis BullMQ — retry lewat endpoint).
 */
@Processor(PUBLISH_QUEUE_NAME, { concurrency: 2 })
export class PublishProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(PublishProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly social: SocialService,
    private readonly uploader: YoutubeUploader,
    private readonly publish: PublishService,
    @InjectQueue(PUBLISH_QUEUE_NAME)
    private readonly queue: Queue<PublishJobData>,
  ) {
    super();
  }

  async process(job: Job<PublishJobData>): Promise<void> {
    const { publicationId, kind } = job.data;
    try {
      if (kind === 'check') {
        await this.check(publicationId, job.data.checks ?? 1);
      } else {
        await this.upload(publicationId);
      }
    } catch (error) {
      await this.fail(publicationId, error);
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.recover();
    } catch (error) {
      this.logger.error(`recovery publish: ${describe(error)}`);
    }
  }

  private async upload(publicationId: string): Promise<void> {
    const claimed = await this.prisma.publication.updateMany({
      // `uploading` diterima agar job yang stalled (API restart) bisa diulang dari awal.
      where: {
        id: publicationId,
        status: { in: [PublicationStatus.queued, PublicationStatus.uploading] },
      },
      data: {
        status: PublicationStatus.uploading,
        progress: 0,
        error: null,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) return;

    const publication = await this.prisma.publication.findUnique({
      where: { id: publicationId },
      include: { clip: true },
    });
    if (!publication) return;
    if (publication.platform !== 'youtube') {
      throw new PublishError('Publishing to this platform is not available yet');
    }
    if (publication.clip.deletedAt) {
      throw new PublishError('Clip was deleted');
    }

    const filePath = resolveClipPath(this.config.clipsDir, publication.clip.filePath);
    if (!filePath) throw new PublishError('Clip file is not available');
    let size: number;
    try {
      const stats = await stat(filePath);
      if (!stats.isFile() || stats.size <= 0) throw new Error('not a file');
      size = stats.size;
    } catch {
      throw new PublishError('Clip file is not available');
    }

    const accessToken = await this.accessToken(publication.socialAccountId);
    const sessionUrl = await this.uploader.startSession(
      accessToken,
      {
        title: publication.title || publication.clip.title.slice(0, 100),
        description: publication.caption,
        privacyStatus: publication.privacy,
        madeForKids: publication.madeForKids,
      },
      size,
    );

    let lastPercent = 0;
    const videoId = await this.uploader.uploadFile(
      sessionUrl,
      accessToken,
      filePath,
      size,
      async (sent) => {
        // Throttle: tulis DB hanya bila persen berubah (paling sering sekali per chunk).
        const percent = Math.min(uploadPercent(sent, size), 99);
        if (percent <= lastPercent) return;
        lastPercent = percent;
        await this.prisma.publication.updateMany({
          where: { id: publicationId, status: PublicationStatus.uploading },
          data: { progress: percent },
        });
      },
    );

    await this.prisma.publication.updateMany({
      where: { id: publicationId, status: PublicationStatus.uploading },
      data: {
        status: PublicationStatus.processing,
        progress: 100,
        externalId: videoId,
        externalUrl: shortsUrl(videoId),
      },
    });
    await this.scheduleCheck(publicationId, 1);
  }

  private async check(publicationId: string, checks: number): Promise<void> {
    const publication = await this.prisma.publication.findUnique({
      where: { id: publicationId },
      select: { status: true, externalId: true, socialAccountId: true },
    });
    if (
      !publication ||
      publication.status !== PublicationStatus.processing ||
      !publication.externalId
    ) {
      return;
    }

    let outcome;
    try {
      const accessToken = await this.accessToken(publication.socialAccountId);
      outcome = await this.uploader.videoStatus(accessToken, publication.externalId);
    } catch (error) {
      // Galat sementara saat cek status: coba lagi pada jadwal berikutnya.
      if (error instanceof PublishError && error.transient && checks < MAX_PROCESSING_CHECKS) {
        await this.scheduleCheck(publicationId, checks + 1);
        return;
      }
      throw error;
    }

    if (outcome.state === 'published') {
      await this.markPublished(publicationId);
      return;
    }
    if (outcome.state === 'failed') {
      await this.markFailed(publicationId, outcome.reason, [PublicationStatus.processing]);
      return;
    }
    if (checks >= MAX_PROCESSING_CHECKS) {
      // Video sudah ada di YouTube; pemrosesan lambat tidak membuat unggahan gagal.
      this.logger.warn(`publikasi ${publicationId}: batas cek status tercapai, dianggap published`);
      await this.markPublished(publicationId);
      return;
    }
    await this.scheduleCheck(publicationId, checks + 1);
  }

  private async markPublished(publicationId: string): Promise<void> {
    await this.prisma.publication.updateMany({
      where: { id: publicationId, status: PublicationStatus.processing },
      data: { status: PublicationStatus.published, publishedAt: new Date() },
    });
  }

  private async scheduleCheck(publicationId: string, checks: number): Promise<void> {
    await this.queue.add(
      'check',
      { publicationId, kind: 'check', checks },
      {
        // Suffix waktu mencegah dedupe dengan job cek lama yang masih tersimpan.
        jobId: publishJobId(publicationId, `check-${checks}-${Date.now()}`),
        delay: PROCESSING_CHECK_DELAY_MS,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }

  private async accessToken(accountId: string): Promise<string> {
    try {
      return await this.social.getValidAccessToken(accountId);
    } catch (error) {
      if (error instanceof SocialProviderError && error.code === 'not_configured') {
        throw new PublishError('YouTube publishing is not configured on the server');
      }
      throw new PublishError(RECONNECT_MESSAGE);
    }
  }

  private async fail(publicationId: string, error: unknown): Promise<void> {
    const message =
      error instanceof PublishError ? error.message : 'Upload failed, retry later';
    if (!(error instanceof PublishError)) {
      // Hanya pesan galat; token tidak pernah masuk ke pesan galat.
      this.logger.error(`publikasi ${publicationId}: ${describe(error)}`);
    }
    await this.markFailed(publicationId, message, [
      PublicationStatus.queued,
      PublicationStatus.uploading,
      PublicationStatus.processing,
    ]).catch((dbError) =>
      this.logger.error(`publikasi ${publicationId}: gagal menulis status: ${describe(dbError)}`),
    );
  }

  private async markFailed(
    publicationId: string,
    message: string,
    from: PublicationStatus[],
  ): Promise<void> {
    await this.prisma.publication.updateMany({
      where: { id: publicationId, status: { in: from } },
      data: { status: PublicationStatus.failed, error: message.slice(0, 500) },
    });
  }

  /**
   * Pulihkan publikasi yang tertinggal saat API mati:
   * - queued tanpa job BullMQ → masukkan ulang;
   * - uploading tanpa job aktif dan lebih tua dari 1 jam → failed "interrupted";
   * - processing tanpa job cek → jadwalkan cek status lagi.
   */
  private async recover(): Promise<void> {
    const stuck = await this.prisma.publication.findMany({
      where: {
        status: {
          in: [
            PublicationStatus.queued,
            PublicationStatus.uploading,
            PublicationStatus.processing,
          ],
        },
      },
      select: { id: true, status: true, updatedAt: true },
    });
    if (stuck.length === 0) return;

    const pending = await this.queue.getJobs([
      'active',
      'waiting',
      'delayed',
      'prioritized',
    ]);
    const tracked = new Set(
      pending
        .filter((job) => job?.data?.publicationId)
        .map((job) => job.data.publicationId),
    );

    for (const publication of stuck) {
      if (tracked.has(publication.id)) continue;
      if (publication.status === PublicationStatus.queued) {
        await this.publish.enqueueOrFail(publication.id);
      } else if (publication.status === PublicationStatus.uploading) {
        if (Date.now() - publication.updatedAt.getTime() >= STALE_UPLOAD_MS) {
          await this.markFailed(publication.id, 'Upload interrupted, retry the upload', [
            PublicationStatus.uploading,
          ]);
        }
      } else {
        await this.scheduleCheck(publication.id, 1).catch(() => undefined);
      }
    }
    this.logger.log(`recovery publish: ${stuck.length} publikasi aktif diperiksa`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
