/**
 * Helper murni outro: validasi default (zod), deteksi MP4/MOV lewat magic `ftyp`,
 * dan pembacaan durasi/dimensi dari box ISO-BMFF. Image API tidak punya ffmpeg,
 * jadi semuanya diparse langsung dari buffer. Tanpa import Nest/Prisma agar bisa
 * dites dengan `node --experimental-strip-types`.
 */
import { z } from 'zod';

export const OUTRO_MAX_BYTES = 50 * 1024 * 1024;
export const OUTRO_MAX_PER_USER = 20;
export const OUTRO_NAME_MAX = 80;
export const OUTRO_MIN_DURATION_SEC = 0.5;
export const OUTRO_MAX_DURATION_SEC = 20;

/** Default outro pengguna: { outroId }. */
export const outroSettingsSchema = z
  .object({ outroId: z.string().min(1).max(64) })
  .strict();

export type OutroSettings = z.infer<typeof outroSettingsSchema>;

/** Snapshot di Job.outro. */
export interface StoredOutro extends OutroSettings {
  filePath: string;
  durationSec: number;
}

/** Payload ke worker (tanpa outroId). */
export interface OutroJobPayload {
  filePath: string;
  durationSec: number;
}

export function parseOutroSettings(
  raw: unknown,
): { ok: true; value: OutroSettings } | { ok: false; message: string } {
  const parsed = outroSettingsSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue?.path.join('.') || 'outro';
  return {
    ok: false,
    message: `Pengaturan outro tidak valid (${field}): ${issue?.message ?? 'format salah'}.`,
  };
}

export type OutroMime = 'video/mp4' | 'video/quicktime';

export const OUTRO_EXT: Record<OutroMime, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/** MP4/MOV: box pertama harus `ftyp`. 'qt  ' = QuickTime (mov), selain itu mp4. */
export function sniffOutroMime(buf: Buffer): OutroMime | null {
  if (buf.length < 16) return null;
  if (buf.toString('ascii', 4, 8) !== 'ftyp') return null;
  const size = buf.readUInt32BE(0);
  if (size < 16 && size !== 1) return null;
  return buf.toString('ascii', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
}

export interface OutroInfo {
  durationSec: number;
  width: number;
  height: number;
}

interface Box {
  type: string;
  start: number; // awal payload
  end: number; // akhir box
}

/** Iterasi box anak pada [start, end). Berhenti diam-diam di data rusak. */
function* boxes(buf: Buffer, start: number, end: number): Generator<Box> {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      const big = buf.readBigUInt64BE(offset + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) return;
    yield { type, start: offset + header, end: offset + size };
    offset += size;
  }
}

function findChild(buf: Buffer, parent: Box, type: string): Box | null {
  for (const box of boxes(buf, parent.start, parent.end)) {
    if (box.type === type) return box;
  }
  return null;
}

/**
 * Baca durasi (mvhd v0/v1) dan lebar/tinggi trak video (tkhd, 16.16 fixed)
 * dari buffer MP4/MOV. null bila tidak bisa diparse atau tidak ada trak video.
 */
export function readOutroInfo(buf: Buffer): OutroInfo | null {
  try {
    const top: Box = { type: 'root', start: 0, end: buf.length };
    const moov = findChild(buf, top, 'moov');
    if (!moov) return null;

    const mvhd = findChild(buf, moov, 'mvhd');
    if (!mvhd) return null;
    const version = buf[mvhd.start];
    let timescale: number;
    let duration: number;
    if (version === 1) {
      if (mvhd.end - mvhd.start < 32) return null;
      timescale = buf.readUInt32BE(mvhd.start + 20);
      const big = buf.readBigUInt64BE(mvhd.start + 24);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      duration = Number(big);
    } else if (version === 0) {
      if (mvhd.end - mvhd.start < 20) return null;
      timescale = buf.readUInt32BE(mvhd.start + 12);
      duration = buf.readUInt32BE(mvhd.start + 16);
    } else {
      return null;
    }
    if (timescale < 1) return null;
    const durationSec = duration / timescale;
    if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

    for (const trak of boxes(buf, moov.start, moov.end)) {
      if (trak.type !== 'trak') continue;
      const tkhd = findChild(buf, trak, 'tkhd');
      if (!tkhd) continue;
      const tv = buf[tkhd.start];
      if (tv !== 0 && tv !== 1) continue;
      // v0: width di +76; v1 (creation/modification/duration 64-bit): +88.
      const wOff = tkhd.start + (tv === 1 ? 88 : 76);
      if (wOff + 8 > tkhd.end) continue;
      const width = Math.round(buf.readUInt32BE(wOff) / 65536);
      const height = Math.round(buf.readUInt32BE(wOff + 4) / 65536);
      if (width >= 1 && height >= 1) return { durationSec, width, height };
    }
    return null;
  } catch {
    return null;
  }
}

/** Nama tampilan: trim, buang karakter kontrol, batasi panjang; kosong -> fallback. */
export function sanitizeOutroName(raw: unknown, fallback: string): string {
  const base = typeof raw === 'string' ? raw : '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  const name = (cleaned || fallback).slice(0, OUTRO_NAME_MAX).trim();
  return name || 'Outro';
}
