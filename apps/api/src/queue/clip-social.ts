const MAX_CAPTION_CHARS = 2200;
const MAX_HASHTAGS = 15;

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
      ? input.caption.trim().slice(0, MAX_CAPTION_CHARS) || null
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
}

/**
 * Validasi + sanitasi hasil worker antrean `captions` (sanitizer sama dengan
 * hasil job render). Caption kosong/rusak -> null (API membalas 503).
 */
export function parseCaptionResult(value: unknown): RegeneratedCaption | null {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const { caption, hashtags } = sanitizeClipSocialMetadata(
    parsed as { caption?: unknown; hashtags?: unknown },
  );
  if (!caption) return null;
  return { caption, hashtags };
}
