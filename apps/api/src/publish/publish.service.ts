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
import type {
  PublicationResponse,
  PublishMode,
  PublishJobData,
} from '@clipper/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLISH_QUEUE_NAME } from '../queue/queue.constants';
import type { PublishClipDto } from './dto/publish-clip.dto';
import {
  ACTIVE_PUBLICATION_STATUSES,
  sanitizeCaption,
  sanitizeTiktokCaption,
  sanitizeTitle,
  tiktokMode,
  validatePublishTargets,
  validatePublishTargetsShape,
} from './publish-helpers';

/** Platform yang sudah bisa dipublikasikan. */
const PUBLISHABLE_PLATFORMS = new Set<string>(['youtube', 'tiktok']);

export const PUBLICATION_INCLUDE = {
  socialAccount: { select: { displayName: true } },
} as const satisfies Prisma.PublicationInclude;

type PublicationWithAccount = Prisma.PublicationGetPayload<{
  include: typeof PUBLICATION_INCLUDE;
}>;

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
  ) {}

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
      select: { id: true, platform: true },
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
      for (const target of dto.targets) {
        const account = byId.get(target.accountId)!;
        rows.push(
          await tx.publication.create({
            data: {
              clipId,
              socialAccountId: account.id,
              platform: account.platform,
              title:
                account.platform === 'tiktok'
                  ? sanitizeTitle(target.title ?? '')
                  : sanitizeTitle(target.title!),
              caption:
                account.platform === 'tiktok'
                  ? sanitizeTiktokCaption(target.caption ?? '')
                  : sanitizeCaption(target.caption ?? ''),
              privacy:
                account.platform === 'tiktok'
                  ? tiktokMode(target) === 'inbox'
                    ? 'inbox'
                    : target.tiktok!.privacyLevel
                  : target.privacy!,
              mode: account.platform === 'tiktok' ? tiktokMode(target) : 'direct',
              options:
                account.platform === 'tiktok' && tiktokMode(target) === 'direct'
                  ? {
                      privacyLevel: target.tiktok!.privacyLevel,
                      disableComment: target.tiktok!.disableComment ?? false,
                      disableDuet: target.tiktok!.disableDuet ?? false,
                      disableStitch: target.tiktok!.disableStitch ?? false,
                      brandContent: target.tiktok!.brandContent ?? false,
                      brandOrganic: target.tiktok!.brandOrganic ?? false,
                    }
                  : undefined,
              madeForKids: target.madeForKids ?? false,
              status: PublicationStatus.queued,
            },
            include: PUBLICATION_INCLUDE,
          }),
        );
      }
      return rows;
    });

    for (const publication of created) {
      await this.enqueueOrFail(publication.id);
    }

    const fresh = await this.prisma.publication.findMany({
      where: { id: { in: created.map((row) => row.id) } },
      include: PUBLICATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return fresh.map(toPublicationResponse);
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
      where: { clipId, socialAccount: { userId } },
      include: PUBLICATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPublicationResponse);
  }

  async retry(id: string, userId: string): Promise<PublicationResponse> {
    const publication = await this.prisma.publication.findFirst({
      where: { id, socialAccount: { userId }, clip: { job: { userId } } },
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
    if (publication.status !== PublicationStatus.failed) {
      throw new BadRequestException(
        'Hanya publikasi berstatus failed yang bisa diulang.',
      );
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
      where: { id, status: PublicationStatus.failed },
      data: {
        status: PublicationStatus.queued,
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
  async enqueueOrFail(publicationId: string): Promise<void> {
    try {
      await this.enqueueUpload(publicationId);
    } catch (error) {
      this.logger.error(
        `enqueue publish ${publicationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.prisma.publication.updateMany({
        where: { id: publicationId, status: PublicationStatus.queued },
        data: {
          status: PublicationStatus.failed,
          error: 'Could not queue the upload, retry later',
        },
      });
    }
  }

  async enqueueUpload(publicationId: string): Promise<void> {
    const jobId = publishJobId(publicationId);
    // Job lama (completed/failed) dengan id sama harus dihapus agar add tidak di-dedupe.
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        return;
      }
      await existing.remove().catch(() => undefined);
    }
    await this.queue.add(
      'upload',
      { publicationId, kind: 'upload' },
      { jobId, removeOnComplete: true, removeOnFail: 100 },
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

export function toPublicationResponse(
  row: PublicationWithAccount,
): PublicationResponse {
  return {
    id: row.id,
    clipId: row.clipId,
    platform: row.platform,
    accountId: row.socialAccountId,
    accountName: row.socialAccount.displayName,
    title: row.title,
    caption: row.caption,
    privacy: row.privacy,
    mode: row.mode as PublishMode,
    status: row.status,
    progress: row.progress,
    externalId: row.externalId,
    externalUrl: row.externalUrl,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}
