import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Public } from '../auth/public.decorator';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveClipPath } from './clip-path';
import { derivePublicMediaKey, verifyPublicMediaSignature } from './public-media';
import { parseRange } from './clips.service';

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
};

/**
 * Media klip untuk konsumen eksternal (Instagram). Tidak butuh sesi, tetapi
 * hanya bisa diakses lewat URL bertanda tangan yang kedaluwarsa 30 menit.
 */
@Controller('public/clips')
export class PublicMediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get(':id/media')
  async media(
    @Param('id') id: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.config.socialTokenKey) {
      throw new ServiceUnavailableException('not_configured');
    }
    if (
      !verifyPublicMediaSignature({
        clipId: id,
        exp,
        sig,
        key: derivePublicMediaKey(this.config.socialTokenKey),
      })
    ) {
      res.status(403).json({ message: 'Invalid or expired media link' });
      return;
    }

    const clip = await this.prisma.clip.findFirst({
      where: { id, deletedAt: null },
      select: { filePath: true },
    });
    if (!clip) {
      res.status(404).json({ message: 'Clip not found' });
      return;
    }
    const absolutePath = resolveClipPath(this.config.clipsDir, clip.filePath);
    if (!absolutePath) {
      res.status(404).json({ message: 'Clip not found' });
      return;
    }

    let size: number;
    try {
      const stats = await stat(absolutePath);
      if (!stats.isFile() || stats.size <= 0) throw new Error('not a file');
      size = stats.size;
    } catch {
      res.status(404).json({ message: 'Clip file is not available' });
      return;
    }

    const mimeType = MIME_BY_EXT[path.extname(clip.filePath).toLowerCase()] ?? 'video/mp4';
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=60');

    if (!rangeHeader) {
      res.setHeader('Content-Length', size);
      createReadStream(absolutePath).pipe(res);
      return;
    }

    const range = parseRange(rangeHeader, size);
    if (range === 'invalid') {
      res.setHeader('Content-Range', `bytes */${size}`);
      res.status(416).end();
      return;
    }
    if (!range) {
      res.setHeader('Content-Length', size);
      createReadStream(absolutePath).pipe(res);
      return;
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader('Content-Length', range.end - range.start + 1);
    createReadStream(absolutePath, { start: range.start, end: range.end }).pipe(res);
  }
}
