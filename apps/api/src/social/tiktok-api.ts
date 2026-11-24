/**
 * Klien tipis TikTok Open API v2 (tanpa dependensi Nest agar mudah dipakai
 * ulang oleh publish). Token hanya dikirim di header Authorization dan tidak
 * pernah dimasukkan ke pesan galat.
 */

export const TIKTOK_API_BASE = 'https://open.tiktokapis.com';

/** Kode galat TikTok yang berarti token/scope harus diperbarui lewat connect ulang. */
export const TIKTOK_RECONNECT_CODES = [
  'access_token_invalid',
  'scope_not_authorized',
  'scope_permission_missed',
  'token_not_authorized_for_specified_user',
] as const;

export class TiktokApiError extends Error {
  constructor(
    /** error.code dari TikTok, atau 'network' / 'http_<status>' / 'bad_response'. */
    readonly code: string,
    readonly httpStatus: number,
    /** true bila boleh dicoba ulang (jaringan, 5xx, rate limit). */
    readonly transient: boolean,
    readonly logId?: string,
  ) {
    super(code);
    this.name = 'TiktokApiError';
  }

  get needsReconnect(): boolean {
    return (
      this.httpStatus === 401 ||
      (TIKTOK_RECONNECT_CODES as readonly string[]).includes(this.code)
    );
  }
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

/** POST JSON ke endpoint TikTok; kembalikan `data` atau lempar TiktokApiError. */
export async function tiktokPost(
  path: string,
  accessToken: string,
  body?: unknown,
): Promise<Record<string, any>> {
  let response: Response;
  try {
    response = await fetch(`${TIKTOK_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new TiktokApiError('network', 0, true);
  }

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const json = asRecord(parsed);
  const error = asRecord(json?.error);
  const code = typeof error?.code === 'string' ? error.code : null;
  const logId = typeof error?.log_id === 'string' ? error.log_id : undefined;

  if (code && code !== 'ok') {
    throw new TiktokApiError(
      code,
      response.status,
      code === 'rate_limit_exceeded' || response.status >= 500,
      logId,
    );
  }
  if (!response.ok) {
    throw new TiktokApiError(
      `http_${response.status}`,
      response.status,
      response.status >= 500 || response.status === 429,
      logId,
    );
  }
  return asRecord(json?.data) ?? {};
}

export interface TiktokCreatorInfo {
  nickname: string;
  username: string;
  avatarUrl: string | null;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

/** Tafsirkan `data` dari creator_info/query. */
export function parseCreatorInfo(data: Record<string, any>): TiktokCreatorInfo {
  const options = Array.isArray(data.privacy_level_options)
    ? data.privacy_level_options.filter(
        (value: unknown): value is string => typeof value === 'string',
      )
    : [];
  const max = Number(data.max_video_post_duration_sec);
  return {
    nickname:
      typeof data.creator_nickname === 'string' ? data.creator_nickname : '',
    username:
      typeof data.creator_username === 'string' ? data.creator_username : '',
    avatarUrl:
      typeof data.creator_avatar_url === 'string' && data.creator_avatar_url
        ? data.creator_avatar_url
        : null,
    privacyLevelOptions: options,
    commentDisabled: data.comment_disabled === true,
    duetDisabled: data.duet_disabled === true,
    stitchDisabled: data.stitch_disabled === true,
    maxVideoPostDurationSec: Number.isFinite(max) && max > 0 ? max : 600,
  };
}

export async function fetchTiktokCreatorInfo(
  accessToken: string,
): Promise<TiktokCreatorInfo> {
  return parseCreatorInfo(
    await tiktokPost('/v2/post/publish/creator_info/query/', accessToken),
  );
}
