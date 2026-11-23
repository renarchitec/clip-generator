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
