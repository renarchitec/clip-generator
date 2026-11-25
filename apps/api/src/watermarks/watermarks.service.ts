import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  parseWatermarkSettings,
  readWatermarkMediaInfo,
  sanitizeWatermarkName,
  sniffWatermarkMime,
  WATERMARK_EXT,
  WATERMARK_IMAGE_MAX_BYTES,
  WATERMARK_MAX_PER_USER,
  WATERMARK_VIDEO_MAX_BYTES,
  WATERMARK_VIDEO_MAX_DURATION_SEC,
  WATERMARK_VIDEO_MIN_DURATION_SEC,
  watermarkKind,
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
    const mimeType = sniffWatermarkMime(file.buffer);
    if (!mimeType) throw new BadRequestException('File harus berupa gambar (PNG, JPEG, WebP) atau video (MP4, WebM, MOV) yang valid.');
    const kind = watermarkKind(mimeType);
    const maxBytes = kind === 'video' ? WATERMARK_VIDEO_MAX_BYTES : WATERMARK_IMAGE_MAX_BYTES;
    if (file.size > maxBytes) {
      throw new BadRequestException(kind === 'video' ? 'File video watermark maksimal 25 MB.' : 'File watermark maksimal 2 MB.');
    }
    const info = readWatermarkMediaInfo(file.buffer, mimeType);
    if (!info) throw new BadRequestException(`Header ${kind === 'video' ? 'video' : 'gambar'} watermark tidak valid.`);
    if (kind === 'video' && info.durationSec !== null &&
        (info.durationSec < WATERMARK_VIDEO_MIN_DURATION_SEC || info.durationSec > WATERMARK_VIDEO_MAX_DURATION_SEC)) {
      throw new BadRequestException('Durasi video watermark harus antara 0,2 dan 30 detik.');
    }

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
          width: info.width,
          height: info.height,
          durationSec: info.durationSec,
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
    } catch {
      throw new NotFoundException(`File watermark ${id} tidak tersedia.`);
    }
    res.setHeader('Content-Type', watermark.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    await new Promise<void>((resolve) => {
      res.sendFile(absolutePath, { acceptRanges: true, dotfiles: 'allow' }, (error) => {
        if (error && !res.headersSent) {
          const sendError = error as Error & { statusCode?: number; headers?: Record<string, string> };
          if (sendError.statusCode === 416) {
            const contentRange = sendError.headers?.['Content-Range'];
            if (contentRange) res.setHeader('Content-Range', contentRange);
            res.status(416).end();
          } else {
            res.status(404).end();
          }
        } else if (error) {
          res.destroy();
        }
        resolve();
      });
    });
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
    return { ...parsed.value, filePath: watermark.filePath, mimeType: watermark.mimeType };
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

  private toResponse(watermark: { id: string; name: string; width: number; height: number; mimeType: string; durationSec: number | null; createdAt: Date }) {
    return {
      ...watermark,
      kind: watermarkKind(watermark.mimeType),
      durationSec: watermark.durationSec ?? null,
      url: watermarkUrl(watermark.id),
    };
  }
}
