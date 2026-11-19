/**
 * Self-check kontrak pembatalan lintas API (Node) dan worker (Python).
 * Jalankan dari apps/api: pnpm test  (node --experimental-strip-types).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cancelKey } from '../queue/queue.constants.ts';

// Skrip dijalankan dari apps/api (lihat script "test").
const root = join(process.cwd(), '../..');

test('kunci Redis pembatalan sama persis antara API dan worker', async () => {
  const workerModels = await readFile(join(root, 'worker/clipper/models.py'), 'utf8');
  const match = workerModels.match(/CANCEL_KEY = "([^"]+)"/);
  assert.ok(match, 'CANCEL_KEY tidak ditemukan di worker/clipper/models.py');
  assert.equal(cancelKey('job-123'), match[1].replace('{}', 'job-123'));
});

test('status cancelled ada di semua sumber kontrak', async () => {
  const shared = await readFile(join(root, 'packages/shared/src/index.ts'), 'utf8');
  const schema = await readFile(join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  assert.ok(/'cancelled'/.test(shared), 'JobStatus shared belum punya cancelled');
  assert.ok(/\bcancelled\b/.test(schema), 'schema.prisma belum punya cancelled');

  const migration = await readFile(
    join(root, 'apps/api/prisma/migrations/20260102000000_add_job_cancelled/migration.sql'),
    'utf8',
  );
  assert.ok(migration.includes("ADD VALUE IF NOT EXISTS 'cancelled'"));
});

test('pipeline worker menghentikan job di batas tahap saat dibatalkan', async () => {
  const pipelineSrc = await readFile(join(root, 'worker/clipper/pipeline.py'), 'utf8');
  const workerSrc = await readFile(join(root, 'worker/clipper/worker.py'), 'utf8');

  assert.ok(pipelineSrc.includes('JobCancelled'), 'JobCancelled belum ada');
  assert.ok(
    (pipelineSrc.match(/_check_cancel\(should_cancel\)/g) ?? []).length >= 4,
    'cek pembatalan harus ada di setiap batas tahap',
  );
  assert.ok(pipelineSrc.includes('should_cancel=None'), 'run_job harus menerima should_cancel opsional');
  assert.ok(workerSrc.includes('pipeline.JobCancelled'));
  assert.ok(workerSrc.includes('CANCEL_KEY.format'));
});
