/**
 * Self-check state OAuth, PKCE, dan URL redirect YouTube.
 * Jalankan dari apps/api: node --experimental-strip-types src/social/oauth.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSettingsRedirect,
  buildTiktokAuthorizationUrl,
  buildYoutubeAuthorizationUrl,
  createOAuthState,
  createPkceChallenge,
  socialCallbackUrl,
  socialOAuthStateKey,
  TIKTOK_SCOPES,
  YOUTUBE_SCOPES,
  youtubeCallbackUrl,
} from './oauth.ts';

test('state acak membawa user/platform/verifier dan key Redis ber-namespace', () => {
  const pending = createOAuthState('user-1', 'youtube');
  assert.match(pending.state, /^[A-Za-z0-9_-]{43}$/);
  assert.match(pending.payload.codeVerifier, /^[A-Za-z0-9_-]{64}$/);
  assert.equal(pending.payload.userId, 'user-1');
  assert.equal(pending.payload.platform, 'youtube');
  assert.equal(socialOAuthStateKey(pending.state), `social:oauth:${pending.state}`);
  assert.notEqual(createOAuthState('user-1', 'youtube').state, pending.state);
});

test('PKCE memakai S256 sesuai contoh RFC 7636', () => {
  assert.equal(
    createPkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

test('authorization URL Google memuat scope, offline consent, state, dan PKCE', () => {
  const url = new URL(
    buildYoutubeAuthorizationUrl({
      clientId: 'client-id',
      redirectUri: 'https://clipper.test/api/social/youtube/callback',
      state: 'state-acak',
      codeChallenge: 'challenge-s256',
    }),
  );

  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://clipper.test/api/social/youtube/callback',
  );
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), YOUTUBE_SCOPES.join(' '));
  assert.equal(url.searchParams.get('state'), 'state-acak');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-s256');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
});

test('callback dan redirect settings dibangun tanpa slash ganda', () => {
  assert.equal(
    youtubeCallbackUrl('https://clipper.test/'),
    'https://clipper.test/api/social/youtube/callback',
  );

  const connected = new URL(
    buildSettingsRedirect('https://clipper.test/', { connected: 'youtube' }),
  );
  assert.equal(connected.origin + connected.pathname, 'https://clipper.test/settings');
  assert.equal(connected.searchParams.get('connected'), 'youtube');

  const failed = new URL(
    buildSettingsRedirect('https://clipper.test', {
      social_error: 'not_configured',
    }),
  );
  assert.equal(failed.searchParams.get('social_error'), 'not_configured');
});


test('authorization URL TikTok memakai scope comma-separated dan tanpa PKCE', () => {
  const url = new URL(
    buildTiktokAuthorizationUrl({
      clientKey: 'tt-key',
      redirectUri: 'https://clipper.test/api/social/tiktok/callback',
      state: 'state-acak',
    }),
  );
  assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.equal(url.searchParams.get('client_key'), 'tt-key');
  assert.equal(url.searchParams.get('scope'), TIKTOK_SCOPES.join(','));
  assert.equal(
    url.searchParams.get('scope'),
    'user.info.basic,video.upload,video.publish',
  );
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://clipper.test/api/social/tiktok/callback',
  );
  assert.equal(url.searchParams.get('state'), 'state-acak');
  assert.equal(url.searchParams.get('code_challenge'), null);
  assert.equal(url.searchParams.get('code_challenge_method'), null);
  assert.equal(
    socialCallbackUrl('https://clipper.test/', 'tiktok'),
    'https://clipper.test/api/social/tiktok/callback',
  );
});
