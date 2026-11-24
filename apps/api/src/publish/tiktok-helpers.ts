/**
 * Helper murni publikasi TikTok (chunk plan, tafsir status, pemetaan galat).
 * Tanpa import Nest/Prisma agar bisa dites dengan `node --experimental-strip-types`.
 */

const MiB = 1024 * 1024;

/** Batas chunk TikTok: min 5 MiB, maks 64 MiB; chunk terakhir boleh menyerap sisa hingga 128 MiB. */
export const TIKTOK_MIN_CHUNK = 5 * MiB;
export const TIKTOK_MAX_CHUNK = 64 * MiB;
export const TIKTOK_MAX_LAST_CHUNK = 128 * MiB;
export const TIKTOK_MAX_CHUNKS = 1000;
export const TIKTOK_DEFAULT_CHUNK = 10 * MiB;
/** Polling status: batas TikTok 30/menit per token → tiap 5 detik. */
export const TIKTOK_CHECK_DELAY_MS = 5_000;
/** ~10 menit pada interval 5 detik. */
export const TIKTOK_MAX_CHECKS = 120;
export const TIKTOK_MAX_CHUNK_RETRIES = 3;

export interface TiktokChunkPlan {
  videoSize: number;
  chunkSize: number;
  totalChunkCount: number;
}

/**
 * Rencana chunk sesuai aturan TikTok: file < 5 MiB (atau ≤ chunk default) = satu
 * chunk dengan chunk_size = size; selainnya total = floor(size / chunk_size)
 * dan chunk terakhir menyerap sisa. Mengembalikan null bila tak bisa dipenuhi.
 */
export function planTiktokChunks(
  size: number,
  preferredChunk = TIKTOK_DEFAULT_CHUNK,
): TiktokChunkPlan | null {
  if (!Number.isInteger(size) || size <= 0) return null;
  if (size <= preferredChunk) {
    if (size > TIKTOK_MAX_CHUNK) return null;
    return { videoSize: size, chunkSize: size, totalChunkCount: 1 };
  }
  let chunkSize = Math.min(
    TIKTOK_MAX_CHUNK,
    Math.max(TIKTOK_MIN_CHUNK, preferredChunk),
  );
  // Terlalu banyak chunk: perbesar chunk (naik ke kelipatan MiB) hingga ≤ 1000.
  while (Math.floor(size / chunkSize) > TIKTOK_MAX_CHUNKS) {
    chunkSize = Math.ceil((size / TIKTOK_MAX_CHUNKS) / MiB) * MiB;
    if (chunkSize > TIKTOK_MAX_CHUNK) return null;
  }
  const totalChunkCount = Math.max(1, Math.floor(size / chunkSize));
  const lastChunk = size - chunkSize * (totalChunkCount - 1);
  if (lastChunk > TIKTOK_MAX_LAST_CHUNK) return null;
  return { videoSize: size, chunkSize, totalChunkCount };
}

export interface TiktokChunkRange {
  index: number;
  start: number;
  /** inklusif */
  end: number;
}

/** Rentang byte chunk ke-`index`; chunk terakhir mencakup sisa file. */
export function tiktokChunkRange(
  plan: TiktokChunkPlan,
  index: number,
): TiktokChunkRange | null {
  if (!Number.isInteger(index) || index < 0 || index >= plan.totalChunkCount) {
    return null;
  }
  const start = index * plan.chunkSize;
  const end =
    index === plan.totalChunkCount - 1
      ? plan.videoSize - 1
      : start + plan.chunkSize - 1;
  return { index, start, end };
}

export function tiktokContentRange(
  range: { start: number; end: number },
  size: number,
): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}

/** Panjang caption dalam UTF-16 code unit (aturan TikTok). */
export function tiktokCaptionLength(caption: string): number {
  return caption.length;
}

export function tiktokPostUrl(username: string, postId: string): string {
  return `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${encodeURIComponent(postId)}`;
}

export type TiktokStatusOutcome =
  | { state: 'published'; postId: string | null }
  | { state: 'failed'; reason: string }
  | { state: 'pending' };

/**
 * Tafsirkan `data` dari status/fetch. Inbox: SEND_TO_USER_INBOX atau
 * PUBLISH_COMPLETE = sukses. Direct: hanya PUBLISH_COMPLETE.
 */
export function interpretTiktokStatus(
  data: unknown,
  mode: 'direct' | 'inbox',
): TiktokStatusOutcome {
  const record =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, any>)
      : {};
  const status = typeof record.status === 'string' ? record.status : '';

  if (status === 'FAILED') {
    return {
      state: 'failed',
      reason: mapTiktokFailReason(
        typeof record.fail_reason === 'string' ? record.fail_reason : null,
      ),
    };
  }
  if (status === 'PUBLISH_COMPLETE') {
    // Nama field TikTok memang salah eja: `publicaly_available_post_id`.
    const ids = record.publicaly_available_post_id;
    const first = Array.isArray(ids) ? ids[0] : null;
    const postId =
      typeof first === 'string' || typeof first === 'number'
        ? String(first)
        : null;
    return { state: 'published', postId };
  }
  if (status === 'SEND_TO_USER_INBOX' && mode === 'inbox') {
    return { state: 'published', postId: null };
  }
  return { state: 'pending' };
}

export const TIKTOK_RECONNECT_MESSAGE = 'Reconnect your TikTok account';

/** Petakan `fail_reason` status TikTok ke pesan Inggris yang manusiawi. */
export function mapTiktokFailReason(reason: string | null): string {
  switch (reason) {
    case 'file_format_check_failed':
      return 'TikTok rejected the video format, use MP4 with H.264';
    case 'duration_check_failed':
      return 'TikTok rejected the video duration';
    case 'frame_rate_check_failed':
      return 'TikTok rejected the video frame rate (must be 23–60 FPS)';
    case 'picture_size_check_failed':
      return 'TikTok rejected the video size or resolution (360–4096 px)';
    case 'video_pull_failed':
    case 'internal':
      return 'TikTok could not process the video, retry later';
    case 'publish_cancelled':
      return 'The post was cancelled on TikTok';
    case 'auth_removed':
      return `TikTok access was removed. ${TIKTOK_RECONNECT_MESSAGE}`;
    case 'spam_risk_too_many_posts':
      return 'TikTok daily post limit reached, try again tomorrow';
    case 'spam_risk_user_banned_from_posting':
      return 'This TikTok account is banned from posting';
    case 'spam_risk_text':
    case 'spam_risk':
      return 'TikTok flagged this post as spam';
    case 'reached_active_user_cap':
      return 'TikTok app has reached its daily active user cap, try again later';
    case 'unaudited_client_can_only_post_to_private_accounts':
      return 'TikTok account must be private while the app is unaudited';
    case 'privacy_level_option_mismatch':
      return 'Privacy level is not allowed for this TikTok account';
    case 'url_ownership_unverified':
      return 'TikTok could not verify the upload source';
    default:
      return reason
        ? `TikTok publishing failed (${reason.replace(/[^a-z0-9_]/gi, '').slice(0, 60)})`
        : 'TikTok publishing failed';
  }
}

/** Petakan `error.code` TikTok (init/creator_info/upload) ke pesan manusiawi. */
export function mapTiktokApiError(code: string, httpStatus = 0): string {
  switch (code) {
    case 'access_token_invalid':
    case 'token_not_authorized_for_specified_user':
      return TIKTOK_RECONNECT_MESSAGE;
    case 'scope_not_authorized':
    case 'scope_permission_missed':
      return `Missing TikTok publishing permission. ${TIKTOK_RECONNECT_MESSAGE}`;
    case 'rate_limit_exceeded':
      return 'Too many requests to TikTok, try again in a minute';
    case 'spam_risk_too_many_posts':
      return 'TikTok daily post limit reached, try again tomorrow';
    case 'spam_risk_user_banned_from_posting':
      return 'This TikTok account is banned from posting';
    case 'spam_risk_too_many_pending_share':
      return 'Too many pending drafts in the TikTok inbox, open TikTok and clear them first';
    case 'reached_active_user_cap':
      return 'TikTok app has reached its daily active user cap, try again later';
    case 'unaudited_client_can_only_post_to_private_accounts':
      return 'TikTok account must be private while the app is unaudited';
    case 'privacy_level_option_mismatch':
      return 'Privacy level is not allowed for this TikTok account';
    case 'url_ownership_unverified':
      return 'TikTok could not verify the upload source';
    case 'invalid_file_upload':
    case 'invalid_param':
      return 'TikTok rejected the upload request';
    case 'network':
      return 'Could not reach TikTok, retry later';
    default:
      break;
  }
  if (httpStatus === 401) return TIKTOK_RECONNECT_MESSAGE;
  if (httpStatus === 429) return 'Too many requests to TikTok, try again in a minute';
  if (httpStatus >= 500) return 'TikTok is temporarily unavailable, retry later';
  return 'TikTok publishing failed';
}
