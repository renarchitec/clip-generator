import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Optional,
  Param,
  Post,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/app-config.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { resolveClipPath } from '../clips/clip-path';
import { type DesktopLlmConfig, LocalQueueBackend } from '../queue/local-queue.backend';
import { LlmStatusService } from './llm-status.service';

@Controller('system')
export class LlmStatusController {
  constructor(
    private readonly llmStatus: LlmStatusService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Optional() private readonly localQueue?: LocalQueueBackend,
  ) {}

  @Public()
  @Get('runtime')
  runtime() {
    return {
      mode: this.config.mode,
      isDesktop: this.config.isDesktop,
      publishEnabled: !this.config.isDesktop,
      clipsDir: this.config.isDesktop ? this.config.clipsDir : undefined,
    };
  }

  @Get('llm-status')
  get() {
    return this.llmStatus.get();
  }

  @Post('llm-status/refresh')
  refreshLlmStatus() {
    this.localQueue?.refreshLlmStatus();
    return this.llmStatus.get();
  }

  /**
   * Terima konfigurasi LLM/encoder terdekripsi dari proses utama Electron secara in-memory
   * (tidak pernah menulis API key plaintext ke disk).
   */
  @Public()
  @Post('desktop-config')
  applyDesktopConfig(
    @Headers('x-dartclip-internal-token') token: string | undefined,
    @Body() body: DesktopLlmConfig,
  ) {
    if (!this.config.isDesktop || !this.localQueue) {
      throw new NotFoundException();
    }
    const expected = process.env.DARTCLIP_INTERNAL_TOKEN;
    if (!expected || !token) {
      throw new ForbiddenException();
    }
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException();
    }
    this.localQueue.setRuntimeConfig({
      nineRouterUrl: typeof body?.nineRouterUrl === 'string' ? body.nineRouterUrl.trim() : undefined,
      nineRouterApiKey:
        typeof body?.nineRouterApiKey === 'string' ? body.nineRouterApiKey.trim() : undefined,
      nineRouterModel:
        typeof body?.nineRouterModel === 'string' ? body.nineRouterModel.trim() : undefined,
      geminiApiKey: typeof body?.geminiApiKey === 'string' ? body.geminiApiKey.trim() : undefined,
      geminiModel: typeof body?.geminiModel === 'string' ? body.geminiModel.trim() : undefined,
      openaiApiKey: typeof body?.openaiApiKey === 'string' ? body.openaiApiKey.trim() : undefined,
      openaiModel: typeof body?.openaiModel === 'string' ? body.openaiModel.trim() : undefined,
      videoEncoder:
        body?.videoEncoder === 'libx264' || body?.videoEncoder === 'h264_videotoolbox'
          ? body.videoEncoder
          : undefined,
    });
    return { ok: true };
  }

  /** Uji koneksi LLM saat ini menggunakan worker lokal (desktop only). */
  @Post('llm-test')
  async testLlm() {
    if (!this.config.isDesktop || !this.localQueue) {
      throw new NotFoundException();
    }
    return this.localQueue.testLlmConnection();
  }

  /** Kembalikan path absolut file klip di mode desktop untuk "Buka di Finder". */
  @Get('clips/:id/local-path')
  async clipLocalPath(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    if (!this.config.isDesktop) {
      throw new NotFoundException();
    }
    const clip = await this.prisma.clip.findFirst({
      where: { id, deletedAt: null, job: { userId: user.id } },
      select: { filePath: true },
    });
    if (!clip) throw new NotFoundException(`Clip ${id} tidak ditemukan.`);
    const absolutePath = resolveClipPath(this.config.clipsDir, clip.filePath);
    if (!absolutePath) throw new NotFoundException(`Clip ${id} tidak ditemukan.`);
    return { path: absolutePath };
  }
}
