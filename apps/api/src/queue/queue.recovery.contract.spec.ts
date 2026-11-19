/**
 * Self-check kontrak fitur "pemulihan status job basi" (stale job recovery).
 * Event BullMQ completed/failed bisa hilang saat Redis/worker restart; API
 * harus bisa merekonsiliasi status DB tiap 60 detik tanpa menduplikasi clip
 * dan tanpa menyentuh job done/cancelled.
 * Jalankan dari apps/api lewat `pnpm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('recovery berjalan saat init dan tiap 60 detik, dihentikan saat shutdown', async () => {
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  assert.match(listener, /const RECOVERY_INTERVAL_MS = 60_000;/);
  assert.match(listener, /const STALE_JOB_MAX_AGE_MS = 3_600_000;/);
  assert.match(listener, /void this\.recoverStaleJobs\(\)/);
  assert.match(listener, /setInterval\(/);
  assert.match(listener, /this\.recoveryTimer\.unref\?\.\(\)/);
  assert.match(listener, /if \(this\.recoveryTimer\) clearInterval\(this\.recoveryTimer\);/);
});

test('recovery mencari job queued/running lalu menyesuaikan dengan state BullMQ', async () => {
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  assert.match(
    listener,
    /where: \{ status: \{ in: \[JobStatus\.queued, JobStatus\.running\] \} \}/,
  );
  assert.match(listener, /const bullJob = await this\.queue\.getJob\(job\.id\);/);
  assert.match(listener, /state === 'completed'/);
  assert.match(listener, /await this\.onCompleted\(job\.id, bullJob\.returnvalue\);/);
  assert.match(listener, /state === 'failed'/);
  assert.match(listener, /await this\.onFailed\(\s*\n\s*job\.id,\s*\n\s*bullJob\.failedReason \|\| 'Job gagal tanpa alasan yang dilaporkan\.',\s*\n\s*\);/);
});

test('job yang hilang dari antrean dan lebih tua dari 1 jam ditandai gagal', async () => {
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  assert.match(
    listener,
    /Date\.now\(\) - job\.createdAt\.getTime\(\) > STALE_JOB_MAX_AGE_MS/,
  );
  assert.match(
    listener,
    /'Job hilang dari antrean \(worker\/redis restart\)\. Jalankan ulang\.'/,
  );
});

test('onCompleted idempoten: tanpa duplikasi clip dan tanpa menyentuh job final', async () => {
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  // Clip hanya dibuat bila job belum punya clip sama sekali.
  assert.match(listener, /clips: \{ select: \{ id: true \}, take: 1 \}/);
  assert.match(listener, /if \(clips\.length > 0 && existing\.clips\.length === 0\)/);
  // Update bersyarat: job done/failed/cancelled tidak ditimpa.
  assert.match(
    listener,
    /where: \{ id: jobId, status: \{ in: \[JobStatus\.queued, JobStatus\.running\] \} \}/,
  );
});

test('fail hanya mengubah job yang masih queued/running (cancelled tidak disentuh)', async () => {
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  const failBody = listener.slice(listener.indexOf('private async fail'));
  assert.match(
    failBody,
    /where: \{ id: jobId, status: \{ in: \[JobStatus\.queued, JobStatus\.running\] \} \}/,
  );
});

test('kedua spec masuk skrip test api', async () => {
  const pkg = await read('apps/api/package.json');
  assert.match(pkg, /jobs\.max-source-sec\.contract\.spec\.ts/);
  assert.match(pkg, /queue\.recovery\.contract\.spec\.ts/);
});
