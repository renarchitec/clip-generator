import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  parseWatermarkSettings,
  readImageSize,
  sanitizeWatermarkName,
  sniffImageMime,
  WATERMARK_EXT,
  WATERMARK_MAX_BYTES,
  WATERMARK_MAX_PER_USER,
  watermarkUrl,
  type StoredWatermark,
  type WatermarkSettings,
} from './watermark-helpers';

@Injectable()
export class WatermarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async upload(file: { buffer: Buffer; originalname: string; size: number } | undefined, rawName: unknown, userId: string) {
    if (!file) throw new BadRequestException('Field file wajib diisi.');
    if (file.size > WATERMARK_MAX_BYTES) throw new BadRequestException('File watermark maksimal 2 MB.');
    const mimeType = sniffImageMime(file.buffer);
    if (!mimeType) throw new BadRequestException('File harus berupa gambar PNG, JPEG, atau WebP yang valid.');
    const dimensions = readImageSize(file.buffer, mimeType);
    if (!dimensions) throw new BadRequestException('Header gambar watermark tidak valid.');

    const count = await this.prisma.watermark.count({ where: { userId } });
    if (count >= WATERMARK_MAX_PER_USER) throw new BadRequestException('Maksimal 20 watermark per pengguna.');

    const id = randomUUID();
    const filePath = `watermarks/${userId}/${id}.${WATERMARK_EXT[mimeType]}`;
    const absolutePath = this.absolutePath(filePath);
    if (!absolutePath) throw new BadRequestException('Path watermark tidak valid.');
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.buffer, { flag: 'wx' });

    try {
      const watermark = await this.prisma.watermark.create({
        data: {
          id,
          userId,
          name: sanitizeWatermarkName(rawName, path.parse(file.originalname).name || 'Watermark'),
          filePath,
          mimeType,
          width: dimensions.width,
          height: dimensions.height,
        },
      });
      return this.toResponse(watermark);
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  async list(userId: string) {
    const watermarks = await this.prisma.watermark.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return watermarks.map((watermark) => this.toResponse(watermark));
  }

  async stream(id: string, userId: string, res: Response): Promise<void> {
    const watermark = await this.findOwned(id, userId);
    const absolutePath = this.absolutePath(watermark.filePath);
    if (!absolutePath) throw new NotFoundException(`Watermark ${id} tidak ditemukan.`);
    try {
      const info = await stat(absolutePath);
      if (!info.isFile()) throw new Error('not a file');
      res.setHeader('Content-Type', watermark.mimeType);
      res.setHeader('Content-Length', info.size);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      const file = createReadStream(absolutePath);
      res.on('close', () => file.destroy());
      file.on('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); });
      file.pipe(res);
    } catch {
      throw new NotFoundException(`File watermark ${id} tidak tersedia.`);
    }
  }

  async remove(id: string, userId: string): Promise<void> {
    const watermark = await this.findOwned(id, userId);
    const absolutePath = this.absolutePath(watermark.filePath);
    await this.prisma.$transaction(async (tx) => {
      await tx.watermark.delete({ where: { id: watermark.id } });
      const user = await tx.user.findUnique({ where: { id: userId }, select: { watermarkDefault: true } });
      const settings = parseWatermarkSettings(user?.watermarkDefault);
      if (settings.ok && settings.value.watermarkId === watermark.id) {
        await tx.user.update({ where: { id: userId }, data: { watermarkDefault: Prisma.DbNull } });
      }
    });
    if (absolutePath) await unlink(absolutePath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }

  async getDefault(userId: string): Promise<{ default: WatermarkSettings | null }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { watermarkDefault: true } });
    const parsed = parseWatermarkSettings(user?.watermarkDefault);
    return { default: parsed.ok ? parsed.value : null };
  }

  async setDefault(raw: unknown, userId: string): Promise<{ default: WatermarkSettings | null }> {
    if (raw === null) {
      await this.prisma.user.update({ where: { id: userId }, data: { watermarkDefault: Prisma.DbNull } });
      return { default: null };
    }
    const parsed = parseWatermarkSettings(raw);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    await this.findOwned(parsed.value.watermarkId, userId);
    await this.prisma.user.update({ where: { id: userId }, data: { watermarkDefault: parsed.value as Prisma.InputJsonValue } });
    return { default: parsed.value };
  }

  async resolveSettings(raw: unknown, userId: string): Promise<StoredWatermark | null> {
    if (raw === undefined || raw === null) return null;
    const parsed = parseWatermarkSettings(raw);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    const watermark = await this.findOwned(parsed.value.watermarkId, userId);
    return { ...parsed.value, filePath: watermark.filePath };
  }

  private async findOwned(id: string, userId: string) {
    const watermark = await this.prisma.watermark.findFirst({ where: { id, userId } });
    if (!watermark) throw new NotFoundException(`Watermark ${id} tidak ditemukan.`);
    return watermark;
  }

  private absolutePath(filePath: string): string | null {
    const root = path.resolve(this.config.clipsDir);
    const target = path.resolve(root, filePath);
    return target !== root && target.startsWith(root + path.sep) ? target : null;
  }

  private toResponse(watermark: { id: string; name: string; width: number; height: number; mimeType: string; createdAt: Date }) {
    return { ...watermark, url: watermarkUrl(watermark.id) };
  }
}
