import { Injectable } from '@nestjs/common';
import type { SocialPlatform } from '@clipper/shared';
import { AppConfig } from '../config/app-config.service';

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
