/**
 * Kontrak target publish TikTok: mode, opsi, dan validasi lintas-platform.
 * Jalankan dari apps/api: node --experimental-strip-types src/publish/tiktok-target.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  sanitizeTiktokCaption,
  tiktokMode,
  validatePublishTargets,
} from './publish-helpers.ts';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

const tiktok = { accountId: 'tt-1', title: '', caption: 'Halo', tiktok: {
  privacyLevel: 'SELF_ONLY',
  disableComment: false,
  disableDuet: false,
  disableStitch: false,
  brandContent: false,
  brandOrganic: false,
} };

test('target TikTok: default direct, opsi wajib, caption 2200 UTF-16', () => {
  assert.equal(tiktokMode({}), 'direct');
  assert.equal(tiktokMode({ mode: 'inbox' }), 'inbox');
  const platformOf = (id: string) => (id === 'tt-1' ? 'tiktok' : 'youtube');
  assert.equal(validatePublishTargets([tiktok], platformOf), null);
  assert.equal(validatePublishTargets([{ ...tiktok, title: undefined, caption: '' }], platformOf), null);
  assert.match(validatePublishTargets([{ ...tiktok, tiktok: undefined }], platformOf)!, /tiktok/);
  assert.match(
    validatePublishTargets([{ ...tiktok, caption: 'x'.repeat(2201) }], platformOf)!,
    /2200/,
  );
  assert.equal(validatePublishTargets([{ ...tiktok, caption: 'x'.repeat(2200) }], platformOf), null);
  assert.match(
    validatePublishTargets([{ ...tiktok, tiktok: { ...tiktok.tiktok, brandContent: true } }], platformOf)!,
    /SELF_ONLY/,
  );
  assert.equal(
    validatePublishTargets([{ ...tiktok, mode: 'inbox', tiktok: undefined }], platformOf),
    null,
  );
});

test('YouTube tetap mewajibkan title dan privacy', () => {
  const platformOf = () => 'youtube';
  assert.match(validatePublishTargets([tiktok], platformOf)!, /title/);
  assert.equal(
    validatePublishTargets([{ ...tiktok, title: 'Judul', privacy: 'public' }], () => undefined),
    null,
  );
  assert.equal(sanitizeTiktokCaption('a<b>\r\nx\u0007').includes('<b>'), true);
  assert.equal(sanitizeTiktokCaption('x'.repeat(3000)).length, 2200);
});

test('kontrak shared dan Prisma mendukung mode/opsi TikTok', async () => {
  const shared = await read('packages/shared/src/index.ts');
  assert.match(shared, /mode\?: PublishMode/);
  assert.match(shared, /tiktok\?: TiktokPublishOptions/);
  assert.match(shared, /mode: PublishMode;/);
  const schema = await read('apps/api/prisma/schema.prisma');
  assert.match(schema, /options\s+Json\?/);
  const migration = await read(
    'apps/api/prisma/migrations/20260125000000_publication_tiktok/migration.sql',
  );
  assert.match(migration, /"options" JSONB/);
  const service = await read('apps/api/src/publish/publish.service.ts');
  assert.match(service, /\['youtube', 'tiktok', 'instagram'\]/);
});
