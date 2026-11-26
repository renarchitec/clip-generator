export const METRICS_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_METRIC_COUNT = 2_147_483_647;

export interface MetricCounts {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

export function parseMetricCount(value: unknown): number | null {
  const count = typeof value === 'string' && /^\d+$/.test(value.trim())
    ? Number(value)
    : value;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0
    ? Math.min(count, MAX_METRIC_COUNT)
    : null;
}

export function isNumericTiktokVideoId(externalId: string | null | undefined): boolean {
  return /^\d+$/.test(externalId ?? '');
}

export function partitionByCooldown<T extends { metricsUpdatedAt: Date | null }>(
  publications: readonly T[],
  now: Date,
  cooldownMs: number,
): { eligible: T[]; skipped: T[]; nextAllowedAt: string | null } {
  const eligible: T[] = [];
  const skipped: T[] = [];
  const nowMs = now.getTime();
  let earliest = Infinity;
  for (const publication of publications) {
    const expiry = (publication.metricsUpdatedAt?.getTime() ?? -Infinity) + cooldownMs;
    if (expiry > nowMs) {
      skipped.push(publication);
      earliest = Math.min(earliest, expiry);
    } else {
      eligible.push(publication);
      earliest = Math.min(earliest, nowMs + cooldownMs);
    }
  }
  return { eligible, skipped, nextAllowedAt: earliestExpiry(earliest) };
}

function earliestExpiry(time: number): string | null {
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isSafeInteger(size) || size < 1) throw new RangeError('Chunk size must be a positive integer');
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function classifyInstagramMetricsError(status: number, body: unknown): string {
  const error = asRecord(asRecord(body)?.error);
  const code = parseMetricCount(error?.code);
  const message = typeof error?.message === 'string' ? error.message : '';
  if (status === 401 || code === 190) return 'auth_error';
  if (status === 404 || (code === 100 && /does not exist|not found/i.test(message))) {
    return 'video_not_found';
  }
  if (code === 10 || code === 200 || /permission|insights/i.test(message)) {
    return 'missing_insights_permission';
  }
  return 'fetch_failed';
}

export function parseYoutubeStatisticsResponse(json: unknown): Map<string, MetricCounts> {
  const counts = new Map<string, MetricCounts>();
  for (const item of asArray(asRecord(json)?.items)) {
    const video = asRecord(item);
    if (typeof video?.id !== 'string' || !video.id) continue;
    const stats = asRecord(video.statistics);
    counts.set(video.id, {
      viewCount: parseMetricCount(stats?.viewCount),
      likeCount: parseMetricCount(stats?.likeCount),
      commentCount: parseMetricCount(stats?.commentCount),
    });
  }
  return counts;
}

export function parseInstagramInsightsResponse(insightsJson: unknown, mediaJson: unknown): MetricCounts {
  const views = asArray(asRecord(insightsJson)?.data)
    .map(asRecord)
    .find((metric) => metric?.name === 'views');
  const media = asRecord(mediaJson);
  return {
    viewCount: parseMetricCount(asRecord(views?.total_value)?.value)
      ?? parseMetricCount(asRecord(asArray(views?.values)[0])?.value),
    likeCount: parseMetricCount(media?.like_count),
    commentCount: parseMetricCount(media?.comments_count),
  };
}

export function parseTiktokVideoQueryResponse(json: unknown): Map<string, MetricCounts> {
  const counts = new Map<string, MetricCounts>();
  const data = asRecord(asRecord(json)?.data);
  for (const item of asArray(data?.videos)) {
    const video = asRecord(item);
    if (typeof video?.id !== 'string' || !isNumericTiktokVideoId(video.id)) continue;
    counts.set(video.id, {
      viewCount: parseMetricCount(video.view_count),
      likeCount: parseMetricCount(video.like_count),
      commentCount: parseMetricCount(video.comment_count),
    });
  }
  return counts;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
