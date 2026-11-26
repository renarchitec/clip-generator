import type { Prisma } from '@prisma/client';

/**
 * Select ringan publikasi untuk kartu klip; diurutkan terbaru dulu lalu
 * diringkas menjadi satu entri per akun via latestPerAccount.
 */
export const CLIP_PUBLICATION_SELECT = {
  orderBy: { createdAt: 'desc' },
  select: {
    id: true,
    socialAccountId: true,
    accountExternalId: true,
    platform: true,
    status: true,
    scheduledAt: true,
    externalUrl: true,
    mode: true,
    viewCount: true,
    likeCount: true,
    commentCount: true,
    metricsUpdatedAt: true,
    metricsError: true,
  },
} as const satisfies Prisma.Clip$publicationsArgs;
