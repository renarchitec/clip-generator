import { Injectable } from '@nestjs/common';
import type { SocialPlatform } from '@clipper/shared';
import { AppConfig } from '../config/app-config.service';
import { INSTAGRAM_SCOPES, INSTAGRAM_UNIFIED_SCOPES } from './oauth';
import { isInstagramAccountTypeSupported } from './instagram-token';
import {
  exchangeInstagramUnifiedCode,
  fetchInstagramUnifiedAccount,
  isInstagramUnifiedLogin,
} from './instagram-unified';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scopes?: string[];
}

export interface ExternalSocialAccount {
  externalId: string;
  displayName: string;
  avatarUrl?: string;
}

export interface SocialProvider {
  readonly platform: SocialPlatform;
  readonly configured: boolean;
  readonly available: boolean;
  /** codeVerifier hanya dipakai provider ber-PKCE (YouTube); TikTok web tidak memakainya. */
  exchangeCode(
    code: string,
    codeVerifier: string | undefined,
    redirectUri: string,
  ): Promise<OAuthTokens>;
  fetchAccount(accessToken: string): Promise<ExternalSocialAccount>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  revoke?(accessToken: string): Promise<void>;
}

export class SocialProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SocialProviderError';
  }
}

@Injectable()
export class YoutubeProvider implements SocialProvider {
  readonly platform: SocialPlatform = 'youtube';
  readonly available = true;

  constructor(private readonly config: AppConfig) {}

  get configured(): boolean {
    return Boolean(
      this.config.googleClientId &&
        this.config.googleClientSecret &&
        this.config.socialTokenKey,
    );
  }

  async exchangeCode(
    code: string,
    codeVerifier: string | undefined,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    const credentials = this.credentials();
    if (!codeVerifier) throw new SocialProviderError('token_exchange');
    return this.requestToken(
      {
        code,
        code_verifier: codeVerifier,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      },
      'token_exchange',
    );
  }

  async fetchAccount(accessToken: string): Promise<ExternalSocialAccount> {
    const url = new URL(YOUTUBE_CHANNELS_URL);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('mine', 'true');

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new SocialProviderError('channel_fetch');
    }
    if (!response.ok) throw new SocialProviderError('channel_fetch');

    const body = await responseJson(response, 'channel_fetch');
    const channel = asRecord(asRecord(body)?.items?.[0]);
    const snippet = asRecord(channel?.snippet);
    const thumbnails = asRecord(snippet?.thumbnails);
    const defaultThumbnail = asRecord(thumbnails?.default);

    if (
      typeof channel?.id !== 'string' ||
      !channel.id ||
      typeof snippet?.title !== 'string'
    ) {
      throw new SocialProviderError('channel_not_found');
    }

    return {
      externalId: channel.id,
      displayName: snippet.title,
      avatarUrl:
        typeof defaultThumbnail?.url === 'string'
          ? defaultThumbnail.url
          : undefined,
    };
  }

  async refresh(refreshToken: string): Promise<OAuthTokens> {
    const credentials = this.credentials();
    return this.requestToken(
      {
        refresh_token: refreshToken,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: 'refresh_token',
      },
      'refresh_failed',
    );
  }

  async revoke(accessToken: string): Promise<void> {
    const response = await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: accessToken }),
    });
    if (!response.ok) throw new SocialProviderError('revoke_failed');
  }

  private credentials(): { clientId: string; clientSecret: string } {
    const clientId = this.config.googleClientId;
    const clientSecret = this.config.googleClientSecret;
    if (!clientId || !clientSecret || !this.config.socialTokenKey) {
      throw new SocialProviderError('not_configured');
    }
    return { clientId, clientSecret };
  }

  private async requestToken(
    params: Record<string, string>,
    errorCode: string,
  ): Promise<OAuthTokens> {
    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
      });
    } catch {
      throw new SocialProviderError(errorCode);
    }
    if (!response.ok) throw new SocialProviderError(errorCode);

    const body = asRecord(await responseJson(response, errorCode));
    if (typeof body?.access_token !== 'string' || !body.access_token) {
      throw new SocialProviderError(errorCode);
    }

    const expiresIn = Number(body.expires_in);
    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === 'string' && body.refresh_token
          ? body.refresh_token
          : undefined,
      expiresIn:
        Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : undefined,
      scopes:
        typeof body.scope === 'string'
          ? body.scope.split(/\s+/).filter(Boolean)
          : undefined,
    };
  }
}

const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const TIKTOK_USER_URL =
  'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url';

@Injectable()
export class TiktokProvider implements SocialProvider {
  readonly platform: SocialPlatform = 'tiktok';
  readonly available = true;

  constructor(private readonly config: AppConfig) {}

  get configured(): boolean {
    return Boolean(
      this.config.tiktokClientKey &&
        this.config.tiktokClientSecret &&
        this.config.socialTokenKey,
    );
  }

  /** Web flow TikTok tidak memakai PKCE: codeVerifier diabaikan. */
  async exchangeCode(
    code: string,
    _codeVerifier: string | undefined,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    const credentials = this.credentials();
    return this.requestToken(
      {
        client_key: credentials.clientKey,
        client_secret: credentials.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      },
      'token_exchange',
    );
  }

  async fetchAccount(accessToken: string): Promise<ExternalSocialAccount> {
    let response: Response;
    try {
      response = await fetch(TIKTOK_USER_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new SocialProviderError('profile_fetch');
    }
    const body = asRecord(await responseJson(response, 'profile_fetch'));
    const errorCode = asRecord(body?.error)?.code;
    if (!response.ok || (typeof errorCode === 'string' && errorCode !== 'ok')) {
      throw new SocialProviderError('profile_fetch');
    }
    const user = asRecord(asRecord(body?.data)?.user);
    if (typeof user?.open_id !== 'string' || !user.open_id) {
      throw new SocialProviderError('profile_fetch');
    }
    return {
      externalId: user.open_id,
      displayName:
        typeof user.display_name === 'string' && user.display_name
          ? user.display_name
          : 'TikTok',
      avatarUrl:
        typeof user.avatar_url === 'string' && user.avatar_url
          ? user.avatar_url
          : undefined,
    };
  }

  /** Refresh token TikTok berotasi: pemanggil wajib menyimpan refreshToken baru. */
  async refresh(refreshToken: string): Promise<OAuthTokens> {
    const credentials = this.credentials();
    return this.requestToken(
      {
        client_key: credentials.clientKey,
        client_secret: credentials.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
      'refresh_failed',
    );
  }

  async revoke(accessToken: string): Promise<void> {
    const credentials = this.credentials();
    const response = await fetch(TIKTOK_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: credentials.clientKey,
        client_secret: credentials.clientSecret,
        token: accessToken,
      }),
    });
    if (!response.ok) throw new SocialProviderError('revoke_failed');
  }

  private credentials(): { clientKey: string; clientSecret: string } {
    const clientKey = this.config.tiktokClientKey;
    const clientSecret = this.config.tiktokClientSecret;
    if (!clientKey || !clientSecret || !this.config.socialTokenKey) {
      throw new SocialProviderError('not_configured');
    }
    return { clientKey, clientSecret };
  }

  private async requestToken(
    params: Record<string, string>,
    errorCode: string,
  ): Promise<OAuthTokens> {
    let response: Response;
    try {
      response = await fetch(TIKTOK_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
      });
    } catch {
      throw new SocialProviderError(errorCode);
    }
    if (!response.ok) throw new SocialProviderError(errorCode);

    const body = asRecord(await responseJson(response, errorCode));
    if (typeof body?.access_token !== 'string' || !body.access_token) {
      throw new SocialProviderError(errorCode);
    }

    const expiresIn = Number(body.expires_in);
    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === 'string' && body.refresh_token
          ? body.refresh_token
          : undefined,
      expiresIn:
        Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : undefined,
      scopes:
        typeof body.scope === 'string'
          ? body.scope.split(/[\s,]+/).filter(Boolean)
          : undefined,
    };
  }
}

const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const INSTAGRAM_GRAPH_ORIGIN = 'https://graph.instagram.com';
const INSTAGRAM_ME_URL = `${INSTAGRAM_GRAPH_ORIGIN}/v27.0/me?fields=user_id,username,profile_picture_url,account_type`;
/** Umur access token long-lived Instagram. */
const INSTAGRAM_LONG_LIVED_SECONDS = 60 * 24 * 60 * 60;

/** Graph host untuk Instagram API with Unified Login (SUAT `EAA...`). */
const FACEBOOK_GRAPH_ORIGIN = 'https://graph.facebook.com';
const FACEBOOK_GRAPH_VERSION = 'v27.0';
const FACEBOOK_GRAPH_URL = `${FACEBOOK_GRAPH_ORIGIN}/${FACEBOOK_GRAPH_VERSION}`;

/**
 * Instagram API with Instagram Login (bukan Facebook Login): tanpa PKCE,
 * tanpa refresh token. Token long-lived diperpanjang dengan token itu sendiri.
 */
@Injectable()
export class InstagramProvider implements SocialProvider {
  readonly platform: SocialPlatform = 'instagram';
  readonly available = true;

  constructor(private readonly config: AppConfig) {}

  get configured(): boolean {
    return Boolean(
      this.config.instagramClientId &&
        this.config.instagramClientSecret &&
        this.config.socialTokenKey,
    );
  }

  /**
   * Tukar authorization code (sekali pakai, berlaku 1 jam) menjadi token
   * long-lived. Respons short-lived bisa berbentuk `{data:[{...}]}` atau flat.
   */
  async exchangeCode(
    code: string,
    _codeVerifier: string | undefined,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    const credentials = this.credentials();
    // Instagram menambahkan `#_` di belakang code pada redirect.
    const cleanCode = code.trim().replace(/#_?$/, '');

    if (this.isUnifiedLogin()) {
      try {
        return await exchangeInstagramUnifiedCode({
          baseUrl: FACEBOOK_GRAPH_URL,
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          code: cleanCode,
          redirectUri,
          scopes: INSTAGRAM_UNIFIED_SCOPES,
        });
      } catch {
        throw new SocialProviderError('token_exchange');
      }
    }

    let response: Response;
    try {
      response = await fetch(INSTAGRAM_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code: cleanCode,
        }),
      });
    } catch {
      throw new SocialProviderError('token_exchange');
    }
    if (!response.ok) throw new SocialProviderError('token_exchange');

    const body = asRecord(await responseJson(response, 'token_exchange'));
    const data = asRecord(body?.data) ?? body;
    const shortToken =
      typeof data?.access_token === 'string' && data.access_token
        ? data.access_token
        : null;
    if (!shortToken) throw new SocialProviderError('token_exchange');

    const permissions = Array.isArray(data?.permissions)
      ? (data!.permissions as unknown[])
          .filter((item): item is string => typeof item === 'string')
          .flatMap((item) => item.split(','))
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined;

    // Tukar ke long-lived (60 hari). Bila gagal, token 1 jam tetap terpakai.
    const longLived = await this.exchangeForLongLived(
      shortToken,
      credentials.clientSecret,
    );

    return {
      accessToken: longLived?.accessToken ?? shortToken,
      expiresIn: longLived?.expiresIn ?? INSTAGRAM_LONG_LIVED_SECONDS,
      scopes: permissions ?? [...INSTAGRAM_SCOPES],
    };
  }

  /** `GET /me`: hanya akun Business/Creator yang boleh memakai Content Publishing. */
  async fetchAccount(accessToken: string): Promise<ExternalSocialAccount> {
    if (this.isUnifiedLogin(accessToken)) {
      // Unified Login: SUAT tidak punya `account_type`, akun Instagram diambil
      // dari edge assigned_instagram_accounts pada Graph API Facebook.
      try {
        return await fetchInstagramUnifiedAccount({
          baseUrl: FACEBOOK_GRAPH_URL,
          accessToken,
        });
      } catch {
        throw new SocialProviderError('profile_fetch');
      }
    }

    let response: Response;
    try {
      response = await fetch(INSTAGRAM_ME_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new SocialProviderError('profile_fetch');
    }
    if (!response.ok) throw new SocialProviderError('profile_fetch');

    const body = asRecord(await responseJson(response, 'profile_fetch'));
    const accountType =
      typeof body?.account_type === 'string' ? body.account_type : null;
    if (!isInstagramAccountTypeSupported(accountType)) {
      throw new SocialProviderError(
        accountType?.toLowerCase() === 'personal'
          ? 'account_type_personal'
          : 'account_type_unsupported',
      );
    }

    const externalId =
      typeof body?.user_id === 'string' && body.user_id
        ? body.user_id
        : typeof body?.id === 'string' && body.id
          ? body.id
          : null;
    if (!externalId) throw new SocialProviderError('profile_fetch');

    return {
      externalId,
      displayName:
        typeof body?.username === 'string' && body.username
          ? body.username
          : 'Instagram',
      avatarUrl:
        typeof body?.profile_picture_url === 'string' && body.profile_picture_url
          ? body.profile_picture_url
          : undefined,
    };
  }

  /**
   * Perpanjang access token long-lived dengan token itu sendiri
   * (`grant_type=ig_refresh_token`). Loop: token baru menggantikan yang lama.
   */
  async refresh(accessToken: string): Promise<OAuthTokens> {
    const url = new URL(`${INSTAGRAM_GRAPH_ORIGIN}/refresh_access_token`);
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', accessToken);

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new SocialProviderError('refresh_failed');
    }
    if (!response.ok) throw new SocialProviderError('refresh_failed');

    const body = asRecord(await responseJson(response, 'refresh_failed'));
    if (typeof body?.access_token !== 'string' || !body.access_token) {
      throw new SocialProviderError('refresh_failed');
    }
    const expiresIn = Number(body.expires_in);
    return {
      accessToken: body.access_token,
      expiresIn:
        Number.isFinite(expiresIn) && expiresIn > 0
          ? expiresIn
          : INSTAGRAM_LONG_LIVED_SECONDS,
    };
  }

  /** Unified Login aktif bila config_id di-set atau token berupa SUAT `EAA...`. */
  private isUnifiedLogin(accessToken?: string): boolean {
    return isInstagramUnifiedLogin({
      configId: this.config.instagramConfigId,
      accessToken,
    });
  }

  private credentials(): { clientId: string; clientSecret: string } {
    const clientId = this.config.instagramClientId;
    const clientSecret = this.config.instagramClientSecret;
    if (!clientId || !clientSecret || !this.config.socialTokenKey) {
      throw new SocialProviderError('not_configured');
    }
    return { clientId, clientSecret };
  }

  private async exchangeForLongLived(
    shortToken: string,
    clientSecret: string,
  ): Promise<{ accessToken: string; expiresIn: number } | null> {
    const url = new URL(`${INSTAGRAM_GRAPH_ORIGIN}/access_token`);
    url.searchParams.set('grant_type', 'ig_exchange_token');
    url.searchParams.set('client_secret', clientSecret);
    url.searchParams.set('access_token', shortToken);

    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const body = asRecord(await response.json());
      if (typeof body?.access_token !== 'string' || !body.access_token) {
        return null;
      }
      const expiresIn = Number(body.expires_in);
      return {
        accessToken: body.access_token,
        expiresIn:
          Number.isFinite(expiresIn) && expiresIn > 0
            ? expiresIn
            : INSTAGRAM_LONG_LIVED_SECONDS,
      };
    } catch {
      return null;
    }
  }
}

async function responseJson(
  response: Response,
  errorCode: string,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SocialProviderError(errorCode);
  }
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}
