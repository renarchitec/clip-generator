/**
 * Kontrak enhance brief: rute, DTO, antrean captions, dan 503 brief_unavailable.
 * Jalankan: node --experimental-strip-types src/briefs/briefs.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('shared BriefJobData dan BriefJobResult', async () => {
  const shared = await read('packages/shared/src/index.ts');
  assert.match(shared, /export interface BriefJobData \{\s*brief: string;\s*\}/);
  assert.match(shared, /export interface BriefJobResult \{\s*brief: string;\s*\}/);
});

test('rute POST briefs/expand terautentikasi dengan DTO validasi panjang', async () => {
  const controller = await read('apps/api/src/briefs/briefs.controller.ts');
  assert.match(controller, /@Controller\('briefs'\)/);
  assert.match(controller, /@Post\('expand'\)\s*\n\s*@HttpCode\(200\)/);
  assert.match(controller, /@Body\(\) dto: ExpandBriefDto/);
  assert.match(controller, /@CurrentUser\(\)/);
  const dto = await read('apps/api/src/briefs/dto/expand-brief.dto.ts');
  assert.match(dto, /@IsString\(\)/);
  assert.match(dto, /@Length\(2, 500\)/);
});

test('service mengantre job brief ke captions queue, tunggu 60s, 503 saat gagal', async () => {
  const service = await read('apps/api/src/briefs/briefs.service.ts');
  assert.match(service, /this\.queue\.add\('brief', \{ brief \}/);
  assert.match(service, /removeOnComplete: true,/);
  assert.match(service, /removeOnFail: true,/);
  assert.match(service, /waitUntilFinished\(this\.events, CAPTION_WAIT_TIMEOUT_MS\)/);
  assert.match(service, /new ServiceUnavailableException\(\{ message: 'brief_unavailable' \}\)/);
  const module = await read('apps/api/src/briefs/briefs.module.ts');
  assert.match(module, /BullModule\.registerQueue\(\{ name: CAPTION_QUEUE_NAME \}\)/);
  assert.match(module, /new QueueEvents\(CAPTION_QUEUE_NAME/);
  const app = await read('apps/api/src/app.module.ts');
  assert.match(app, /BriefsModule/);
});

test('worker menangani job brief dan memanggil expand_brief', async () => {
  const worker = await read('worker/clipper/worker.py');
  assert.match(worker, /getattr\(job, "name", None\) == "brief"/);
  assert.match(worker, /llm\.expand_brief/);
  assert.match(worker, /result = \{"brief": brief\}/);
  const llm = await read('worker/clipper/llm.py');
  assert.match(llm, /def expand_brief\(/);
});
