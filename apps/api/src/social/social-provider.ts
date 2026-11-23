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
  exchangeCode(
    code: string,
    codeVerifier: string,
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
    codeVerifier: string,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    const credentials = this.credentials();
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
