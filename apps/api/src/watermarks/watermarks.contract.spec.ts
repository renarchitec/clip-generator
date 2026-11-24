/**
 * Kontrak pustaka watermark: migrasi/schema, endpoint owner-scoped, unggahan
 * (magic bytes + 2 MB + 20/item), default settings, dan helper gambar.
 * Jalankan dari apps/api: node --experimental-strip-types src/watermarks/watermarks.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseWatermarkSettings,
  readImageSize,
  sniffImageMime,
  WATERMARK_MAX_BYTES,
} from './watermark-helpers.ts';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('schema dan migrasi watermark sesuai kontrak', async () => {
  const schema = await read('apps/api/prisma/schema.prisma');
  assert.match(schema, /model Watermark \{[\s\S]*@@map\("watermarks"\)/);
  assert.match(schema, /userId\s+String[\s\S]*?onDelete: Cascade/);
  assert.match(schema, /@@index\(\[userId\]\)/);
  assert.match(schema, /watermarkDefault\s+Json\?/);
  assert.match(schema, /watermark\s+Json\?/);

  const migration = await read('apps/api/prisma/migrations/20260126000000_watermarks/migration.sql');
  for (const expected of [
    'CREATE TABLE "watermarks"',
    'ALTER TABLE "users" ADD COLUMN "watermarkDefault" JSONB;',
    'ALTER TABLE "jobs" ADD COLUMN "watermark" JSONB;',
    'CREATE INDEX "watermarks_userId_idx"',
    'ON DELETE CASCADE',
  ]) {
    assert.ok(migration.includes(expected), `migrasi belum memuat ${expected}`);
  }
});

test('endpoint watermarks terdaftar, owner-scoped, dan default tidak tertangkap :id', async () => {
  const controller = await read('apps/api/src/watermarks/watermarks.controller.ts');
  assert.match(controller, /@Controller\('watermarks'\)/);
  assert.match(controller, /@Post\(\)/);
  assert.match(controller, /FileInterceptor\('file'/);
  assert.match(controller, /@Get\('default'\)/);
  assert.match(controller, /@Put\('default'\)/);
  assert.match(controller, /@Get\(':id\/file'\)/);
  assert.match(controller, /@Delete\(':id'\)/);
  assert.match(controller, /@CurrentUser\(\) user: \{ id: string \}/);

  const service = await read('apps/api/src/watermarks/watermarks.service.ts');
  assert.match(service, /findFirst\(\{ where: \{ id, userId \} \}\)/);
  assert.match(service, /orderBy: \{ createdAt: 'desc' \}/);
  assert.match(service, /Cache-Control/);
  assert.match(service, /private/);
  assert.match(service, /watermark\.count\(\{ where: \{ userId \} \}\)/);
});

test('hapus watermark mengosongkan default bila sama, tapi tidak menyentuh job', async () => {
  const service = await read('apps/api/src/watermarks/watermarks.service.ts');
  const body = service.slice(service.indexOf('async remove('), service.indexOf('async getDefault('));
  assert.match(body, /watermarkDefault/);
  assert.match(body, /watermarkId === watermark\.id/);
  assert.match(body, /Prisma\.DbNull/);
  assert.match(body, /unlink/);
  assert.doesNotMatch(body, /job\.update|job\.delete/);
});

test('magic bytes menolak file bukan png/jpeg/webp', () => {
  assert.equal(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])), 'image/png');
  assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImageMime(Buffer.from('RIFF0000WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImageMime(Buffer.from('hello world image?')), null);
  assert.equal(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null);
});

test('dimensi dibaca dari header PNG, JPEG, dan WebP', () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.write('IHDR', 12);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  assert.deepEqual(readImageSize(png, 'image/png'), { width: 640, height: 480 });

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 1, 0xc2, 2, 0x58]);
  assert.deepEqual(readImageSize(jpeg, 'image/jpeg'), { width: 600, height: 450 });

  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0);
  webp.write('WEBP', 8);
  webp.write('VP8 ', 12);
  webp[23] = 0x9d; webp[24] = 0x01; webp[25] = 0x2a;
  webp.writeUInt16LE(320, 26);
  webp.writeUInt16LE(180, 28);
  assert.deepEqual(readImageSize(webp, 'image/webp'), { width: 320, height: 180 });
  assert.equal(readImageSize(Buffer.alloc(8), 'image/png'), null);
});

test('zod menerima settings valid dan menolak nilai di luar rentang', () => {
  const valid = { watermarkId: 'abc', x: 0.25, y: 1, scale: 0.03, opacity: 0.1 };
  assert.deepEqual(parseWatermarkSettings(valid), { ok: true, value: valid });
  for (const bad of [
    { ...valid, x: 1.5 },
    { ...valid, y: -0.1 },
    { ...valid, scale: 0.02 },
    { ...valid, scale: 0.7 },
    { ...valid, opacity: 0 },
    { ...valid, opacity: 1.2 },
    { ...valid, watermarkId: '' },
    { ...valid, extra: true },
  ]) {
    assert.equal(parseWatermarkSettings(bad).ok, false);
  }
});

test('batas 2 MB ditegakkan di interceptor dan service', async () => {
  const controller = await read('apps/api/src/watermarks/watermarks.controller.ts');
  assert.match(controller, /limits: \{ fileSize: WATERMARK_MAX_BYTES \+ 1/);
  assert.match(controller, /@UploadedFile\(\) file/);
  const service = await read('apps/api/src/watermarks/watermarks.service.ts');
  assert.match(service, /file\.size > WATERMARK_MAX_BYTES/);
  assert.equal(WATERMARK_MAX_BYTES, 2 * 1024 * 1024);
});

test('modul watermark terdaftar di AppModule', async () => {
  const app = await read('apps/api/src/app.module.ts');
  assert.match(app, /WatermarksModule/);
});
