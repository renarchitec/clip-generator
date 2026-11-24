/**
 * Self-check helper TikTok: chunk plan, rentang, tafsir status, dan galat.
 * Jalankan dari apps/api: node --experimental-strip-types src/publish/tiktok-helpers.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  interpretTiktokStatus,
  mapTiktokApiError,
  mapTiktokFailReason,
  planTiktokChunks,
  tiktokCaptionLength,
  tiktokChunkRange,
  tiktokContentRange,
  tiktokPostUrl,
} from './tiktok-helpers.ts';

const MiB = 1024 * 1024;

test('file kecil menjadi satu chunk dengan chunk_size = video_size', () => {
  assert.deepEqual(planTiktokChunks(4 * MiB), {
    videoSize: 4 * MiB,
    chunkSize: 4 * MiB,
    totalChunkCount: 1,
  });
  assert.deepEqual(tiktokChunkRange(planTiktokChunks(4 * MiB)!, 0), {
    index: 0,
    start: 0,
    end: 4 * MiB - 1,
  });
});

test('rencana chunk TikTok: floor(size/chunk), sisa di chunk terakhir', () => {
  const plan = planTiktokChunks(20 * MiB + 5)!;
  assert.equal(plan.chunkSize, 10 * MiB);
  assert.equal(plan.totalChunkCount, 2);
  assert.equal(tiktokContentRange(tiktokChunkRange(plan, 0)!, plan.videoSize), `bytes 0-${10 * MiB - 1}/${20 * MiB + 5}`);
  assert.deepEqual(tiktokChunkRange(plan, 1), {
    index: 1,
    start: 10 * MiB,
    end: 20 * MiB + 4,
  });
  assert.equal(tiktokChunkRange(plan, 2), null);
  assert.equal(tiktokChunkRange(plan, -1), null);
});

test('file 10-20 MiB tetap satu chunk dengan chunk_size = video_size', () => {
  assert.deepEqual(planTiktokChunks(11967162), {
    videoSize: 11967162,
    chunkSize: 11967162,
    totalChunkCount: 1,
  });
});

test('chunk size maks 64 MiB dan total_chunk_count maks 1000', () => {
  const plan = planTiktokChunks(100 * MiB)!;
  assert.ok(plan.chunkSize >= 5 * MiB && plan.chunkSize <= 64 * MiB);
  assert.equal(plan.totalChunkCount, Math.floor((100 * MiB) / plan.chunkSize));
  const huge = planTiktokChunks(5000 * MiB)!;
  assert.ok(huge.chunkSize >= 5 * MiB && huge.chunkSize <= 64 * MiB);
  assert.ok(huge.totalChunkCount <= 1000);
  assert.equal(planTiktokChunks(0), null);
  assert.equal(planTiktokChunks(-1), null);
});

test('tafsir status direct vs inbox', () => {
  assert.deepEqual(
    interpretTiktokStatus({ status: 'PROCESSING_DOWNLOAD' }, 'direct'),
    { state: 'pending' },
  );
  assert.deepEqual(
    interpretTiktokStatus({ status: 'SEND_TO_USER_INBOX' }, 'direct'),
    { state: 'pending' },
  );
  assert.deepEqual(
    interpretTiktokStatus({ status: 'SEND_TO_USER_INBOX' }, 'inbox'),
    { state: 'published', postId: null },
  );
  assert.deepEqual(
    interpretTiktokStatus({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['123'] }, 'direct'),
    { state: 'published', postId: '123' },
  );
  assert.deepEqual(
    interpretTiktokStatus({ status: 'PUBLISH_COMPLETE' }, 'direct'),
    { state: 'published', postId: null },
  );
  assert.equal(
    (interpretTiktokStatus({ status: 'FAILED', fail_reason: 'auth_removed' }, 'direct') as any).reason,
    'TikTok access was removed. Reconnect your TikTok account',
  );
});

test('pemetaan alasan gagal dan galat API TikTok', () => {
  assert.match(mapTiktokFailReason('unaudited_client_can_only_post_to_private_accounts')!, /account must be private/);
  assert.match(mapTiktokFailReason('spam_risk_too_many_posts')!, /daily post limit/);
  assert.match(mapTiktokFailReason('duration_check_failed')!, /duration/);
  assert.match(mapTiktokApiError('rate_limit_exceeded')!, /Too many requests/);
  assert.match(mapTiktokApiError('access_token_invalid')!, /Reconnect/);
});

test('caption memakai panjang UTF-16 dan URL video memakai username', () => {
  assert.equal(tiktokCaptionLength('🔥'), 2);
  assert.equal(
    tiktokPostUrl('ren.official', '7401'),
    'https://www.tiktok.com/@ren.official/video/7401',
  );
});
