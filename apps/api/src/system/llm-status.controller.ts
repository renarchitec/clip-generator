import { Body, Controller, Get, NotFoundException, Param, Post, Optional } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { resolveClipPath } from '../clips/clip-path';
import { LocalQueueBackend } from '../queue/local-queue.backend';
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
