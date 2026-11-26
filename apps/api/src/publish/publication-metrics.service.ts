import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BulkRefreshMetricsResponse, RefreshMetricsResponse } from '@clipper/shared';
import { PublicationStatus, type Prisma } from '@prisma/client';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { SocialService } from '../social/social.service';
import { instagramGraphBaseUrl } from './instagram-helpers';
import {
  METRICS_REFRESH_COOLDOWN_MS,
  asRecord,
  chunkArray,
  classifyInstagramMetricsError,
  isNumericTiktokVideoId,
  parseInstagramInsightsResponse,
  parseTiktokVideoQueryResponse,
  parseYoutubeStatisticsResponse,
  partitionByCooldown,
  type MetricCounts,
} from './publication-metrics-helpers';
import { toPublicationResponse } from './publish.service';

const METRICS_INCLUDE = {
  socialAccount: { select: { displayName: true, scopes: true } },
} as const satisfies Prisma.PublicationInclude;

type MetricsPublication = Prisma.PublicationGetPayload<{ include: typeof METRICS_INCLUDE }>;
type ConnectedPublication = MetricsPublication & {
  socialAccountId: string;
  socialAccount: NonNullable<MetricsPublication['socialAccount']>;
};
type MetricsUpdate = Partial<MetricCounts> & { metricsError: string | null };
type VideoPublication = MetricsPublication & { externalId: string };
const RECENT_PUBLICATION_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class PublicationMetricsService {
  private readonly logger = new Logger(PublicationMetricsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly social: SocialService,
    private readonly config: AppConfig,
  ) {}

  async refreshClipMetrics(userId: string, clipId: string): Promise<RefreshMetricsResponse> {
    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, job: { userId } },
      select: { id: true },
    });
    if (!clip) throw new NotFoundException(`Clip ${clipId} tidak ditemukan.`);

    const rows = await this.prisma.publication.findMany({
      where: { clipId, clip: { job: { userId } } },
      include: METRICS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const { updated, ...result } = await this.refreshByCooldown(
      rows.filter((row) => row.status === PublicationStatus.published),
    );
    return { ...result, publications: rows.map((row) => toPublicationResponse(updated.get(row.id) ?? row)) };
  }

  async refreshUserMetrics(userId: string, clipIds?: string[]): Promise<BulkRefreshMetricsResponse> {
    const rows = await this.prisma.publication.findMany({
      where: {
        status: PublicationStatus.published,
        clip: { job: { userId } },
        ...(clipIds ? { clipId: { in: clipIds.slice(0, 50) } } : {}),
      },
      include: METRICS_INCLUDE,
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 50,
    });
    const { refreshed, skipped, nextAllowedAt } = await this.refreshByCooldown(rows);
    return { refreshed, skipped, nextAllowedAt };
  }

  async syncStalePublications(limit = 200): Promise<{ refreshed: number; skipped: number }> {
    const now = new Date();
    const recent = new Date(now.getTime() - RECENT_PUBLICATION_MS);
    const stale = new Date(now.getTime() - this.config.metricsSyncIntervalMs / 2);
    const rows = await this.prisma.publication.findMany({
      where: {
        status: PublicationStatus.published,
        socialAccountId: { not: null },
        AND: [
          { OR: [{ publishedAt: { gte: recent } }, { publishedAt: null, createdAt: { gte: recent } }] },
          { OR: [{ metricsUpdatedAt: null }, { metricsUpdatedAt: { lt: stale } }] },
        ],
      },
      include: METRICS_INCLUDE,
      orderBy: [{ metricsUpdatedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: Math.max(0, Math.min(200, limit)),
    });
    const updated = await this.refreshPublications(rows, now);
    return { refreshed: updated.size, skipped: rows.length - updated.size };
  }

  private async refreshByCooldown(rows: MetricsPublication[]) {
    const now = new Date();
    const { eligible, nextAllowedAt } = partitionByCooldown(rows, now, METRICS_REFRESH_COOLDOWN_MS);
    const updated = await this.refreshPublications(eligible, now);
    return {
      updated,
      refreshed: updated.size,
      skipped: rows.length - updated.size,
      nextAllowedAt: updated.size === eligible.length ? nextAllowedAt : now.toISOString(),
    };
  }

  private async refreshPublications(rows: MetricsPublication[], now: Date) {
    const updated = new Map<string, MetricsPublication>();
    const save = async (publication: MetricsPublication, data: MetricsUpdate) => {
      try {
        const row = await this.prisma.publication.update({
          where: {
            id: publication.id,
            status: PublicationStatus.published,
            socialAccountId: publication.socialAccountId,
          },
          data: { ...data, metricsUpdatedAt: now },
          include: METRICS_INCLUDE,
        });
        updated.set(row.id, row);
      } catch {
        this.logger.warn(`Could not save metrics for publication ${publication.id}`);
      }
    };

    const groups = new Map<string, ConnectedPublication[]>();
    for (const row of rows) {
      if (!row.socialAccountId || !row.socialAccount) {
        await save(row, { metricsError: 'account_disconnected' });
        continue;
      }
      const { socialAccountId, socialAccount } = row;
      const connected = { ...row, socialAccountId, socialAccount };
      const key = `${row.platform}:${socialAccountId}`;
      const group = groups.get(key);
      if (group) group.push(connected);
      else groups.set(key, [connected]);
    }
    for (const group of groups.values()) {
      const account = group[0];
      const videos: VideoPublication[] = [];
      for (const row of group) {
        if (row.platform === 'tiktok' && (row.mode !== 'direct' || !isNumericTiktokVideoId(row.externalId))) {
          await save(row, { metricsError: 'post_id_unavailable' });
        } else if (row.platform === 'tiktok' && !row.socialAccount.scopes.includes('video.list')) {
          await save(row, { metricsError: 'missing_scope' });
        } else if (!row.externalId) {
          await save(row, { metricsError: 'video_not_found' });
        } else {
          videos.push({ ...row, externalId: row.externalId });
        }
      }
      if (!videos.length) continue;

      let token: string;
      try {
        token = await this.social.getValidAccessToken(account.socialAccountId);
      } catch {
        for (const video of videos) await save(video, { metricsError: 'auth_error' });
        continue;
      }

      if (account.platform === 'instagram') {
        for (const batch of chunkArray(videos, 5)) {
          await Promise.all(batch.map(async (video) => {
            const data = await this.fetchInstagram(video.externalId, token).catch(() => ({ metricsError: 'fetch_failed' }));
            await save(video, data);
          }));
        }
        continue;
      }

      const tiktok = account.platform === 'tiktok';
      // Multiple publication rows can refer to the same upstream video.
      const byId = new Map<string, VideoPublication[]>();
      for (const video of videos) {
        const duplicates = byId.get(video.externalId);
        if (duplicates) duplicates.push(video);
        else byId.set(video.externalId, [video]);
      }
      for (const ids of chunkArray([...byId.keys()], tiktok ? 20 : 50)) {
        const result = await (tiktok ? this.fetchTiktok(ids, token) : this.fetchYoutube(ids, token))
          .catch(() => ({ error: 'fetch_failed' } as const));
        for (const id of ids) {
          const counts = 'counts' in result ? result.counts.get(id) : undefined;
          const data = counts
            ? { ...counts, metricsError: null }
            : { metricsError: 'error' in result ? result.error : 'video_not_found' };
          for (const video of byId.get(id) ?? []) await save(video, data);
        }
      }
    }
    return updated;
  }

  private async fetchYoutube(ids: string[], token: string): Promise<BatchResult> {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'statistics');
    url.searchParams.set('id', ids.join(','));
    const { response, body } = await request(url, token);
    if (!response.ok) return { error: httpError(response.status) };
    if (!Array.isArray(asRecord(body)?.items)) return { error: 'fetch_failed' };
    return { counts: parseYoutubeStatisticsResponse(body) };
  }

  private async fetchInstagram(id: string, token: string): Promise<MetricsUpdate> {
    const mediaUrl = `${instagramGraphBaseUrl(token)}/${encodeURIComponent(id)}`;
    const insights = new URL(`${mediaUrl}/insights`);
    insights.searchParams.set('metric', 'views');
    const media = new URL(mediaUrl);
    media.searchParams.set('fields', 'like_count,comments_count');
    const [insightsResult, mediaResult] = await Promise.all([
      request(insights, token).catch(() => null),
      request(media, token).catch(() => null),
    ]);
    const insightsBody = asRecord(insightsResult?.body);
    const insightsOk = insightsResult?.response.ok && !insightsBody?.error && Array.isArray(insightsBody?.data);
    const metricCounts = parseInstagramInsightsResponse(
      insightsOk ? insightsBody : null,
      mediaResult?.response.ok ? mediaResult.body : null,
    );
    return {
      ...(metricCounts.viewCount !== null ? { viewCount: metricCounts.viewCount } : {}),
      ...(metricCounts.likeCount !== null ? { likeCount: metricCounts.likeCount } : {}),
      ...(metricCounts.commentCount !== null ? { commentCount: metricCounts.commentCount } : {}),
      metricsError: insightsOk ? null : classifyInstagramMetricsError(insightsResult?.response.status ?? 0, insightsBody),
    };
  }

  private async fetchTiktok(ids: string[], token: string): Promise<BatchResult> {
    const url = new URL('https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count');
    const { response, body } = await request(url, token, { filters: { video_ids: ids } });
    const json = asRecord(body);
    const code = asRecord(json?.error)?.code;
    if (code === 'scope_not_authorized') return { error: 'missing_scope' };
    if (code === 'access_token_invalid') return { error: 'auth_error' };
    if (!response.ok) return { error: httpError(response.status) };
    if ((code && code !== 'ok') || !Array.isArray(asRecord(json?.data)?.videos)) return { error: 'fetch_failed' };
    return { counts: parseTiktokVideoQueryResponse(body) };
  }
}

type BatchResult = { error: string } | { counts: Map<string, MetricCounts> };

function httpError(status: number): string {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 404) return 'video_not_found';
  return 'fetch_failed';
}

async function request(url: URL, token: string, payload?: unknown): Promise<{ response: Response; body: unknown }> {
  const response = await globalThis.fetch(url, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const body: unknown = await response.json().catch(() => null);
  return { response, body };
}
