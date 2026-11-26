/**
 * Kontrak publikasi YouTube: rute, antrean `publish`, migrasi, dan tipe shared.
 * Jalankan dari apps/api: node --experimental-strip-types src/publish/publish.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('rute publish owner-scoped terdaftar', async () => {
  const controller = await read('apps/api/src/publish/publish.controller.ts');
  assert.match(controller, /@Post\('clips\/:id\/publish'\)/);
  assert.match(controller, /@Get\('clips\/:id\/publications'\)/);
  assert.match(controller, /@Post\('publications\/:id\/retry'\)/);
  assert.match(controller, /@CurrentUser\(\) user: \{ id: string \}/);
  const service = await read('apps/api/src/publish/publish.service.ts');
  assert.match(service, /job: \{ userId \}/);
  assert.match(service, /platform_unavailable/);
  assert.match(service, /ConflictException\('publication_in_progress'\)/);
});

test('antrean publish sama di API dan shared; processor concurrency 2', async () => {
  const constants = await read('apps/api/src/queue/queue.constants.ts');
  const shared = await read('packages/shared/src/index.ts');
  assert.match(constants, /PUBLISH_QUEUE_NAME = 'publish'/);
  assert.match(shared, /PUBLISH_QUEUE_NAME = 'publish'/);
  assert.match(shared, /export interface PublicationResponse/);
  const processor = await read('apps/api/src/publish/publish.processor.ts');
  assert.match(processor, /@Processor\(PUBLISH_QUEUE_NAME, \{ concurrency: 2 \}\)/);
  const app = await read('apps/api/src/app.module.ts');
  assert.match(app, /PublishModule/);
});

test('migrasi mempertahankan publikasi saat akun sosial diputus', async () => {
  const schema = await read('apps/api/prisma/schema.prisma');
  assert.match(schema, /socialAccountId\s+String\?/);
  assert.match(schema, /socialAccount\s+SocialAccount\?\s+@relation\(fields: \[socialAccountId\], references: \[id\], onDelete: SetNull\)/);
  const migration = await read(
    'apps/api/prisma/migrations/20260204000000_publication_preserve_on_disconnect/migration.sql',
  );
  assert.match(migration, /SET "accountName" = sa\."displayName", "accountExternalId" = sa\."externalId"/);
  assert.match(migration, /ALTER COLUMN "socialAccountId" DROP NOT NULL/);
  assert.match(migration, /ON DELETE SET NULL ON UPDATE CASCADE/);
  const shared = await read('packages/shared/src/index.ts');
  assert.match(shared, /interface PublicationResponse\s*\{[^}]*accountId: string \| null;/);
});

test('migrasi menambah kolom YouTube pada publications', async () => {
  const migration = await read(
    'apps/api/prisma/migrations/20260123000000_publication_youtube_fields/migration.sql',
  );
  for (const column of ['"title"', '"madeForKids"', '"progress"', '"publishedAt"']) {
    assert.ok(migration.includes(column), `kolom ${column} belum ada`);
  }
  const pkg = JSON.parse(await read('apps/api/package.json'));
  assert.ok(pkg.scripts.test.includes('publish-helpers.spec.ts'));
});
