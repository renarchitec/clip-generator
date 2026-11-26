/**
 * Self-check helper publikasi YouTube: chunk, Content-Range, galat Google,
 * validasi target, sanitasi judul, dan tafsir status video.
 * Jalankan dari apps/api: node --experimental-strip-types src/publish/publish-helpers.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contentRange,
  interpretVideoStatus,
  latestPerAccount,
  parseScheduledAt,
  mapGoogleError,
  nextChunk,
  parseResumeOffset,
  RECONNECT_MESSAGE,
  retryDelayMs,
  sanitizeCaption,
  sanitizeTitle,
  shortsUrl,
  statusQueryRange,
  UPLOAD_CHUNK_QUANTUM,
  UPLOAD_CHUNK_SIZE,
  uploadPercent,
  validatePublishTargets,
} from './publish-helpers.ts';

const MiB = 1024 * 1024;

test('chunk 8 MiB kelipatan 256 KiB dan rentang inklusif', () => {
  assert.equal(UPLOAD_CHUNK_SIZE % UPLOAD_CHUNK_QUANTUM, 0);
  const size = 20 * MiB + 5;
  assert.deepEqual(nextChunk(0, size), { start: 0, end: 8 * MiB - 1 });
  assert.deepEqual(nextChunk(8 * MiB, size), { start: 8 * MiB, end: 16 * MiB - 1 });
  assert.deepEqual(nextChunk(16 * MiB, size), { start: 16 * MiB, end: size - 1 });
  assert.equal(nextChunk(size, size), null);
  assert.equal(nextChunk(-1, size), null);
  assert.deepEqual(nextChunk(0, 10), { start: 0, end: 9 });
});

test('header Content-Range untuk chunk dan query status', () => {
  assert.equal(contentRange({ start: 0, end: 8 * MiB - 1 }, 20 * MiB), `bytes 0-${8 * MiB - 1}/${20 * MiB}`);
  assert.equal(statusQueryRange(12345), 'bytes */12345');
});

test('parse header Range dari 308 Resume Incomplete', () => {
  assert.equal(parseResumeOffset('bytes=0-524287'), 524288);
  assert.equal(parseResumeOffset('Bytes=0-0'), 1);
  assert.equal(parseResumeOffset(null), 0);
  assert.equal(parseResumeOffset(undefined), 0);
  assert.equal(parseResumeOffset(''), 0);
  assert.equal(parseResumeOffset('bytes=100-200'), null);
  assert.equal(parseResumeOffset('garbage'), null);
});

test('backoff eksponensial dengan batas', () => {
  assert.equal(retryDelayMs(1), 1000);
  assert.equal(retryDelayMs(2), 2000);
  assert.equal(retryDelayMs(5), 16000);
  assert.equal(retryDelayMs(10), 30000);
});

test('persen unggah dibatasi 0..100', () => {
  assert.equal(uploadPercent(0, 100), 0);
  assert.equal(uploadPercent(50, 100), 50);
  assert.equal(uploadPercent(200, 100), 100);
  assert.equal(uploadPercent(5, 0), 0);
  assert.equal(shortsUrl('abc123'), 'https://youtube.com/shorts/abc123');
});

const googleError = (reason: string) => ({
  error: { code: 403, errors: [{ reason, domain: 'youtube' }] },
});

test('pemetaan galat Google ke pesan singkat', () => {
  assert.match(mapGoogleError(403, googleError('quotaExceeded')), /quota/i);
  assert.match(mapGoogleError(400, googleError('uploadLimitExceeded')), /upload limit/i);
  assert.match(mapGoogleError(401, googleError('youtubeSignupRequired')), /YouTube channel/);
  assert.equal(mapGoogleError(401, googleError('authError')), RECONNECT_MESSAGE);
  assert.equal(mapGoogleError(401, null), RECONNECT_MESSAGE);
  assert.match(mapGoogleError(403, googleError('forbidden')), /refused/);
  assert.match(mapGoogleError(403, { error: { status: 'PERMISSION_DENIED' } }), /refused/);
  assert.match(mapGoogleError(503, null), /temporarily/);
  assert.match(mapGoogleError(418, null), /HTTP 418/);
  assert.match(mapGoogleError(403, googleError('insufficientPermissions')), /Reconnect/);
});

const valid = {
  accountId: 'acc-1',
  title: 'Momen terbaik',
  caption: 'Deskripsi #shorts',
  privacy: 'unlisted',
};

test('validasi target publish', () => {
  assert.equal(validatePublishTargets([valid]), null);
  assert.equal(validatePublishTargets([{ ...valid, madeForKids: true }]), null);
  assert.equal(validatePublishTargets([{ ...valid, caption: '' }]), null);
  assert.match(validatePublishTargets([])!, /minimal/);
  assert.match(validatePublishTargets('x')!, /minimal/);
  assert.match(
    validatePublishTargets(Array.from({ length: 6 }, (_, i) => ({ ...valid, accountId: `a${i}` })))!,
    /maksimal 5/,
  );
  assert.match(validatePublishTargets([valid, valid])!, /duplikat/);
  assert.match(validatePublishTargets([{ ...valid, title: '   ' }])!, /title/);
  assert.match(validatePublishTargets([{ ...valid, title: 'a<b' }])!, /'<'/);
  assert.match(validatePublishTargets([{ ...valid, title: 'x'.repeat(101) }])!, /100/);
  assert.equal(validatePublishTargets([{ ...valid, title: 'x'.repeat(100) }]), null);
  assert.match(validatePublishTargets([{ ...valid, caption: 'x'.repeat(5001) }])!, /5000/);
  assert.match(validatePublishTargets([{ ...valid, privacy: 'friends' }])!, /privacy/);
  assert.match(validatePublishTargets([{ ...valid, madeForKids: 'yes' }])!, /madeForKids/);
  assert.match(validatePublishTargets([{ ...valid, accountId: '' }])!, /accountId/);
});

test('sanitasi judul dan caption', () => {
  assert.equal(sanitizeTitle('  Halo <b>dunia</b>\n\tbaru  '), 'Halo bdunia/b baru');
  assert.equal(Array.from(sanitizeTitle('🔥'.repeat(150))).length, 100);
  assert.equal(sanitizeTitle('<>'), '');
  assert.equal(sanitizeCaption('a<b>\r\nbaris\u0007'), 'ab\nbaris');
  assert.equal(sanitizeCaption('x'.repeat(6000)).length, 5000);
});

test('tafsir status video YouTube', () => {
  assert.deepEqual(
    interpretVideoStatus({ status: { uploadStatus: 'processed' } }),
    { state: 'published' },
  );
  assert.deepEqual(
    interpretVideoStatus({ status: { uploadStatus: 'uploaded' } }),
    { state: 'published' },
  );
  assert.deepEqual(
    interpretVideoStatus({
      status: { uploadStatus: 'uploaded' },
      processingDetails: { processingStatus: 'processing' },
    }),
    { state: 'pending' },
  );
  assert.deepEqual(
    interpretVideoStatus({
      status: { uploadStatus: 'uploaded' },
      processingDetails: { processingStatus: 'succeeded' },
    }),
    { state: 'published' },
  );
  const rejected = interpretVideoStatus({
    status: { uploadStatus: 'rejected', rejectionReason: 'duplicate' },
  });
  assert.equal(rejected.state, 'failed');
  assert.match((rejected as { reason: string }).reason, /duplicate/);
  assert.equal(interpretVideoStatus({ status: { uploadStatus: 'failed' } }).state, 'failed');
  assert.equal(interpretVideoStatus(undefined).state, 'failed');
});

test('parseScheduledAt validates ISO input and scheduling windows', () => {
  const now = new Date('2026-02-02T12:00:00Z');
  const at = (offset: number) => new Date(now.getTime() + offset).toISOString();
  for (const value of [undefined, null, '', at(-60_000), at(0), at(15_000)]) {
    assert.equal(parseScheduledAt(value, now), null);
  }
  for (const value of [at(15_001), at(90 * 86_400_000)]) {
    assert.equal(parseScheduledAt(value, now)?.toISOString(), value);
  }
  for (const value of ['not a date', '2/3/2026', '2026-02-30T00:00:00Z', at(-60_001), at(90 * 86_400_000 + 1)]) {
    assert.throws(() => parseScheduledAt(value, now), { status: 400 });
  }
});

test('ringkasan publikasi terbaru per akun', () => {
  const metricsUpdatedAt = new Date('2026-02-02T12:00:00Z');
  const scheduledAt = new Date('2026-02-03T12:00:00Z');
  const summary = latestPerAccount([
    {
      socialAccountId: 'a', platform: 'youtube', status: 'published', externalUrl: 'u2',
      mode: 'direct', viewCount: 100, likeCount: 0, commentCount: 1,
      metricsUpdatedAt, metricsError: 'fetch_failed', scheduledAt,
    },
    { socialAccountId: 'b', platform: 'tiktok', status: 'failed', externalUrl: null, mode: 'inbox' },
    { socialAccountId: 'a', platform: 'youtube', status: 'failed', externalUrl: null, viewCount: 9 },
  ]);
  assert.deepEqual(summary, [
    {
      platform: 'youtube', status: 'published', externalUrl: 'u2', mode: 'direct', scheduledAt: scheduledAt.toISOString(),
      viewCount: 100, likeCount: 0, commentCount: 1,
      metricsUpdatedAt: metricsUpdatedAt.toISOString(), metricsError: 'fetch_failed',
    },
    {
      platform: 'tiktok', status: 'failed', externalUrl: null, mode: 'inbox', scheduledAt: null,
      viewCount: null, likeCount: null, commentCount: null, metricsUpdatedAt: null, metricsError: null,
    },
  ]);
});

test('disconnected publication badges dedupe by platform and snapshotted account ID', () => {
  const disconnected = {
    socialAccountId: null, platform: 'youtube', status: 'published', externalUrl: null,
  };
  const badges = latestPerAccount([
    { ...disconnected, accountExternalId: 'channel-1', viewCount: 100 },
    { ...disconnected, accountExternalId: 'channel-1', viewCount: 25 },
    { ...disconnected, accountExternalId: 'channel-2', viewCount: 90 },
    { ...disconnected, accountExternalId: 'channel-1', platform: 'tiktok', viewCount: 80 },
    { ...disconnected, accountExternalId: null, id: 'pub-1', viewCount: 70 },
    { ...disconnected, accountExternalId: null, id: 'pub-2', viewCount: 60 },
  ]);
  assert.deepEqual(badges.map(({ viewCount }) => viewCount), [100, 90, 80, 70, 60]);
});
