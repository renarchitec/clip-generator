/**
 * Self-check helper Instagram Reels: caption, batas Reels, status container, galat.
 * Jalankan dari apps/api: node --experimental-strip-types src/publish/instagram-helpers.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeInstagramCaption,
  interpretInstagramContainerStatus,
  isPublicHttpsUrl,
  mapInstagramApiErrorDetail,
  sanitizeInstagramCaption,
  validateInstagramReel,
} from './instagram-helpers.ts';

test('caption dipotong ke 2200 tanpa memotong surrogate pair', () => {
  assert.equal(sanitizeInstagramCaption('x'.repeat(3000)).length, 2200);
  const emoji = '😀'.repeat(1500);
  const out = sanitizeInstagramCaption(emoji);
  assert.ok(out.length <= 2200);
  assert.equal(out.length % 2, 0);
  assert.equal(Array.from(out).every((c) => c === '😀'), true);
});

test('hashtag dibatasi 30, kelebihan dibuang', () => {
  const tags = Array.from({ length: 40 }, (_, i) => `#t${i}`).join(' ');
  const out = sanitizeInstagramCaption(`Halo ${tags}`);
  assert.equal((out.match(/#\w+/g) ?? []).length, 30);
  assert.ok(out.startsWith('Halo #t0'));
  assert.ok(!out.includes('#t30'));
});

test('compose: caption + hashtag klip, tanpa duplikat, maks 30 hashtag', () => {
  assert.equal(
    composeInstagramCaption('Halo #seru', ['seru', '#baru', 'a b!']),
    'Halo #seru\n\n#baru #ab',
  );
  assert.equal(composeInstagramCaption(null, ['x']), '#x');
  assert.equal(composeInstagramCaption('', []), '');
  const many = Array.from({ length: 50 }, (_, i) => `tag${i}`);
  const out = composeInstagramCaption('Caption', many);
  assert.equal((out.match(/#\w+/g) ?? []).length, 30);
  assert.ok(out.length <= 2200);
});

test('validasi Reels: durasi >15 menit ditolak, 3s-15m dan <=300MB lolos', () => {
  assert.equal(validateInstagramReel({ durationSec: 60, sizeBytes: 10 }), null);
  assert.equal(validateInstagramReel({ durationSec: 900, sizeBytes: 10 }), null);
  assert.match(validateInstagramReel({ durationSec: 901, sizeBytes: 10 })!, /15 minutes/);
  assert.match(validateInstagramReel({ durationSec: 2, sizeBytes: 10 })!, /3 seconds/);
  assert.match(
    validateInstagramReel({ durationSec: 30, sizeBytes: 301 * 1024 * 1024 })!,
    /300 MB/,
  );
});

test('video_url harus HTTPS publik', () => {
  assert.equal(isPublicHttpsUrl('https://clipper.rencraft.site/api/x'), true);
  assert.equal(isPublicHttpsUrl('http://clipper.rencraft.site/x'), false);
  assert.equal(isPublicHttpsUrl('https://localhost/x'), false);
  assert.equal(isPublicHttpsUrl('https://192.168.1.2/x'), false);
  assert.equal(isPublicHttpsUrl('https://10.0.0.1/x'), false);
  assert.equal(isPublicHttpsUrl('nonsense'), false);
});

test('status container: FINISHED/PUBLISHED/ERROR/EXPIRED/IN_PROGRESS', () => {
  assert.deepEqual(interpretInstagramContainerStatus({ status_code: 'FINISHED' }), { state: 'ready' });
  assert.deepEqual(interpretInstagramContainerStatus({ status_code: 'PUBLISHED' }), { state: 'published' });
  assert.deepEqual(interpretInstagramContainerStatus({ status_code: 'IN_PROGRESS' }), { state: 'pending' });
  assert.deepEqual(interpretInstagramContainerStatus({}), { state: 'pending' });
  assert.equal(interpretInstagramContainerStatus({ status_code: 'EXPIRED' }).state, 'failed');
  const error = interpretInstagramContainerStatus({
    status_code: 'ERROR',
    status: 'Error: Media upload has failed with error code 2207026',
  });
  assert.equal(error.state, 'failed');
  assert.match((error as { reason: string }).reason, /format/);
  assert.equal(interpretInstagramContainerStatus({ status_code: 'ERROR' }).state, 'failed');
});

test('pemetaan galat Instagram ke pesan yang bisa dibaca', () => {
  const limited = mapInstagramApiErrorDetail(400, { error: { code: 9, error_subcode: 2207042 } });
  assert.equal(limited.code, 'instagram_rate_limited');
  assert.match(limited.message, /daily publishing limit/);
  assert.equal(mapInstagramApiErrorDetail(400, { error: { code: 9 } }).code, 'instagram_rate_limited');

  const token = mapInstagramApiErrorDetail(400, { error: { code: 190 } });
  assert.equal(token.reconnect, true);
  assert.equal(token.message, 'Reconnect your Instagram account');
  assert.equal(mapInstagramApiErrorDetail(401, {}).reconnect, true);

  assert.equal(mapInstagramApiErrorDetail(400, { error: { code: 10 } }).code, 'instagram_missing_permission');
  assert.equal(
    mapInstagramApiErrorDetail(400, { error: { code: 100, error_subcode: 2207026 } }).code,
    'instagram_unsupported_format',
  );
  assert.equal(
    mapInstagramApiErrorDetail(400, { error: { code: 100, error_subcode: 2207052 } }).code,
    'instagram_media_fetch_failed',
  );
  const busy = mapInstagramApiErrorDetail(400, { error: { code: 4 } });
  assert.equal(busy.transient, true);
  assert.equal(mapInstagramApiErrorDetail(503, null).transient, true);
  const unknown = mapInstagramApiErrorDetail(400, { error: { code: 999 } });
  assert.equal(unknown.code, 'instagram_failed');
  assert.equal(unknown.transient, false);
});
