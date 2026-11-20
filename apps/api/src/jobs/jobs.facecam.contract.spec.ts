import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');

test('schema.prisma has facecam Boolean default false and migration exists', async () => {
  const schema = await readFile(join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  assert.match(schema, /facecam\s+Boolean\s+@default\(false\)/);

  const migration = await readFile(
    join(root, 'apps/api/prisma/migrations/20260120000000_add_job_facecam/migration.sql'),
    'utf8',
  );
  assert.match(migration, /ALTER TABLE "jobs" ADD COLUMN "facecam" BOOLEAN NOT NULL DEFAULT false;/);
});

test('shared JobData includes facecam', async () => {
  const shared = await readFile(join(root, 'packages/shared/src/index.ts'), 'utf8');
  assert.match(shared, /facecam:\s*boolean;/);
});

test('CreateJobDto has optional facecam defaulting to false', async () => {
  const dto = await readFile(join(root, 'apps/api/src/jobs/dto/create-job.dto.ts'), 'utf8');
  assert.match(dto, /facecam:\s*boolean\s*=\s*false;/);
});

test('JobSnapshot and services carry facecam', async () => {
  const snapshot = await readFile(join(root, 'apps/api/src/queue/job-events.service.ts'), 'utf8');
  assert.match(snapshot, /facecam:\s*boolean;/);

  const listener = await readFile(join(root, 'apps/api/src/queue/queue.listener.ts'), 'utf8');
  assert.match(listener, /facecam:\s*job\.facecam,/);

  const service = await readFile(join(root, 'apps/api/src/jobs/jobs.service.ts'), 'utf8');
  assert.match(
    service,
    /const facecam =\s*aspectRatio === '9:16' && !twoSpeakers \? \(dto\.facecam \?\? false\) : false;/,
  );
  assert.match(service, /facecam,\s*\n\s*aspectRatio,/);
  assert.match(service, /maxSourceSec,\s*\n\s*facecam,/, 'facecam tersimpan di create');
  assert.match(service, /facecam:\s*job\.facecam,/);
});

test('retry copies facecam into the new job DTO', async () => {
  const service = await readFile(join(root, 'apps/api/src/jobs/jobs.service.ts'), 'utf8');
  assert.match(service, /dto\.facecam = old\.facecam;/);
});
