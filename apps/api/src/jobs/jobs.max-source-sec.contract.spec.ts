/**
 * Self-check kontrak fitur "batas pemindaian sumber" (maxSourceSec).
 * API (Node) dan worker (Python) harus sepakat soal validasi, persistensi,
 * bentuk data antrean, dan pemotongan cue/momen di batas limit.
 * Jalankan dari apps/api lewat `pnpm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('schema.prisma punya maxSourceSec Int? dan migrasinya ada', async () => {
  const schema = await read('apps/api/prisma/schema.prisma');
  assert.match(schema, /maxSourceSec\s+Int\?/);

  const migration = await read(
    'apps/api/prisma/migrations/20260111000000_add_job_max_source_sec/migration.sql',
  );
  assert.match(migration, /ALTER TABLE "jobs" ADD COLUMN "maxSourceSec" INTEGER;/);
});

test('shared mengekspos batas 60-36000 dan field di JobData & PreviewJobData', async () => {
  const shared = await read('packages/shared/src/index.ts');
  assert.match(shared, /export const MIN_SOURCE_SEC = 60;/);
  assert.match(shared, /export const MAX_SOURCE_SEC = 36000;/);
  assert.equal((shared.match(/maxSourceSec\?: number \| null;/g) ?? []).length, 2);
});

test('CreateJobDto dan CreatePreviewDto memvalidasi maxSourceSec opsional 60-36000', async () => {
  for (const path of [
    'apps/api/src/jobs/dto/create-job.dto.ts',
    'apps/api/src/previews/dto/create-preview.dto.ts',
  ]) {
    const dto = await read(path);
    assert.match(dto, /@IsOptional\(\)\s*\n\s*@IsInt\(\)\s*\n\s*@Min\(MIN_SOURCE_SEC\)\s*\n\s*@Max\(MAX_SOURCE_SEC\)\s*\n\s*maxSourceSec\?: number \| null;/, path);
  }
});

test('service menyimpan maxSourceSec (auto saja), mengirim ke antrean, dan snapshot', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  assert.match(
    service,
    /const maxSourceSec = dto\.mode === 'auto' \? \(dto\.maxSourceSec \?\? null\) : null;/,
  );
  assert.match(service, /targetDurationSec: dto\.targetDurationSec,\s*\n\s*maxSourceSec,/);
  assert.match(service, /maxSourceSec: job\.maxSourceSec \?\? null,/);

  const snapshot = await read('apps/api/src/queue/job-events.service.ts');
  assert.match(snapshot, /maxSourceSec\?: number \| null;/);

  const listener = await read('apps/api/src/queue/queue.listener.ts');
  assert.match(listener, /maxSourceSec: job\.maxSourceSec \?\? null,/);
});

test('preview meneruskan maxSourceSec ke data job antrean', async () => {
  const previews = await read('apps/api/src/previews/previews.service.ts');
  assert.match(previews, /maxSourceSec: dto\.maxSourceSec \?\? null,/);
});

test('worker mem-parse maxSourceSec dengan toleran (invalid -> None)', async () => {
  const models = await read('worker/clipper/models.py');
  assert.match(models, /MIN_SOURCE_SEC = 60/);
  assert.match(models, /MAX_SOURCE_SEC = 36000/);
  assert.match(models, /def to_max_source_sec\(value: Any\) -> Optional\[int\]:/);
  assert.match(models, /return parsed if MIN_SOURCE_SEC <= parsed <= MAX_SOURCE_SEC else None/);
  assert.match(models, /max_source_sec: Optional\[int\] = None/);
  assert.match(models, /"maxSourceSec": self\.max_source_sec,/);
});

test('preview memotong cue di limit sebelum LLM dan mengembalikan cue terbatas', async () => {
  const pipeline = await read('worker/clipper/pipeline.py');
  assert.match(pipeline, /def _cues_within_limit\(/);
  assert.match(pipeline, /max_source_sec = to_max_source_sec\(data\.get\("maxSourceSec"\)\)/);
  assert.match(pipeline, /cues = _cues_within_limit\(cues, max_source_sec\)/);
});

test('job auto mengunduh hanya 0-limit via --download-sections (offset 0)', async () => {
  const pipeline = await read('worker/clipper/pipeline.py');
  assert.match(pipeline, /job\.mode == "auto" and job\.max_source_sec/);
  assert.match(pipeline, /f"\*0\.000-{limit:\.3f}"/);
  assert.match(pipeline, /video = await asyncio\.to_thread\(_ensure_opencv_readable, path\)/);
  // Mode manual tidak memakai limit: rentang sudah eksplisit.
  assert.match(pipeline, /Mode manual mengabaikan maxSourceSec/);
});
