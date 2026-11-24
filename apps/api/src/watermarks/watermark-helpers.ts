/**
 * Helper murni watermark: validasi pengaturan (zod), deteksi tipe lewat magic
 * bytes, dan pembacaan dimensi dari header. Tanpa import Nest/Prisma agar bisa
 * dites langsung dengan `node --experimental-strip-types`.
 */
import { z } from 'zod';

export const WATERMARK_MAX_BYTES = 2 * 1024 * 1024;
export const WATERMARK_MAX_PER_USER = 20;
export const WATERMARK_NAME_MAX = 80;

export const WATERMARK_SCALE_MIN = 0.03;
export const WATERMARK_SCALE_MAX = 0.6;
export const WATERMARK_OPACITY_MIN = 0.1;
export const WATERMARK_OPACITY_MAX = 1;

/** Pengaturan watermark per job / default user. x,y = titik tengah (0..1 dari frame output). */
export const watermarkSettingsSchema = z
  .object({
    watermarkId: z.string().min(1).max(64),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    scale: z.number().finite().min(WATERMARK_SCALE_MIN).max(WATERMARK_SCALE_MAX),
    opacity: z
      .number()
      .finite()
      .min(WATERMARK_OPACITY_MIN)
      .max(WATERMARK_OPACITY_MAX),
  })
  .strict();

export type WatermarkSettings = z.infer<typeof watermarkSettingsSchema>;

/** Pengaturan + snapshot path relatif (disimpan di Job.watermark). */
export type StoredWatermark = WatermarkSettings & { filePath: string };

/** Payload ke worker. */
export interface WatermarkJobPayload {
  filePath: string;
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

/** Mengembalikan pesan galat pertama, atau data valid. */
export function parseWatermarkSettings(
  raw: unknown,
): { ok: true; value: WatermarkSettings } | { ok: false; message: string } {
  const parsed = watermarkSettingsSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue?.path.join('.') || 'watermark';
  return {
    ok: false,
    message: `Pengaturan watermark tidak valid (${field}): ${issue?.message ?? 'format salah'}.`,
  };
}

export type WatermarkMime = 'image/png' | 'image/jpeg' | 'image/webp';

export const WATERMARK_EXT: Record<WatermarkMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Deteksi tipe dari magic bytes; null bila bukan png/jpeg/webp. */
export function sniffImageMime(buf: Buffer): WatermarkMime | null {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export interface ImageSize {
  width: number;
  height: number;
}

/** Baca lebar/tinggi dari header; null bila rusak atau ukuran 0. */
export function readImageSize(buf: Buffer, mime: WatermarkMime): ImageSize | null {
  let size: ImageSize | null = null;
  try {
    if (mime === 'image/png') size = pngSize(buf);
    else if (mime === 'image/jpeg') size = jpegSize(buf);
    else size = webpSize(buf);
  } catch {
    return null;
  }
  if (!size || size.width < 1 || size.height < 1) return null;
  return size;
}

function pngSize(buf: Buffer): ImageSize | null {
  // 8 byte signature + chunk IHDR: length(4) 'IHDR'(4) width(4) height(4)
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf: Buffer): ImageSize | null {
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xff) {
      offset += 1; // padding
      continue;
    }
    // Marker tanpa panjang: SOI, EOI, RSTn, TEM
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > buf.length) return null;
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webpSize(buf: Buffer): ImageSize | null {
  if (buf.length < 30) return null;
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') {
    // frame tag(3) + start code 9d 01 2a + width(2) height(2), 14 bit
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  if (fourcc === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (fourcc === 'VP8X') {
    return {
      width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1,
      height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1,
    };
  }
  return null;
}

/** Nama tampilan: trim, buang karakter kontrol, batasi panjang; kosong -> fallback. */
export function sanitizeWatermarkName(raw: unknown, fallback: string): string {
  const base = typeof raw === 'string' ? raw : '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  const name = (cleaned || fallback).slice(0, WATERMARK_NAME_MAX).trim();
  return name || 'Watermark';
}

export function watermarkUrl(id: string): string {
  return `/api/watermarks/${id}/file`;
}
