/**
 * Tautan media publik bertanda tangan (HMAC) untuk klip.
 *
 * Instagram menarik video lewat `video_url` sehingga file harus bisa diunduh
 * tanpa sesi. Alih-alih membuat route terbuka permanen, URL ditandatangani dan
 * kedaluwarsa 30 menit; kunci diturunkan dari SOCIAL_TOKEN_KEY agar tidak ada
 * env baru.
 *
 * Modul ini murni (hanya node:crypto) supaya bisa dites dengan
 * `node --experimental-strip-types`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Umur tautan media publik. */
export const PUBLIC_MEDIA_TTL_SECONDS = 30 * 60;

/** Label pemisah kunci agar turunan SOCIAL_TOKEN_KEY tidak dipakai untuk hal lain. */
const PUBLIC_MEDIA_KEY_PURPOSE = 'clipper:public-media:v1';

/** Turunkan kunci HMAC khusus media publik dari SOCIAL_TOKEN_KEY. */
export function derivePublicMediaKey(socialTokenKey: string): Buffer {
  return createHmac('sha256', socialTokenKey)
    .update(PUBLIC_MEDIA_KEY_PURPOSE)
    .digest();
}

/** Tanda tangan `clipId.exp` dalam base64url. */
export function publicMediaSignature(
  clipId: string,
  exp: number,
  key: Buffer | string,
): string {
  const secret = typeof key === 'string' ? derivePublicMediaKey(key) : key;
  return createHmac('sha256', secret)
    .update(`${clipId}.${exp}`)
    .digest('base64url');
}

/** Path relatif (sudah memuat prefix global `/api`). */
export function publicMediaPath(
  clipId: string,
  exp: number,
  sig: string,
): string {
  return `/api/public/clips/${encodeURIComponent(clipId)}/media?exp=${exp}&sig=${sig}`;
}

/** URL absolut yang bisa dijangkau Instagram. */
export function publicMediaUrl(
  publicWebUrl: string,
  clipId: string,
  key: Buffer | string,
  now: number = Date.now(),
): string {
  const exp = Math.floor(now / 1000) + PUBLIC_MEDIA_TTL_SECONDS;
  const sig = publicMediaSignature(clipId, exp, key);
  return `${publicWebUrl.replace(/\/+$/, '')}${publicMediaPath(clipId, exp, sig)}`;
}

/**
 * Verifikasi tanda tangan dan masa berlaku. `exp` dalam detik epoch.
 * Perbandingan memakai timingSafeEqual supaya tidak bocor per byte.
 */
export function verifyPublicMediaSignature(input: {
  clipId: string;
  exp: string | number | null | undefined;
  sig: string | null | undefined;
  key: Buffer | string;
  now?: number;
}): boolean {
  const { clipId, sig } = input;
  if (typeof sig !== 'string' || !sig) return false;
  const exp = Number(input.exp);
  if (!Number.isInteger(exp) || exp <= 0) return false;
  const now = input.now ?? Date.now();
  if (exp * 1000 <= now) return false;

  const expected = publicMediaSignature(clipId, exp, input.key);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(sig);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
