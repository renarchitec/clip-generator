import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MEDIA_MAX_PER_USER, MEDIA_UPLOAD_MAX_BYTES, MEDIA_UPLOAD_MAX_DURATION_SEC } from '@clipper/shared';
import type { MediaAssetResponse } from '@clipper/shared';
import type { MediaAsset } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'express';
import { resolveClipPath } from '../clips/clip-path';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MEDIA_EXT, moveUpload, probeMedia, type UploadedMedia } from './media-helpers';

@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfig) {}

  async upload(file: UploadedMedia | undefined, rawName: unknown, userId: string): Promise<MediaAssetResponse> {
    if (!file) throw new BadRequestException('Field file wajib diisi.');
    let movedPath: string | undefined;
    try {
      if (file.size > MEDIA_UPLOAD_MAX_BYTES) throw new BadRequestException('File video maksimal 100 MiB.');
      const where = { userId };
      const quotaError = () => new BadRequestException(`Maksimal ${MEDIA_MAX_PER_USER} media per pengguna.`);
      if (await this.prisma.mediaAsset.count({ where }) >= MEDIA_MAX_PER_USER) throw quotaError();

      const info = await probeMedia(file.path).catch(() => null);
      if (!info) throw new BadRequestException('File harus berupa video MP4, MOV, atau WebM yang valid.');
      if (info.durationSec > MEDIA_UPLOAD_MAX_DURATION_SEC) throw new BadRequestException('Durasi video maksimal 1 jam.');

      const id = randomUUID();
      const filePath = `media/${userId}/${id}.${MEDIA_EXT[info.mimeType]}`;
      const absolutePath = resolveClipPath(this.config.clipsDir, filePath);
      if (!absolutePath) throw new BadRequestException('Path media tidak valid.');
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await moveUpload(file.path, absolutePath);
      movedPath = absolutePath;
      const name = Array.from((typeof rawName === 'string' && rawName.trim()) || path.parse(file.originalname).name.trim() || 'Video')
        .slice(0, 120).join('');
      const asset = await this.prisma.$transaction(async (tx) => {
        // Serialkan unggahan dari user yang sama agar kuota tidak bisa terlampaui.
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
        if (await tx.mediaAsset.count({ where }) >= MEDIA_MAX_PER_USER) throw quotaError();
        return tx.mediaAsset.create({ data: { id, userId, name, filePath, sizeBytes: file.size, ...info } });
      });
      movedPath = undefined;
      return toResponse(asset);
    } finally {
      if (movedPath) await unlink(movedPath).catch(() => undefined);
      await unlink(file.path).catch(() => undefined);
    }
  }

  async list(userId: string): Promise<MediaAssetResponse[]> {
    return (await this.prisma.mediaAsset.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })).map(toResponse);
  }

  async findOwned(id: string, userId: string) {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, userId } });
    if (!asset) throw new NotFoundException(`Media ${id} tidak ditemukan.`);
    return asset;
  }

  async stream(id: string, userId: string, res: Response): Promise<void> {
    const asset = await this.findOwned(id, userId);
    const absolutePath = resolveClipPath(this.config.clipsDir, asset.filePath);
    if (!absolutePath || !(await stat(absolutePath).catch(() => null))?.isFile()) {
      throw new NotFoundException(`File media ${id} tidak tersedia.`);
    }
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    await new Promise<void>((resolve) => {
      res.sendFile(absolutePath, { acceptRanges: true, dotfiles: 'allow' }, (error) => {
        if (error && !res.headersSent) res.status((error as { status?: number }).status ?? 404).end();
        else if (error) res.destroy();
        resolve();
      });
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const asset = await this.findOwned(id, userId);
    await this.prisma.mediaAsset.delete({ where: { id, userId } });
    const absolutePath = resolveClipPath(this.config.clipsDir, asset.filePath);
    if (absolutePath) await unlink(absolutePath).catch(() => undefined);
  }
}

function toResponse({ id, name, mimeType, durationSec, width, height, sizeBytes, createdAt }: MediaAsset): MediaAssetResponse {
  return { id, name, mimeType, durationSec, width, height, sizeBytes, createdAt: createdAt.toISOString() };
}
