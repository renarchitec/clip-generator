/**
 * Instagram API with Unified Login (Facebook Login for Business).
 *
 * Modul murni tanpa import Nest/Prisma agar bisa dites dengan
 * `node --experimental-strip-types`. `InstagramProvider` mendelegasikan
 * pertukaran code dan pengambilan profil Unified Login ke sini.
 */

export interface UnifiedLoginTokens {
  accessToken: string;
  expiresIn?: number;
  scopes: string[];
}

export interface UnifiedLoginAccount {
  externalId: string;
  displayName: string;
  avatarUrl?: string;
}

/**
 * Unified Login aktif bila `config_id` di-set, atau bila token yang dipegang
 * adalah SUAT/Facebook Graph (diawali `EAA`). Token Instagram Login lama
 * diawali `IG`, jadi tetap memakai jalur legacy.
 */
export function isInstagramUnifiedLogin(input: {
  configId?: string;
  accessToken?: string;
}): boolean {
  return (
    Boolean(input.configId) ||
    Boolean(input.accessToken && input.accessToken.startsWith('EAA'))
  );
}

/**
 * Tukar authorization code Unified Login lewat `graph.facebook.com`.
 *
 * Meta mendokumentasikan panggilan tanpa `redirect_uri`, sedangkan OAuth
 * Facebook standar mewajibkannya. Coba dengan `redirect_uri` lebih dulu, lalu
 * ulangi sekali tanpa `redirect_uri` bila respons tidak OK.
 *
 * Unified Login menerbitkan Business Integration System User Access Token
 * (SUAT) yang biasanya tidak kedaluwarsa, jadi `expiresIn` dibiarkan undefined
 * kecuali server benar-benar mengirim nilai positif.
 */
export async function exchangeInstagramUnifiedCode(input: {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  scopes: readonly string[];
}): Promise<UnifiedLoginTokens> {
  const cleanCode = input.code.trim().replace(/#_?$/, '');

  const tokenUrl = new URL(`${input.baseUrl}/oauth/access_token`);
  tokenUrl.searchParams.set('client_id', input.clientId);
  tokenUrl.searchParams.set('client_secret', input.clientSecret);
  tokenUrl.searchParams.set('redirect_uri', input.redirectUri);
  tokenUrl.searchParams.set('code', cleanCode);

  let response = await request(tokenUrl);
  if (!response.ok) {
    const retryUrl = new URL(`${input.baseUrl}/oauth/access_token`);
    retryUrl.searchParams.set('client_id', input.clientId);
    retryUrl.searchParams.set('client_secret', input.clientSecret);
    retryUrl.searchParams.set('code', cleanCode);
    response = await request(retryUrl);
  }
  if (!response.ok) throw new Error('token_exchange');

  const body = asRecord(await responseJson(response));
  if (typeof body?.access_token !== 'string' || !body.access_token) {
    throw new Error('token_exchange');
  }

  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    expiresIn:
      Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : undefined,
    scopes: [...input.scopes],
  };
}

/**
 * Profil Instagram untuk Unified Login: akun Instagram ditautkan ke Business
 * Integration lewat edge `/me/assigned_instagram_accounts`. Bila `username`
 * atau foto profil tidak ikut, lengkapi lewat `GET /<id>` (best-effort).
 */
export async function fetchInstagramUnifiedAccount(input: {
  baseUrl: string;
  accessToken: string;
}): Promise<UnifiedLoginAccount> {
  const auth = { Authorization: `Bearer ${input.accessToken}` };

  let response = await request(
    new URL(
      `${input.baseUrl}/me/assigned_instagram_accounts?fields=${encodeURIComponent(
        'id,username,name,profile_picture_url',
      )}`,
    ),
    auth,
  );
  if (!response.ok) {
    response = await request(
      new URL(
        `${input.baseUrl}/me/assigned_instagram_accounts?fields=${encodeURIComponent(
          'id,username',
        )}`,
      ),
      auth,
    );
  }
  if (!response.ok) throw new Error('profile_fetch');

  const body = asRecord(await responseJson(response));
  const first = asRecord(Array.isArray(body?.data) ? body.data[0] : null);
  const externalId =
    typeof first?.id === 'string' && first.id ? first.id : null;
  if (!externalId) throw new Error('profile_fetch');

  let username = typeof first?.username === 'string' ? first.username : '';
  let name = typeof first?.name === 'string' ? first.name : '';
  let picture =
    typeof first?.profile_picture_url === 'string'
      ? first.profile_picture_url
      : '';

  if (!username || !picture) {
    try {
      const enrich = await request(
        new URL(
          `${input.baseUrl}/${encodeURIComponent(
            externalId,
          )}?fields=${encodeURIComponent('id,username,name,profile_picture_url')}`,
        ),
        auth,
      );
      if (enrich.ok) {
        const detail = asRecord(await responseJson(enrich));
        if (typeof detail?.username === 'string' && detail.username) {
          username = detail.username;
        }
        if (typeof detail?.name === 'string' && detail.name) {
          name = detail.name;
        }
        if (
          typeof detail?.profile_picture_url === 'string' &&
          detail.profile_picture_url
        ) {
          picture = detail.profile_picture_url;
        }
      }
    } catch {
      // Pengayaan best-effort: kegagalan tidak menggagalkan koneksi akun.
    }
  }

  return {
    externalId,
    displayName: username || name || 'Instagram',
    avatarUrl: picture || undefined,
  };
}

async function request(
  url: URL,
  headers?: Record<string, string>,
): Promise<Response> {
  try {
    return await fetch(url, headers ? { headers } : undefined);
  } catch {
    throw new Error('request_failed');
  }
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error('invalid_response');
  }
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}
