import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { ClipsService } from './clips.service';

@Controller('clips')
export class ClipsController {
  constructor(private readonly clips: ClipsService) {}

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
}
