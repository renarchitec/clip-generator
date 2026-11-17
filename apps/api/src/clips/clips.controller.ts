import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ClipsService } from './clips.service';

@Controller('clips')
export class ClipsController {
  constructor(private readonly clips: ClipsService) {}

  @Get(':id/stream')
  stream(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    return this.clips.stream(id, range, res);
  }

  @Get(':id/download')
  download(@Param('id') id: string, @Res() res: Response) {
    return this.clips.download(id, res);
  }
}
