/**
 * Kontrak pustaka outro: migrasi/schema, endpoint owner-scoped, unggahan
 * (ftyp + 50 MB + 20/user + durasi 0.5-20 s), parser MP4 murni TypeScript, default.
 * Jalankan dari apps/api: node --experimental-strip-types src/outros/outros.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  OUTRO_MAX_BYTES,
  parseOutroSettings,
  readOutroInfo,
  sniffOutroMime,
} from './outro-helpers.ts';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

function mvhd(version: 0 | 1, timescale: number, duration: number): Buffer {
  const body = Buffer.alloc(version === 1 ? 108 : 100);
  body[0] = version;
  if (version === 1) {
    body.writeUInt32BE(timescale, 20);
    body.writeBigUInt64BE(BigInt(duration), 24);
  } else {
    body.writeUInt32BE(timescale, 12);
    body.writeUInt32BE(duration, 16);
  }
  return box('mvhd', body);
}

function tkhd(version: 0 | 1, width: number, height: number): Buffer {
  const body = Buffer.alloc(version === 1 ? 96 : 84);
  body[0] = version;
  const off = version === 1 ? 88 : 76;
  body.writeUInt32BE(width * 65536, off);
  body.writeUInt32BE(height * 65536, off + 4);
  return box('tkhd', body);
}

/** MP4 minimal: ftyp + moov(mvhd + trak audio (0x0) + trak video). */
export function tinyMp4(opts: { version?: 0 | 1; seconds?: number; w?: number; h?: number } = {}): Buffer {
  const { version = 0, seconds = 3, w = 320, h = 180 } = opts;
  const ftyp = box('ftyp', Buffer.from('isom'), Buffer.alloc(4), Buffer.from('isomiso2'));
  const audio = box('trak', tkhd(version, 0, 0));
  const video = box('trak', tkhd(version, w, h));
  const moov = box('moov', mvhd(version, 1000, Math.round(seconds * 1000)), audio, video);
  return Buffer.concat([ftyp, moov, box('mdat', Buffer.alloc(16))]);
}

test('schema dan migrasi outro sesuai kontrak', async () => {
  const schema = await read('apps/api/prisma/schema.prisma');
  assert.match(schema, /model Outro \{[\s\S]*@@map\("outros"\)/);
  assert.match(schema, /durationSec\s+Float/);
  assert.match(schema, /sizeBytes\s+Int/);
  assert.match(schema, /userId\s+String[\s\S]*?onDelete: Cascade/);
  assert.match(schema, /outroDefault\s+Json\?/);
  assert.match(schema, /\boutro\s+Json\?/);

  const migration = await read('apps/api/prisma/migrations/20260127000000_outros/migration.sql');
  for (const expected of [
    'CREATE TABLE "outros"',
    'ALTER TABLE "users" ADD COLUMN "outroDefault" JSONB;',
    'ALTER TABLE "jobs" ADD COLUMN "outro" JSONB;',
    '"durationSec" DOUBLE PRECISION NOT NULL',
    'CREATE INDEX "outros_userId_idx"',
    'ON DELETE CASCADE',
  ]) {
    assert.ok(migration.includes(expected), `migrasi belum memuat ${expected}`);
  }
});

test('endpoint outros terdaftar, owner-scoped, default tidak tertangkap :id', async () => {
  const controller = await read('apps/api/src/outros/outros.controller.ts');
  assert.match(controller, /@Controller\('outros'\)/);
  assert.match(controller, /@Post\(\)/);
  assert.match(controller, /FileInterceptor\('file'/);
  assert.match(controller, /@Get\('default'\)/);
  assert.match(controller, /@Put\('default'\)/);
  assert.match(controller, /@Get\(':id\/file'\)/);
  assert.match(controller, /@Delete\(':id'\)/);
  assert.match(controller, /@HttpCode\(204\)/);
  assert.match(controller, /@CurrentUser\(\) user: \{ id: string \}/);
  assert.ok(
    controller.indexOf("@Get('default')") < controller.indexOf("@Get(':id/file')"),
    'default harus didaftarkan sebelum :id',
  );

  const service = await read('apps/api/src/outros/outros.service.ts');
  assert.match(service, /findFirst\(\{ where: \{ id, userId \} \}\)/);
  assert.match(service, /orderBy: \{ createdAt: 'desc' \}/);
  assert.match(service, /outro\.count\(\{ where: \{ userId \} \}\)/);
  assert.match(service, /res\.sendFile\(/);
  assert.match(service, /acceptRanges: true/);
});

test('respons outro tidak membocorkan filePath', async () => {
  const service = await read('apps/api/src/outros/outros.service.ts');
  const body = service.slice(service.indexOf('private toResponse('));
  assert.doesNotMatch(body, /filePath/);
  for (const key of ['id', 'name', 'mimeType', 'durationSec', 'width', 'height', 'sizeBytes', 'createdAt']) {
    assert.match(body, new RegExp(`\\b${key}\\b`));
  }
});

test('hapus outro mengosongkan default bila sama dan menghapus file', async () => {
  const service = await read('apps/api/src/outros/outros.service.ts');
  const body = service.slice(service.indexOf('async remove('), service.indexOf('async getDefault('));
  assert.match(body, /outroDefault/);
  assert.match(body, /outroId === outro\.id/);
  assert.match(body, /Prisma\.DbNull/);
  assert.match(body, /unlink/);
  assert.doesNotMatch(body, /job\.update|job\.delete/);
});

test('ftyp: hanya MP4/MOV yang diterima', () => {
  assert.equal(sniffOutroMime(tinyMp4()), 'video/mp4');
  const mov = tinyMp4();
  mov.write('qt  ', 8, 'latin1');
  assert.equal(sniffOutroMime(mov), 'video/quicktime');
  assert.equal(sniffOutroMime(Buffer.from('RIFF....AVI LIST0000')), null);
  assert.equal(sniffOutroMime(Buffer.from('hello world, definitely not a video')), null);
  assert.equal(sniffOutroMime(Buffer.alloc(4)), null);
});

test('mvhd v0 dan v1 + tkhd video dibaca (trak audio dilewati)', () => {
  assert.deepEqual(readOutroInfo(tinyMp4({ version: 0, seconds: 3, w: 320, h: 180 })), {
    durationSec: 3,
    width: 320,
    height: 180,
  });
  assert.deepEqual(readOutroInfo(tinyMp4({ version: 1, seconds: 7.5, w: 1080, h: 1920 })), {
    durationSec: 7.5,
    width: 1080,
    height: 1920,
  });
});

test('file rusak/tanpa moov/tanpa trak video ditolak (null)', () => {
  const good = tinyMp4();
  assert.equal(readOutroInfo(good.subarray(0, 40)), null); // terpotong
  assert.equal(readOutroInfo(Buffer.concat([box('ftyp', Buffer.from('isom'), Buffer.alloc(4)), box('mdat', Buffer.alloc(8))])), null);
  const noVideo = Buffer.concat([
    box('ftyp', Buffer.from('isom'), Buffer.alloc(4)),
    box('moov', mvhd(0, 1000, 3000), box('trak', tkhd(0, 0, 0))),
  ]);
  assert.equal(readOutroInfo(noVideo), null);
  const zeroTimescale = Buffer.concat([
    box('ftyp', Buffer.from('isom'), Buffer.alloc(4)),
    box('moov', mvhd(0, 0, 3000), box('trak', tkhd(0, 320, 180))),
  ]);
  assert.equal(readOutroInfo(zeroTimescale), null);
  assert.equal(readOutroInfo(Buffer.alloc(0)), null);
});

test('zod default outro: { outroId } saja', () => {
  assert.deepEqual(parseOutroSettings({ outroId: 'abc' }), { ok: true, value: { outroId: 'abc' } });
  for (const bad of [{}, { outroId: '' }, { outroId: 1 }, { outroId: 'a', extra: 1 }, 'x', [], undefined]) {
    assert.equal(parseOutroSettings(bad).ok, false);
  }
});

test('batas 50 MB, 20/user, dan durasi 0.5-20 s ditegakkan', async () => {
  assert.equal(OUTRO_MAX_BYTES, 50 * 1024 * 1024);
  const controller = await read('apps/api/src/outros/outros.controller.ts');
  assert.match(controller, /limits: \{ fileSize: OUTRO_MAX_BYTES \+ 1/);
  const service = await read('apps/api/src/outros/outros.service.ts');
  assert.match(service, /file\.size > OUTRO_MAX_BYTES/);
  assert.match(service, /OUTRO_MAX_PER_USER/);
  assert.match(service, /OUTRO_MIN_DURATION_SEC/);
  assert.match(service, /OUTRO_MAX_DURATION_SEC/);
  const helpers = await read('apps/api/src/outros/outro-helpers.ts');
  assert.match(helpers, /OUTRO_MAX_PER_USER = 20/);
  assert.match(helpers, /OUTRO_MIN_DURATION_SEC = 0\.5/);
  assert.match(helpers, /OUTRO_MAX_DURATION_SEC = 20/);
});

test('modul outro terdaftar di AppModule dan JobsModule', async () => {
  assert.match(await read('apps/api/src/app.module.ts'), /OutrosModule/);
  assert.match(await read('apps/api/src/jobs/jobs.module.ts'), /OutrosModule/);
});
