/**
 * Tanda tangan URL media publik klip (untuk video_url Instagram).
 * Jalankan dari apps/api: node --experimental-strip-types src/clips/public-media.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PUBLIC_MEDIA_TTL_SECONDS,
  derivePublicMediaKey,
  publicMediaSignature,
  publicMediaUrl,
  verifyPublicMediaSignature,
} from './public-media.ts';

const secret = 'rahasia-test-kunci-sosial';
const key = derivePublicMediaKey(secret);
const now = Date.UTC(2026, 0, 1);
const exp = Math.floor(now / 1000) + 600;

test('tanda tangan valid lolos, deterministik, dan terikat ke clip + exp', () => {
  const sig = publicMediaSignature('clip-1', exp, key);
  assert.equal(sig, publicMediaSignature('clip-1', exp, key));
  assert.equal(verifyPublicMediaSignature({ clipId: 'clip-1', exp, sig, key, now }), true);
  assert.equal(verifyPublicMediaSignature({ clipId: 'clip-2', exp, sig, key, now }), false);
  assert.equal(verifyPublicMediaSignature({ clipId: 'clip-1', exp: exp + 1, sig, key, now }), false);
});

test('kedaluwarsa, tanda tangan rusak, atau kunci lain ditolak', () => {
  const sig = publicMediaSignature('clip-1', exp, key);
  assert.equal(
    verifyPublicMediaSignature({ clipId: 'clip-1', exp, sig, key, now: exp * 1000 + 1 }),
    false,
  );
  assert.equal(verifyPublicMediaSignature({ clipId: 'clip-1', exp, sig: 'abc', key, now }), false);
  assert.equal(verifyPublicMediaSignature({ clipId: 'clip-1', exp, sig: undefined, key, now }), false);
  assert.equal(verifyPublicMediaSignature({ clipId: 'clip-1', exp: 'x', sig, key, now }), false);
  assert.equal(
    verifyPublicMediaSignature({
      clipId: 'clip-1',
      exp,
      sig,
      key: derivePublicMediaKey('kunci-lain'),
      now,
    }),
    false,
  );
});

test('URL publik memuat exp 30 menit dan lolos verifikasi', () => {
  assert.equal(PUBLIC_MEDIA_TTL_SECONDS, 1800);
  const url = new URL(publicMediaUrl('https://clipper.example.com/', 'clip-1', key, now));
  assert.equal(url.protocol, 'https:');
  assert.equal(url.pathname, '/api/public/clips/clip-1/media');
  const urlExp = Number(url.searchParams.get('exp'));
  assert.equal(urlExp, Math.floor(now / 1000) + 1800);
  assert.equal(
    verifyPublicMediaSignature({
      clipId: 'clip-1',
      exp: url.searchParams.get('exp'),
      sig: url.searchParams.get('sig'),
      key,
      now,
    }),
    true,
  );
});
