import { Injectable, NotFoundException } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'express';
import type { Clip } from '@prisma/client';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

interface ResolvedClip {
  clip: Clip;
  absolutePath: string;
  size: number;
  mimeType: string;
}

@Injectable()
export class ClipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async stream(
    id: string,
    rangeHeader: string | undefined,
    res: Response,
    userId: string,
  ): Promise<void> {
    const { absolutePath, size, mimeType } = await this.resolve(id, userId);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mimeType);

    if (!rangeHeader) {
      res.setHeader('Content-Length', size);
      this.send(absolutePath, res);
      return;
    }

    const range = parseRange(rangeHeader, size);

    if (range === 'invalid') {
      res.setHeader('Content-Range', `bytes */${size}`);
      res.status(416).end();
      return;
    }

    if (!range) {
      // Range yang tidak didukung (mis. multi-range) diabaikan; kirim file utuh.
      res.setHeader('Content-Length', size);
      this.send(absolutePath, res);
      return;
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader('Content-Length', range.end - range.start + 1);
    this.send(absolutePath, res, range.start, range.end);
  }

  async download(id: string, res: Response, userId: string): Promise<void> {
    const { clip, absolutePath, size, mimeType } = await this.resolve(
      id,
      userId,
    );

    if (!clip.downloadedAt) {
      await this.prisma.clip.updateMany({
        where: { id, downloadedAt: null },
        data: { downloadedAt: new Date() },
      });
    }

    const filename = buildFilename(clip);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    this.send(absolutePath, res);
  }

  private send(
    absolutePath: string,
    res: Response,
    start?: number,
    end?: number,
  ): void {
    const file = createReadStream(
      absolutePath,
      start === undefined ? undefined : { start, end },
    );

    res.on('close', () => file.destroy());
    file.on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.destroy();
    });
    file.pipe(res);
  }

  /** Path selalu dibentuk dari id database, lalu diverifikasi tetap di dalam CLIPS_DIR. */
  private async resolve(id: string, userId: string): Promise<ResolvedClip> {
    const clip = await this.prisma.clip.findFirst({
      where: { id, job: { userId } },
    });
    if (!clip || clip.deletedAt) {
      throw new NotFoundException(`Clip ${id} tidak ditemukan.`);
    }

    const base = path.resolve(this.config.clipsDir);
    const absolutePath = path.resolve(base, clip.filePath);

    if (absolutePath !== base && !absolutePath.startsWith(base + path.sep)) {
      throw new NotFoundException(`Clip ${id} tidak ditemukan.`);
    }

    let size: number;
    try {
      const stats = await stat(absolutePath);
      if (!stats.isFile()) throw new Error('not a file');
      size = stats.size;
    } catch {
      throw new NotFoundException(`File clip ${id} tidak tersedia.`);
    }

    return {
      clip,
      absolutePath,
      size,
      mimeType: MIME_BY_EXT[path.extname(absolutePath).toLowerCase()] ?? 'application/octet-stream',
    };
  }
}

interface ByteRange {
  start: number;
  end: number;
}

/** `bytes=0-99`, `bytes=100-`, `bytes=-500`. Range ganda diabaikan (null). */
export function parseRange(header: string, size: number): ByteRange | 'invalid' | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return 'invalid';

  let start: number;
  let end: number;

  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (start >= size || start > end) return 'invalid';

  return { start, end };
}

/** Nama file dari judul clip; semua karakter di luar ASCII aman diganti '-'. */
function buildFilename(clip: Clip): string {
  const ext = path.extname(clip.filePath).toLowerCase() || '.mp4';
  const base = clip.title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-. ]+|[-. ]+$/g, '')
    .slice(0, 80);

  return `${base || clip.id}${ext}`;
}
