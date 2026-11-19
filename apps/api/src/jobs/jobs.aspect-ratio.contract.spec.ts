import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');

test('schema.prisma has aspectRatio String default 9:16 and migration exists', async () => {
  const schema = await readFile(join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  assert.match(schema, /aspectRatio\s+String\s+@default\("9:16"\)/);

  const migration = await readFile(
    join(root, 'apps/api/prisma/migrations/20260110000000_add_job_aspect_ratio/migration.sql'),
    'utf8',
  );
  assert.match(migration, /ALTER TABLE "jobs" ADD COLUMN "aspectRatio" TEXT NOT NULL DEFAULT '9:16';/);
});

test('shared exposes ASPECT_RATIOS and JobData.aspectRatio', async () => {
  const shared = await readFile(join(root, 'packages/shared/src/index.ts'), 'utf8');
  assert.match(shared, /export const ASPECT_RATIOS = \['9:16', '1:1', '16:9'\] as const;/);
  assert.match(shared, /export type AspectRatio = \(typeof ASPECT_RATIOS\)\[number\];/);
  assert.match(shared, /aspectRatio:\s*AspectRatio;/);
});

test('CreateJobDto has optional aspectRatio validated with IsIn and default 9:16', async () => {
  const dto = await readFile(join(root, 'apps/api/src/jobs/dto/create-job.dto.ts'), 'utf8');
  assert.match(dto, /@IsIn\(ASPECT_RATIOS\)/);
  assert.match(dto, /aspectRatio:\s*AspectRatio\s*=\s*DEFAULT_ASPECT;/);
});

test('JobSnapshot, listener, and service carry aspectRatio', async () => {
  const snapshot = await readFile(join(root, 'apps/api/src/queue/job-events.service.ts'), 'utf8');
  assert.match(snapshot, /aspectRatio:\s*string;/);

  const listener = await readFile(join(root, 'apps/api/src/queue/queue.listener.ts'), 'utf8');
  assert.match(listener, /aspectRatio:\s*job\.aspectRatio,/);

  const service = await readFile(join(root, 'apps/api/src/jobs/jobs.service.ts'), 'utf8');
  assert.match(service, /const aspectRatio = dto\.aspectRatio \?\? DEFAULT_ASPECT;/);
  assert.match(service, /aspectRatio,\s*\n\s*description,/);
  assert.match(service, /aspectRatio:\s*job\.aspectRatio,/);
});

test('service normalizes twoSpeakers to false outside 9:16', async () => {
  const service = await readFile(join(root, 'apps/api/src/jobs/jobs.service.ts'), 'utf8');
  assert.match(
    service,
    /const twoSpeakers = aspectRatio === '9:16' \? \(dto\.twoSpeakers \?\? false\) : false;/,
  );
});

test('worker parses aspectRatio tolerantly and models serializes it', async () => {
  const models = await readFile(join(root, 'worker/clipper/models.py'), 'utf8');
  assert.match(models, /ASPECT_RATIOS = \("9:16", "1:1", "16:9"\)/);
  assert.match(models, /DEFAULT_ASPECT = "9:16"/);
  assert.match(models, /aspect_ratio:\s*AspectRatio\s*=\s*DEFAULT_ASPECT/);
  assert.match(models, /"aspectRatio":\s*self\.aspect_ratio,/);
  assert.match(models, /aspect_ratio = raw_aspect if raw_aspect in ASPECT_RATIOS else DEFAULT_ASPECT/);

  const pipeline = await readFile(join(root, 'worker/clipper/pipeline.py'), 'utf8');
  assert.match(pipeline, /"9:16": \(1080, 1920\)/);
  assert.match(pipeline, /"1:1": \(1080, 1080\)/);
  assert.match(pipeline, /"16:9": \(1920, 1080\)/);
  assert.match(pipeline, /job\.aspect_ratio,/);
});
