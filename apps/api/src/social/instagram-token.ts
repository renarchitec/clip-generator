/**
 * Helper murni token Instagram (tanpa import Nest/Prisma) agar bisa dites
 * dengan `node --experimental-strip-types`.
 *
 * Instagram tidak punya refresh token: access token long-lived (60 hari)
 * di-refresh dengan dirinya sendiri lewat `grant_type=ig_refresh_token`.
 * Syarat dari dokumentasi: token minimal berumur 24 jam dan masih valid,
 * hasil refresh berlaku 60 hari lagi.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Refresh bila sisa umur token <= 7 hari. */
export const INSTAGRAM_REFRESH_WINDOW_MS = 7 * DAY_MS;
/** Refresh hanya boleh dilakukan setelah token berumur >= 24 jam. */
export const INSTAGRAM_REFRESH_MIN_AGE_MS = DAY_MS;
/** Umur access token long-lived Instagram. */
export const INSTAGRAM_LONG_LIVED_TTL_MS = 60 * DAY_MS;

/** Umur token menurut `expiresAt`; null bila `expiresAt` tidak diketahui. */
export function instagramTokenAgeMs(
  expiresAt: Date | number | string | null | undefined,
  now: number = Date.now(),
): number | null {
  const expires = toMs(expiresAt);
  if (expires === null) return null;
  return INSTAGRAM_LONG_LIVED_TTL_MS - (expires - now);
}

export interface InstagramRefreshDecision {
  refresh: boolean;
  /** Sisa umur token (ms); null bila `expiresAt` tidak diketahui. */
  remainingMs: number | null;
  reason:
    | 'no_expiry'
    | 'still_fresh'
    | 'too_young'
    | 'expiring_soon'
    | 'expired';
}

/**
 * Putuskan perlu-tidaknya refresh access token Instagram.
 *
 * - `expiresAt` kosong: tidak refresh (tidak ada dasar keputusan).
 * - Sudah kedaluwarsa: refresh (harus sebelum dipakai).
 * - Sisa <= 7 hari: refresh, asalkan token sudah berumur >= 24 jam.
 * - Selain itu: pakai token apa adanya.
 */
export function decideInstagramRefresh(
  expiresAt: Date | number | string | null | undefined,
  now: number = Date.now(),
): InstagramRefreshDecision {
  const expires = toMs(expiresAt);
  if (expires === null) {
    return { refresh: false, remainingMs: null, reason: 'no_expiry' };
  }

  const remainingMs = expires - now;
  if (remainingMs > INSTAGRAM_REFRESH_WINDOW_MS) {
    return { refresh: false, remainingMs, reason: 'still_fresh' };
  }

  const ageMs = INSTAGRAM_LONG_LIVED_TTL_MS - remainingMs;
  if (ageMs < INSTAGRAM_REFRESH_MIN_AGE_MS) {
    return { refresh: false, remainingMs, reason: 'too_young' };
  }

  return {
    refresh: true,
    remainingMs,
    reason: remainingMs <= 0 ? 'expired' : 'expiring_soon',
  };
}

/** Akun harus Business atau Creator; Personal tidak bisa memakai Content Publishing API. */
export function isInstagramAccountTypeSupported(
  accountType: string | null | undefined,
): boolean {
  if (typeof accountType !== 'string') return false;
  const normalized = accountType.trim().toLowerCase();
  return normalized === 'business' || normalized === 'media_creator';
}

function toMs(value: Date | number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
