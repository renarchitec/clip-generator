/**
 * Self-check kontrak POST /api/jobs/:id/retry: kepemilikan (404 non-pemilik),
 * hanya job failed/cancelled (400 selain itu), dan job baru dibuat lewat jalur
 * create yang sama (validasi/normalisasi/payload antrean tidak diduplikasi).
 * Jalankan dari apps/api: pnpm test (node --experimental-strip-types).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');

test('endpoint POST /api/jobs/:id/retry ada di controller', async () => {
  const controller = await readFile(
    join(root, 'apps/api/src/jobs/jobs.controller.ts'),
    'utf8',
  );

  assert.match(controller, /@Post\(':id\/retry'\)/);
  assert.match(controller, /this\.jobs\.retry\(id, user\.id(?:, user\.role)?\)/);
});

test('retry: cek kepemilikan via findOne(id, userId)', async () => {
  const service = await readFile(
    join(root, 'apps/api/src/jobs/jobs.service.ts'),
    'utf8',
  );

  const body = service.slice(service.indexOf('async retry('));
  assert.ok(body.length > 0, 'method retry tidak ditemukan');
  assert.match(body, /this\.findOne\(id, userId\)/);
});

test('retry: hanya job failed/cancelled, selain itu 400', async () => {
  const service = await readFile(
    join(root, 'apps/api/src/jobs/jobs.service.ts'),
    'utf8',
  );

  const body = service.slice(service.indexOf('async retry('));
  assert.match(body, /JobStatus\.failed/);
  assert.match(body, /JobStatus\.cancelled/);
  assert.match(body, /BadRequestException/);
});

test('retry: konfigurasi lama disalin lengkap ke DTO create', async () => {
  const service = await readFile(
    join(root, 'apps/api/src/jobs/jobs.service.ts'),
    'utf8',
  );

  const body = service.slice(service.indexOf('async retry('));
  for (const field of [
    'url',
    'mode',
    'clipCount',
    'targetDurationSec',
    'reframe',
    'captions',
    'twoSpeakers',
    'aspectRatio',
    'description',
    'ranges',
    'maxSourceSec',
  ]) {
    assert.ok(
      new RegExp(`dto\\.${field}\\s*=`).test(body),
      `field ${field} tidak disalin ke DTO`,
    );
  }
});

test('retry: job baru dibuat lewat this.create (tanpa duplikasi payload antrean)', async () => {
  const service = await readFile(
    join(root, 'apps/api/src/jobs/jobs.service.ts'),
    'utf8',
  );

  const body = service.slice(service.indexOf('async retry('));
  assert.match(body, /return this\.create\(dto, userId(?:, role)?\)/);
  // Job lama tidak diubah: di dalam retry tidak boleh ada prisma.job.update.
  const retryOnly = body.slice(0, body.indexOf('async snapshot('));
  assert.doesNotMatch(retryOnly, /prisma\.job\.update/);
});

test('spec retry terdaftar di script test api', async () => {
  const pkg = JSON.parse(
    await readFile(join(root, 'apps/api/package.json'), 'utf8'),
  );
  assert.ok(
    pkg.scripts.test.includes('jobs.retry.contract.spec.ts'),
    'jobs.retry.contract.spec.ts belum ada di script test',
  );
});
