import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateFrameDto } from './dto/create-frame.dto';
import { FramesService } from './frames.service';
@Controller('frames')
export class FramesController {
  constructor(private readonly frames: FramesService) {}
  @Post() create(@Body() dto: CreateFrameDto, @CurrentUser() user: { id: string }) { return this.frames.create(dto, user.id); }
  @Get(':id') findOne(@Param('id') id: string, @CurrentUser() user: { id: string }) { return this.frames.findOne(id, user.id); }
  @Get(':id/image') image(@Param('id') id: string, @Res() res: Response, @CurrentUser() user: { id: string }) { return this.frames.image(id, user.id, res); }
}
