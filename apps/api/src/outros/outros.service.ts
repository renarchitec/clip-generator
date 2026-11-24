import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  OUTRO_EXT,
  OUTRO_MAX_BYTES,
  OUTRO_MAX_DURATION_SEC,
  OUTRO_MAX_PER_USER,
  OUTRO_MIN_DURATION_SEC,
  parseOutroSettings,
  readOutroInfo,
  sanitizeOutroName,
  sniffOutroMime,
  type OutroSettings,
  type StoredOutro,
} from './outro-helpers';

@Injectable()
export class OutrosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async upload(file: { buffer: Buffer; originalname: string; size: number } | undefined, rawName: unknown, userId: string) {
    if (!file) throw new BadRequestException('Field file wajib diisi.');
    if (file.size > OUTRO_MAX_BYTES || file.buffer.length > OUTRO_MAX_BYTES) {
      throw new BadRequestException('File outro maksimal 50 MB.');
    }
    const mimeType = sniffOutroMime(file.buffer);
    if (!mimeType) throw new BadRequestException('File harus berupa video MP4 atau MOV yang valid.');
    const info = readOutroInfo(file.buffer);
    if (!info) throw new BadRequestException('Metadata video outro tidak bisa dibaca (file rusak atau tanpa trak video).');
    if (info.durationSec < OUTRO_MIN_DURATION_SEC || info.durationSec > OUTRO_MAX_DURATION_SEC) {
      throw new BadRequestException('Durasi outro harus antara 0,5 dan 20 detik.');
    }

    const count = await this.prisma.outro.count({ where: { userId } });
    if (count >= OUTRO_MAX_PER_USER) throw new BadRequestException('Maksimal 20 outro per pengguna.');

    const id = randomUUID();
    const filePath = `outros/${userId}/${id}.${OUTRO_EXT[mimeType]}`;
    const absolutePath = this.absolutePath(filePath);
    if (!absolutePath) throw new BadRequestException('Path outro tidak valid.');
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.buffer, { flag: 'wx' });

    try {
      const outro = await this.prisma.outro.create({
        data: {
          id,
          userId,
          name: sanitizeOutroName(rawName, path.parse(file.originalname).name || 'Outro'),
          filePath,
          mimeType,
          durationSec: info.durationSec,
          width: info.width,
          height: info.height,
          sizeBytes: file.buffer.length,
        },
      });
      return this.toResponse(outro);
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  async list(userId: string) {
    const outros = await this.prisma.outro.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return outros.map((outro) => this.toResponse(outro));
  }

  /** Stream via res.sendFile: Range/206, ETag, dan Content-Type dari ekstensi. */
  async stream(id: string, userId: string, res: Response): Promise<void> {
    const outro = await this.findOwned(id, userId);
    const absolutePath = this.absolutePath(outro.filePath);
    if (!absolutePath) throw new NotFoundException(`Outro ${id} tidak ditemukan.`);
    try {
      const info = await stat(absolutePath);
      if (!info.isFile()) throw new Error('not a file');
    } catch {
      throw new NotFoundException(`File outro ${id} tidak tersedia.`);
    }
    res.setHeader('Content-Type', outro.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    await new Promise<void>((resolve) => {
      res.sendFile(absolutePath, { acceptRanges: true, dotfiles: 'allow' }, (error) => {
        if (error && !res.headersSent) res.status(404).end();
        else if (error) res.destroy();
        resolve();
      });
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const outro = await this.findOwned(id, userId);
    const absolutePath = this.absolutePath(outro.filePath);
    await this.prisma.$transaction(async (tx) => {
      await tx.outro.delete({ where: { id: outro.id } });
      const user = await tx.user.findUnique({ where: { id: userId }, select: { outroDefault: true } });
      const settings = parseOutroSettings(user?.outroDefault);
      if (settings.ok && settings.value.outroId === outro.id) {
        await tx.user.update({ where: { id: userId }, data: { outroDefault: Prisma.DbNull } });
      }
    });
    if (absolutePath) await unlink(absolutePath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }

  async getDefault(userId: string): Promise<{ default: OutroSettings | null }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { outroDefault: true } });
    const parsed = parseOutroSettings(user?.outroDefault);
    return { default: parsed.ok ? parsed.value : null };
  }

  async setDefault(raw: unknown, userId: string): Promise<{ default: OutroSettings | null }> {
    if (raw === null) {
      await this.prisma.user.update({ where: { id: userId }, data: { outroDefault: Prisma.DbNull } });
      return { default: null };
    }
    const parsed = parseOutroSettings(raw);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    await this.findOwned(parsed.value.outroId, userId);
    await this.prisma.user.update({ where: { id: userId }, data: { outroDefault: parsed.value as Prisma.InputJsonValue } });
    return { default: parsed.value };
  }

  /** Validasi kepemilikan + snapshot untuk Job.outro; null/undefined -> null. */
  async resolveSettings(raw: unknown, userId: string): Promise<StoredOutro | null> {
    if (raw === undefined || raw === null) return null;
    const parsed = parseOutroSettings(raw);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    const outro = await this.findOwned(parsed.value.outroId, userId);
    return { outroId: outro.id, filePath: outro.filePath, durationSec: outro.durationSec };
  }

  private async findOwned(id: string, userId: string) {
    const outro = await this.prisma.outro.findFirst({ where: { id, userId } });
    if (!outro) throw new NotFoundException(`Outro ${id} tidak ditemukan.`);
    return outro;
  }

  private absolutePath(filePath: string): string | null {
    const root = path.resolve(this.config.clipsDir);
    const target = path.resolve(root, filePath);
    return target !== root && target.startsWith(root + path.sep) ? target : null;
  }

  private toResponse(outro: {
    id: string;
    name: string;
    mimeType: string;
    durationSec: number;
    width: number;
    height: number;
    sizeBytes: number;
    createdAt: Date;
  }) {
    const { id, name, mimeType, durationSec, width, height, sizeBytes, createdAt } = outro;
    return { id, name, mimeType, durationSec, width, height, sizeBytes, createdAt };
  }
}
