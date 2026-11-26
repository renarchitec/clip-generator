/**
 * Helper murni untuk publikasi YouTube. Tanpa import Nest/Prisma agar bisa
 * dites langsung dengan `node --experimental-strip-types`.
 */

/** Ukuran chunk unggah: 8 MiB (kelipatan 256 KiB sesuai syarat resumable upload). */
export const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
export const UPLOAD_CHUNK_QUANTUM = 256 * 1024;
/** Percobaan ulang maksimum per chunk saat 5xx / galat jaringan. */
export const MAX_CHUNK_RETRIES = 5;
/** Interval cek status pemrosesan YouTube. */
export const PROCESSING_CHECK_DELAY_MS = 15_000;
/** ~20 menit pada interval 15 detik. */
export const MAX_PROCESSING_CHECKS = 80;
/** Publikasi `uploading` tanpa job aktif yang lebih tua dari ini dianggap terputus. */
export const STALE_UPLOAD_MS = 3_600_000;

export const TITLE_MAX = 100;
export const CAPTION_MAX = 5000;
export const TARGETS_MAX = 5;
export const PRIVACIES = ['public', 'unlisted', 'private'] as const;
/** Batas caption TikTok dalam UTF-16 code unit (String.length). */
export const TIKTOK_CAPTION_MAX = 2200;
export const INSTAGRAM_TARGET_CAPTION_MAX = 2200;
export const PUBLISH_MODES = ['direct', 'inbox'] as const;
export const TIKTOK_PRIVACY_LEVEL_MAX = 64;
export const ACTIVE_PUBLICATION_STATUSES = [
  'queued',
  'uploading',
  'processing',
] as const;

export interface ByteChunk {
  start: number;
  /** inklusif */
  end: number;
}

/** Rentang chunk berikutnya mulai `offset`; null bila sudah selesai. */
export function nextChunk(
  offset: number,
  size: number,
  chunkSize = UPLOAD_CHUNK_SIZE,
): ByteChunk | null {
  if (!Number.isFinite(offset) || offset < 0 || offset >= size) return null;
  return { start: offset, end: Math.min(offset + chunkSize, size) - 1 };
}

/** Header Content-Range untuk PUT chunk. */
export function contentRange(chunk: ByteChunk, size: number): string {
  return `bytes ${chunk.start}-${chunk.end}/${size}`;
}

/** Header Content-Range untuk menanyakan status sesi unggah. */
export function statusQueryRange(size: number): string {
  return `bytes */${size}`;
}

/**
 * Header `Range` pada respons 308 (mis. `bytes=0-524287`) → offset byte
 * berikutnya. Tanpa header = belum ada byte yang diterima (0). Format tak
 * dikenal → null.
 */
export function parseResumeOffset(range: string | null | undefined): number | null {
  if (range === null || range === undefined || range.trim() === '') return 0;
  const match = /^bytes=0-(\d+)$/i.exec(range.trim());
  if (!match) return null;
  return Number(match[1]) + 1;
}

/** Backoff eksponensial dengan batas 30 detik (attempt mulai 1). */
export function retryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 30_000);
}

export function uploadPercent(sent: number, size: number): number {
  if (size <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((sent / size) * 100)));
}

export function shortsUrl(videoId: string): string {
  return `https://youtube.com/shorts/${videoId}`;
}

/** Judul aman untuk YouTube: buang '<' '>' dan karakter kontrol, rapikan spasi, maks 100. */
export function sanitizeTitle(title: string): string {
  return Array.from(
    title
      .replace(/[<>]/g, '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .slice(0, TITLE_MAX)
    .join('')
    .trim();
}

/** Deskripsi aman: buang '<' '>' (ditolak YouTube) dan karakter kontrol selain newline. */
export function sanitizeCaption(caption: string): string {
  return Array.from(
    caption
      .replace(/[<>]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
      .trim(),
  )
    .slice(0, CAPTION_MAX)
    .join('');
}

/**
 * Deskripsi TikTok aman: buang karakter kontrol selain newline dan batasi ke
 * 2200 UTF-16 code unit tanpa memotong surrogate pair. '<' '>' dibiarkan.
 */
export function sanitizeTiktokCaption(caption: string): string {
  const cleaned = caption
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .trim();
  let out = '';
  for (const char of cleaned) {
    if (out.length + char.length > TIKTOK_CAPTION_MAX) break;
    out += char;
  }
  return out.trim();
}

export interface PublishTargetInput {
  accountId?: unknown;
  title?: unknown;
  caption?: unknown;
  privacy?: unknown;
  madeForKids?: unknown;
  mode?: unknown;
  tiktok?: unknown;
}

/** Mode efektif target TikTok (default 'direct'). */
export function tiktokMode(raw: { mode?: unknown }): 'direct' | 'inbox' {
  return raw.mode === 'inbox' ? 'inbox' : 'direct';
}

/** Validasi target TikTok; null bila valid. Opsi TikTok diabaikan pada mode inbox. */
export function validateTiktokTarget(raw: PublishTargetInput): string | null {
  if (raw.title !== undefined && typeof raw.title !== 'string') {
    return 'title harus berupa teks.';
  }
  if (
    typeof raw.title === 'string' &&
    Array.from(raw.title).length > TIKTOK_CAPTION_MAX
  ) {
    return `title maksimal ${TIKTOK_CAPTION_MAX} karakter.`;
  }
  if (typeof raw.caption !== 'string') return 'caption wajib berupa teks.';
  if (raw.caption.length > TIKTOK_CAPTION_MAX) {
    return `caption TikTok maksimal ${TIKTOK_CAPTION_MAX} karakter.`;
  }
  if (
    raw.mode !== undefined &&
    !PUBLISH_MODES.includes(raw.mode as (typeof PUBLISH_MODES)[number])
  ) {
    return 'mode harus direct atau inbox.';
  }
  if (tiktokMode(raw) === 'inbox') return null;

  const options = asRecord(raw.tiktok);
  if (!options) return 'tiktok wajib diisi untuk mode direct.';
  const level = options.privacyLevel;
  if (
    typeof level !== 'string' ||
    !/^[A-Z_]{1,64}$/.test(level) ||
    level.length > TIKTOK_PRIVACY_LEVEL_MAX
  ) {
    return 'tiktok.privacyLevel wajib diisi.';
  }
  for (const key of [
    'disableComment',
    'disableDuet',
    'disableStitch',
    'brandContent',
    'brandOrganic',
  ]) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      return `tiktok.${key} harus boolean.`;
    }
  }
  if (options.brandContent === true && level === 'SELF_ONLY') {
    return 'Konten bermerek (brandContent) tidak boleh berprivasi SELF_ONLY.';
  }
  return null;
}

/** Validasi target Instagram Reels; title dan privacy diabaikan. */
export function validateInstagramTarget(raw: PublishTargetInput): string | null {
  if (raw.title !== undefined && typeof raw.title !== 'string') {
    return 'title harus berupa teks.';
  }
  if (typeof raw.caption !== 'string') return 'caption wajib berupa teks.';
  if (raw.caption.length > INSTAGRAM_TARGET_CAPTION_MAX) {
    return `caption Instagram maksimal ${INSTAGRAM_TARGET_CAPTION_MAX} karakter.`;
  }
  return null;
}

/** Validasi struktural sebelum platform akun diketahui (dipakai publish service). */
export function validatePublishTargetsShape(targets: unknown): string | null {
  if (!Array.isArray(targets) || targets.length < 1) {
    return 'targets wajib berisi minimal 1 akun.';
  }
  if (targets.length > TARGETS_MAX) {
    return `targets maksimal ${TARGETS_MAX} akun.`;
  }
  const seen = new Set<string>();
  for (const raw of targets as PublishTargetInput[]) {
    if (!raw || typeof raw !== 'object') return 'target tidak valid.';
    if (typeof raw.accountId !== 'string' || !raw.accountId) {
      return 'accountId wajib diisi.';
    }
    if (seen.has(raw.accountId)) return 'accountId tidak boleh duplikat.';
    seen.add(raw.accountId);
  }
  return null;
}

/**
 * Validasi body publish di luar class-validator (dipakai service sebagai
 * pertahanan kedua). Mengembalikan pesan galat atau null bila valid.
 */
export function validatePublishTargets(
  targets: unknown,
  /** Platform akun per accountId; default 'youtube' bila tidak diketahui. */
  platformOf?: (accountId: string) => string | undefined,
): string | null {
  if (!Array.isArray(targets) || targets.length < 1) {
    return 'targets wajib berisi minimal 1 akun.';
  }
  if (targets.length > TARGETS_MAX) {
    return `targets maksimal ${TARGETS_MAX} akun.`;
  }
  const seen = new Set<string>();
  for (const raw of targets as PublishTargetInput[]) {
    if (!raw || typeof raw !== 'object') return 'target tidak valid.';
    if (typeof raw.accountId !== 'string' || !raw.accountId) {
      return 'accountId wajib diisi.';
    }
    if (seen.has(raw.accountId)) return 'accountId tidak boleh duplikat.';
    seen.add(raw.accountId);
    if (platformOf?.(raw.accountId) === 'tiktok') {
      const invalid = validateTiktokTarget(raw);
      if (invalid) return invalid;
      continue;
    }
    if (platformOf?.(raw.accountId) === 'instagram') {
      const invalid = validateInstagramTarget(raw);
      if (invalid) return invalid;
      continue;
    }
    if (typeof raw.title !== 'string') return 'title wajib diisi.';
    if (/[<>]/.test(raw.title)) return "title tidak boleh memuat '<' atau '>'.";
    const title = raw.title.trim();
    if (title.length < 1) return 'title wajib diisi.';
    if (Array.from(title).length > TITLE_MAX) {
      return `title maksimal ${TITLE_MAX} karakter.`;
    }
    if (typeof raw.caption !== 'string') return 'caption wajib berupa teks.';
    if (Array.from(raw.caption).length > CAPTION_MAX) {
      return `caption maksimal ${CAPTION_MAX} karakter.`;
    }
    if (!PRIVACIES.includes(raw.privacy as (typeof PRIVACIES)[number])) {
      return 'privacy harus public, unlisted, atau private.';
    }
    if (raw.madeForKids !== undefined && typeof raw.madeForKids !== 'boolean') {
      return 'madeForKids harus boolean.';
    }
  }
  return null;
}

/** Galat unggah yang pesannya aman ditampilkan ke pengguna. */
export class PublishError extends Error {
  /** true bila boleh dicoba ulang otomatis (5xx / jaringan). */
  readonly transient: boolean;

  constructor(message: string, transient = false) {
    super(message);
    this.name = 'PublishError';
    this.transient = transient;
  }
}

export const RECONNECT_MESSAGE = 'Reconnect your account';

/** Ambil `reason` pertama dari body galat Google API. */
export function googleErrorReason(body: unknown): string | null {
  const error = asRecord(asRecord(body)?.error);
  const errors = error?.errors;
  if (Array.isArray(errors)) {
    const reason = asRecord(errors[0])?.reason;
    if (typeof reason === 'string' && reason) return reason;
  }
  const status = error?.status;
  return typeof status === 'string' && status ? status : null;
}

/** Petakan respons galat Google ke pesan singkat yang manusiawi. */
export function mapGoogleError(status: number, body: unknown): string {
  const reason = googleErrorReason(body);
  switch (reason) {
    case 'quotaExceeded':
    case 'dailyLimitExceeded':
    case 'RESOURCE_EXHAUSTED':
      return 'YouTube daily upload quota exceeded, try again tomorrow';
    case 'uploadLimitExceeded':
      return 'Channel upload limit reached, try again later';
    case 'rateLimitExceeded':
    case 'userRateLimitExceeded':
      return 'Too many requests to YouTube, try again later';
    case 'youtubeSignupRequired':
      return 'Create a YouTube channel for this account first';
    case 'authError':
    case 'invalidCredentials':
    case 'UNAUTHENTICATED':
      return RECONNECT_MESSAGE;
    case 'insufficientPermissions':
    case 'ACCESS_TOKEN_SCOPE_INSUFFICIENT':
      return `Missing YouTube upload permission. ${RECONNECT_MESSAGE}`;
    case 'forbidden':
    case 'PERMISSION_DENIED':
      return 'YouTube refused the upload for this account';
    case 'invalidTitle':
      return 'Title rejected by YouTube';
    case 'invalidDescription':
      return 'Description rejected by YouTube';
    case 'invalidCategoryId':
      return 'Category rejected by YouTube';
    default:
      break;
  }
  if (status === 401) return RECONNECT_MESSAGE;
  if (status === 403) return 'YouTube refused the upload for this account';
  if (status === 404) return 'Upload session expired, retry the upload';
  if (status === 429) return 'Too many requests to YouTube, try again later';
  if (status >= 500) return 'YouTube is temporarily unavailable, retry later';
  return `YouTube upload failed (HTTP ${status})`;
}

export type VideoStatusOutcome =
  | { state: 'published' }
  | { state: 'failed'; reason: string }
  | { state: 'pending' };

/**
 * Tafsirkan item `videos.list?part=status,processingDetails`.
 * Bila processingDetails tak tersedia, uploadStatus uploaded/processed = published.
 */
export function interpretVideoStatus(item: unknown): VideoStatusOutcome {
  const video = asRecord(item);
  if (!video) return { state: 'failed', reason: 'Video not found on YouTube' };
  const status = asRecord(video.status);
  const uploadStatus = typeof status?.uploadStatus === 'string' ? status.uploadStatus : null;
  const details = asRecord(video.processingDetails);
  const processingStatus =
    typeof details?.processingStatus === 'string' ? details.processingStatus : null;

  if (uploadStatus === 'failed') {
    return {
      state: 'failed',
      reason: `YouTube processing failed${suffix(status?.failureReason)}`,
    };
  }
  if (uploadStatus === 'rejected') {
    return {
      state: 'failed',
      reason: `Rejected by YouTube${suffix(status?.rejectionReason)}`,
    };
  }
  if (uploadStatus === 'deleted') {
    return { state: 'failed', reason: 'Video was deleted on YouTube' };
  }
  if (processingStatus === 'failed' || processingStatus === 'terminated') {
    return {
      state: 'failed',
      reason: `YouTube processing failed${suffix(details?.processingFailureReason)}`,
    };
  }
  if (uploadStatus === 'processed' || processingStatus === 'succeeded') {
    return { state: 'published' };
  }
  if (uploadStatus === 'uploaded') {
    return processingStatus === 'processing' ? { state: 'pending' } : { state: 'published' };
  }
  return { state: 'pending' };
}

type PublicationBadgeRow = {
  id?: string;
  socialAccountId: string | null;
  accountExternalId?: string | null;
  platform: string;
  status: string;
  externalUrl: string | null;
  mode?: string;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  metricsUpdatedAt?: Date | null;
  metricsError?: string | null;
};

type PublicationBadge<T extends PublicationBadgeRow> = {
  platform: T['platform'];
  status: T['status'];
  externalUrl: string | null;
  mode?: 'direct' | 'inbox';
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  metricsUpdatedAt: string | null;
  metricsError: string | null;
};

/** Pilih publikasi terbaru per akun (input harus urut terbaru dulu). */
export function latestPerAccount<T extends PublicationBadgeRow>(publications: T[]): PublicationBadge<T>[] {
  const seen = new Set<string>();
  const result: PublicationBadge<T>[] = [];
  for (const [index, publication] of publications.entries()) {
    const key = publication.socialAccountId ?? (publication.accountExternalId
      ? `${publication.platform}:${publication.accountExternalId}`
      : `disconnected:${publication.id ?? publication.platform}:${publication.externalUrl ?? index}`);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      platform: publication.platform,
      status: publication.status,
      externalUrl: publication.externalUrl,
      ...(publication.mode === 'direct' || publication.mode === 'inbox' ? { mode: publication.mode } : {}),
      viewCount: publication.viewCount ?? null,
      likeCount: publication.likeCount ?? null,
      commentCount: publication.commentCount ?? null,
      metricsUpdatedAt: publication.metricsUpdatedAt?.toISOString() ?? null,
      metricsError: publication.metricsError ?? null,
    });
  }
  return result;
}

function suffix(value: unknown): string {
  return typeof value === 'string' && value ? `: ${value}` : '';
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}
