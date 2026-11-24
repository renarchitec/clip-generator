/**
 * Kontrak bahasa caption: shared, migrasi, DTO, service/retry, snapshot, worker.
 * Jalankan dari apps/api: node --experimental-strip-types src/jobs/jobs.caption-language.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('shared mengekspor CAPTION_LANGUAGES, default auto, JobData.captionLanguage, ClipResult.transcript', async () => {
  const shared = await read('packages/shared/src/index.ts');
  assert.match(shared, /export const CAPTION_LANGUAGES = \['auto', 'id', 'en'\] as const;/);
  assert.match(shared, /export type CaptionLanguage = \(typeof CAPTION_LANGUAGES\)\[number\];/);
  assert.match(shared, /export const DEFAULT_CAPTION_LANGUAGE: CaptionLanguage = 'auto';/);
  assert.match(shared, /captionLanguage: CaptionLanguage;/);
  assert.match(shared, /transcript\?: string;/);
});

test('schema + migrasi 20260124000000_caption_language', async () => {
  const schema = await read('apps/api/prisma/schema.prisma');
  assert.match(schema, /captionLanguage\s+String\s+@default\("auto"\)/);
  assert.match(schema, /transcript\s+String\?/);

  const migration = await read(
    'apps/api/prisma/migrations/20260124000000_caption_language/migration.sql',
  );
  assert.match(
    migration,
    /ALTER TABLE "jobs" ADD COLUMN "captionLanguage" TEXT NOT NULL DEFAULT 'auto';/,
  );
  assert.match(migration, /ALTER TABLE "clips" ADD COLUMN "transcript" TEXT;/);
});

test('CreateJobDto: captionLanguage opsional, IsIn CAPTION_LANGUAGES, default auto', async () => {
  const dto = await read('apps/api/src/jobs/dto/create-job.dto.ts');
  assert.match(dto, /@IsIn\(CAPTION_LANGUAGES\)\s*\n\s*captionLanguage: CaptionLanguage = DEFAULT_CAPTION_LANGUAGE;/);
});

test('service menyimpan, mengantrekan, dan retry mempertahankan captionLanguage', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  assert.match(service, /const captionLanguage = dto\.captionLanguage \?\? DEFAULT_CAPTION_LANGUAGE;/);
  // Disimpan di Job dan dikirim di JobData.
  assert.equal((service.match(/\n\s+captionLanguage,\n/g) ?? []).length, 2);
  assert.match(service, /dto\.captionLanguage = old\.captionLanguage as CaptionLanguage;/);
  assert.match(service, /captionLanguage: job\.captionLanguage,/);

  const snapshot = await read('apps/api/src/queue/job-events.service.ts');
  assert.match(snapshot, /captionLanguage: string;/);
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  assert.match(listener, /captionLanguage: job\.captionLanguage,/);
  assert.match(listener, /transcript: sanitizeClipTranscript\(clip\.transcript\),/);
});

test('worker membaca captionLanguage (default auto) dan mengirim transcript', async () => {
  const models = await read('worker/clipper/models.py');
  assert.match(models, /CAPTION_LANGUAGES = \("auto", "id", "en"\)/);
  assert.match(models, /DEFAULT_CAPTION_LANGUAGE = "auto"/);
  assert.match(models, /"captionLanguage": self\.caption_language,/);
  assert.match(models, /payload\["transcript"\] = transcript/);

  const pipeline = await read('worker/clipper/pipeline.py');
  assert.match(pipeline, /job\.caption_language,/);
  assert.match(pipeline, /transcript=llm\.clip_transcript\(/);
});
