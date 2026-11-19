import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreatePreviewDto } from './dto/create-preview.dto';
import { PreviewsService } from './previews.service';

@Controller('previews')
export class PreviewsController {
  constructor(private readonly previews: PreviewsService) {}

  @Post()
  create(@Body() dto: CreatePreviewDto, @CurrentUser() user: { id: string }) {
    return this.previews.create(dto, user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.previews.findOne(id, user.id);
  }
}
