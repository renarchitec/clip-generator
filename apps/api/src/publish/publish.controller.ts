import { Body, Controller, Get, HttpCode, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { BatchSchedulePublishResponse, BulkRefreshMetricsResponse, ClipCoverUploadResponse, PublicationResponse, RefreshMetricsResponse } from '@clipper/shared';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { DemoService } from '../demo/demo.service';
import { BatchSchedulePublishDto, PublishClipDto } from './dto/publish-clip.dto';
import { RefreshMetricsDto } from './dto/refresh-metrics.dto';
import { PublicationMetricsService } from './publication-metrics.service';
import { MAX_COVER_IMAGE_BYTES } from './publish-helpers';
import { PublishService } from './publish.service';

@Controller()
export class PublishController {
  constructor(
    private readonly publish: PublishService,
    private readonly metrics: PublicationMetricsService,
    private readonly demo: DemoService,
  ) {}

  @Post('clips/:id/publish')
  @HttpCode(201)
  create(
    @Param('id') id: string,
    @Body() dto: PublishClipDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PublicationResponse[]> {
    this.demo.assertPublishOrSocialAllowed(user.role);
    return this.publish.publish(id, dto, user.id);
  }

  @Post('clips/:id/cover')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_COVER_IMAGE_BYTES, files: 1, fields: 2 },
    }),
  )
  uploadCover(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<ClipCoverUploadResponse> {
    this.demo.assertPublishOrSocialAllowed(user.role);
    return this.publish.uploadCover(user.id, id, file);
  }

  @Get('clips/:id/publications')
  list(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<PublicationResponse[]> {
    if (user.role === 'demo') return Promise.resolve([]);
    return this.publish.listForClip(id, user.id);
  }

  @Post('clips/:id/publications/refresh-metrics')
  @HttpCode(200)
  refreshForClip(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<RefreshMetricsResponse> {
    this.demo.assertPublishOrSocialAllowed(user.role);
    return this.metrics.refreshClipMetrics(user.id, id);
  }

  @Post('publications/refresh-metrics')
  @HttpCode(200)
  refreshForUser(
    @CurrentUser() user: AuthUser,
    @Body() body?: RefreshMetricsDto,
  ): Promise<BulkRefreshMetricsResponse> {
    this.demo.assertPublishOrSocialAllowed(user.role);
    return this.metrics.refreshUserMetrics(user.id, body?.clipIds);
  }

  @Post('jobs/:id/schedule-publish')
  @HttpCode(201)
  batchSchedule(
    @Param('id') id: string,
    @Body() dto: BatchSchedulePublishDto,
    @CurrentUser() user: AuthUser,
  ): Promise<BatchSchedulePublishResponse> {
    this.demo.assertPublishOrSocialAllowed(user.role);
    return this.publish.batchSchedule(id, dto, user.id);
  }

  @Post('publications/:id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<PublicationResponse> {
    this.demo.assertPublishOrSocialAllowed(user.role);
    return this.publish.cancel(id, user.id);
  }

  @Post('publications/:id/retry')
  @HttpCode(200)
  retry(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<PublicationResponse> {
    this.demo.assertPublishOrSocialAllowed(user.role);
    return this.publish.retry(id, user.id);
  }
}
