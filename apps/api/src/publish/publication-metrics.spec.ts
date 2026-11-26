import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import * as instagramHelpers from './instagram-helpers.ts';
import * as helpers from './publication-metrics-helpers.ts';
import * as publishHelpers from './publish-helpers.ts';
import type { PublicationMetricsService as MetricsService } from './publication-metrics.service';

const {
  METRICS_REFRESH_COOLDOWN_MS,
  chunkArray,
  classifyInstagramMetricsError,
  isNumericTiktokVideoId,
  parseInstagramInsightsResponse,
  parseMetricCount,
  parseTiktokVideoQueryResponse,
  parseYoutubeStatisticsResponse,
  partitionByCooldown,
} = helpers;

// The existing strip-types runner cannot evaluate Nest decorators or parameter properties.
function loadDecorated<T>(name: string, dependencies: Record<string, unknown>): T {
  const file = fileURLToPath(new URL(name, import.meta.url));
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
    },
  });
  const require = createRequire(file);
  const exports = {};
  const load = runInThisContext(`(function (exports, require) { ${outputText}\n})`, { filename: file });
  load(exports, (id: string) => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id));
  return exports as T;
}

const serviceExports = loadDecorated<typeof import('./publish.service')>('./publish.service.ts', {
  '../queue/queue.constants': { PUBLISH_QUEUE_NAME: 'publish' },
  './publish-helpers': publishHelpers,
  './instagram-helpers': instagramHelpers,
});
const { PublicationMetricsService } = loadDecorated<typeof import('./publication-metrics.service')>(
  './publication-metrics.service.ts',
  {
    './instagram-helpers': instagramHelpers,
    './publication-metrics-helpers': helpers,
    './publish.service': serviceExports,
  },
);

test('parseMetricCount parses and clamps valid integers without coercing invalid input', () => {
  assert.equal(parseMetricCount(' 123 '), 123);
  assert.equal(parseMetricCount(123), 123);
  assert.equal(parseMetricCount('0'), 0);
  assert.equal(parseMetricCount(0), 0);
  assert.equal(parseMetricCount('9999999999999999999'), 2_147_483_647);
  assert.equal(parseMetricCount(2_147_483_648), 2_147_483_647);
  for (const invalid of [null, undefined, true, '', ' ', '123a', '0x12', '2.5', 2.5, '-1', -1, NaN, Infinity]) {
    assert.equal(parseMetricCount(invalid), null, String(invalid));
  }
});

test('partitionByCooldown treats exact expiry and null as eligible and returns the earliest next refresh', () => {
  const cooldown = METRICS_REFRESH_COOLDOWN_MS;
  const now = new Date('2026-02-02T12:00:00Z');
  const fresh = { metricsUpdatedAt: new Date(now.getTime() - 30_000) };
  const nearlyExpired = { metricsUpdatedAt: new Date(now.getTime() - cooldown + 500) };
  const expired = { metricsUpdatedAt: new Date(now.getTime() - cooldown) };
  const never = { metricsUpdatedAt: null };
  assert.deepEqual(partitionByCooldown([fresh, expired, nearlyExpired, never], now, cooldown), {
    eligible: [expired, never], skipped: [fresh, nearlyExpired], nextAllowedAt: '2026-02-02T12:00:00.500Z',
  });
  assert.equal(partitionByCooldown([never], now, cooldown).nextAllowedAt, '2026-02-02T12:05:00.000Z');
  assert.equal(partitionByCooldown([], now, cooldown).nextAllowedAt, null);
  assert.deepEqual(chunkArray([1, 2, 3], 2), [[1, 2], [3]]);
});

test('YouTube parser reads statistics keyed by video ID', () => {
  assert.deepEqual(parseYoutubeStatisticsResponse({ items: [
    null, { statistics: {} }, { id: 'ABC', statistics: { viewCount: '42', likeCount: '0', commentCount: 'bad' } },
  ] }), new Map([['ABC', { viewCount: 42, likeCount: 0, commentCount: null }]]));
  assert.equal(parseYoutubeStatisticsResponse(null).size, 0);
});

test('Instagram parser supports total_value and values and tolerates empty insights', () => {
  const media = { like_count: '0', comments_count: 3 };
  assert.deepEqual(parseInstagramInsightsResponse({ data: [{ name: 'views', total_value: { value: '9' } }] }, media),
    { viewCount: 9, likeCount: 0, commentCount: 3 });
  assert.equal(parseInstagramInsightsResponse({ data: [{ name: 'views', values: [{ value: 2 }] }] }, null).viewCount, 2);
  assert.deepEqual(parseInstagramInsightsResponse({ data: [] }, media),
    { viewCount: null, likeCount: 0, commentCount: 3 });
});

test('Instagram classifies provider errors', () => {
  for (const error of [{ code: 10 }, { code: 200 }, { message: 'Requires insights permission' }]) {
    assert.equal(classifyInstagramMetricsError(400, { error }), 'missing_insights_permission');
  }
  assert.equal(classifyInstagramMetricsError(400, { error: { code: 190 } }), 'auth_error');
  assert.equal(classifyInstagramMetricsError(401, null), 'auth_error');
  assert.equal(classifyInstagramMetricsError(404, null), 'video_not_found');
  assert.equal(classifyInstagramMetricsError(400, { error: { code: 100, message: 'Object does not exist' } }), 'video_not_found');
  assert.equal(classifyInstagramMetricsError(500, null), 'fetch_failed');
});

test('TikTok parser preserves large string IDs and rejects non-numeric publish IDs', () => {
  const id = '7234123456789012345';
  assert.ok(isNumericTiktokVideoId(id));
  for (const invalid of [null, undefined, '', '-2', ' 42', 'publish_id']) {
    assert.equal(isNumericTiktokVideoId(invalid), false);
  }
  assert.deepEqual(parseTiktokVideoQueryResponse({ data: { videos: [
    { id, view_count: 20, like_count: '0', comment_count: '3' }, { id: 'publish_id', view_count: 1 },
  ] } }), new Map([[id, { viewCount: 20, likeCount: 0, commentCount: 3 }]]));
});

const publishedAt = new Date('2026-02-02T12:00:00Z');
function publication(id: string, platform: string, externalId: string | null, mode = 'direct', scopes: string[] = []) {
  return {
    id, clipId: 'clip-1', platform, mode, externalId, status: 'published',
    socialAccountId: `account-${platform}`, socialAccount: { displayName: platform, scopes },
    title: '', caption: '', privacy: 'public', progress: 100, error: null, externalUrl: null,
    createdAt: publishedAt, updatedAt: publishedAt, publishedAt,
    viewCount: 11, likeCount: null, commentCount: null, metricsUpdatedAt: null, metricsError: null,
  };
}

type FixturePublication = Omit<ReturnType<typeof publication>, 'socialAccountId' | 'socialAccount'> & {
  socialAccountId: string | null;
  socialAccount: { displayName: string; scopes: string[] } | null;
  accountName?: string;
};

function fixture(rows: FixturePublication[]) {
  const records = new Map(rows.map((row) => [row.id, row]));
  const lookups: string[] = [];
  const queries: unknown[] = [];
  const prisma = {
    clip: { findFirst: async () => ({ id: 'clip-1' }) },
    publication: {
      findMany: async (query: { where: unknown }) => {
        queries.push(query.where);
        return [...records.values()];
      },
      update: async ({ where, data }: { where: { id: string }; data: object }) => {
        const row = { ...records.get(where.id)!, ...data };
        records.set(row.id, row);
        return row;
      },
    },
  };
  const social = {
    async getValidAccessToken(accountId: string) {
      lookups.push(accountId);
      return 'mock-token';
    },
  };
  type Dependencies = ConstructorParameters<typeof MetricsService>;
  return {
    records, lookups, queries,
    service: new PublicationMetricsService(
      prisma as unknown as Dependencies[0], social as unknown as Dependencies[1],
      { metricsSyncIntervalMs: 6 * 60 * 60 * 1000 } as Dependencies[2],
    ),
  };
}

test('metrics service batches YouTube, preserves missing stats, and skips refreshed rows on cooldown', async (t) => {
  const rows = Array.from({ length: 51 }, (_, i) => publication(`pub-${i}`, 'youtube', `video-${i}`));
  const { service, lookups } = fixture(rows);
  const batches: string[][] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.equal(url.host, 'www.googleapis.com');
    assert.equal(url.searchParams.get('part'), 'statistics');
    assert.deepEqual(init.headers, { Authorization: 'Bearer mock-token' });
    const ids = url.searchParams.get('id')!.split(',');
    batches.push(ids);
    return Response.json({ items: ids.filter((id) => id !== 'video-50').map((id) => ({
      id, statistics: { viewCount: '42', likeCount: '0', commentCount: '5' },
    })) });
  });
  const result = await service.refreshClipMetrics('user-1', 'clip-1');
  assert.deepEqual(batches.map((ids) => ids.length), [50, 1]);
  assert.deepEqual(lookups, ['account-youtube']);
  assert.equal(result.refreshed, 51);
  assert.equal(result.skipped, 0);
  assert.equal(result.publications[0].viewCount, 42);
  assert.equal(result.publications[0].likeCount, 0);
  assert.equal(result.publications[0].commentCount, 5);
  assert.equal(result.publications[50].viewCount, 11);
  assert.equal(result.publications[50].metricsError, 'video_not_found');
  assert.ok(result.publications[50].metricsUpdatedAt);
  const cooldown = await service.refreshClipMetrics('user-1', 'clip-1');
  assert.equal(cooldown.skipped, 51);
  assert.equal(cooldown.nextAllowedAt, result.nextAllowedAt);
  assert.equal(batches.length, 2);
});

test('clip metrics refresh returns non-published rows in order without fetching their metrics', async (t) => {
  const { service } = fixture([
    { ...publication('failed', 'youtube', 'failed-video'), status: 'failed' },
    publication('published', 'youtube', 'published-video'),
    { ...publication('uploading', 'youtube', 'uploading-video'), status: 'uploading' },
  ]);
  const requestedIds: (string | null)[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    requestedIds.push(url.searchParams.get('id'));
    return Response.json({ items: [{ id: 'published-video', statistics: { viewCount: '42' } }] });
  });

  const { publications, refreshed, skipped, nextAllowedAt } = await service.refreshClipMetrics('user-1', 'clip-1');

  assert.deepEqual(requestedIds, ['published-video']);
  assert.deepEqual(publications.map(({ id, status, viewCount }) => [id, status, viewCount]), [
    ['failed', 'failed', 11],
    ['published', 'published', 42],
    ['uploading', 'uploading', 11],
  ]);
  assert.equal(publications[0].metricsUpdatedAt, null);
  assert.equal(publications[2].metricsUpdatedAt, null);
  assert.equal(refreshed, 1);
  assert.equal(skipped, 0);
  const updatedAt = publications[1].metricsUpdatedAt;
  assert.ok(updatedAt);
  assert.equal(nextAllowedAt, new Date(Date.parse(updatedAt) + METRICS_REFRESH_COOLDOWN_MS).toISOString());
});

test('clip metrics refresh returns disconnected publications with their saved account name and counts', async (t) => {
  const { service, records, lookups, queries } = fixture([
    {
      ...publication('disconnected', 'youtube', 'video-1'),
      socialAccountId: null, socialAccount: null, accountName: 'Saved channel',
      viewCount: 42, likeCount: 3, commentCount: 1,
    },
  ]);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected fetch'); });

  const { publications, refreshed } = await service.refreshClipMetrics('user-1', 'clip-1');

  assert.deepEqual(queries, [{ clipId: 'clip-1', clip: { job: { userId: 'user-1' } } }]);
  assert.equal(refreshed, 1);
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(lookups, []);
  assert.equal(records.get('disconnected')?.metricsError, 'account_disconnected');
  assert.equal(publications.length, 1);
  const { accountId, accountName, viewCount, likeCount, commentCount, metricsError } = publications[0];
  assert.deepEqual([accountId, accountName, viewCount, likeCount, commentCount, metricsError], [
    null, 'Saved channel', 42, 3, 1, 'account_disconnected',
  ]);
});

test('metrics service preserves Instagram views when permission is missing or insights are empty', async (t) => {
  const { service } = fixture([
    publication('denied', 'instagram', 'media-denied'),
    publication('empty', 'instagram', 'media-empty'),
  ]);
  const fetch = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.deepEqual(init.headers, { Authorization: 'Bearer mock-token' });
    if (url.pathname.endsWith('/insights')) {
      assert.equal(url.searchParams.get('metric'), 'views');
      return url.pathname.includes('media-denied')
        ? Response.json({ error: { code: 10 } }, { status: 403 })
        : Response.json({ data: [] });
    }
    assert.equal(url.searchParams.get('fields'), 'like_count,comments_count');
    return Response.json({ like_count: 0, comments_count: 4 });
  });
  const { publications } = await service.refreshClipMetrics('user-1', 'clip-1');
  assert.equal(fetch.mock.callCount(), 4);
  assert.deepEqual(publications.map(({ viewCount, likeCount, commentCount, metricsError }) =>
    [viewCount, likeCount, commentCount, metricsError]), [[11, 0, 4, 'missing_insights_permission'], [11, 0, 4, null]]);
  assert.ok(publications.every((row) => row.metricsUpdatedAt));
});

test('metrics service records unusable TikTok IDs and missing scope without calling TikTok', async (t) => {
  const { service, records, lookups } = fixture([
    publication('inbox', 'tiktok', '123', 'inbox', ['video.list']),
    publication('invalid', 'tiktok', 'publish-id', 'direct', ['video.list']),
    publication('missing-scope', 'tiktok', '123', 'direct', ['video.publish']),
  ]);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected fetch'); });
  const result = await service.refreshUserMetrics('user-1', ['clip-1']);
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(lookups, []);
  assert.equal(result.refreshed, 3);
  assert.deepEqual([...records.values()].map((row) => row.metricsError), [
    'post_id_unavailable', 'post_id_unavailable', 'missing_scope',
  ]);
  assert.ok([...records.values()].every((row) => row.metricsUpdatedAt));
});
