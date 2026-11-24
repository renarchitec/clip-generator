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

test('onCompleted upsert per filePath: tidak duplikat, tanpa membangkitkan clip terhapus', async () => {
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  const completed = listener.slice(
    listener.indexOf('private async onCompleted'),
    listener.indexOf('private async saveProgressClip'),
  );

  // Clip yang sudah ada (termasuk yang dibuat dari progress) dicocokkan per path.
  assert.match(
    completed,
    /clips: \{ select: \{ id: true, filePath: true, deletedAt: true \} \}/,
  );
  assert.match(completed, /new Map\(/);
  assert.match(completed, /byFilePath\.get\(clip\.filePath\)/);
  assert.match(completed, /tx\.clip\.create\(/);
  assert.match(completed, /byFilePath\.set\(/);
  assert.match(completed, /tx\.clip\.update\(/);
  assert.match(completed, /if \(found\.deletedAt\) continue;/);
  assert.doesNotMatch(completed, /createMany/);
  // Metadata akhir worker (caption/hashtag/transkrip) menimpa nilai dari progress.
  assert.match(completed, /caption: clip\.caption,/);
  assert.match(completed, /hashtags: clip\.hashtags,/);
  assert.match(completed, /transcript: clip\.transcript,/);
  // Update bersyarat: job done/failed/cancelled tidak ditimpa.
  assert.match(
    completed,
    /where: \{ id: jobId, status: \{ in: \[JobStatus\.queued, JobStatus\.running\] \} \}/,
  );
});

test('progress clip disimpan sebelum emit, dan job batal tetap diabaikan', async () => {
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  const progress = listener.slice(
    listener.indexOf('private async onProgress'),
    listener.indexOf('private async onCompleted'),
  );
  assert.match(listener, /if \(await this\.isCancelled\(jobId\)\) return;/);
  assert.match(progress, /if \(progress\.clip\) await this\.saveProgressClip\(jobId, progress\.clip\);/);
  assert.ok(
    progress.indexOf('saveProgressClip(jobId, progress.clip)') <
      progress.indexOf('await this.emit(jobId)'),
  );
});

test('clip progress diverifikasi seperti hasil job, path diamankan, dan idempoten per path', async () => {
  const listener = await read('apps/api/src/queue/queue.listener.ts');
  const shared = await read('packages/shared/src/index.ts');
  assert.match(shared, /clip\?: ClipResult;/);
  assert.match(listener, /const clip = parseClipResult\(candidate\.clip\);/);
  assert.match(listener, /function parseClipResult\(value: unknown\): ClipResult \| null/);
  assert.match(listener, /const valid = clips\.flatMap\(\(clip\) => \{/);
  assert.match(listener, /where: \{ jobId, filePath \},/);
  assert.match(listener, /tx\.clip\.findFirst/);
  assert.match(listener, /normalized\.includes\('\.\.'\)/);
  assert.match(listener, /sanitizeClipTranscript\(clip\.transcript\)/);
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
