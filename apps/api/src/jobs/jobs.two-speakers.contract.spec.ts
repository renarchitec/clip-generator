import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');

test('schema.prisma has twoSpeakers Boolean default false and migration exists', async () => {
  const schema = await readFile(join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  assert.match(schema, /twoSpeakers\s+Boolean\s+@default\(false\)/);

  const migration = await readFile(
    join(root, 'apps/api/prisma/migrations/20260107000000_add_job_two_speakers/migration.sql'),
    'utf8',
  );
  assert.match(migration, /ALTER TABLE "jobs" ADD COLUMN "twoSpeakers" BOOLEAN NOT NULL DEFAULT false;/);
});

test('shared JobData includes twoSpeakers', async () => {
  const shared = await readFile(join(root, 'packages/shared/src/index.ts'), 'utf8');
  assert.match(shared, /twoSpeakers:\s*boolean;/);
});

test('CreateJobDto has optional twoSpeakers defaulting to false', async () => {
  const dto = await readFile(join(root, 'apps/api/src/jobs/dto/create-job.dto.ts'), 'utf8');
  assert.match(dto, /@IsBoolean\(\)/);
  assert.match(dto, /twoSpeakers:\s*boolean\s*=\s*false;/);
});

test('JobSnapshot and services carry twoSpeakers', async () => {
  const snapshot = await readFile(join(root, 'apps/api/src/queue/job-events.service.ts'), 'utf8');
  assert.match(snapshot, /twoSpeakers:\s*boolean;/);

  const listener = await readFile(join(root, 'apps/api/src/queue/queue.listener.ts'), 'utf8');
  assert.match(listener, /twoSpeakers:\s*job\.twoSpeakers,/);

  const service = await readFile(join(root, 'apps/api/src/jobs/jobs.service.ts'), 'utf8');
  assert.match(service, /const twoSpeakers = dto\.twoSpeakers \?\? false;/);
  assert.match(service, /twoSpeakers,\s*\n\s*clipCount:/);
  assert.match(service, /twoSpeakers:\s*job\.twoSpeakers,/);
});

test('worker parses twoSpeakers default false and models serializes it', async () => {
  const models = await readFile(join(root, 'worker/clipper/models.py'), 'utf8');
  assert.match(models, /DEFAULT_TWO_SPEAKERS = False/);
  assert.match(models, /two_speakers:\s*bool\s*=\s*DEFAULT_TWO_SPEAKERS/);
  assert.match(models, /"twoSpeakers":\s*self\.two_speakers,/);
  assert.match(models, /raw_two_speakers = _first\(data, "twoSpeakers", "two_speakers", default=DEFAULT_TWO_SPEAKERS\)/);

  const pipeline = await readFile(join(root, 'worker/clipper/pipeline.py'), 'utf8');
  assert.match(pipeline, /job\.two_speakers,/);
  assert.match(pipeline, /if two_speakers:/);
  assert.match(pipeline, /_two_speaker_graph/);
});
