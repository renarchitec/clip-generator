import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { MediaActionsService } from './media-actions.service';
import { CaptureMediaFrameDto, FindMediaMomentDto, GenerateMediaImageDto } from './media.dto';
import type { UploadedMedia } from './media-helpers';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService, private readonly actions: MediaActionsService) {}

  @Post('capture-frame')
  captureFrame(@Body() body: CaptureMediaFrameDto, @CurrentUser() user: { id: string }) {
    return this.actions.captureFrame(body, user.id);
  }

  @Post('generate-image')
  generateImage(@Body() body: GenerateMediaImageDto, @CurrentUser() user: { id: string }) {
    return this.actions.generateImage(body, user.id);
  }

  @Post('find-moment')
  @HttpCode(200)
  findMoment(@Body() body: FindMediaMomentDto, @CurrentUser() user: { id: string }) {
    return this.actions.findMoment(body, user.id);
  }

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.media.list(user.id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: UploadedMedia | undefined, @Body() body: { name?: string }, @CurrentUser() user: { id: string }) {
    return this.media.upload(file, body?.name, user.id);
  }

  @Get(':id/file')
  stream(@Param('id') id: string, @Res() res: Response, @CurrentUser() user: { id: string }) {
    return this.media.stream(id, user.id, res);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string }): Promise<void> {
    await this.media.remove(id, user.id);
  }
}
