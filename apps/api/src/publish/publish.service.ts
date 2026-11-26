import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  PublicationStatus,
  type Prisma,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { isUUID } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  BatchSchedulePublishResponse,
  ClipCoverUploadResponse,
  PublicationResponse,
  PublishMode,
  PublishJobData,
} from '@clipper/shared';
import { resolveClipPath } from '../clips/clip-path';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLISH_QUEUE_NAME } from '../queue/queue.constants';
import { sanitizePlatformCaptions } from '../queue/clip-social';
import type { BatchSchedulePublishDto, PublishClipDto, PublishTargetDto } from './dto/publish-clip.dto';
import {
  ACTIVE_PUBLICATION_STATUSES,
  MAX_COVER_IMAGE_BYTES,
  coverErrorFromOptions,
  coverTimestampFromOptions,
  parseScheduledAt,
  sanitizeCaption,
  sanitizeTiktokCaption,
  sanitizeTitle,
  sniffCoverImageMime,
  tiktokMode,
  validatePublishTargets,
  validatePublishTargetsShape,
  validateTiktokTarget,
} from './publish-helpers';
import { composeInstagramCaption, sanitizeInstagramCaption } from './instagram-helpers';

/** Platform yang sudah bisa dipublikasikan. */
const PUBLISHABLE_PLATFORMS = new Set<string>(['youtube', 'tiktok', 'instagram']);

export const PUBLICATION_INCLUDE = {
  socialAccount: { select: { displayName: true } },
} as const satisfies Prisma.PublicationInclude;

type PublicationWithAccount = Prisma.PublicationGetPayload<{
  include: typeof PUBLICATION_INCLUDE;
}>;

const PUBLISH_ACCOUNT_SELECT = {
  id: true,
  platform: true,
  displayName: true,
  externalId: true,
} as const satisfies Prisma.SocialAccountSelect;

type PublishAccount = Prisma.SocialAccountGetPayload<{ select: typeof PUBLISH_ACCOUNT_SELECT }>;
const CANCELLABLE_STATUSES: PublicationStatus[] = [PublicationStatus.scheduled, PublicationStatus.queued];
const RETRYABLE_STATUSES: PublicationStatus[] = [PublicationStatus.failed, PublicationStatus.cancelled];

/** Id job BullMQ deterministik; ':' dilarang BullMQ sehingga dipakai '-'. */
export function publishJobId(publicationId: string, suffix = 'upload'): string {
  return `publish-${publicationId}-${suffix}`;
}

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(PUBLISH_QUEUE_NAME)
    private readonly queue: Queue<PublishJobData>,
    private readonly config: AppConfig,
  ) {}

  async uploadCover(
    userId: string,
    clipId: string,
    file?: Express.Multer.File,
  ): Promise<ClipCoverUploadResponse> {
    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, deletedAt: null, job: { userId } },
      select: { id: true },
    });
    if (!clip) throw new NotFoundException(`Clip ${clipId} tidak ditemukan.`);

    const buffer = file?.buffer;
    if (!buffer?.length || buffer.length > MAX_COVER_IMAGE_BYTES) {
      throw new BadRequestException('Cover thumbnail must be between 1 byte and 2 MiB');
    }
    const image = sniffCoverImageMime(buffer);
    if (!image) throw new BadRequestException('Cover thumbnail must be JPEG or PNG');

    const coverId = randomUUID();
    const path = resolveClipPath(this.config.clipsDir, `covers/${clip.id}/${coverId}.${image.ext}`);
    if (!path) throw new NotFoundException(`Clip ${clipId} tidak ditemukan.`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer, { flag: 'wx' });
    return { coverId };
  }

  private async findCoverFilePath(clipId: string, coverId: string): Promise<string> {
    if (isUUID(coverId)) {
      for (const ext of ['jpg', 'png']) {
        const relativePath = `covers/${clipId}/${coverId}.${ext}`;
        const path = resolveClipPath(this.config.clipsDir, relativePath);
        if (path && (await stat(path).catch(() => null))?.isFile()) return relativePath;
      }
    }
    throw new BadRequestException('Cover thumbnail not found for this clip');
  }

  async publish(
    clipId: string,
    dto: PublishClipDto,
    userId: string,
  ): Promise<PublicationResponse[]> {
    // Validasi yang bergantung pada platform dilakukan setelah akun dimuat.
    const shapeInvalid = validatePublishTargetsShape(dto.targets);
    if (shapeInvalid) throw new BadRequestException(shapeInvalid);

    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, job: { userId } },
      select: { id: true, deletedAt: true },
    });
    if (!clip || clip.deletedAt) {
      throw new NotFoundException(`Clip ${clipId} tidak ditemukan.`);
    }
    // Baris clip hanya dibuat setelah file-nya selesai dirender (progress
    // worker atau hasil akhir), jadi clip dari job yang masih berjalan atau
    // gagal di tengah sudah bisa dipublikasikan; status job tidak dicek.

    const accountIds = dto.targets.map((target) => target.accountId);
    const accounts = await this.prisma.socialAccount.findMany({
      where: { id: { in: accountIds }, userId },
      select: PUBLISH_ACCOUNT_SELECT,
    });
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const invalid = validatePublishTargets(
      dto.targets,
      (accountId) => byId.get(accountId)?.platform,
    );
    if (invalid) throw new BadRequestException(invalid);

    for (const target of dto.targets) {
      const account = byId.get(target.accountId);
      if (!account) {
        throw new NotFoundException(
          `Akun sosial ${target.accountId} tidak ditemukan.`,
        );
      }
      if (!PUBLISHABLE_PLATFORMS.has(account.platform)) {
        throw new BadRequestException('platform_unavailable');
      }
    }

    const coverTimestampMs = typeof dto.coverTimestampMs === 'number' ? Math.round(dto.coverTimestampMs) : null;
    const coverFilePath = dto.coverId != null ? await this.findCoverFilePath(clip.id, dto.coverId) : null;
    const schedules = dto.targets.map((target) => parseScheduledAt(target.scheduledAt ?? dto.scheduledAt));
    const created = await this.prisma.$transaction(async (tx) => {
      const active = await tx.publication.findFirst({
        where: {
          clipId,
          socialAccountId: { in: accountIds },
          status: { in: [...ACTIVE_PUBLICATION_STATUSES] },
        },
        select: { id: true },
      });
      if (active) throw new ConflictException('publication_in_progress');

      const rows: PublicationWithAccount[] = [];
      for (const [i, target] of dto.targets.entries()) {
        const account = byId.get(target.accountId)!;
        rows.push(await tx.publication.create({
          data: publicationData(clipId, account, target, schedules[i], coverTimestampMs, coverFilePath),
          include: PUBLICATION_INCLUDE,
        }));
      }
      return rows;
    });

    for (const publication of created) {
      await this.enqueueOrFail(publication.id, uploadDelay(publication.scheduledAt));
    }

    const fresh = await this.prisma.publication.findMany({
      where: { id: { in: created.map((row) => row.id) } },
      include: PUBLICATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return fresh.map(toPublicationResponse);
  }

  async batchSchedule(
    jobId: string,
    dto: BatchSchedulePublishDto,
    userId: string,
  ): Promise<BatchSchedulePublishResponse> {
    const clipIds = dto.clipIds && [...new Set(dto.clipIds)];
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      select: {
        clips: {
          where: { deletedAt: null, ...(clipIds ? { id: { in: clipIds } } : {}) },
          orderBy: [{ viralScore: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
          select: { id: true, title: true, caption: true, hashtags: true, platformCaptions: true },
        },
      },
    });
    if (!job) throw new NotFoundException(`Job ${jobId} tidak ditemukan.`);
    const clipsById = new Map(job.clips.map((clip) => [clip.id, clip]));
    const clips = clipIds ? clipIds.flatMap((id) => clipsById.get(id) ?? []) : job.clips;

    const accountIds = [...new Set(dto.accountIds)];
    const rows = await this.prisma.socialAccount.findMany({
      where: { id: { in: accountIds }, userId },
      select: { ...PUBLISH_ACCOUNT_SELECT, refreshTokenEnc: true, expiresAt: true },
    });
    const accountsById = new Map(rows.map((row) => [row.id, row]));
    const now = new Date();
    const accounts = accountIds.map((id) => {
      const account = accountsById.get(id);
      if (!account) throw new NotFoundException(`Akun sosial ${id} tidak ditemukan.`);
      if (!account.refreshTokenEnc && account.expiresAt && account.expiresAt <= now) {
        throw new BadRequestException('social_account_disconnected');
      }
      if (!PUBLISHABLE_PLATFORMS.has(account.platform)) {
        throw new BadRequestException('platform_unavailable');
      }
      return account;
    });
    if (dto.tiktokMode === 'direct' && accounts.some((account) => account.platform === 'tiktok')) {
      const invalid = validateTiktokTarget({ mode: 'direct', caption: '', tiktok: dto.tiktok });
      if (invalid) throw new BadRequestException(invalid);
    }

    const baseTime = parseScheduledAt(dto.startAt, now) ?? now;
    const skipped: BatchSchedulePublishResponse['skipped'] = [];
    if (!clips.length) return { scheduled: [], skipped };

    const created = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.publication.findMany({
        where: {
          clipId: { in: clips.map((clip) => clip.id) },
          socialAccountId: { in: accountIds },
          status: { in: [...ACTIVE_PUBLICATION_STATUSES, PublicationStatus.published] },
        },
        select: { clipId: true, socialAccountId: true },
      });
      const blocked = new Set(existing.map((row) => JSON.stringify([row.clipId, row.socialAccountId])));
      const publications: PublicationWithAccount[] = [];
      for (const [i, clip] of clips.entries()) {
        const slotDate = new Date(baseTime.getTime() + Math.round(i * dto.intervalHours * 3_600_000));
        const scheduledAt = uploadDelay(slotDate) > 15_000 ? slotDate : null;
        const variants = sanitizePlatformCaptions(clip.platformCaptions);
        for (const account of accounts) {
          if (blocked.has(JSON.stringify([clip.id, account.id]))) {
            skipped.push({ clipId: clip.id, accountId: account.id, reason: 'already_published_or_scheduled' });
            continue;
          }
          const variant = variants?.[account.platform];
          const caption = variant?.caption ?? clip.caption ?? '';
          const hashtags = variant?.hashtags ?? clip.hashtags;
          const target = {
            title: variant?.title || clip.title,
            caption: account.platform === 'instagram'
              ? composeInstagramCaption(caption, hashtags)
              : composeBatchCaption(caption, hashtags),
            privacy: dto.privacy ?? 'private',
            madeForKids: dto.madeForKids,
            mode: dto.tiktokMode === 'direct' ? 'direct' : 'inbox',
            tiktok: dto.tiktok,
          } as const;
          publications.push(await tx.publication.create({
            data: publicationData(clip.id, account, target, scheduledAt),
            include: PUBLICATION_INCLUDE,
          }));
        }
      }
      return publications;
    });

    const scheduled = [];
    for (const publication of created) {
      await this.enqueueOrFail(publication.id, uploadDelay(publication.scheduledAt));
      scheduled.push(await this.findResponse(publication.id));
    }
    return { scheduled, skipped };
  }

  async listForClip(
    clipId: string,
    userId: string,
  ): Promise<PublicationResponse[]> {
    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, job: { userId } },
      select: { id: true },
    });
    if (!clip) throw new NotFoundException(`Clip ${clipId} tidak ditemukan.`);

    const rows = await this.prisma.publication.findMany({
      where: { clipId, clip: { job: { userId } } },
      include: PUBLICATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPublicationResponse);
  }

  async cancel(id: string, userId: string): Promise<PublicationResponse> {
    const ownership = { id, clip: { job: { userId } } };
    const publication = await this.prisma.publication.findFirst({
      where: ownership,
      select: { status: true },
    });
    if (!publication) throw new NotFoundException(`Publikasi ${id} tidak ditemukan.`);
    if (!CANCELLABLE_STATUSES.includes(publication.status)) {
      throw new BadRequestException('publication_not_cancellable');
    }

    // Claim cancellation in the DB before removing the job, so the worker
    // and this request cannot both claim a queued or scheduled publication.
    const cancelled = await this.prisma.publication.updateMany({
      where: { ...ownership, status: { in: CANCELLABLE_STATUSES } },
      data: { status: PublicationStatus.cancelled, error: null },
    });
    if (cancelled.count === 0) throw new BadRequestException('publication_not_cancellable');

    try {
      await this.queue.remove(publishJobId(id));
    } catch {
      // A missing or locked BullMQ job cannot override the DB cancellation.
    }
    return this.findResponse(id);
  }

  async retry(id: string, userId: string): Promise<PublicationResponse> {
    const publication = await this.prisma.publication.findFirst({
      where: { id, clip: { job: { userId } } },
      select: {
        id: true,
        clipId: true,
        socialAccountId: true,
        status: true,
        clip: { select: { deletedAt: true } },
      },
    });
    if (!publication || publication.clip.deletedAt) {
      throw new NotFoundException(`Publikasi ${id} tidak ditemukan.`);
    }
    if (!publication.socialAccountId) {
      throw new BadRequestException('social_account_disconnected');
    }
    if (!RETRYABLE_STATUSES.includes(publication.status)) {
      throw new BadRequestException('Hanya publikasi failed atau cancelled yang bisa diulang.');
    }

    const active = await this.prisma.publication.findFirst({
      where: {
        clipId: publication.clipId,
        socialAccountId: publication.socialAccountId,
        status: { in: [...ACTIVE_PUBLICATION_STATUSES] },
        id: { not: id },
      },
      select: { id: true },
    });
    if (active) throw new ConflictException('publication_in_progress');

    const reset = await this.prisma.publication.updateMany({
      where: { id, status: publication.status },
      data: {
        status: PublicationStatus.queued,
        scheduledAt: null,
        progress: 0,
        error: null,
        externalId: null,
        externalUrl: null,
        publishedAt: null,
      },
    });
    if (reset.count === 0) {
      throw new ConflictException('publication_in_progress');
    }

    await this.enqueueOrFail(id);
    return this.findResponse(id);
  }

  /** Masukkan job unggah; bila Redis gagal, publikasi langsung ditandai failed. */
  async enqueueOrFail(publicationId: string, delayMs = 0): Promise<void> {
    try {
      await this.enqueueUpload(publicationId, delayMs);
    } catch (error) {
      this.logger.error(
        `enqueue publish ${publicationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.prisma.publication.updateMany({
        where: { id: publicationId, status: { in: CANCELLABLE_STATUSES } },
        data: {
          status: PublicationStatus.failed,
          error: 'Could not queue the upload, retry later',
        },
      });
    }
  }

  async enqueueUpload(publicationId: string, delayMs = 0): Promise<void> {
    const jobId = publishJobId(publicationId);
    // Job lama (completed/failed) dengan id sama harus dihapus agar add tidak di-dedupe.
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'delayed') {
        if (delayMs === 0) await existing.promote();
        return;
      }
      if (state === 'active' || state === 'waiting') return;
      await existing.remove().catch(() => undefined);
    }
    await this.queue.add(
      'upload',
      { publicationId, kind: 'upload' },
      { jobId, removeOnComplete: true, removeOnFail: 100, ...(delayMs > 0 ? { delay: delayMs } : {}) },
    );
  }

  private async findResponse(id: string): Promise<PublicationResponse> {
    const row = await this.prisma.publication.findUnique({
      where: { id },
      include: PUBLICATION_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Publikasi ${id} tidak ditemukan.`);
    return toPublicationResponse(row);
  }
}

function uploadDelay(scheduledAt: Date | null): number {
  return scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0;
}

function composeBatchCaption(caption: string, hashtags: string[]): string {
  const seen = new Set((caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((tag) => tag.toLowerCase()));
  const extra: string[] = [];
  for (const raw of hashtags) {
    const word = raw.replace(/[^\p{L}\p{N}_]/gu, '');
    if (!word) continue;
    const tag = `#${word}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push(tag);
  }
  return [caption.trim(), extra.join(' ')].filter(Boolean).join('\n\n');
}

function publicationData(
  clipId: string,
  account: PublishAccount,
  target: Pick<PublishTargetDto, 'title' | 'caption' | 'privacy' | 'mode' | 'tiktok' | 'madeForKids'>,
  scheduledAt: Date | null,
  coverTimestampMs: number | null = null,
  coverFilePath: string | null = null,
): Prisma.PublicationUncheckedCreateInput {
  const mode = account.platform === 'tiktok' ? tiktokMode(target) : 'direct';
  const tiktok = account.platform === 'tiktok' && mode === 'direct' ? target.tiktok : undefined;
  const options = {
    ...(tiktok && {
      privacyLevel: tiktok.privacyLevel,
      disableComment: tiktok.disableComment ?? false,
      disableDuet: tiktok.disableDuet ?? false,
      disableStitch: tiktok.disableStitch ?? false,
      brandContent: tiktok.brandContent ?? false,
      brandOrganic: tiktok.brandOrganic ?? false,
    }),
    ...(coverTimestampMs !== null && mode !== 'inbox' && { coverTimestampMs }),
    ...(account.platform === 'youtube' && coverFilePath && { coverFilePath }),
  };
  return {
    clipId,
    socialAccountId: account.id,
    accountName: account.displayName,
    accountExternalId: account.externalId,
    platform: account.platform,
    title: sanitizeTitle(target.title ?? ''),
    caption: account.platform === 'tiktok'
      ? sanitizeTiktokCaption(target.caption)
      : account.platform === 'instagram'
        ? sanitizeInstagramCaption(target.caption)
        : sanitizeCaption(target.caption),
    privacy: account.platform === 'tiktok'
      ? tiktok?.privacyLevel ?? 'inbox'
      : account.platform === 'instagram'
        ? 'public'
        : target.privacy!,
    mode,
    options: Object.keys(options).length ? options : undefined,
    madeForKids: target.madeForKids ?? false,
    status: scheduledAt ? PublicationStatus.scheduled : PublicationStatus.queued,
    scheduledAt,
  };
}

export function toPublicationResponse(
  row: Omit<PublicationWithAccount, 'accountName'> & { accountName?: string | null },
): PublicationResponse {
  return {
    id: row.id,
    clipId: row.clipId,
    platform: row.platform,
    accountId: row.socialAccountId,
    accountName: row.socialAccount?.displayName ?? row.accountName ?? '',
    title: row.title,
    caption: row.caption,
    privacy: row.privacy,
    mode: row.mode as PublishMode,
    status: row.status,
    progress: row.progress,
    externalId: row.externalId,
    externalUrl: row.externalUrl,
    error: row.error,
    coverTimestampMs: coverTimestampFromOptions(row.options),
    coverError: coverErrorFromOptions(row.options),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    metricsUpdatedAt: row.metricsUpdatedAt?.toISOString() ?? null,
    metricsError: row.metricsError,
  };
}
