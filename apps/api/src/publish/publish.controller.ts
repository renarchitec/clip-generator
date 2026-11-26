import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { BatchSchedulePublishResponse, BulkRefreshMetricsResponse, PublicationResponse, RefreshMetricsResponse } from '@clipper/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { BatchSchedulePublishDto, PublishClipDto } from './dto/publish-clip.dto';
import { RefreshMetricsDto } from './dto/refresh-metrics.dto';
import { PublicationMetricsService } from './publication-metrics.service';
import { PublishService } from './publish.service';

@Controller()
export class PublishController {
  constructor(
    private readonly publish: PublishService,
    private readonly metrics: PublicationMetricsService,
  ) {}

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

  @Post('clips/:id/publications/refresh-metrics')
  @HttpCode(200)
  refreshForClip(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<RefreshMetricsResponse> {
    return this.metrics.refreshClipMetrics(user.id, id);
  }

  @Post('publications/refresh-metrics')
  @HttpCode(200)
  refreshForUser(
    @CurrentUser() user: { id: string },
    @Body() body?: RefreshMetricsDto,
  ): Promise<BulkRefreshMetricsResponse> {
    return this.metrics.refreshUserMetrics(user.id, body?.clipIds);
  }

  @Post('jobs/:id/schedule-publish')
  @HttpCode(201)
  batchSchedule(
    @Param('id') id: string,
    @Body() dto: BatchSchedulePublishDto,
    @CurrentUser() user: { id: string },
  ): Promise<BatchSchedulePublishResponse> {
    return this.publish.batchSchedule(id, dto, user.id);
  }

  @Post('publications/:id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<PublicationResponse> {
    return this.publish.cancel(id, user.id);
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
