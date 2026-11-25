/**
 * Kontrak watermark pada job: DTO, kepemilikan, snapshot di DB, payload worker,
 * retry, dan field watermark pada respons/SSE.
 * Jalankan dari apps/api: node --experimental-strip-types src/jobs/jobs.watermark.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('create-job DTO menerima watermark opsional (settings|null)', async () => {
  const dto = await read('apps/api/src/jobs/dto/create-job.dto.ts');
  assert.match(dto, /watermark\?: WatermarkSettingsDto \| null;/);
  assert.match(dto, /@IsWatermarkSettings\(\)/);
  assert.match(dto, /watermarkId\?: string/);
  assert.match(dto, /chromaKey\?: WatermarkChromaKey \| null;/);
  assert.match(dto, /value === null \|\| parseWatermarkSettings\(value\)\.ok/);
});

test('create: validasi kepemilikan lewat WatermarksService dan simpan snapshot di DB', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  assert.match(service, /this\.watermarks\.resolveSettings\(dto\.watermark, userId\)/);
  assert.match(service, /watermark: storedWatermark[\s\S]*?Prisma\.DbNull/);
  const module = await read('apps/api/src/jobs/jobs.module.ts');
  assert.match(module, /WatermarksModule/);
});

test('payload worker mengirim posisi, mimeType, dan chromaKey (tanpa watermarkId)', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  const payload = service.slice(service.indexOf('const watermark: WatermarkJobPayload'), service.indexOf("await this.queue.add('clip'"));
  for (const key of ['filePath', 'x', 'y', 'scale', 'opacity']) {
    assert.ok(new RegExp(`${key}: storedWatermark\\.${key}`).test(payload), `key ${key} tidak dikirim`);
  }
  assert.match(payload, /storedWatermark\.mimeType !== undefined \? \{ mimeType: storedWatermark\.mimeType \}/);
  assert.match(payload, /storedWatermark\.chromaKey !== undefined \? \{ chromaKey: storedWatermark\.chromaKey \}/);
  assert.doesNotMatch(payload, /watermarkId/);
  assert.match(payload, /watermark,\n/);
  // Worker Python membaca key yang sama persis.
  const worker = await read('worker/clipper/models.py');
  assert.match(worker, /"filePath": self\.file_path/);
  assert.match(worker, /"watermark": self\.watermark\.to_dict\(\)/);
});

test('job response & SSE menyertakan watermark; retry membawa watermark lama', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  assert.match(service, /watermark: \(job\.watermark as StoredWatermark \| null\) \?\? null,/);
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  assert.match(listener, /watermark: \(job\.watermark as StoredWatermark \| null\) \?\? null,/);
  const snapshot = await read('apps/api/src/queue/job-events.service.ts');
  assert.match(snapshot, /watermark\?: StoredWatermark \| null;/);
  const retry = service.slice(service.indexOf('async retry('), service.indexOf('async snapshot('));
  const settings = retry.slice(retry.indexOf('dto.watermark'), retry.indexOf('dto.outro'));
  assert.match(settings, /watermarkId: oldWatermark\.watermarkId/);
  assert.match(settings, /chromaKey: oldWatermark\.chromaKey/);
  assert.doesNotMatch(settings, /filePath|mimeType/);
  assert.match(retry, /return this\.create\(dto, userId\);/);
  const watermarks = await read('apps/api/src/watermarks/watermarks.service.ts');
  assert.match(watermarks, /return \{ \.\.\.parsed\.value, filePath: watermark\.filePath, mimeType: watermark\.mimeType \}/);
});

test('spec watermark terdaftar di script test api', async () => {
  const pkg = JSON.parse(await read('apps/api/package.json'));
  assert.ok(pkg.scripts.test.includes('jobs.watermark.contract.spec.ts'));
  assert.ok(pkg.scripts.test.includes('watermarks.contract.spec.ts'));
});
