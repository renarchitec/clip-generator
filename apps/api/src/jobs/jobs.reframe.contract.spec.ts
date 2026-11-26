import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');

test('schema.prisma defaults reframe to center_crop and the migration sets that default', async () => {
  const schema = await readFile(join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  assert.match(schema, /reframe\s+String\s+@default\("center_crop"\)/);

  const migration = await readFile(
    join(root, 'apps/api/prisma/migrations/20261126000000_default_reframe_center_crop/migration.sql'),
    'utf8',
  );
  assert.equal(migration.trim(), 'ALTER TABLE "jobs" ALTER COLUMN "reframe" SET DEFAULT \'center_crop\';');
});

test('shared exports center_crop as the default and keeps the legacy reframe modes', async () => {
  const shared = await readFile(join(root, 'packages/shared/src/index.ts'), 'utf8');
  assert.match(shared, /export const REFRAME_MODES = \['center_crop', 'face_tracking', 'black_bars', 'blurred_fill'\]/);
  assert.match(shared, /export const DEFAULT_REFRAME:\s*ReframeMode\s*=\s*'center_crop'/);
  assert.match(shared, /reframe:\s*ReframeMode;/);
});

test('CreateJobDto has optional reframe defaulting to DEFAULT_REFRAME', async () => {
  const dto = await readFile(join(root, 'apps/api/src/jobs/dto/create-job.dto.ts'), 'utf8');
  assert.match(dto, /@IsOptional\(\)\s+@IsIn\(REFRAME_MODES\)/);
  assert.match(dto, /reframe:\s*ReframeMode\s*=\s*DEFAULT_REFRAME/);
});

test('JobSnapshot includes reframe', async () => {
  const snapshot = await readFile(join(root, 'apps/api/src/queue/job-events.service.ts'), 'utf8');
  assert.match(snapshot, /reframe:\s*string;/);
});
