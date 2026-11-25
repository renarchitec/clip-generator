/**
 * Helper murni watermark: validasi pengaturan (zod), deteksi tipe lewat magic
 * bytes, dan pembacaan dimensi dari header. Tanpa import Nest/Prisma agar bisa
 * dites langsung dengan `node --experimental-strip-types`.
 */
import { z } from 'zod';

export const WATERMARK_MAX_BYTES = 2 * 1024 * 1024;
export const WATERMARK_IMAGE_MAX_BYTES = WATERMARK_MAX_BYTES;
export const WATERMARK_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const WATERMARK_VIDEO_MIN_DURATION_SEC = 0.2;
export const WATERMARK_VIDEO_MAX_DURATION_SEC = 30;
export const WATERMARK_CHROMA_SIMILARITY_MIN = 0.01;
export const WATERMARK_CHROMA_SIMILARITY_MAX = 0.5;
export const WATERMARK_CHROMA_BLEND_MIN = 0;
export const WATERMARK_CHROMA_BLEND_MAX = 0.5;
export const WATERMARK_MAX_PER_USER = 20;
export const WATERMARK_MAX_PER_JOB = 5;
export const WATERMARK_NAME_MAX = 80;

export const WATERMARK_SCALE_MIN = 0.03;
export const WATERMARK_SCALE_MAX = 1;
export const WATERMARK_OPACITY_MIN = 0.1;
export const WATERMARK_OPACITY_MAX = 1;

export const watermarkChromaKeySchema = z
  .object({
    enabled: z.boolean(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((c) => c.toUpperCase()),
    similarity: z.number().finite().min(WATERMARK_CHROMA_SIMILARITY_MIN).max(WATERMARK_CHROMA_SIMILARITY_MAX),
    blend: z.number().finite().min(WATERMARK_CHROMA_BLEND_MIN).max(WATERMARK_CHROMA_BLEND_MAX),
  })
  .strict();

export type WatermarkChromaKey = z.infer<typeof watermarkChromaKeySchema>;

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
    chromaKey: watermarkChromaKeySchema.nullable().optional(),
  })
  .strict();

export type WatermarkSettings = z.infer<typeof watermarkSettingsSchema>;
export type WatermarkDefaultValue = WatermarkSettings | WatermarkSettings[];
export const watermarkListSchema = z.array(watermarkSettingsSchema).max(WATERMARK_MAX_PER_JOB);

/** Pengaturan + snapshot path relatif (disimpan di Job.watermark). */
export type StoredWatermark = WatermarkSettings & { filePath: string; mimeType?: string };
export type StoredWatermarkValue = StoredWatermark | StoredWatermark[];

/** Payload ke worker. */
export interface WatermarkJobPayload {
  filePath: string;
  mimeType?: string;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  chromaKey?: WatermarkChromaKey | null;
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

/** Validasi satu objek lama atau beberapa layer dalam urutan yang diberikan. */
export function parseWatermarkList(
  raw: unknown,
): { ok: true; value: WatermarkSettings[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) {
    const parsed = parseWatermarkSettings(raw);
    return parsed.ok ? { ok: true, value: [parsed.value] } : parsed;
  }
  const parsed = watermarkListSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  if (issue?.code === 'too_big' && issue.path.length === 0) {
    return { ok: false, message: `Maksimal ${WATERMARK_MAX_PER_JOB} layer watermark.` };
  }
  const [index, ...path] = issue?.path ?? [];
  const field = [...path, ...(issue?.code === 'unrecognized_keys' ? [issue.keys[0]] : [])].join('.');
  const location = `watermark${index === undefined ? '' : `[${index}]`}${field ? `.${field}` : ''}`;
  return {
    ok: false,
    message: `Pengaturan watermark tidak valid (${location}): ${issue?.message ?? 'format salah'}.`,
  };
}

export function serializeWatermarkValue<T>(items: T[]): T | T[] | null {
  if (items.length === 0) return null;
  return items.length === 1 ? items[0] : items;
}

export function normalizeStoredWatermarks(raw: unknown): StoredWatermark[] {
  const isStoredWatermark = (item: unknown): item is StoredWatermark =>
    !!item && typeof item === 'object' && !Array.isArray(item) &&
    'watermarkId' in item && typeof item.watermarkId === 'string' &&
    'filePath' in item && typeof item.filePath === 'string';

  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(isStoredWatermark).slice(0, WATERMARK_MAX_PER_JOB);
  return isStoredWatermark(raw) ? [raw] : [];
}

export type WatermarkImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
export type WatermarkVideoMime = 'video/mp4' | 'video/webm' | 'video/quicktime';
export type WatermarkMime = WatermarkImageMime | WatermarkVideoMime;
export type WatermarkKind = 'image' | 'video';

export function isVideoWatermarkMime(mime: string): mime is WatermarkVideoMime {
  return mime === 'video/mp4' || mime === 'video/webm' || mime === 'video/quicktime';
}

export function watermarkKind(mime: string): WatermarkKind {
  return isVideoWatermarkMime(mime) ? 'video' : 'image';
}

export const WATERMARK_EXT: Record<WatermarkMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

/** Deteksi tipe dari magic bytes; null bila bukan png/jpeg/webp. */
export function sniffImageMime(buf: Buffer): WatermarkImageMime | null {
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

export function sniffWatermarkMime(buf: Buffer): WatermarkMime | null {
  const image = sniffImageMime(buf);
  if (image) return image;

  if (buf.length >= 8 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const first = isoBoxes(buf, 0, buf.length).next().value;
    if (!first || buf.readUInt32BE(0) === 0 || first.end - first.start < 8) return null;
    return buf.toString('latin1', first.start, first.start + 4) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  if (buf.length >= 8 && ['wide', 'moov', 'free', 'mdat'].includes(buf.toString('latin1', 4, 8))) {
    return readIsoMediaInfo(buf) ? 'video/quicktime' : null;
  }

  if (buf.length >= 4 && buf.readUInt32BE(0) === EBML_HEADER) {
    const header = readEbmlElement(buf, 0, buf.length);
    if (!header || header.unknownSize) return null;
    for (const field of ebmlElements(buf, header.start, header.end)) {
      if (field.id === 0x4282) {
        return !field.unknownSize && field.end - field.start === 4 &&
          buf.toString('latin1', field.start, field.end) === 'webm' ? 'video/webm' : null;
      }
    }
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
    else if (mime === 'image/webp') size = webpSize(buf);
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

export interface WatermarkMediaInfo extends ImageSize {
  durationSec: number | null;
}

export function readWatermarkMediaInfo(buf: Buffer, mime: WatermarkMime): WatermarkMediaInfo | null {
  if (mime === 'video/webm') return readWebmMediaInfo(buf);
  if (isVideoWatermarkMime(mime)) return readIsoMediaInfo(buf);
  const size = readImageSize(buf, mime);
  return size ? { ...size, durationSec: null } : null;
}

interface IsoBox {
  type: string;
  start: number;
  end: number;
}

function* isoBoxes(buf: Buffer, start: number, end: number): Generator<IsoBox, void> {
  for (let offset = start; offset + 8 <= end;) {
    let size = buf.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      header = 16;
      if (offset + header > end) return;
      const extendedSize = buf.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(end - offset)) return;
      size = Number(extendedSize);
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || size > end - offset) return;
    yield { type: buf.toString('latin1', offset + 4, offset + 8), start: offset + header, end: offset + size };
    offset += size;
  }
}

function findIsoBox(buf: Buffer, start: number, end: number, type: string): IsoBox | undefined {
  for (const box of isoBoxes(buf, start, end)) if (box.type === type) return box;
  return undefined;
}

/** Durasi mvhd dan dimensi fixed-point 16.16 tkhd (versi 0/1), seperti outro. */
function readIsoMediaInfo(buf: Buffer): WatermarkMediaInfo | null {
  const moov = findIsoBox(buf, 0, buf.length, 'moov');
  if (!moov) return null;
  const mvhd = findIsoBox(buf, moov.start, moov.end, 'mvhd');
  if (!mvhd || mvhd.start >= mvhd.end) return null;

  const version = buf[mvhd.start];
  let timescale: number;
  let duration: number;
  if (version === 0 && mvhd.end - mvhd.start >= 20) {
    timescale = buf.readUInt32BE(mvhd.start + 12);
    duration = buf.readUInt32BE(mvhd.start + 16);
  } else if (version === 1 && mvhd.end - mvhd.start >= 32) {
    timescale = buf.readUInt32BE(mvhd.start + 20);
    const extendedDuration = buf.readBigUInt64BE(mvhd.start + 24);
    if (extendedDuration > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    duration = Number(extendedDuration);
  } else {
    return null;
  }
  if (timescale === 0 || duration === 0) return null;

  for (const trak of isoBoxes(buf, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const tkhd = findIsoBox(buf, trak.start, trak.end, 'tkhd');
    if (!tkhd || tkhd.start >= tkhd.end) continue;
    const trackVersion = buf[tkhd.start];
    if (trackVersion !== 0 && trackVersion !== 1) continue;
    const widthOffset = tkhd.start + (trackVersion === 1 ? 88 : 76);
    if (widthOffset + 8 > tkhd.end) continue;
    const width = Math.round(buf.readUInt32BE(widthOffset) / 65536);
    const height = Math.round(buf.readUInt32BE(widthOffset + 4) / 65536);
    if (width >= 1 && height >= 1) return { width, height, durationSec: duration / timescale };
  }
  return null;
}

const EBML_HEADER = 0x1a45dfa3;
const WEBM_SEGMENT = 0x18538067;
const WEBM_INFO = 0x1549a966;
const WEBM_TRACKS = 0x1654ae6b;
const WEBM_CLUSTER = 0x1f43b675;
const WEBM_SEGMENT_CHILD_IDS = new Set([
  WEBM_INFO, WEBM_TRACKS, WEBM_CLUSTER, 0x114d9b74, // SeekHead
  0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367, // Cues, Attachments, Chapters, Tags
]);

interface EbmlElement {
  id: number;
  start: number;
  end: number;
  unknownSize: boolean;
}

function vintWidth(firstByte: number, maxWidth: number): number {
  for (let width = 1; width <= maxWidth; width += 1) {
    if ((firstByte & (0x80 >> (width - 1))) !== 0) return width;
  }
  return 0;
}

function readEbmlElement(buf: Buffer, offset: number, limit: number): EbmlElement | null {
  if (offset >= limit) return null;
  const idWidth = vintWidth(buf[offset], 4);
  const sizeOffset = offset + idWidth;
  if (idWidth === 0 || sizeOffset >= limit) return null;
  const id = buf.readUIntBE(offset, idWidth);
  const sizeWidth = vintWidth(buf[sizeOffset], 8);
  const start = sizeOffset + sizeWidth;
  if (sizeWidth === 0 || start > limit) return null;
  const mask = (0x80 >> (sizeWidth - 1)) - 1;
  let size = buf[sizeOffset] & mask;
  let unknownSize = size === mask;
  for (let i = sizeOffset + 1; i < start; i += 1) {
    size = size * 256 + buf[i];
    unknownSize = unknownSize && buf[i] === 0xff;
  }
  if (!unknownSize && size > limit - start) return null;
  return { id, start, end: unknownSize ? limit : start + size, unknownSize };
}

function* ebmlElements(buf: Buffer, start: number, end: number): Generator<EbmlElement, void> {
  for (let offset = start; offset < end;) {
    const element = readEbmlElement(buf, offset, end);
    if (!element) return;
    yield element;
    offset = element.end;
  }
}

function readEbmlUInt(buf: Buffer, element: EbmlElement): number {
  if (element.unknownSize || element.end - element.start > 8) return NaN;
  let value = 0;
  for (let i = element.start; i < element.end; i += 1) value = value * 256 + buf[i];
  return Number.isSafeInteger(value) ? value : NaN;
}

function readWebmInfoDuration(buf: Buffer, info: EbmlElement): number | null {
  let timecodeScale = 1_000_000;
  let duration: number | null = null;
  for (const field of ebmlElements(buf, info.start, info.end)) {
    if (field.id === 0x2ad7b1) timecodeScale = readEbmlUInt(buf, field);
    if (field.id === 0x4489) {
      const size = field.end - field.start;
      duration = field.unknownSize ? NaN : size === 4 ? buf.readFloatBE(field.start) : size === 8 ? buf.readDoubleBE(field.start) : NaN;
    }
  }
  if (!Number.isFinite(timecodeScale) || timecodeScale < 1) return NaN;
  return duration === null ? null : duration * timecodeScale / 1e9;
}

function readWebmVideoSize(buf: Buffer, tracks: EbmlElement): ImageSize | null {
  for (const entry of ebmlElements(buf, tracks.start, tracks.end)) {
    if (entry.id !== 0xae || entry.unknownSize) continue;
    for (const video of ebmlElements(buf, entry.start, entry.end)) {
      if (video.id !== 0xe0 || video.unknownSize) continue;
      let width = 0;
      let height = 0;
      for (const field of ebmlElements(buf, video.start, video.end)) {
        if (field.id === 0xb0) width = readEbmlUInt(buf, field);
        if (field.id === 0xba) height = readEbmlUInt(buf, field);
      }
      // Prisma stores these as signed 32-bit Ints.
      if (width >= 1 && width <= 0x7fffffff && height >= 1 && height <= 0x7fffffff) return { width, height };
    }
  }
  return null;
}

function readWebmMediaInfo(buf: Buffer): WatermarkMediaInfo | null {
  if (sniffWatermarkMime(buf) !== 'video/webm') return null;
  for (const segment of ebmlElements(buf, 0, buf.length)) {
    if (segment.id !== WEBM_SEGMENT) continue;
    let durationSec: number | null = null;
    let dimensions: ImageSize | null = null;
    let inUnknownCluster = false;
    for (let offset = segment.start; offset < segment.end;) {
      const element = readEbmlElement(buf, offset, segment.end);
      if (!element) return null;
      if (element.id === EBML_HEADER || element.id === WEBM_SEGMENT) break;
      if (inUnknownCluster && !WEBM_SEGMENT_CHILD_IDS.has(element.id)) {
        if (element.unknownSize) return null;
        offset = element.end;
        continue;
      }
      inUnknownCluster = element.id === WEBM_CLUSTER && element.unknownSize;
      if (inUnknownCluster) {
        // The cluster ends at the next Segment child, not necessarily at EOF.
        offset = element.start;
        continue;
      }
      if (element.unknownSize) return null;
      if (element.id === WEBM_INFO) {
        durationSec = readWebmInfoDuration(buf, element);
        if (durationSec !== null && !Number.isFinite(durationSec)) return null;
      }
      if (element.id === WEBM_TRACKS) dimensions = readWebmVideoSize(buf, element);
      offset = element.end;
    }
    return dimensions ? { ...dimensions, durationSec } : null;
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
