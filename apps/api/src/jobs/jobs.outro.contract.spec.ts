/**
 * Kontrak outro pada job: DTO, kepemilikan, snapshot di DB, payload worker,
 * retry, dan field outro pada respons/SSE.
 * Jalankan dari apps/api: node --experimental-strip-types src/jobs/jobs.outro.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('create-job DTO menerima outro opsional ({ outroId } | null)', async () => {
  const dto = await read('apps/api/src/jobs/dto/create-job.dto.ts');
  assert.match(dto, /outro\?: OutroSettingsDto \| null;/);
  assert.match(dto, /@IsOutroSettings\(\)/);
  assert.match(dto, /outroId\?: string/);
});

test('create: kepemilikan lewat OutrosService dan snapshot di DB', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  assert.match(service, /this\.outros\.resolveSettings\(dto\.outro, userId\)/);
  assert.match(service, /outro: storedOutro[\s\S]*?Prisma\.DbNull/);
});

test('payload worker: outro.filePath + durationSec (tanpa outroId)', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  const payload = service.slice(service.indexOf('const outro: OutroJobPayload'), service.indexOf("await this.queue.add('clip'"));
  for (const key of ['filePath', 'durationSec']) {
    assert.ok(new RegExp(`${key}: storedOutro\\.${key}`).test(payload), `key ${key} tidak dikirim`);
  }
  assert.doesNotMatch(payload, /outroId/);
  assert.match(payload, /outro,\n/);
  const worker = await read('worker/clipper/models.py');
  assert.match(worker, /"filePath": self\.file_path/);
  assert.match(worker, /"outro": self\.outro\.to_dict\(\)/);
});

test('job response & SSE menyertakan outro; retry membawa outro lama', async () => {
  const service = await read('apps/api/src/jobs/jobs.service.ts');
  assert.match(service, /outro: \(job\.outro as StoredOutro \| null\) \?\? null,/);
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  assert.match(listener, /outro: \(job\.outro as StoredOutro \| null\) \?\? null,/);
  const snapshot = await read('apps/api/src/queue/job-events.service.ts');
  assert.match(snapshot, /outro\?: StoredOutro \| null;/);
  const retry = service.slice(service.indexOf('async retry('), service.indexOf('async snapshot('));
  assert.match(retry, /dto\.outro = \(old\.outro as StoredOutro \| null\) \?\? null;/);
});

test('spec outro terdaftar di script test api', async () => {
  const pkg = JSON.parse(await read('apps/api/package.json'));
  assert.ok(pkg.scripts.test.includes('jobs.outro.contract.spec.ts'));
  assert.ok(pkg.scripts.test.includes('outros.contract.spec.ts'));
});
