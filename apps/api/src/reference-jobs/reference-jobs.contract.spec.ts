/**
 * Kontrak Reference Edit: schema/migrasi, konstanta antrean, helper validasi,
 * dan wiring controller/service.
 * Jalankan dari apps/api: node --experimental-strip-types src/reference-jobs/reference-jobs.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REFERENCE_MAX_FILE_BYTES as SHARED_MAX_FILE_BYTES,
  REFERENCE_MAX_FOOTAGE_FILES,
  REFERENCE_QUEUE_NAME,
  REFERENCE_STAGES,
} from '@clipper/shared';
import { OUTRO_EXT, readOutroInfo, sniffOutroMime } from '../outros/outro-helpers.ts';
import {
  REFERENCE_QUEUE_EVENTS,
  REFERENCE_QUEUE_NAME as API_QUEUE_NAME,
} from '../queue/queue.constants.ts';
import {
  normalizeAspectRatio,
  normalizeReframeMode,
  REFERENCE_MAX_DURATION_SEC,
  REFERENCE_MAX_FILE_BYTES,
  REFERENCE_MIN_DURATION_SEC,
  sanitizeReferenceBrief,
  sanitizeReferenceTitle,
} from './reference-helpers.ts';

const root = join(process.cwd(), '../..');
const read = (p: string) => readFile(join(root, p), 'utf8');

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

function tkhdBox(w: number, h: number): Buffer {
  const b = Buffer.alloc(84);
  b.writeUInt32BE(Math.round(w * 65536) & 0xffffffff, 76);
  b.writeUInt32BE(Math.round(h * 65536) & 0xffffffff, 80);
  return box('tkhd', b);
}

function tinyMp4(seconds: number): Buffer {
  const ftyp = box('ftyp', Buffer.from('isom'), Buffer.alloc(4), Buffer.from('isomiso2'));
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(Math.round(seconds * 1000), 16);
  const audio = box('trak', tkhdBox(0, 0));
  return Buffer.concat([
    ftyp,
    box('moov', box('mvhd', mvhd), audio, box('trak', tkhdBox(720, 1280))),
  ]);
}

test('schema, migrasi, dan konstanta reference jobs', async () => {
  const schema = await read('apps/api/prisma/schema.prisma');
  assert.match(schema, /referenceJobs\s+ReferenceJob\[\]/);
  assert.match(schema, /model ReferenceJob \{[\s\S]*@@map\("reference_jobs"\)/);
  for (const field of [
    /footage\s+Json\s+@default\("\[\]"\)/,
    /templateSlots\s+Json\?/,
    /planSlots\s+Json\?/,
    /hashtags\s+String\[\]\s+@default\(\[\]\)/,
    /@@index\(\[userId, createdAt\]\)/,
  ]) {
    assert.match(schema, field);
  }

  const migration = await read(
    'apps/api/prisma/migrations/20260131000000_reference_jobs/migration.sql',
  );
  for (const sql of [
    'CREATE TABLE "reference_jobs"',
    'CREATE INDEX "reference_jobs_userId_createdAt_idx"',
    'REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE',
  ]) {
    assert.ok(migration.includes(sql), sql);
  }

  assert.equal(API_QUEUE_NAME, REFERENCE_QUEUE_NAME);
  assert.equal(REFERENCE_QUEUE_EVENTS, 'REFERENCE_QUEUE_EVENTS');
  assert.equal(REFERENCE_QUEUE_NAME, 'reference-jobs');
  assert.equal(REFERENCE_MAX_FOOTAGE_FILES, 12);
  assert.equal(REFERENCE_MAX_FILE_BYTES, SHARED_MAX_FILE_BYTES);
  assert.equal(REFERENCE_MAX_FILE_BYTES, 100 * 1024 * 1024);
  assert.deepEqual([...REFERENCE_STAGES], [
    'analyze_reference',
    'analyze_footage',
    'plan_edit',
    'render',
    'save',
  ]);
});

test('helper validasi video referensi dan parameter job', () => {
  assert.equal(REFERENCE_MIN_DURATION_SEC, 0.5);
  assert.equal(REFERENCE_MAX_DURATION_SEC, 600);
  assert.equal(OUTRO_EXT['video/mp4'], 'mp4');

  const mp4 = tinyMp4(3);
  assert.equal(sniffOutroMime(mp4), 'video/mp4');
  assert.deepEqual(readOutroInfo(mp4), { durationSec: 3, width: 720, height: 1280 });
  assert.equal(sniffOutroMime(Buffer.alloc(32)), null);
  assert.equal(readOutroInfo(Buffer.alloc(32)), null);
  assert.equal(readOutroInfo(tinyMp4(601))!.durationSec > REFERENCE_MAX_DURATION_SEC, true);

  assert.equal(normalizeAspectRatio(undefined), '9:16');
  assert.equal(normalizeAspectRatio('1:1'), '1:1');
  assert.equal(normalizeAspectRatio('4:3'), null);
  assert.equal(normalizeReframeMode(undefined), 'face_tracking');
  assert.equal(normalizeReframeMode('blurred_fill'), 'blurred_fill');
  assert.equal(normalizeReframeMode('invalid'), null);
  assert.equal(sanitizeReferenceTitle('  Test Title  '), 'Test Title');
  assert.equal(sanitizeReferenceBrief('   '), null);
});

test('wiring controller/service', async () => {
  const controller = await read(
    'apps/api/src/reference-jobs/reference-jobs.controller.ts',
  );
  for (const route of [
    "@Controller('reference-jobs')",
    "@Post('upload')",
    "@Sse(':id/events')",
    "@Get(':id/stream')",
    "@Get(':id/download')",
    "@Post(':id/cancel')",
    '@HttpCode(204)',
  ]) {
    assert.ok(controller.includes(route), route);
  }

  const service = await read('apps/api/src/reference-jobs/reference-jobs.service.ts');
  for (const token of [
    'assertAllowedUrl',
    'reference/uploads/',
    'REFERENCE_MAX_FOOTAGE_FILES',
    'cancelKey(id)',
    'REFERENCE_QUEUE_NAME',
  ]) {
    assert.ok(service.includes(token), token);
  }

  const app = await read('apps/api/src/app.module.ts');
  assert.ok(app.includes('ReferenceJobsModule'));
});
