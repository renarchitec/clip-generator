/**
 * Helper murni publikasi Instagram Reels (caption, batas Reels, tafsir status
 * container, pemetaan galat). Tanpa import Nest/Prisma agar bisa dites dengan
 * `node --experimental-strip-types`.
 */

/** Versi Graph API untuk host graph.instagram.com. */
export const INSTAGRAM_GRAPH_VERSION = 'v27.0';
export const INSTAGRAM_GRAPH_URL = `https://graph.instagram.com/${INSTAGRAM_GRAPH_VERSION}`;

/** Batas caption Instagram. */
export const INSTAGRAM_CAPTION_MAX = 2200;
export const INSTAGRAM_MAX_HASHTAGS = 30;
export const INSTAGRAM_MAX_MENTIONS = 20;

/** Spesifikasi Reels: durasi 3 detik–15 menit, file maks 300 MB. */
export const INSTAGRAM_REEL_MIN_SEC = 3;
export const INSTAGRAM_REEL_MAX_SEC = 15 * 60;
export const INSTAGRAM_REEL_MAX_BYTES = 300 * 1024 * 1024;

/** Polling status container: tiap 5 detik, ~10 menit. */
export const INSTAGRAM_CHECK_DELAY_MS = 5_000;
export const INSTAGRAM_MAX_CHECKS = 120;

export const INSTAGRAM_RECONNECT_MESSAGE = 'Reconnect your Instagram account';

const HASHTAG = /#[\p{L}\p{N}_]+/gu;
const MENTION = /@[\p{L}\p{N}_.]+/gu;

/** Buang kemunculan `pattern` setelah yang ke-`max`; rapikan spasi sisa. */
function limitMatches(text: string, pattern: RegExp, max: number): string {
  let seen = 0;
  const limited = text.replace(pattern, (match) => {
    seen += 1;
    return seen > max ? '' : match;
  });
  if (seen <= max) return text;
  return limited
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

/**
 * Caption Instagram aman: buang karakter kontrol selain newline, batasi 30
 * hashtag dan 20 @mention (kelebihan dibuang), lalu potong ke 2200 UTF-16
 * code unit tanpa memotong surrogate pair.
 */
export function sanitizeInstagramCaption(caption: string): string {
  let text = caption
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .trim();
  text = limitMatches(text, HASHTAG, INSTAGRAM_MAX_HASHTAGS);
  text = limitMatches(text, MENTION, INSTAGRAM_MAX_MENTIONS);

  let out = '';
  for (const char of text) {
    if (out.length + char.length > INSTAGRAM_CAPTION_MAX) break;
    out += char;
  }
  return out.trim();
}

/**
 * Gabungkan caption klip dan hashtag (tanpa menduplikasi hashtag yang sudah
 * ada di caption), lalu terapkan batas Instagram.
 */
export function composeInstagramCaption(
  caption: string | null | undefined,
  hashtags: readonly string[] | null | undefined,
): string {
  const base = (caption ?? '').trim();
  const present = new Set(
    (base.match(HASHTAG) ?? []).map((tag) => tag.toLowerCase()),
  );
  const extra: string[] = [];
  for (const raw of hashtags ?? []) {
    const word = raw.trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (!word) continue;
    const tag = `#${word}`;
    if (present.has(tag.toLowerCase())) continue;
    present.add(tag.toLowerCase());
    extra.push(tag);
  }
  const joined = [base, extra.join(' ')].filter(Boolean).join('\n\n');
  return sanitizeInstagramCaption(joined);
}

/** Validasi klip terhadap batas Reels; null bila lolos, selain itu pesan galat. */
export function validateInstagramReel(input: {
  durationSec: number;
  sizeBytes: number;
}): string | null {
  if (input.durationSec > INSTAGRAM_REEL_MAX_SEC) {
    return 'Instagram Reels must be 15 minutes or shorter';
  }
  if (input.durationSec < INSTAGRAM_REEL_MIN_SEC) {
    return 'Instagram Reels must be at least 3 seconds long';
  }
  if (input.sizeBytes > INSTAGRAM_REEL_MAX_BYTES) {
    return 'Clip is larger than the 300 MB Instagram Reels limit';
  }
  return null;
}

/**
 * Instagram menarik video lewat `video_url`, jadi URL harus HTTPS dan dapat
 * dijangkau publik (bukan localhost / jaringan privat).
 */
export function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return false;
  }
  if (host === '::1' || host === '[::1]') return false;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}

export type InstagramContainerOutcome =
  | { state: 'ready' }
  | { state: 'published' }
  | { state: 'failed'; reason: string }
  | { state: 'pending' };

/**
 * Tafsirkan `GET /<container>?fields=status_code,status`. Pada ERROR, field
 * `status` memuat subcode galat (mis. "Error: ... 2207026"), dipetakan ke pesan.
 */
export function interpretInstagramContainerStatus(
  data: unknown,
): InstagramContainerOutcome {
  const record = asRecord(data) ?? {};
  const code = typeof record.status_code === 'string' ? record.status_code : '';
  switch (code) {
    case 'FINISHED':
      return { state: 'ready' };
    case 'PUBLISHED':
      return { state: 'published' };
    case 'EXPIRED':
      return {
        state: 'failed',
        reason: 'The Instagram upload expired, retry the upload',
      };
    case 'ERROR': {
      const status = typeof record.status === 'string' ? record.status : '';
      const subcode = /\b(22\d{5})\b/.exec(status)?.[1];
      return {
        state: 'failed',
        reason: subcode
          ? mapInstagramApiError(400, { error: { code: 100, error_subcode: Number(subcode) } }).message
          : 'Instagram could not process the video, check it is MP4 with H.264/AAC',
      };
    }
    default:
      return { state: 'pending' };
  }
}

export interface MappedInstagramError {
  /** Kode mesin stabil, mis. `instagram_rate_limited`. */
  code: string;
  /** Pesan Inggris yang aman ditampilkan ke pengguna. */
  message: string;
  /** true bila layak dicoba lagi (galat sementara / belum siap). */
  transient: boolean;
  /** true bila pengguna perlu menyambungkan ulang akun. */
  reconnect: boolean;
}

export interface ParsedInstagramError {
  code: number | null;
  subcode: number | null;
  message: string | null;
  userMessage: string | null;
  isTransient: boolean;
}

export function parseInstagramError(body: unknown): ParsedInstagramError {
  const error = asRecord(asRecord(body)?.error);
  const code = Number(error?.code);
  const subcode = Number(error?.error_subcode);
  return {
    code: Number.isFinite(code) ? code : null,
    subcode: Number.isFinite(subcode) ? subcode : null,
    message: typeof error?.message === 'string' ? error.message : null,
    userMessage: typeof error?.error_user_msg === 'string' ? error.error_user_msg : null,
    isTransient: error?.is_transient === true,
  };
}

function mapped(
  code: string,
  message: string,
  transient = false,
  reconnect = false,
): MappedInstagramError {
  return { code, message, transient, reconnect };
}

/**
 * Petakan galat Graph API (code + error_subcode) ke pesan manusiawi.
 * Daftar subcode: dokumentasi "Instagram Platform error codes".
 */
export function mapInstagramApiErrorDetail(
  httpStatus: number,
  body: unknown,
): MappedInstagramError {
  const { code, subcode, isTransient } = parseInstagramError(body);

  switch (subcode) {
    case 2207042:
      return mapped(
        'instagram_rate_limited',
        'Instagram daily publishing limit reached, try again tomorrow',
      );
    case 2207051:
      return mapped(
        'instagram_spam_restricted',
        'Instagram restricted this post as suspected spam, review the account in the Instagram app',
      );
    case 2207050:
      return mapped(
        'instagram_account_restricted',
        'This Instagram account is restricted, open the Instagram app to resolve it',
      );
    case 2207026:
      return mapped(
        'instagram_unsupported_format',
        'Instagram rejected the video format, use MP4 with H.264 and AAC',
      );
    case 2207052:
      return mapped(
        'instagram_media_fetch_failed',
        'Instagram could not download the clip, check that the server is publicly reachable over HTTPS',
      );
    case 2207003:
      return mapped(
        'instagram_download_timeout',
        'Instagram timed out downloading the clip, retry later',
        true,
      );
    case 2207020:
    case 2207008:
      return mapped(
        'instagram_container_expired',
        'The Instagram upload expired, retry the upload',
      );
    case 2207006:
      return mapped(
        'instagram_container_missing',
        'Instagram could not find the upload, retry the upload',
      );
    case 2207027:
      return mapped(
        'instagram_not_ready',
        'Instagram is still processing the video',
        true,
      );
    case 2207010:
      return mapped(
        'instagram_caption_too_long',
        'Instagram rejected the caption length (max 2200 characters)',
      );
    case 2207040:
      return mapped(
        'instagram_too_many_tags',
        'Instagram rejected the caption: too many @mentions',
      );
    case 2207001:
    case 2207032:
    case 2207053:
      return mapped(
        'instagram_server_error',
        'Instagram had a temporary problem, retry later',
        true,
      );
    default:
      break;
  }

  switch (code) {
    case 190:
    case 102:
    case 459:
    case 460:
    case 463:
    case 467:
      return mapped(
        'instagram_reconnect',
        INSTAGRAM_RECONNECT_MESSAGE,
        false,
        true,
      );
    case 10:
    case 200:
      return mapped(
        'instagram_missing_permission',
        `Missing Instagram publishing permission. ${INSTAGRAM_RECONNECT_MESSAGE}`,
        false,
        true,
      );
    case 9:
      return mapped(
        'instagram_rate_limited',
        'Instagram daily publishing limit reached, try again tomorrow',
      );
    case 4:
    case 17:
    case 32:
    case 613:
    case 80002:
      return mapped(
        'instagram_app_rate_limited',
        'Too many requests to Instagram, try again later',
        true,
      );
    case 9004:
      return mapped(
        'instagram_media_fetch_failed',
        'Instagram could not download the clip, check that the server is publicly reachable over HTTPS',
      );
    case 352:
      return mapped(
        'instagram_unsupported_format',
        'Instagram rejected the video format, use MP4 with H.264 and AAC',
      );
    case 1:
    case 2:
    case -1:
    case -2:
      return mapped(
        'instagram_server_error',
        'Instagram had a temporary problem, retry later',
        true,
      );
    default:
      break;
  }

  if (httpStatus === 401) {
    return mapped('instagram_reconnect', INSTAGRAM_RECONNECT_MESSAGE, false, true);
  }
  if (httpStatus === 429) {
    return mapped(
      'instagram_app_rate_limited',
      'Too many requests to Instagram, try again later',
      true,
    );
  }
  if (httpStatus >= 500 || isTransient) {
    return mapped(
      'instagram_unavailable',
      'Instagram is temporarily unavailable, retry later',
      true,
    );
  }
  const suffix = code !== null ? ` (code ${code}${subcode ? `/${subcode}` : ''})` : ` (HTTP ${httpStatus})`;
  return mapped('instagram_failed', `Instagram publishing failed${suffix}`);
}

/** Pesan galat saja (kompatibel dengan pola mapTiktokApiError). */
export function mapInstagramApiError(
  httpStatus: number,
  body: unknown,
): { message: string } & MappedInstagramError {
  const detail = mapInstagramApiErrorDetail(httpStatus, body);
  return { ...detail };
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}
