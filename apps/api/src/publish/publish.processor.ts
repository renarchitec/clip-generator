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
import { fetchTiktokCreatorInfo } from '../social/tiktok-api';
import {
  derivePublicMediaKey,
  publicMediaUrl,
} from '../clips/public-media';
import {
  INSTAGRAM_CHECK_DELAY_MS,
  INSTAGRAM_MAX_CHECKS,
  composeInstagramCaption,
  validateInstagramReel,
} from './instagram-helpers';
import { PublicationMetricsService } from './publication-metrics.service';
import { InstagramUploader } from './instagram-uploader';
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
import { TiktokUploader } from './tiktok-uploader';
import { TIKTOK_CHECK_DELAY_MS, TIKTOK_MAX_CHECKS, tiktokPostUrl } from './tiktok-helpers';

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
    private readonly tiktokUploader: TiktokUploader,
    private readonly instagramUploader: InstagramUploader,
    private readonly publish: PublishService,
    private readonly metricsService: PublicationMetricsService,
    @InjectQueue(PUBLISH_QUEUE_NAME)
    private readonly queue: Queue<PublishJobData>,
  ) {
    super();
  }

  async process(job: Job<PublishJobData>): Promise<void> {
    if (job.data.kind === 'sync-metrics') {
      await this.metricsService.syncStalePublications();
      return;
    }
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
    try {
      await this.queue.upsertJobScheduler(
        'sync-metrics-periodic',
        { every: this.config.metricsSyncIntervalMs },
        {
          name: 'sync-metrics',
          data: { kind: 'sync-metrics' },
          opts: { removeOnComplete: true, removeOnFail: 20 },
        },
      );
    } catch (error) {
      this.logger.warn(`schedule metrics sync: ${describe(error)}`);
    }
  }

  private async upload(publicationId: string): Promise<void> {
    const claimed = await this.prisma.publication.updateMany({
      // `uploading` diterima agar job yang stalled (API restart) bisa diulang dari awal.
      where: {
        id: publicationId,
        status: { in: [PublicationStatus.scheduled, PublicationStatus.queued, PublicationStatus.uploading] },
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
    if (!publication.socialAccountId) {
      throw new PublishError('Social account was disconnected', false);
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

    if (publication.platform === 'youtube') {
      const accessToken = await this.accessToken(publication.socialAccountId, 'youtube');
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
      return;
    }

    if (publication.platform === 'instagram') {
      await this.uploadInstagram(publicationId, publication, size);
      return;
    }

    if (publication.platform !== 'tiktok') {
      throw new PublishError('Publishing to this platform is not available yet');
    }
    const mode = publication.mode === 'inbox' ? 'inbox' : 'direct';
    const accessToken = await this.accessToken(publication.socialAccountId, 'tiktok');
    // creator_info harus fresh: privacy option dan limit durasi dapat berubah.
    const creator = await this.creatorInfo(accessToken);
    if (
      mode === 'direct' &&
      !creator.privacyLevelOptions.includes(publication.privacy)
    ) {
      throw new PublishError('Selected TikTok privacy level is no longer available for this account');
    }
    const duration = publication.clip.endSec - publication.clip.startSec;
    if (duration > creator.maxVideoPostDurationSec) {
      throw new PublishError(
        `Clip duration exceeds this TikTok account limit (${creator.maxVideoPostDurationSec} seconds)`,
      );
    }
    const options = this.tiktokOptions(publication.options);
    if (mode === 'direct' && options.brandContent && publication.privacy === 'SELF_ONLY') {
      throw new PublishError('Branded content cannot use TikTok privacy SELF_ONLY');
    }
    // Username dibutuhkan untuk membentuk URL video setelah publish; disimpan di options.
    const storedOptions = {
      ...(publication.options && typeof publication.options === 'object' && !Array.isArray(publication.options)
        ? (publication.options as Record<string, unknown>)
        : {}),
      creatorUsername: creator.username || null,
    };
    const session = await this.tiktokUploader.startSession(
      accessToken,
      mode,
      mode === 'direct'
        ? {
            title: publication.caption,
            privacyLevel: publication.privacy,
            ...options,
          }
        : null,
      size,
    );
    let lastPercent = 0;
    await this.tiktokUploader.uploadFile(session.uploadUrl, filePath, size, async (sent) => {
      const percent = Math.min(uploadPercent(sent, size), 99);
      if (percent <= lastPercent) return;
      lastPercent = percent;
      await this.prisma.publication.updateMany({
        where: { id: publicationId, status: PublicationStatus.uploading },
        data: { progress: percent },
      });
    });
    await this.prisma.publication.updateMany({
      where: { id: publicationId, status: PublicationStatus.uploading },
      data: {
        status: PublicationStatus.processing,
        progress: 100,
        externalId: session.publishId,
        options: storedOptions,
      },
    });
    await this.scheduleCheck(publicationId, 1);
  }

  private async check(publicationId: string, checks: number): Promise<void> {
    const publication = await this.prisma.publication.findUnique({
      where: { id: publicationId },
      select: {
        status: true,
        externalId: true,
        socialAccountId: true,
        platform: true,
        mode: true,
        privacy: true,
        caption: true,
        options: true,
        clipId: true,
      },
    });
    if (!publication || publication.status !== PublicationStatus.processing) return;
    if (!publication.socialAccountId) {
      throw new PublishError('Social account was disconnected', false);
    }
    if (!publication.externalId) return;

    if (publication.platform === 'youtube') {
      let outcome;
      try {
        outcome = await this.uploader.videoStatus(
          await this.accessToken(publication.socialAccountId, 'youtube'),
          publication.externalId,
        );
      } catch (error) {
        if (error instanceof PublishError && error.transient && checks < MAX_PROCESSING_CHECKS) {
          await this.scheduleCheck(publicationId, checks + 1);
          return;
        }
        throw error;
      }
      if (outcome.state === 'published') return this.markPublished(publicationId);
      if (outcome.state === 'failed') {
        return this.markFailed(publicationId, outcome.reason, [PublicationStatus.processing]);
      }
      if (checks >= MAX_PROCESSING_CHECKS) {
        this.logger.warn(`publikasi ${publicationId}: batas cek status tercapai, dianggap published`);
        return this.markPublished(publicationId);
      }
      return this.scheduleCheck(publicationId, checks + 1);
    }

    if (publication.platform === 'instagram') {
      await this.checkInstagram(publicationId, publication, checks);
      return;
    }

    if (publication.platform !== 'tiktok') return;
    const mode = publication.mode === 'inbox' ? 'inbox' : 'direct';
    let outcome;
    try {
      outcome = await this.tiktokUploader.publishStatus(
        await this.accessToken(publication.socialAccountId, 'tiktok'),
        publication.externalId,
        mode,
      );
    } catch (error) {
      if (error instanceof PublishError && error.transient && checks < TIKTOK_MAX_CHECKS) {
        await this.scheduleCheck(publicationId, checks + 1);
        return;
      }
      throw error;
    }
    if (outcome.state === 'failed') {
      return this.markFailed(publicationId, outcome.reason, [PublicationStatus.processing]);
    }
    if (outcome.state === 'published') {
      const username = this.tiktokUsername(publication.options);
      const externalUrl =
        mode === 'direct' && outcome.postId && username
          ? tiktokPostUrl(username, outcome.postId)
          : null;
      await this.prisma.publication.updateMany({
        where: { id: publicationId, status: PublicationStatus.processing },
        data: {
          status: PublicationStatus.published,
          publishedAt: new Date(),
          externalId: outcome.postId ?? publication.externalId,
          externalUrl,
        },
      });
      return;
    }
    if (checks >= TIKTOK_MAX_CHECKS) {
      return this.markFailed(
        publicationId,
        'TikTok publishing timed out after 10 minutes',
        [PublicationStatus.processing],
      );
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
    const publication = await this.prisma.publication.findUnique({
      where: { id: publicationId },
      select: { platform: true },
    });
    const delay =
      publication?.platform === 'instagram'
        ? INSTAGRAM_CHECK_DELAY_MS
        : publication?.platform === 'tiktok'
          ? TIKTOK_CHECK_DELAY_MS
          : PROCESSING_CHECK_DELAY_MS;
    await this.queue.add(
      'check',
      { publicationId, kind: 'check', checks },
      {
        // Suffix waktu mencegah dedupe dengan job cek lama yang masih tersimpan.
        jobId: publishJobId(publicationId, `check-${checks}-${Date.now()}`),
        delay,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }

  private async accessToken(
    accountId: string,
    platform: 'youtube' | 'tiktok' | 'instagram',
  ): Promise<string> {
    try {
      return await this.social.getValidAccessToken(accountId);
    } catch (error) {
      if (error instanceof SocialProviderError && error.code === 'not_configured') {
        throw new PublishError(
          platform === 'instagram'
            ? 'Instagram publishing is not configured on the server'
            : 'YouTube publishing is not configured on the server',
        );
      }
      throw new PublishError(RECONNECT_MESSAGE);
    }
  }

  private async creatorInfo(accessToken: string) {
    try {
      return await fetchTiktokCreatorInfo(accessToken);
    } catch (error) {
      throw new PublishError(
        error instanceof Error && error.message.includes('access_token')
          ? 'Reconnect your TikTok account'
          : 'Could not retrieve TikTok creator settings, retry later',
        true,
      );
    }
  }

  private tiktokUsername(value: unknown): string | null {
    const options = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    return typeof options.creatorUsername === 'string' && options.creatorUsername
      ? options.creatorUsername
      : null;
  }

  private tiktokOptions(value: unknown): {
    disableComment: boolean;
    disableDuet: boolean;
    disableStitch: boolean;
    brandContent: boolean;
    brandOrganic: boolean;
  } {
    const options = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    return {
      disableComment: options.disableComment === true,
      disableDuet: options.disableDuet === true,
      disableStitch: options.disableStitch === true,
      brandContent: options.brandContent === true,
      brandOrganic: options.brandOrganic === true,
    };
  }

  /** Unggah Reels Instagram: validasi batas, buat container REELS, lalu cek status. */
  private async uploadInstagram(
    publicationId: string,
    publication: {
      id: string;
      caption: string;
      socialAccountId: string | null;
      options: PrismaJsonish;
      clip: { id: string; startSec: number; endSec: number; hashtags: string[] };
    },
    size: number,
  ): Promise<void> {
    if (!publication.socialAccountId) {
      throw new PublishError('Social account was disconnected', false);
    }
    const accessToken = await this.accessToken(
      publication.socialAccountId,
      'instagram',
    );
    const igUserId = await this.instagramUserId(publication.socialAccountId);
    const durationSec = publication.clip.endSec - publication.clip.startSec;
    const reelError = validateInstagramReel({ durationSec, sizeBytes: size });
    if (reelError) throw new PublishError(reelError);

    const videoUrl = publicMediaUrl(
      this.config.publicWebUrl,
      publication.clip.id,
      derivePublicMediaKey(this.tokenKey()),
    );
    const caption = composeInstagramCaption(
      publication.caption,
      publication.clip.hashtags,
    );
    const containerId = await this.instagramUploader.createContainer({
      accessToken,
      igUserId,
      videoUrl,
      caption,
    });
    await this.prisma.publication.updateMany({
      where: { id: publicationId, status: PublicationStatus.uploading },
      data: {
        status: PublicationStatus.processing,
        progress: 100,
        externalId: containerId,
        options: {
          ...(asRecord(publication.options) ?? {}),
          igUserId,
        },
      },
    });
    await this.scheduleCheck(publicationId, 1);
  }

  /** Cek container Reels: FINISHED → media_publish → simpan permalink. */
  private async checkInstagram(
    publicationId: string,
    publication: {
      externalId: string | null;
      socialAccountId: string | null;
      options: PrismaJsonish;
      clipId: string;
    },
    checks: number,
  ): Promise<void> {
    const containerId = publication.externalId;
    if (!containerId) return;
    if (!publication.socialAccountId) {
      throw new PublishError('Social account was disconnected', false);
    }
    const accessToken = await this.accessToken(
      publication.socialAccountId,
      'instagram',
    );
    const igUserId =
      instagramUserIdFromOptions(publication.options) ??
      (await this.instagramUserId(publication.socialAccountId));

    let outcome;
    try {
      outcome = await this.instagramUploader.containerStatus(
        accessToken,
        containerId,
      );
    } catch (error) {
      if (
        error instanceof PublishError &&
        error.transient &&
        checks < INSTAGRAM_MAX_CHECKS
      ) {
        await this.scheduleCheck(publicationId, checks + 1);
        return;
      }
      throw error;
    }

    if (outcome.state === 'failed') {
      return this.markFailed(publicationId, outcome.reason, [
        PublicationStatus.processing,
      ]);
    }
    if (outcome.state === 'published') return this.markPublished(publicationId);

    if (outcome.state === 'ready') {
      try {
        const result = await this.instagramUploader.publishContainer(
          accessToken,
          igUserId,
          containerId,
        );
        const permalink = result.mediaId
          ? await this.instagramUploader
              .fetchPermalink(accessToken, result.mediaId)
              .catch(() => null)
          : null;
        await this.prisma.publication.updateMany({
          where: { id: publicationId, status: PublicationStatus.processing },
          data: {
            status: PublicationStatus.published,
            publishedAt: new Date(),
            externalId: result.mediaId ?? containerId,
            externalUrl: permalink,
          },
        });
        if (result.configIssue) {
          this.logger.warn(
            `publikasi ${publicationId}: Instagram publish sebagian (${result.configIssue})`,
          );
        }
        return;
      } catch (error) {
        if (
          error instanceof PublishError &&
          error.transient &&
          checks < INSTAGRAM_MAX_CHECKS
        ) {
          await this.scheduleCheck(publicationId, checks + 1);
          return;
        }
        throw error;
      }
    }

    if (checks >= INSTAGRAM_MAX_CHECKS) {
      return this.markFailed(
        publicationId,
        'Instagram publishing timed out after 10 minutes',
        [PublicationStatus.processing],
      );
    }
    await this.scheduleCheck(publicationId, checks + 1);
  }

  private async instagramUserId(accountId: string): Promise<string> {
    const account = await this.prisma.socialAccount.findUnique({
      where: { id: accountId },
      select: { externalId: true },
    });
    if (!account?.externalId) throw new PublishError('Reconnect your Instagram account');
    return account.externalId;
  }

  private tokenKey(): string {
    const key = this.config.socialTokenKey;
    if (!key) throw new PublishError('Instagram publishing is not configured on the server');
    return key;
  }

  private async fail(publicationId: string, error: unknown): Promise<void> {
    const message =
      error instanceof PublishError ? error.message : 'Upload failed, retry later';
    if (!(error instanceof PublishError)) {
      // Hanya pesan galat; token tidak pernah masuk ke pesan galat.
      this.logger.error(`publikasi ${publicationId}: ${describe(error)}`);
    }
    await this.markFailed(publicationId, message, [
      PublicationStatus.scheduled,
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
   * - queued/scheduled tanpa job BullMQ → masukkan ulang dengan sisa delay;
   * - uploading tanpa job aktif dan lebih tua dari 1 jam → failed "interrupted";
   * - processing tanpa job cek → jadwalkan cek status lagi.
   */
  private async recover(): Promise<void> {
    const stuck = await this.prisma.publication.findMany({
      where: {
        status: {
          in: [
            PublicationStatus.scheduled,
            PublicationStatus.queued,
            PublicationStatus.uploading,
            PublicationStatus.processing,
          ],
        },
      },
      select: { id: true, status: true, updatedAt: true, scheduledAt: true },
    });
    if (stuck.length === 0) return;

    const pending = await this.queue.getJobs([
      'active',
      'waiting',
      'delayed',
      'prioritized',
    ]);
    const tracked = new Set<string>();
    for (const job of pending) {
      if (job?.data && job.data.kind !== 'sync-metrics') {
        tracked.add(job.data.publicationId);
      }
    }

    for (const publication of stuck) {
      if (tracked.has(publication.id)) continue;
      if (publication.status === PublicationStatus.queued || publication.status === PublicationStatus.scheduled) {
        const scheduledAt = publication.status === PublicationStatus.scheduled ? publication.scheduledAt : null;
        const delay = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0;
        await this.publish.enqueueOrFail(publication.id, delay);
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

type PrismaJsonish = unknown;

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function instagramUserIdFromOptions(value: unknown): string | null {
  const record = asRecord(value);
  return typeof record?.igUserId === 'string' && record.igUserId
    ? record.igUserId
    : null;
}
