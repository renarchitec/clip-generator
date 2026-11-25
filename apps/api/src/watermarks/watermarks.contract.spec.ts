/**
 * Kontrak pustaka watermark: migrasi/schema, endpoint owner-scoped, unggahan
 * (magic bytes + batas per tipe + 20/item), default settings, dan helper media.
 * Jalankan dari apps/api: node --experimental-strip-types src/watermarks/watermarks.contract.spec.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseWatermarkSettings,
  readImageSize,
  readWatermarkMediaInfo,
  sniffImageMime,
  sniffWatermarkMime,
  WATERMARK_IMAGE_MAX_BYTES,
  WATERMARK_MAX_BYTES,
  WATERMARK_VIDEO_MAX_BYTES,
  WATERMARK_VIDEO_MAX_DURATION_SEC,
  WATERMARK_VIDEO_MIN_DURATION_SEC,
  watermarkKind,
} from './watermark-helpers.ts';

const root = join(process.cwd(), '../..');
const read = (path: string) => readFile(join(root, path), 'utf8');

test('schema dan migrasi watermark sesuai kontrak', async () => {
  const schema = await read('apps/api/prisma/schema.prisma');
  assert.match(schema, /model Watermark \{[^}]*durationSec\s+Float\?[^}]*@@map\("watermarks"\)/);
  const videoMigration = await read('apps/api/prisma/migrations/20260201000000_video_watermarks/migration.sql');
  assert.equal(videoMigration.trim(), 'ALTER TABLE "watermarks" ADD COLUMN "durationSec" DOUBLE PRECISION;');
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
  assert.equal(sniffWatermarkMime(png), 'image/png');
  assert.deepEqual(readWatermarkMediaInfo(png, 'image/png'), { width: 640, height: 480, durationSec: null });

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
    { ...valid, scale: 1.1 },
    { ...valid, opacity: 0 },
    { ...valid, opacity: 1.2 },
    { ...valid, watermarkId: '' },
    { ...valid, extra: true },
  ]) {
    assert.equal(parseWatermarkSettings(bad).ok, false);
  }
});

test('chroma key is optional, nullable, normalized and strictly validated', () => {
  const valid = { watermarkId: 'abc', x: 0.25, y: 1, scale: 0.03, opacity: 0.1 };
  const key = { enabled: true, color: '#00ff1a', similarity: 0.01, blend: 0 };
  assert.deepEqual(parseWatermarkSettings({ ...valid, chromaKey: null }), { ok: true, value: { ...valid, chromaKey: null } });
  assert.deepEqual(parseWatermarkSettings({ ...valid, chromaKey: key }), {
    ok: true, value: { ...valid, chromaKey: { ...key, color: '#00FF1A' } },
  });
  assert.equal(parseWatermarkSettings({ ...valid, chromaKey: { ...key, enabled: false, similarity: 0.5, blend: 0.5 } }).ok, true);
  for (const bad of [
    { enabled: 'true' }, { color: '#0f0' }, { similarity: 0 }, { similarity: 0.51 },
    { similarity: Infinity }, { blend: -0.001 }, { blend: 0.51 }, { extra: true },
  ]) {
    assert.equal(parseWatermarkSettings({ ...valid, chromaKey: { ...key, ...bad } }).ok, false);
  }
});

function box(type: string, ...payload: Buffer[]): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.reduce((sum, part) => sum + part.length, 0));
  header.write(type, 4);
  return Buffer.concat([header, ...payload]);
}

function movieHeader(version: 0 | 1, durationMs: number): Buffer {
  const mvhd = Buffer.alloc(version === 0 ? 20 : 32);
  mvhd[0] = version;
  mvhd.writeUInt32BE(1000, version === 0 ? 12 : 20);
  if (version === 0) mvhd.writeUInt32BE(durationMs, 16);
  else mvhd.writeBigUInt64BE(BigInt(durationMs), 24);
  const tkhd = Buffer.alloc(version === 0 ? 84 : 96);
  tkhd[0] = version;
  tkhd.writeUInt32BE(320 * 65536, version === 0 ? 76 : 88);
  tkhd.writeUInt32BE(180 * 65536, version === 0 ? 80 : 92);
  return box('moov', box('mvhd', mvhd), box('trak', box('tkhd', tkhd)));
}

test('sniff MP4 and MOV (including extended ftyp and legacy MOV), parse v0/v1 headers', () => {
  const ftyp = box('ftyp', Buffer.from('isom0000'));
  const mp4 = Buffer.concat([ftyp, movieHeader(0, 1250)]);
  const extendedFtyp = Buffer.from('000000016674797000000000000000187174202000000000', 'hex');
  const mov = Buffer.concat([extendedFtyp, movieHeader(1, 30000)]);
  const legacyMov = Buffer.concat([box('wide'), box('mdat'), movieHeader(0, 200)]);
  for (const [buf, mime, durationSec] of [
    [mp4, 'video/mp4', 1.25], [mov, 'video/quicktime', 30], [legacyMov, 'video/quicktime', 0.2],
  ] as const) {
    assert.equal(sniffWatermarkMime(buf), mime);
    assert.deepEqual(readWatermarkMediaInfo(buf, mime), { width: 320, height: 180, durationSec });
    assert.equal(readWatermarkMediaInfo(buf.subarray(0, -1), mime), null);
  }
  assert.equal(sniffWatermarkMime(box('ftyp', Buffer.from('qt  0000'))), 'video/quicktime');
  assert.equal(sniffWatermarkMime(box('ftyp', Buffer.from('isom'))), null);
  assert.equal(sniffWatermarkMime(box('moov', box('mvhd', Buffer.alloc(20)))), null);
  assert.equal(readWatermarkMediaInfo(Buffer.concat([ftyp, movieHeader(0, 0)]), 'video/mp4'), null);
});

function ebml(id: string, ...children: Buffer[]): Buffer {
  const payload = Buffer.concat(children);
  assert.ok(payload.length < 0x7f);
  return Buffer.concat([Buffer.from(id, 'hex'), Buffer.from([0x80 | payload.length]), payload]);
}

test('WebM verifies DocType and reads duration/dimensions in known and unknown-size Segments', () => {
  const header = ebml('1a45dfa3', ebml('4282', Buffer.from('webm')));
  const tracks = ebml('1654ae6b', ebml('ae', ebml('e0', ebml('b0', Buffer.from([1, 64])), ebml('ba', Buffer.from([180])))));
  const duration32 = Buffer.alloc(4);
  duration32.writeFloatBE(1250);
  const duration64 = Buffer.alloc(8);
  duration64.writeDoubleBE(625);
  const scale = ebml('2ad7b1', Buffer.from([0x1e, 0x84, 0x80])); // 2,000,000
  const unknownSegment = Buffer.from('1853806701ffffffffffffff', 'hex');
  const unknownCluster = Buffer.concat([Buffer.from('1f43b675ff', 'hex'), ebml('e7', Buffer.from([0]))]);
  const expected = { width: 320, height: 180, durationSec: 1.25 };
  const sized = Buffer.concat([header, ebml('18538067', ebml('1549a966', ebml('4489', duration32)), tracks)]);
  const streaming = Buffer.concat([header, unknownSegment, unknownCluster, tracks, ebml('1549a966', ebml('4489', duration64), scale)]);
  for (const file of [sized, streaming]) {
    assert.equal(sniffWatermarkMime(file), 'video/webm');
    assert.deepEqual(readWatermarkMediaInfo(file, 'video/webm'), expected);
  }
  const noDuration = Buffer.concat([header, unknownSegment, tracks]);
  assert.deepEqual(readWatermarkMediaInfo(noDuration, 'video/webm'), { ...expected, durationSec: null });
  assert.equal(readWatermarkMediaInfo(noDuration.subarray(0, -1), 'video/webm'), null);
  assert.equal(sniffWatermarkMime(ebml('1a45dfa3', ebml('4282', Buffer.from('matroska')))), null);
  assert.equal(sniffWatermarkMime(ebml('1a45dfa3', ebml('ec', ebml('4282', Buffer.from('webm'))))), null);
});

test('upload applies per-kind byte limits and video duration limits and responds with media metadata', async () => {
  const controller = await read('apps/api/src/watermarks/watermarks.controller.ts');
  assert.match(controller, /limits: \{ fileSize: WATERMARK_VIDEO_MAX_BYTES \+ 1/);
  assert.match(controller, /@UploadedFile\(\) file/);
  const service = await read('apps/api/src/watermarks/watermarks.service.ts');
  assert.match(service, /sniffWatermarkMime\(file\.buffer\)/);
  assert.match(service, /kind === 'video' \? WATERMARK_VIDEO_MAX_BYTES : WATERMARK_IMAGE_MAX_BYTES/);
  assert.match(service, /file\.size > maxBytes/);
  assert.match(service, /info\.durationSec !== null &&\s*\(info\.durationSec < WATERMARK_VIDEO_MIN_DURATION_SEC \|\| info\.durationSec > WATERMARK_VIDEO_MAX_DURATION_SEC\)/);
  assert.match(service, /durationSec: info\.durationSec/);
  assert.match(service, /kind: watermarkKind\(watermark\.mimeType\)/);
  assert.match(service, /durationSec: watermark\.durationSec \?\? null/);
  assert.equal(WATERMARK_IMAGE_MAX_BYTES, WATERMARK_MAX_BYTES);
  assert.equal(WATERMARK_IMAGE_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(WATERMARK_VIDEO_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(WATERMARK_VIDEO_MIN_DURATION_SEC, 0.2);
  assert.equal(WATERMARK_VIDEO_MAX_DURATION_SEC, 30);
  assert.equal(watermarkKind('image/png'), 'image');
  for (const mime of ['video/mp4', 'video/webm', 'video/quicktime']) assert.equal(watermarkKind(mime), 'video');
});

test('stream delegates Range/206 handling to Express sendFile without setting a full-file Content-Length', async () => {
  const service = await read('apps/api/src/watermarks/watermarks.service.ts');
  const stream = service.slice(service.indexOf('async stream('), service.indexOf('async remove('));
  assert.match(stream, /findOwned\(id, userId\)/);
  assert.match(stream, /res\.setHeader\('Content-Type', watermark\.mimeType\)/);
  assert.match(stream, /res\.setHeader\('Accept-Ranges', 'bytes'\)/);
  assert.match(stream, /res\.sendFile\(absolutePath, \{ acceptRanges: true, dotfiles: 'allow' \}/);
  assert.doesNotMatch(stream, /Content-Length|createReadStream/);
});

test('modul watermark terdaftar di AppModule', async () => {
  const app = await read('apps/api/src/app.module.ts');
  assert.match(app, /WatermarksModule/);
});
