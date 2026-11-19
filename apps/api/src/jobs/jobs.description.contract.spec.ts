import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Kontrak description job + endpoint DELETE /api/clips/:id.
 * Self-check ringan tanpa DB/HTTP, cukup memastikan bentuk yang disepakati.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');

test('schema.prisma punya kolom description nullable + migration-nya', async () => {
  const schema = await readFile(join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  assert.match(schema, /model Job\s*\{[^}]*description\s+String\?/);

  const migration = await readFile(
    join(root, 'apps/api/prisma/migrations/20260104000000_add_job_description/migration.sql'),
    'utf8',
  );
  assert.match(migration, /ALTER TABLE "jobs" ADD COLUMN "description" TEXT/);
});

test('shared JobData menyertakan description', async () => {
  const shared = await readFile(join(root, 'packages/shared/src/index.ts'), 'utf8');
  assert.match(shared, /interface JobData\s*\{[^}]*description\?\s*:\s*string \| null/);
});

test('worker models mem-parse description ke JobData', async () => {
  const models = await readFile(join(root, 'worker/clipper/models.py'), 'utf8');
  assert.match(models, /description:\s*Optional\[str\] = None/);
  assert.match(models, /MAX_DESCRIPTION_CHARS = 500/);
});

test('delete clip lewat DELETE /api/clips/:id -> 204', async () => {
  const controller = await readFile(join(root, 'apps/api/src/clips/clips.controller.ts'), 'utf8');
  assert.match(controller, /@Delete\(':id'\)/);
  assert.match(controller, /@HttpCode\(204\)/);
});
