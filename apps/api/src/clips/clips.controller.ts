import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { ClipCaptionsService } from './clip-captions.service';
import { ClipsService } from './clips.service';
import { RegenerateCaptionDto } from './dto/regenerate-caption.dto';

@Controller('clips')
export class ClipsController {
  constructor(
    private readonly clips: ClipsService,
    private readonly captions: ClipCaptionsService,
  ) {}

  /** Harus di atas rute :id agar tidak tertangkap sebagai id clip. */
  @Get('recent')
  recent(
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: { id: string },
  ) {
    const parsed = Number.parseInt(limit ?? '', 10);
    return this.clips.recent(user.id, Number.isFinite(parsed) ? parsed : 8);
  }

  @Get(':id/stream')
  stream(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
    @CurrentUser() user: { id: string },
  ) {
    return this.clips.stream(id, range, res, user.id);
  }

  @Get(':id/download')
  download(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user: { id: string },
  ) {
    return this.clips.download(id, res, user.id);
  }

  /** Regenerasi caption sosial dalam bahasa pilihan; 503 caption_unavailable bila LLM gagal. */
  @Post(':id/caption')
  @HttpCode(200)
  regenerateCaption(
    @Param('id') id: string,
    @Body() dto: RegenerateCaptionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.captions.regenerate(id, dto.language, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.clips.remove(id, user.id);
  }
}
