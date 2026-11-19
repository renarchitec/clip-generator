import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');

test('schema.prisma has captions Boolean default true and migration exists', async () => {
  const schema = await readFile(join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  assert.match(schema, /captions\s+Boolean\s+@default\(true\)/);

  const migration = await readFile(
    join(root, 'apps/api/prisma/migrations/20260106000000_add_job_captions/migration.sql'),
    'utf8',
  );
  assert.match(migration, /ALTER TABLE "jobs" ADD COLUMN "captions" BOOLEAN NOT NULL DEFAULT true;/);
});

test('shared JobData includes captions', async () => {
  const shared = await readFile(join(root, 'packages/shared/src/index.ts'), 'utf8');
  assert.match(shared, /captions:\s*boolean;/);
});

test('CreateJobDto has optional captions defaulting to true', async () => {
  const dto = await readFile(join(root, 'apps/api/src/jobs/dto/create-job.dto.ts'), 'utf8');
  assert.match(dto, /@IsBoolean\(\)/);
  assert.match(dto, /captions:\s*boolean\s*=\s*true;/);
});

test('JobSnapshot and services carry captions', async () => {
  const snapshot = await readFile(join(root, 'apps/api/src/queue/job-events.service.ts'), 'utf8');
  assert.match(snapshot, /captions:\s*boolean;/);

  const listener = await readFile(join(root, 'apps/api/src/queue/queue.listener.ts'), 'utf8');
  assert.match(listener, /captions:\s*job\.captions,/);

  const service = await readFile(join(root, 'apps/api/src/jobs/jobs.service.ts'), 'utf8');
  assert.match(service, /const captions = dto\.captions \?\? true;/);
  assert.match(service, /captions,\s*\n\s*description,/);
});

test('worker parses captions default true and skips ASS when false', async () => {
  const models = await readFile(join(root, 'worker/clipper/models.py'), 'utf8');
  assert.match(models, /DEFAULT_CAPTIONS = True/);
  assert.match(models, /captions:\s*bool\s*=\s*DEFAULT_CAPTIONS/);
  assert.match(models, /"captions":\s*self\.captions,/);
  assert.match(models, /raw_captions = _first\(data, "captions", default=DEFAULT_CAPTIONS\)/);

  const pipeline = await readFile(join(root, 'worker/clipper/pipeline.py'), 'utf8');
  assert.match(pipeline, /if captions and clip_cues:/);
  assert.match(pipeline, /job\.captions,/);
});
