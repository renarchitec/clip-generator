/**
 * Keputusan refresh token Instagram dan tipe akun.
 * Jalankan dari apps/api: node --experimental-strip-types src/social/instagram-token.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideInstagramRefresh,
  instagramTokenAgeMs,
  isInstagramAccountTypeSupported,
} from './instagram-token.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 0, 1);

test('token baru (sisa > 7 hari) tidak di-refresh', () => {
  const decision = decideInstagramRefresh(now + 59 * DAY, now);
  assert.equal(decision.refresh, false);
  assert.equal(decision.reason, 'still_fresh');
});

test('sisa <= 7 hari dan umur >= 24 jam: refresh', () => {
  assert.equal(decideInstagramRefresh(now + 7 * DAY, now).refresh, true);
  assert.equal(decideInstagramRefresh(now + 3 * DAY, now).reason, 'expiring_soon');
  assert.equal(decideInstagramRefresh(new Date(now + DAY), now).refresh, true);
});

test('token sudah kedaluwarsa: refresh dicoba', () => {
  const decision = decideInstagramRefresh(now - 1000, now);
  assert.equal(decision.refresh, true);
  assert.equal(decision.reason, 'expired');
});

test('tanpa expiresAt: tidak ada refresh', () => {
  assert.deepEqual(decideInstagramRefresh(null, now), {
    refresh: false,
    remainingMs: null,
    reason: 'no_expiry',
  });
  assert.equal(decideInstagramRefresh(undefined, now).refresh, false);
  assert.equal(decideInstagramRefresh('bukan tanggal', now).refresh, false);
});

test('token short-lived (umur < 24 jam) tidak di-refresh', () => {
  // Token 1 jam: sisa 1 jam, umur 59 hari 23 jam -> 1 jam dari kedaluwarsa tetap
  // dihitung dari TTL 60 hari; kasus umur <24j terjadi saat expiresAt > 60 hari - 24j.
  const decision = decideInstagramRefresh(now + 60 * DAY - 3600_000, now);
  assert.equal(decision.refresh, false);
  assert.equal(instagramTokenAgeMs(now + 60 * DAY - 3600_000, now), 3600_000);
});

test('hanya akun Business dan Media_Creator yang didukung', () => {
  assert.equal(isInstagramAccountTypeSupported('BUSINESS'), true);
  assert.equal(isInstagramAccountTypeSupported('Business'), true);
  assert.equal(isInstagramAccountTypeSupported('MEDIA_CREATOR'), true);
  assert.equal(isInstagramAccountTypeSupported('Media_Creator'), true);
  assert.equal(isInstagramAccountTypeSupported('PERSONAL'), false);
  assert.equal(isInstagramAccountTypeSupported(undefined), false);
  assert.equal(isInstagramAccountTypeSupported(null), false);
});
