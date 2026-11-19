import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');

test('schema.prisma has reframe with default face_tracking and migration exists', async () => {
  const schema = await readFile(join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  assert.match(schema, /reframe\s+String\s+@default\("face_tracking"\)/);

  const migration = await readFile(
    join(root, 'apps/api/prisma/migrations/20260105000000_add_job_reframe/migration.sql'),
    'utf8',
  );
  assert.match(migration, /ALTER TABLE "jobs" ADD COLUMN "reframe" TEXT NOT NULL DEFAULT 'face_tracking';/);
});

test('shared exports REFRAME_MODES and JobData includes reframe', async () => {
  const shared = await readFile(join(root, 'packages/shared/src/index.ts'), 'utf8');
  assert.match(shared, /export const REFRAME_MODES = \['face_tracking', 'black_bars', 'blurred_fill'\]/);
  assert.match(shared, /reframe:\s*ReframeMode;/);
});

test('CreateJobDto has optional reframe defaulting to face_tracking', async () => {
  const dto = await readFile(join(root, 'apps/api/src/jobs/dto/create-job.dto.ts'), 'utf8');
  assert.match(dto, /@IsIn\(REFRAME_MODES\)/);
  assert.match(dto, /reframe:\s*ReframeMode\s*=\s*DEFAULT_REFRAME/);
});

test('JobSnapshot includes reframe', async () => {
  const snapshot = await readFile(join(root, 'apps/api/src/queue/job-events.service.ts'), 'utf8');
  assert.match(snapshot, /reframe:\s*string;/);
});
