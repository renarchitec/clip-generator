/**
 * Self-check kontrak fitur "tinjau momen sebelum memotong":
 * API (Node) dan worker (Python) harus sepakat soal antrean, bentuk data,
 * dan batas retensi. Jalankan dari apps/api lewat `pnpm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('nama antrean preview sama di shared, API, dan worker', async () => {
  const shared = await read('packages/shared/src/index.ts');
  assert.match(shared, /export const PREVIEW_QUEUE_NAME = 'previews';/);

  const constants = await read('apps/api/src/queue/queue.constants.ts');
  assert.match(constants, /export const PREVIEW_QUEUE_NAME = 'previews';/);

  const models = await read('worker/clipper/models.py');
  assert.match(models, /PREVIEW_QUEUE_NAME = "previews"/);
});

test('CreatePreviewDto memakai default dan batas kontrak web', async () => {
  const dto = await read('apps/api/src/previews/dto/create-preview.dto.ts');
  assert.match(dto, /clipCount: number = 5;/);
  assert.match(dto, /targetDurationSec: number = 45;/);
  assert.match(dto, /@Max\(10\)/);
  assert.match(dto, /@Max\(180\)/);
});

test('preview menyimpan userId di data job dan kedaluwarsa setelah 1 jam', async () => {
  const service = await read('apps/api/src/previews/previews.service.ts');
  assert.match(service, /const PREVIEW_TTL_SECONDS = 3600;/);
  assert.match(service, /removeOnComplete: \{ age: PREVIEW_TTL_SECONDS \}/);
  assert.match(service, /removeOnFail: \{ age: PREVIEW_TTL_SECONDS \}/);
  assert.match(service, /userId,/);
  assert.match(service, /data\?\.userId !== userId/);
  // Validasi URL allowlist dipakai ulang dari job.
  assert.match(service, /from '\.\.\/jobs\/validation'/);
  assert.match(service, /assertAllowedUrl\(dto\.url\)/);
});

test('endpoint preview ada di controller berautentikasi', async () => {
  const controller = await read('apps/api/src/previews/previews.controller.ts');
  assert.match(controller, /@Controller\('previews'\)/);
  assert.match(controller, /@Post\(\)/);
  assert.match(controller, /@Get\(':id'\)/);
  assert.match(controller, /@CurrentUser\(\)/);
  assert.doesNotMatch(controller, /@Public\(\)/);
});

test('worker punya consumer preview sendiri dengan concurrency 2', async () => {
  const worker = await read('worker/clipper/worker.py');
  assert.match(worker, /PREVIEW_QUEUE_NAME = models\.PREVIEW_QUEUE_NAME/);
  assert.match(worker, /PREVIEW_CONCURRENCY = 2/);
  assert.match(worker, /pipeline\.run_preview/);
  // Render tetap concurrency 1.
  assert.match(worker, /CONCURRENCY = 1/);
});

test('preview hanya subtitle + LLM lalu mengembalikan kandidat dan cue', async () => {
  const pipeline = await read('worker/clipper/pipeline.py');
  assert.match(pipeline, /_fetch_subtitles/);
  assert.match(pipeline, /NO_SUBTITLE_ERROR/);
  assert.match(pipeline, /llm\.select_moments/);
  assert.match(pipeline, /"candidates": \[moment\.to_dict\(\) for moment in moments\]/);
  assert.match(pipeline, /"cues": \[/);
  // Tanpa unduh video: tidak memanggil download() di jalur preview.
  const previewBody = pipeline.slice(pipeline.indexOf('async def run_preview'));
  assert.doesNotMatch(previewBody, /await download\(/);
});
