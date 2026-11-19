import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Format tersimpan: `<salt hex>:<hash hex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, KEY_BYTES);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEY_BYTES) return false;

  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEY_BYTES);
  return timingSafeEqual(actual, expected);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
