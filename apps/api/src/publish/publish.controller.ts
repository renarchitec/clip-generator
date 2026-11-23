import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { PublicationResponse } from '@clipper/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { PublishClipDto } from './dto/publish-clip.dto';
import { PublishService } from './publish.service';

@Controller()
export class PublishController {
  constructor(private readonly publish: PublishService) {}

  @Post('clips/:id/publish')
  @HttpCode(201)
  create(
    @Param('id') id: string,
    @Body() dto: PublishClipDto,
    @CurrentUser() user: { id: string },
  ): Promise<PublicationResponse[]> {
    return this.publish.publish(id, dto, user.id);
  }

  @Get('clips/:id/publications')
  list(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<PublicationResponse[]> {
    return this.publish.listForClip(id, user.id);
  }

  @Post('publications/:id/retry')
  @HttpCode(200)
  retry(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<PublicationResponse> {
    return this.publish.retry(id, user.id);
  }
}
