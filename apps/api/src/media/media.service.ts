import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { MEDIA_IMAGE_MAX_BYTES, MEDIA_MAX_PER_USER, MEDIA_UPLOAD_MAX_BYTES, MEDIA_UPLOAD_MAX_DURATION_SEC } from '@clipper/shared';
import type { GenerateImageJobResult, MediaAssetResponse } from '@clipper/shared';
import type { MediaAsset } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { chmod, stat, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import type { Response } from 'express';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ensureMediaDirectory, isImageMime, MEDIA_EXT, moveUpload, probeImage, probeMedia,
  resolveExistingMediaFile, sniffImageMime, type UploadedMedia,
} from './media-helpers';

type MediaInfo = NonNullable<Awaited<ReturnType<typeof probeMedia>>>;
const quotaError = () => new BadRequestException(`Maksimal ${MEDIA_MAX_PER_USER} media per pengguna.`);

@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfig) {}

  async upload(file: UploadedMedia | undefined, rawName: unknown, userId: string): Promise<MediaAssetResponse> {
    if (!file) throw new BadRequestException('Field file wajib diisi.');
    try {
      if (file.size > MEDIA_UPLOAD_MAX_BYTES) throw new BadRequestException('File media maksimal 100 MiB.');
      await this.assertQuota(userId);
      const sizeBytes = await this.fileSize(file.path);
      const imageMime = await sniffImageMime(file.path).catch(() => undefined);
      if (imageMime) return await this.storeImage(file.path, rawName, userId, path.parse(file.originalname).name);
      if (sizeBytes > MEDIA_UPLOAD_MAX_BYTES) throw new BadRequestException('File video maksimal 100 MiB.');
      const info = await probeMedia(file.path).catch(() => null);
      if (!info) throw new BadRequestException('Gunakan MP4, MOV, WebM, PNG, JPEG, atau WebP yang valid.');
      if (info.durationSec > MEDIA_UPLOAD_MAX_DURATION_SEC) throw new BadRequestException('Durasi video maksimal 1 jam.');
      return await this.persist(file.path, rawName, path.parse(file.originalname).name, userId, sizeBytes, info);
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  async assertQuota(userId: string): Promise<void> {
    if (await this.prisma.mediaAsset.count({ where: { userId } }) >= MEDIA_MAX_PER_USER) throw quotaError();
  }

  async storeImage(source: string, rawName: unknown, userId: string, fallbackName = 'Gambar',
    expected?: Omit<GenerateImageJobResult, 'file'>): Promise<MediaAssetResponse> {
    const invalidOutput = () => new ServiceUnavailableException('media_output_invalid');
    const sizeBytes = await this.fileSize(source).catch((error: unknown) => { throw expected ? invalidOutput() : error; });
    if (sizeBytes > MEDIA_IMAGE_MAX_BYTES) throw expected ? invalidOutput() : new BadRequestException('File gambar maksimal 15 MiB.');
    const mimeType = await sniffImageMime(source).catch(() => undefined);
    const info = mimeType && await probeImage(source, mimeType).catch(() => null);
    if (!info) throw expected ? invalidOutput() : new BadRequestException('File harus berupa gambar PNG, JPEG, atau WebP yang valid.');
    if (expected && (expected.mimeType !== info.mimeType || expected.width !== info.width ||
        expected.height !== info.height || expected.sizeBytes !== sizeBytes)) {
      throw invalidOutput();
    }
    return this.persist(source, rawName, fallbackName, userId, sizeBytes, info);
  }

  private async fileSize(source: string): Promise<number> {
    const file = await stat(source).catch(() => null);
    if (!file?.isFile() || file.size <= 0) throw new BadRequestException('File media kosong atau tidak tersedia.');
    return file.size;
  }

  private async persist(source: string, rawName: unknown, fallbackName: string, userId: string, sizeBytes: number, info: MediaInfo) {
    const id = randomUUID();
    const filename = `${id}.${MEDIA_EXT[info.mimeType]}`;
    const filePath = `media/${userId}/${filename}`;
    const absolutePath = path.join(await ensureMediaDirectory(this.config.clipsDir, 0o755, 'media', userId), filename);
    const name = Array.from((typeof rawName === 'string' && rawName.trim()) || fallbackName.trim() ||
      (isImageMime(info.mimeType) ? 'Gambar' : 'Video')).slice(0, 120).join('');
    try {
      await moveUpload(source, absolutePath);
      // Worker runs under a separate UID and reads stored assets from the shared volume.
      await chmod(absolutePath, 0o644);
      const asset = await this.prisma.$transaction(async (tx) => {
        // Serialize all media creation for the same user, including worker outputs.
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
        if (await tx.mediaAsset.count({ where: { userId } }) >= MEDIA_MAX_PER_USER) throw quotaError();
        return tx.mediaAsset.create({ data: { id, userId, name, filePath, sizeBytes, ...info } });
      });
      return toResponse(asset);
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
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
    const absolutePath = await resolveExistingMediaFile(this.config.clipsDir, asset.filePath);
    if (!absolutePath) {
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
    const absolutePath = await resolveExistingMediaFile(this.config.clipsDir, asset.filePath);
    if (absolutePath) await unlink(absolutePath).catch(() => undefined);
  }
}

function toResponse({ id, name, mimeType, durationSec, width, height, sizeBytes, createdAt }: MediaAsset): MediaAssetResponse {
  return { id, name, mimeType, mediaType: isImageMime(mimeType) ? 'image' : 'video', durationSec, width, height, sizeBytes,
    createdAt: createdAt.toISOString() };
}
