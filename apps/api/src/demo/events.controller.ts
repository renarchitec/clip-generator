import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { LOCKED_DEMO_FEATURES, type LockedDemoFeature } from '@clipper/shared';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { DemoService } from './demo.service';

const CLIENT_TRACKABLE_EVENTS = [
  'locked_feature_clicked',
  'desktop_cta_clicked',
] as const;
type ClientTrackableEvent = (typeof CLIENT_TRACKABLE_EVENTS)[number];

class TrackEventDto {
  @IsIn(CLIENT_TRACKABLE_EVENTS)
  event: ClientTrackableEvent;

  @IsOptional()
  @IsIn(LOCKED_DEMO_FEATURES)
  feature?: LockedDemoFeature;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;
}

@Controller('events')
export class EventsController {
  constructor(private readonly demo: DemoService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async track(
    @Body() dto: TrackEventDto,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    const meta: Record<string, unknown> = {};
    if (dto.feature) meta.feature = dto.feature;
    if (dto.source) meta.source = dto.source;
    await this.demo.recordEvent(
      user.id,
      dto.event,
      Object.keys(meta).length > 0 ? meta : undefined,
    );
  }
}
