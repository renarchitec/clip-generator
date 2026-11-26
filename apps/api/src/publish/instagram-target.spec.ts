/**
 * Kontrak target publish Instagram: validasi, env opsional, rute, dan wiring.
 * Jalankan dari apps/api: node --experimental-strip-types src/publish/instagram-target.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePublishTargets } from './publish-helpers.ts';
import { buildInstagramAuthorizationUrl, socialCallbackUrl } from '../social/oauth.ts';
import {
  FACEBOOK_GRAPH_URL,
  INSTAGRAM_GRAPH_URL,
  instagramGraphBaseUrl,
} from './instagram-helpers.ts';
import {
  exchangeInstagramUnifiedCode,
  fetchInstagramUnifiedAccount,
  isInstagramUnifiedLogin,
} from '../social/instagram-unified.ts';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Ganti fetch sementara; kembalikan URL yang dipanggil untuk assertion. */
function mockFetch(handler: (url: URL, index: number) => Response): {
  calls: URL[];
  restore: () => void;
} {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(
      input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url,
    );
    calls.push(url);
    return handler(url, calls.length - 1);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test('target Instagram: hanya caption (<=2200); title/privacy tidak diwajibkan', () => {
  const platformOf = () => 'instagram';
  assert.equal(validatePublishTargets([{ accountId: 'ig-1', caption: 'Halo' }], platformOf), null);
  assert.equal(validatePublishTargets([{ accountId: 'ig-1', caption: '' }], platformOf), null);
  assert.equal(
    validatePublishTargets([{ accountId: 'ig-1', caption: 'x'.repeat(2200) }], platformOf),
    null,
  );
  assert.match(
    validatePublishTargets([{ accountId: 'ig-1', caption: 'x'.repeat(2201) }], platformOf)!,
    /2200/,
  );
  assert.match(validatePublishTargets([{ accountId: 'ig-1' }], platformOf)!, /caption/);
});

test('URL otorisasi dan redirect URI Instagram', () => {
  const redirectUri = socialCallbackUrl('https://clipper.example.com/', 'instagram');
  assert.equal(redirectUri, 'https://clipper.example.com/api/social/instagram/callback');
  const url = new URL(
    buildInstagramAuthorizationUrl({ clientId: 'cid', redirectUri, state: 'st' }),
  );
  assert.equal(url.origin + url.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'st');
  assert.equal(
    url.searchParams.get('scope'),
    'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights',
  );
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(url.searchParams.has('code_challenge'), false);
});

test('env Instagram opsional dan wiring rute/publish ada', async () => {
  const env = await read('apps/api/src/config/env.validation.ts');
  assert.match(env, /INSTAGRAM_CLIENT_ID: z\.string\(\)\.optional\(\)/);
  assert.match(env, /INSTAGRAM_CLIENT_SECRET: z\.string\(\)\.optional\(\)/);
  assert.match(env, /INSTAGRAM_CONFIG_ID: z\.string\(\)\.optional\(\)/);
  const controller = await read('apps/api/src/social/social.controller.ts');
  assert.match(controller, /@Get\('instagram\/connect'\)/);
  assert.match(controller, /@Get\('instagram\/callback'\)/);
  const service = await read('apps/api/src/publish/publish.service.ts');
  assert.match(service, /\['youtube', 'tiktok', 'instagram'\]/);
  const processor = await read('apps/api/src/publish/publish.processor.ts');
  assert.match(processor, /platform === 'instagram'/);
  const media = await read('apps/api/src/clips/public-media.controller.ts');
  assert.match(media, /@Public\(\)/);
  const shared = await read('packages/shared/src/index.ts');
  assert.match(shared, /PUBLISH_INSTAGRAM_CAPTION_MAX = 2200/);
});

test('Unified Login: config_id memakai facebook dialog/oauth, tanpa config_id tetap Instagram Login', () => {
  const redirectUri = socialCallbackUrl('https://clipper.test/', 'instagram');
  const unified = new URL(
    buildInstagramAuthorizationUrl({
      clientId: 'cid',
      redirectUri,
      state: 'st',
      configId: 'cfg-123',
    }),
  );

  assert.equal(
    unified.origin + unified.pathname,
    'https://www.facebook.com/dialog/oauth',
  );
  assert.equal(unified.searchParams.get('client_id'), 'cid');
  assert.equal(unified.searchParams.get('config_id'), 'cfg-123');
  assert.equal(unified.searchParams.get('display'), 'popup');
  assert.equal(
    unified.searchParams.get('override_default_response_type'),
    'true',
  );
  assert.equal(unified.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(unified.searchParams.get('response_type'), 'code');
  assert.equal(unified.searchParams.get('state'), 'st');
  assert.equal(unified.searchParams.get('prompt'), 'login');
  assert.equal(unified.searchParams.has('scope'), false);

  for (const configId of [undefined, '']) {
    const legacy = new URL(
      buildInstagramAuthorizationUrl({
        clientId: 'cid',
        redirectUri,
        state: 'st',
        configId,
      }),
    );
    assert.equal(
      legacy.origin + legacy.pathname,
      'https://www.instagram.com/oauth/authorize',
    );
    assert.equal(legacy.searchParams.has('config_id'), false);
    assert.equal(
      legacy.searchParams.get('scope'),
      'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights',
    );
  }
});

test('host Graph dipilih dari awalan token: EAA → graph.facebook.com, IG → graph.instagram.com', () => {
  assert.equal(FACEBOOK_GRAPH_URL, 'https://graph.facebook.com/v27.0');
  assert.equal(INSTAGRAM_GRAPH_URL, 'https://graph.instagram.com/v27.0');
  assert.equal(instagramGraphBaseUrl('EAAabc'), FACEBOOK_GRAPH_URL);
  assert.equal(instagramGraphBaseUrl('  EAAabc  '), FACEBOOK_GRAPH_URL);
  assert.equal(instagramGraphBaseUrl('IGQVJabc'), INSTAGRAM_GRAPH_URL);
  assert.equal(instagramGraphBaseUrl('other'), INSTAGRAM_GRAPH_URL);
});

test('InstagramUploader memakai instagramGraphBaseUrl untuk setiap panggilan Graph', async () => {
  const uploader = await read('apps/api/src/publish/instagram-uploader.ts');
  assert.match(uploader, /instagramGraphBaseUrl\(input\.accessToken\)/);
  assert.equal((uploader.match(/instagramGraphBaseUrl\(accessToken\)/g) ?? []).length, 3);
  assert.equal(/INSTAGRAM_GRAPH_URL/.test(uploader), false);
});

test('mode Unified Login: config_id atau token SUAT EAA', () => {
  assert.equal(isInstagramUnifiedLogin({ configId: 'cfg' }), true);
  assert.equal(isInstagramUnifiedLogin({ accessToken: 'EAA123' }), true);
  assert.equal(isInstagramUnifiedLogin({}), false);
  assert.equal(isInstagramUnifiedLogin({ accessToken: 'IGQVJ123' }), false);
  assert.equal(isInstagramUnifiedLogin({ configId: '', accessToken: 'IGQVJ' }), false);
});

test('Unified Login exchangeCode: SUAT tidak kedaluwarsa, retry tanpa redirect_uri', async () => {
  const scopes = ['instagram_basic', 'instagram_content_publish'];
  const first = mockFetch(() =>
    json({ access_token: 'EAA-suat', expires_in: 0 }),
  );
  try {
    const tokens = await exchangeInstagramUnifiedCode({
      baseUrl: FACEBOOK_GRAPH_URL,
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'code#_',
      redirectUri: 'https://clipper.test/api/social/instagram/callback',
      scopes,
    });
    assert.equal(tokens.accessToken, 'EAA-suat');
    assert.equal(tokens.expiresIn, undefined);
    assert.deepEqual(tokens.scopes, scopes);
    assert.equal(
      first.calls[0].origin + first.calls[0].pathname,
      'https://graph.facebook.com/v27.0/oauth/access_token',
    );
    assert.equal(first.calls[0].searchParams.get('code'), 'code');
    assert.equal(
      first.calls[0].searchParams.get('redirect_uri'),
      'https://clipper.test/api/social/instagram/callback',
    );
  } finally {
    first.restore();
  }

  const retry = mockFetch((_url, index) =>
    index === 0
      ? json({ error: { message: 'redirect_uri mismatch' } }, 400)
      : json({ access_token: 'EAA-suat' }),
  );
  try {
    const tokens = await exchangeInstagramUnifiedCode({
      baseUrl: FACEBOOK_GRAPH_URL,
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'code',
      redirectUri: 'https://clipper.test/api/social/instagram/callback',
      scopes,
    });
    assert.equal(retry.calls.length, 2);
    assert.equal(retry.calls[1].searchParams.has('redirect_uri'), false);
    assert.equal(retry.calls[1].searchParams.get('code'), 'code');
    assert.equal(tokens.accessToken, 'EAA-suat');
    assert.equal(tokens.expiresIn, undefined);
  } finally {
    retry.restore();
  }
});

test('Unified Login exchangeCode: expires_in positif tetap dipakai, token kosong ditolak', async () => {
  const base = {
    baseUrl: FACEBOOK_GRAPH_URL,
    clientId: 'cid',
    clientSecret: 'sec',
    code: 'code',
    redirectUri: 'https://clipper.test/callback',
    scopes: ['instagram_basic'],
  };
  const ok = mockFetch(() => json({ access_token: 'EAA-timed', expires_in: 3600 }));
  try {
    const tokens = await exchangeInstagramUnifiedCode(base);
    assert.equal(tokens.expiresIn, 3600);
  } finally {
    ok.restore();
  }

  const bad = mockFetch(() => json({ error: { message: 'no token' } }));
  try {
    await assert.rejects(
      exchangeInstagramUnifiedCode(base),
      /token_exchange/,
    );
  } finally {
    bad.restore();
  }
});

test('Unified Login fetchAccount membaca /v27.0/me/assigned_instagram_accounts', async () => {
  const mock = mockFetch(() =>
    json({
      data: [
        {
          id: '178414000',
          username: 'reels_user',
          name: 'Reels User',
          profile_picture_url: 'https://cdn.example/avatar.jpg',
        },
      ],
    }),
  );
  try {
    const account = await fetchInstagramUnifiedAccount({
      baseUrl: FACEBOOK_GRAPH_URL,
      accessToken: 'EAA-suat',
    });
    assert.equal(
      mock.calls[0].origin + mock.calls[0].pathname,
      'https://graph.facebook.com/v27.0/me/assigned_instagram_accounts',
    );
    assert.equal(
      mock.calls[0].searchParams.get('fields'),
      'id,username,name,profile_picture_url',
    );
    assert.equal(account.externalId, '178414000');
    assert.equal(account.displayName, 'reels_user');
    assert.equal(account.avatarUrl, 'https://cdn.example/avatar.jpg');
  } finally {
    mock.restore();
  }
});

test('Unified Login fetchAccount: retry fields minimal, enrich username, gagal bila data kosong', async () => {
  const retry = mockFetch((_url, index) => {
    if (index === 0) return json({ error: { message: 'unsupported fields' } }, 400);
    return json({ data: [{ id: '178414001', username: 'minimal_user' }] });
  });
  try {
    const account = await fetchInstagramUnifiedAccount({
      baseUrl: FACEBOOK_GRAPH_URL,
      accessToken: 'EAA-suat',
    });
    assert.equal(retry.calls.length, 3);
    assert.equal(retry.calls[1].searchParams.get('fields'), 'id,username');
    assert.equal(account.displayName, 'minimal_user');
    assert.equal(account.avatarUrl, undefined);
  } finally {
    retry.restore();
  }

  const enrich = mockFetch((_url, index) =>
    index === 0
      ? json({ data: [{ id: '178414002' }] })
      : json({ id: '178414002', username: 'enriched', profile_picture_url: 'https://cdn.example/p.jpg' }),
  );
  try {
    const account = await fetchInstagramUnifiedAccount({
      baseUrl: FACEBOOK_GRAPH_URL,
      accessToken: 'EAA-suat',
    });
    assert.equal(
      enrich.calls[1].origin + enrich.calls[1].pathname,
      'https://graph.facebook.com/v27.0/178414002',
    );
    assert.equal(account.externalId, '178414002');
    assert.equal(account.displayName, 'enriched');
    assert.equal(account.avatarUrl, 'https://cdn.example/p.jpg');
  } finally {
    enrich.restore();
  }

  const empty = mockFetch(() => json({ data: [] }));
  try {
    await assert.rejects(
      fetchInstagramUnifiedAccount({
        baseUrl: FACEBOOK_GRAPH_URL,
        accessToken: 'EAA-suat',
      }),
      /profile_fetch/,
    );
  } finally {
    empty.restore();
  }
});

test('wiring provider/service/config memakai jalur Unified Login bila tersedia', async () => {
  const provider = await read('apps/api/src/social/social-provider.ts');
  assert.match(provider, /FACEBOOK_GRAPH_ORIGIN = 'https:\/\/graph\.facebook\.com'/);
  assert.match(provider, /FACEBOOK_GRAPH_VERSION = 'v27\.0'/);
  assert.match(provider, /private isUnifiedLogin\(accessToken\?: string\)/);
  assert.match(provider, /this\.config\.instagramConfigId/);
  assert.match(provider, /exchangeInstagramUnifiedCode\(/);
  assert.match(provider, /fetchInstagramUnifiedAccount\(/);

  const service = await read('apps/api/src/social/social.service.ts');
  assert.match(service, /configId: this\.config\.instagramConfigId/);
  assert.match(service, /this\.config\.instagramConfigId\s*\?\s*INSTAGRAM_UNIFIED_SCOPES/);

  const config = await read('apps/api/src/config/app-config.service.ts');
  assert.match(config, /readonly instagramConfigId: string \| undefined/);
  assert.match(config, /config\.get<string>\('INSTAGRAM_CONFIG_ID'\) \|\| undefined/);

  const envExample = await read('.env.example');
  assert.match(envExample, /INSTAGRAM_CONFIG_ID=/);
});
