/**
 * Self-check AES-256-GCM untuk token akun sosial.
 * Jalankan dari apps/api: node --experimental-strip-types src/social/token-crypto.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeSocialTokenKey,
  decryptSocialToken,
  encryptSocialToken,
} from './token-crypto.ts';

const hexKey = '11'.repeat(32);
const base64Key = Buffer.alloc(32, 7).toString('base64');

test('token terenkripsi roundtrip dengan kunci hex dan base64', () => {
  for (const key of [hexKey, base64Key]) {
    assert.equal(decodeSocialTokenKey(key).length, 32);
    const encrypted = encryptSocialToken('token rahasia 🔐', key);
    const parts = encrypted.split(':');

    assert.equal(parts.length, 4);
    assert.equal(parts[0], 'v1');
    assert.equal(Buffer.from(parts[1]!, 'base64url').length, 12);
    assert.equal(Buffer.from(parts[2]!, 'base64url').length, 16);
    assert.equal(decryptSocialToken(encrypted, key), 'token rahasia 🔐');
    assert.notEqual(encryptSocialToken('token rahasia 🔐', key), encrypted);
  }
});

test('ciphertext/tag yang diubah dan kunci lain ditolak', () => {
  const encrypted = encryptSocialToken('access-token', hexKey);
  const parts = encrypted.split(':');
  parts[3] = `${parts[3]![0] === 'A' ? 'B' : 'A'}${parts[3]!.slice(1)}`;

  assert.throws(() => decryptSocialToken(parts.join(':'), hexKey));
  assert.throws(() => decryptSocialToken(encrypted, '22'.repeat(32)));
  assert.throws(() => decryptSocialToken('v1:format:rusak', hexKey));
});

test('kunci hilang, malformed, atau bukan 32 byte ditolak', () => {
  assert.throws(() => decodeSocialTokenKey(undefined));
  assert.throws(() => decodeSocialTokenKey('bukan-base64!'));
  assert.throws(() => decodeSocialTokenKey(Buffer.alloc(31).toString('base64')));
  assert.throws(() => decodeSocialTokenKey('11'.repeat(31)));
  assert.throws(() => decodeSocialTokenKey('g'.repeat(64)));
});
