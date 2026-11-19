/**
 * Self-check hashing password scrypt.
 * Jalankan dari apps/api: node --experimental-strip-types src/auth/crypto.spec.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './crypto.ts';

test('hash dan verifikasi password scrypt', async () => {
  const stored = await hashPassword('rahasia123');
  assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('rahasia123', stored), true);
  assert.equal(await verifyPassword('salah', stored), false);
  assert.notEqual(await hashPassword('rahasia123'), stored); // salt acak
  assert.equal(await verifyPassword('x', 'rusak'), false);
});
