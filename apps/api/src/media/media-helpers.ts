import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, open, rename, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MEDIA_EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' } as const;

type MediaMime = keyof typeof MEDIA_EXT;

export interface UploadedMedia {
  originalname: string;
  path: string;
  size: number;
}

export async function probeMedia(filePath: string) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist',
    'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm', '-select_streams', 'V:0',
    '-show_entries', 'stream=width,height,duration:format=format_name,duration:format_tags=major_brand',
    '-of', 'json', filePath,
  ], { timeout: 15_000, maxBuffer: 64 * 1024 });
  const { format, streams } = JSON.parse(stdout) as {
    format?: { format_name?: string; duration?: string; tags?: { major_brand?: string } };
    streams?: { width?: number; height?: number; duration?: string }[];
  };
  const formats = (format?.format_name ?? '').split(',');
  const brand = format?.tags?.major_brand;
  let mimeType: MediaMime | undefined;
  if (formats.includes('mov')) {
    if (!brand || brand === 'qt  ') mimeType = 'video/quicktime';
    else if (!/^(3g|mj2)/i.test(brand)) mimeType = 'video/mp4';
  } else if (formats.includes('webm')) {
    // ffprobe reports both Matroska and WebM under the same demuxer. Check the EBML DocType.
    const file = await open(filePath, 'r');
    try {
      const { buffer, bytesRead } = await file.read(Buffer.alloc(4096), 0, 4096, 0);
      if (buffer.subarray(0, bytesRead).includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]))) {
        mimeType = 'video/webm';
      }
    } finally {
      await file.close();
    }
  }
  const { width, height, duration } = streams?.[0] ?? {};
  const durationSec = Number(format?.duration) || Number(duration);
  if (!mimeType || width === undefined || height === undefined ||
      !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      !Number.isFinite(durationSec) || durationSec <= 0) return null;
  return { mimeType, width, height, durationSec };
}

export async function moveUpload(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(source, target, constants.COPYFILE_EXCL);
    // Source is unlinked by the caller's finally, including when copy fails.
  }
}
