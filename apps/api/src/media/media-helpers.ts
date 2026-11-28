import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, realpath, rename, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const IMAGE_FORMATS = {
  'image/png': { ext: 'png', demuxer: 'png_pipe', codec: 'png' },
  'image/jpeg': { ext: 'jpg', demuxer: 'jpeg_pipe', codec: 'mjpeg' },
  'image/webp': { ext: 'webp', demuxer: 'webp_pipe', codec: 'webp' },
} as const;

type ImageMime = keyof typeof IMAGE_FORMATS;
export const MEDIA_EXT = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'image/png': IMAGE_FORMATS['image/png'].ext,
  'image/jpeg': IMAGE_FORMATS['image/jpeg'].ext,
  'image/webp': IMAGE_FORMATS['image/webp'].ext,
} as const;

const VIDEO_DEMUXERS = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm';
const MEDIA_COMMAND_OPTIONS = { timeout: 15_000, killSignal: 'SIGKILL' as const, maxBuffer: 64 * 1024 };
type MediaMime = keyof typeof MEDIA_EXT;

export function isImageMime(mimeType: string): mimeType is ImageMime {
  return Object.hasOwn(IMAGE_FORMATS, mimeType);
}

export async function sniffImageMime(filePath: string): Promise<ImageMime | undefined> {
  const file = await open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(12), 0, 12, 0);
    if (bytesRead >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
    if (bytesRead >= 3 && buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
    if (bytesRead === 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8) === 'WEBP') return 'image/webp';
  } finally {
    await file.close();
  }
}

export async function probeImage(filePath: string, mimeType: ImageMime) {
  const { demuxer, codec } = IMAGE_FORMATS[mimeType];
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file', '-f', demuxer, '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height', '-of', 'json', filePath,
  ], MEDIA_COMMAND_OPTIONS);
  const { streams } = JSON.parse(stdout) as { streams?: { codec_name: string; width: number; height: number }[] };
  const stream = streams?.[0];
  if (!stream || stream.codec_name !== codec || !validDimension(stream.width) || !validDimension(stream.height) ||
      stream.width * stream.height > 40_000_000) return null;
  // Confirm that the file decodes, not just that it contains a valid header.
  await execFileAsync('ffmpeg', [
    '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file', '-f', demuxer,
    '-threads', '1', '-i', filePath, '-frames:v', '1', '-f', 'null', '-',
  ], MEDIA_COMMAND_OPTIONS);
  return { mimeType, width: stream.width, height: stream.height, durationSec: 0 };
}

function validDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 16_384;
}

export async function resolveExistingMediaFile(rootDir: string, relativePath: string): Promise<string | null> {
  if (path.isAbsolute(relativePath) || /[\\:\0]/.test(relativePath) || relativePath.split('/').includes('..')) return null;
  try {
    const [root, absolute] = await Promise.all([realpath(rootDir), realpath(path.join(rootDir, relativePath))]);
    const fromRoot = path.relative(root, absolute);
    if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot) ||
        !(await stat(absolute)).isFile()) return null;
    return absolute;
  } catch {
    return null;
  }
}

export async function ensureMediaDirectory(rootDir: string, mode: number, ...components: string[]): Promise<string> {
  if (components.some((part) => !/^[a-z0-9_.-]+$/i.test(part) || part === '.' || part === '..')) {
    throw new Error('Invalid media directory');
  }
  await mkdir(rootDir, { recursive: true });
  let directory = await realpath(rootDir);
  for (const part of components) {
    directory = path.join(directory, part);
    await mkdir(directory, { mode }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const entry = await lstat(directory);
    if (!entry.isDirectory()) throw new Error('Invalid media directory');
    // mkdir applies the API's umask; shared staging needs an explicit sticky mode.
    if (mode === 0o1777 && (entry.mode & 0o7777) !== mode) await chmod(directory, mode);
  }
  return directory;
}

export async function captureLocalFrame(input: string, output: string, atSec: number): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-nostdin', '-v', 'error', '-xerror', '-n', '-protocol_whitelist', 'file', '-format_whitelist', VIDEO_DEMUXERS,
    '-ss', atSec.toFixed(6), '-i', input, '-map', '0:V:0', '-frames:v', '1',
    '-q:v', '2', '-update', '1', output,
  ], MEDIA_COMMAND_OPTIONS);
}

export interface UploadedMedia {
  originalname: string;
  path: string;
  size: number;
}

export async function probeMedia(filePath: string) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist',
    VIDEO_DEMUXERS, '-select_streams', 'V:0',
    '-show_entries', 'stream=width,height,duration:format=format_name,duration:format_tags=major_brand',
    '-of', 'json', filePath,
  ], MEDIA_COMMAND_OPTIONS);
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
