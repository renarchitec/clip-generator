import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { ClipsService } from './clips.service';

@Controller('clips')
export class ClipsController {
  constructor(private readonly clips: ClipsService) {}

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

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.clips.remove(id, user.id);
  }
}
