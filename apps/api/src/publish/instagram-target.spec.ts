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

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

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
    'instagram_business_basic,instagram_business_content_publish',
  );
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(url.searchParams.has('code_challenge'), false);
});

test('env Instagram opsional dan wiring rute/publish ada', async () => {
  const env = await read('apps/api/src/config/env.validation.ts');
  assert.match(env, /INSTAGRAM_CLIENT_ID: z\.string\(\)\.optional\(\)/);
  assert.match(env, /INSTAGRAM_CLIENT_SECRET: z\.string\(\)\.optional\(\)/);
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
