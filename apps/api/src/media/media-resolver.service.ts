import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SPLIT_MATCH_MODES, SPLIT_PANEL_FITS, SPLIT_SCREEN_MAX_CLIPS, SPLIT_SCREEN_RATIOS } from '@clipper/shared';
import type { AspectRatio, PrimaryMediaSource, SplitScreenClipSource, SplitScreenConfig } from '@clipper/shared';
import { assertAllowedUrl } from '../jobs/validation';
import { PrismaService } from '../prisma/prisma.service';
import type { MediaActionSourceDto, SplitScreenDto, SplitScreenClipDto } from './media.dto';
import { isImageMime } from './media-helpers';
import { MediaService } from './media.service';

@Injectable()
export class MediaResolverService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService) {}

  async resolvePrimarySource(userId: string, url?: string, source?: PrimaryMediaSource | null): Promise<{
    url: string; primarySource: PrimaryMediaSource | null;
  }> {
    if (!source || source.kind === 'url') return { url: assertAllowedUrl(url || source?.url || ''), primarySource: null };
    if (source.kind === 'upload') {
      const asset = await this.media.findOwned(requiredId(source.mediaId), userId);
      if (isImageMime(asset.mimeType)) throw new BadRequestException('Sumber utama harus berupa video.');
      return { url: `media://${asset.id}`, primarySource: {
        kind: 'upload', mediaId: asset.id, filePath: asset.filePath, label: source.label?.trim() || asset.name, durationSec: asset.durationSec,
      } };
    }
    if (source.kind === 'clip') {
      const clip = await this.findClip(requiredId(source.clipId), userId);
      return { url: `clip://${clip.id}`, primarySource: {
        kind: 'clip', clipId: clip.id, filePath: clip.filePath, label: source.label?.trim() || clip.title,
        durationSec: Math.max(0.1, clip.endSec - clip.startSec),
      } };
    }
    throw new BadRequestException('Jenis sumber video tidak valid.');
  }

  async resolveVideoActionSource(userId: string, source: MediaActionSourceDto): Promise<
    { kind: 'url'; url: string } | { kind: 'upload' | 'clip'; filePath: string; durationSec: number }
  > {
    if ([source.url, source.mediaId, source.clipId].filter((value) => value !== undefined).length !== 1) {
      throw new BadRequestException('Gunakan hanya satu sumber video.');
    }
    const { url, primarySource } = await this.resolvePrimarySource(userId, undefined, source);
    if (!primarySource) return { kind: 'url', url };
    const { kind, filePath, durationSec } = primarySource;
    if (kind === 'url' || !filePath || durationSec == null) throw new NotFoundException('File sumber video tidak tersedia.');
    return { kind, filePath, durationSec };
  }

  async resolveSplitScreen(
    userId: string,
    config: SplitScreenDto | null | undefined,
    opts: { aspectRatio: AspectRatio; twoSpeakers?: boolean; facecam?: boolean },
  ): Promise<SplitScreenConfig | null> {
    if (!config?.enabled) return null;
    if (opts.aspectRatio !== '9:16' || opts.twoSpeakers || opts.facecam) {
      throw new BadRequestException('Split screen hanya untuk 9:16 tanpa dua pembicara atau facecam.');
    }
    const { ratio, swap, primaryFit, secondaryFit, secondaryVolume, matchMode, clips } = config;
    if (!SPLIT_SCREEN_RATIOS.includes(ratio) || !SPLIT_PANEL_FITS.includes(primaryFit) ||
        !SPLIT_PANEL_FITS.includes(secondaryFit) || !SPLIT_MATCH_MODES.includes(matchMode) ||
        typeof swap !== 'boolean' || !Number.isFinite(secondaryVolume)) {
      throw new BadRequestException('Pengaturan split screen tidak valid.');
    }
    if (!Array.isArray(clips) || clips.length < 1 || clips.length > SPLIT_SCREEN_MAX_CLIPS) {
      throw new BadRequestException(`Split screen butuh 1–${SPLIT_SCREEN_MAX_CLIPS} klip.`);
    }
    const ids = clips.map((clip, index) => clip.id?.trim() || `b${index + 1}`);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('ID klip split screen harus unik.');
    return {
      enabled: true, ratio, swap, primaryFit, secondaryFit, matchMode,
      secondaryVolume: Math.max(0, Math.min(1, secondaryVolume)),
      clips: await Promise.all(clips.map((clip, index) => this.resolveSecondary(userId, clip, ids[index]))),
    };
  }

  private async resolveSecondary(userId: string, source: SplitScreenClipDto, id: string): Promise<SplitScreenClipSource> {
    const { kind, startSec, endSec } = source;
    if ([startSec, endSec].some((sec) => sec != null && (!Number.isFinite(sec) || sec < 0)) ||
        (startSec != null && endSec != null && endSec <= startSec)) {
      throw new BadRequestException('Rentang klip split screen tidak valid.');
    }
    const label = source.label?.trim();
    const description = source.description?.trim() || null;
    const momentPrompt = source.momentPrompt?.trim();
    const timing = { ...(startSec != null ? { startSec } : {}), ...(endSec != null ? { endSec } : {}),
      ...(momentPrompt ? { momentPrompt } : {}) };
    if (kind === 'url') {
      const url = assertAllowedUrl(source.url || '');
      if (source.mediaType === 'image') return { id, kind, mediaType: 'image', url, label: label || url, description };
      return { id, kind, url, label: label || url, description, ...timing };
    }
    if (kind === 'upload') {
      const asset = await this.media.findOwned(requiredId(source.mediaId), userId);
      if (isImageMime(asset.mimeType)) return { id, kind, mediaType: 'image', mediaId: asset.id, filePath: asset.filePath,
        durationSec: 0, label: label || asset.name, description };
      return { id, kind, mediaId: asset.id, filePath: asset.filePath, durationSec: asset.durationSec,
        label: label || asset.name, description, ...timing };
    }
    if (kind === 'clip') {
      const clip = await this.findClip(requiredId(source.clipId), userId);
      return { id, kind, clipId: clip.id, filePath: clip.filePath, durationSec: Math.max(0.1, clip.endSec - clip.startSec),
        label: label || clip.title, description: description || clip.transcript || clip.caption || null, ...timing };
    }
    throw new BadRequestException('Jenis klip split screen tidak valid.');
  }

  private async findClip(id: string, userId: string) {
    const clip = await this.prisma.clip.findFirst({ where: { id, deletedAt: null, job: { userId } } });
    if (!clip) throw new NotFoundException(`Klip ${id} tidak ditemukan.`);
    return clip;
  }
}

function requiredId(id: string | undefined): string {
  if (!id?.trim()) throw new BadRequestException('ID sumber video wajib diisi.');
  return id.trim();
}
