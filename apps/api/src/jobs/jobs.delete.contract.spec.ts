/**
 * Self-check kontrak DELETE /api/jobs/:id: kepemilikan, sinyal cancel untuk job
 * queued/running, penghapusan file klip yang aman, lalu hard-delete DB (cascade).
 * Jalankan dari apps/api: pnpm test (node --experimental-strip-types).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');

test('endpoint DELETE /api/jobs/:id ada dan mengembalikan 204', async () => {
  const controller = await readFile(
    join(root, 'apps/api/src/jobs/jobs.controller.ts'),
    'utf8',
  );

  assert.match(controller, /@Delete\(':id'\)/);
  assert.match(controller, /@HttpCode\(204\)/);
  assert.match(controller, /await this\.jobs\.remove\(id, user\.id\)/);
});

test('JobsService.remove: cek kepemilikan via findOne(id, userId)', async () => {
  const service = await readFile(
    join(root, 'apps/api/src/jobs/jobs.service.ts'),
    'utf8',
  );

  const body = service.slice(service.indexOf('async remove('));
  assert.ok(body.length > 0, 'method remove tidak ditemukan');
  assert.match(body, /this\.findOne\(id, userId\)/);
});

test('JobsService.remove: batalkan job queued/running lewat cancel key + BullMQ', async () => {
  const service = await readFile(
    join(root, 'apps/api/src/jobs/jobs.service.ts'),
    'utf8',
  );

  const body = service.slice(service.indexOf('async remove('));
  assert.match(body, /cancelKey\(id\)/);
  assert.match(body, /await this\.queue\.getJob\(id\)/);
  assert.match(body, /state === 'waiting'/);
  assert.match(body, /await bullJob\.remove\(\)/);
  // Status terminal tidak perlu sinyal cancel.
  assert.match(body, /job\.status !== JobStatus\.done/);
});

test('JobsService.remove: file klip dihapus lewat safe resolver, ENOENT diabaikan', async () => {
  const service = await readFile(
    join(root, 'apps/api/src/jobs/jobs.service.ts'),
    'utf8',
  );

  const body = service.slice(service.indexOf('async remove('));
  assert.match(body, /resolveClipPath\(this\.config\.clipsDir, clip\.filePath\)/);
  assert.match(body, /await unlink\(target\)/);
  assert.match(body, /code !== 'ENOENT'/);
});

test('JobsService.remove: hard-delete job di DB setelah file dibersihkan', async () => {
  const service = await readFile(
    join(root, 'apps/api/src/jobs/jobs.service.ts'),
    'utf8',
  );

  const body = service.slice(service.indexOf('async remove('));
  assert.match(body, /this\.prisma\.job\.delete\(\{\s*where:\s*\{\s*id\s*\}/);
  // File unlink harus terjadi sebelum delete DB.
  assert.ok(
    body.indexOf('unlink(target)') < body.indexOf('prisma.job.delete'),
    'unlink file harus sebelum delete DB',
  );
});

test('schema.prisma: klip terhapus cascade saat job dihapus', async () => {
  const schema = await readFile(
    join(root, 'apps/api/prisma/schema.prisma'),
    'utf8',
  );
  assert.match(schema, /job\s+Job\s+@relation\([^)]*onDelete:\s*Cascade\)/);
});
