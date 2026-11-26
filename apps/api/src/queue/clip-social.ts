import type { PlatformCaptions } from '@clipper/shared';
import type { Prisma } from '@prisma/client';

const MAX_CAPTION_CHARS = 2200;
const MAX_HASHTAGS = 15;

function trimToLimit(value: string, limit: number): string {
  return value.trim().slice(0, limit).replace(/[\uD800-\uDFFF]/gu, '').trimEnd();
}

export interface ClipSocialMetadata {
  caption: string | null;
  hashtags: string[];
}

/**
 * Normalisasi metadata sosial dari hasil worker. Caption kosong menjadi null;
 * hashtag hanya memuat huruf/angka Unicode dan underscore, unik, maksimal 15.
 */
export function sanitizeClipSocialMetadata(input: {
  caption?: unknown;
  hashtags?: unknown;
}): ClipSocialMetadata {
  const caption =
    typeof input.caption === 'string'
      ? trimToLimit(input.caption, MAX_CAPTION_CHARS) || null
      : null;

  if (!Array.isArray(input.hashtags)) return { caption, hashtags: [] };

  const seen = new Set<string>();
  for (const raw of input.hashtags) {
    if (typeof raw !== 'string') continue;

    const hashtag = raw
      .replace(/^#/, '')
      .replace(/[^\p{L}\p{N}_]/gu, '');
    if (!hashtag || seen.has(hashtag)) continue;

    seen.add(hashtag);
    if (seen.size === MAX_HASHTAGS) break;
  }

  return { caption, hashtags: [...seen] };
}

export function sanitizePlatformCaptions(
  raw: unknown,
  overrideHashtags?: string[],
): PlatformCaptions | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const records = raw as Record<string, unknown>;
  const result: PlatformCaptions = {};
  const custom = overrideHashtags?.length
    ? sanitizeClipSocialMetadata({ hashtags: overrideHashtags }).hashtags
    : undefined;
  for (const platform of ['youtube', 'tiktok', 'instagram'] as const) {
    if (!Object.hasOwn(records, platform)) continue;
    const entry = records[platform];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const variant = entry as { title?: unknown; caption?: unknown; hashtags?: unknown };
    const title = typeof variant.title === 'string'
      ? trimToLimit(variant.title.replace(/[<>\u0000-\u001f\u007f]/g, ''), 100)
      : '';
    const { caption, hashtags } = sanitizeClipSocialMetadata({
      caption: typeof variant.caption === 'string' ? variant.caption.replace(/\u0000/g, '') : variant.caption,
      hashtags: variant.hashtags,
    });
    // Overrides replace metadata on existing variants; they don't create blank ones.
    if (!title && !caption && hashtags.length === 0) continue;
    result[platform] = {
      ...(title ? { title } : {}),
      caption: caption ?? '',
      hashtags: custom ?? hashtags,
    };
  }
  return Object.keys(result).length ? result : null;
}

export function platformCaptionsJson(captions: PlatformCaptions | null): Prisma.InputJsonObject | null {
  if (!captions) return null;
  return Object.fromEntries(Object.entries(captions).map(([platform, variant]) => [platform, { ...variant }]));
}

/** Batas cuplikan transkrip klip; sama dengan CLIP_TRANSCRIPT_MAX di packages/shared. */
export const CLIP_TRANSCRIPT_MAX = 2000;

/** Cuplikan transkrip dari hasil worker: trim, maksimal 2000 karakter, kosong -> null. */
export function sanitizeClipTranscript(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  return input.trim().slice(0, CLIP_TRANSCRIPT_MAX).trim() || null;
}

export interface RegeneratedCaption {
  caption: string;
  hashtags: string[];
  platformCaptions: PlatformCaptions | null;
}

/**
 * Validasi + sanitasi hasil worker antrean `captions` (sanitizer sama dengan
 * hasil job render). Caption kosong/rusak -> null (API membalas 503).
 */
export function parseCaptionResult(
  value: unknown,
  overrideHashtags?: string[],
): RegeneratedCaption | null {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const input = parsed as { caption?: unknown; hashtags?: unknown; platformCaptions?: unknown };
  const { caption, hashtags } = sanitizeClipSocialMetadata(input);
  if (!caption) return null;
  return {
    caption,
    hashtags: overrideHashtags?.length ? overrideHashtags : hashtags,
    platformCaptions: sanitizePlatformCaptions(input.platformCaptions, overrideHashtags),
  };
}
