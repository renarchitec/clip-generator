import { createHash, randomBytes } from 'node:crypto';
import type { SocialPlatform } from '@clipper/shared';

export const OAUTH_STATE_TTL_SECONDS = 600;
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
] as const;

export interface OAuthStatePayload {
  userId: string;
  platform: SocialPlatform;
  codeVerifier: string;
}

export interface PendingOAuthState {
  state: string;
  payload: OAuthStatePayload;
}

export function socialOAuthStateKey(state: string): string {
  return `social:oauth:${state}`;
}

export function createOAuthState(
  userId: string,
  platform: SocialPlatform,
): PendingOAuthState {
  return {
    state: randomBytes(32).toString('base64url'),
    payload: {
      userId,
      platform,
      codeVerifier: randomBytes(48).toString('base64url'),
    },
  };
}

/** PKCE S256: base64url(SHA256(verifier ASCII)). */
export function createPkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}

export function youtubeCallbackUrl(publicWebUrl: string): string {
  return `${publicWebUrl.replace(/\/+$/, '')}/api/social/youtube/callback`;
}

export function buildYoutubeAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', YOUTUBE_SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  return url.toString();
}

export function buildSettingsRedirect(
  publicWebUrl: string,
  params: Record<string, string>,
): string {
  const url = new URL(`${publicWebUrl.replace(/\/+$/, '')}/settings`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
