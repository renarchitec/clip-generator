import { loadSource } from '../testing/load-source.ts';
/**
 * Kontrak watermark pada job: DTO, kepemilikan, snapshot di DB, payload worker,
 * retry, dan field watermark pada respons/SSE.
 * Jalankan dari apps/api: node --experimental-strip-types src/jobs/jobs.watermark.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ValidationPipe } from '@nestjs/common';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('ValidationPipe accepts legacy settings, layered settings with chroma key, [] and null', async () => {
  const path = 'apps/api/src/jobs/dto/create-job.dto.ts';
  const file = join(root, path);
  const { CreateJobDto } = loadSource<typeof import('./dto/create-job.dto')>(file);

  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const transform = (watermark: unknown) => pipe.transform({
    url: 'https://example.com/video', mode: 'auto', watermark, ignored: true,
  }, { type: 'body', metatype: CreateJobDto });
  const layer = { watermarkId: 'logo', x: 0.25, y: 0.75, scale: 0.2, opacity: 0.6 };
  const keyed = { ...layer, watermarkId: 'video', chromaKey: { enabled: true, color: '#00ff00', similarity: 0.1, blend: 0.2 } };
  for (const watermark of [layer, [layer, keyed], [], null, undefined]) {
    const dto = await transform(watermark);
    assert.ok(dto instanceof CreateJobDto);
    assert.deepEqual(dto.watermark, watermark);
    assert.equal('ignored' in dto, false);
  }
  await assert.rejects(transform(Array(6).fill(layer)), (error: unknown) => {
    assert.ok(error instanceof BadRequestException);
    assert.match(JSON.stringify(error.getResponse()), /maksimal 5/i);
    return true;
  });
});

test('create: validasi kepemilikan lewat WatermarksService dan simpan snapshot di DB', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  assert.match(service, /this\.watermarks\.resolveSettings\(dto\.watermark, userId\)/);
  assert.match(service, /persistedWatermark = serializeWatermarkValue\(storedWatermarks\)/);
  assert.match(service, /watermark: persistedWatermark[\s\S]*?Prisma\.DbNull/);
  const module = await read('apps/api/src/jobs/jobs.module.ts');
  assert.match(module, /WatermarksModule/);
});

test('payload worker mengirim posisi, mimeType, dan chromaKey (tanpa watermarkId)', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  const payload = service.slice(service.indexOf('const toPayload'), service.indexOf("await this.queue.add('clip'"));
  for (const key of ['filePath', 'x', 'y', 'scale', 'opacity', 'mimeType', 'chromaKey']) {
    assert.ok(new RegExp(`${key}: wm\\.${key}`).test(payload), `key ${key} tidak dikirim`);
  }
  assert.doesNotMatch(payload, /watermarkId/);
  assert.match(payload, /storedWatermarks\.map\(toPayload\)/);
  assert.match(payload, /watermark = watermarks\[0\] \?\? null/);
  assert.match(payload, /watermark,\s+watermarks,/);
  // Worker Python membaca key yang sama persis.
  const worker = await read('worker/clipper/models.py');
  assert.match(worker, /"filePath": self\.file_path/);
  assert.match(worker, /"watermark": self\.watermark\.to_dict\(\)/);
});

test('job response & SSE menyertakan watermark; retry membawa watermark lama', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  assert.match(service, /watermark: \(job\.watermark as StoredWatermarkValue \| null\) \?\? null,/);
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  assert.match(listener, /watermark: \(job\.watermark as StoredWatermarkValue \| null\) \?\? null,/);
  const snapshot = await read('apps/api/src/queue/job-events.service.ts');
  assert.match(snapshot, /watermark\?: StoredWatermarkValue \| null;/);
  const retry = service.slice(service.indexOf('async retry('), service.indexOf('async snapshot('));
  const settings = retry.slice(retry.indexOf('dto.watermark'), retry.indexOf('dto.outro'));
  assert.match(retry, /normalizeStoredWatermarks\(old\.watermark\)/);
  assert.match(settings, /serializeWatermarkValue\(oldWatermarks\.map/);
  assert.match(settings, /watermarkId, x, y, scale, opacity, chromaKey/);
  assert.match(settings, /chromaKey !== undefined \? \{ chromaKey \}/);
  assert.doesNotMatch(settings, /filePath|mimeType/);
  assert.match(retry, /return this\.create\(dto, userId(?:, role)?\);/);
});

test('spec watermark terdaftar di script test api', async () => {
  const pkg = JSON.parse(await read('apps/api/package.json'));
  assert.ok(pkg.scripts.test.includes('jobs.watermark.contract.spec.ts'));
  assert.ok(pkg.scripts.test.includes('watermarks.contract.spec.ts'));
});
