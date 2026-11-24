import { IsBoolean, IsIn, IsNumber, IsOptional, IsUrl, Max, Min } from 'class-validator';
import type { AspectRatio, ReframeMode } from '@clipper/shared';
import { ASPECT_RATIOS, DEFAULT_ASPECT, DEFAULT_REFRAME, REFRAME_MODES } from '@clipper/shared';

export class CreateFrameDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url: string;

  @IsNumber()
  @Min(0)
  @Max(36000)
  atSec: number;

  @IsOptional()
  @IsIn(ASPECT_RATIOS)
  aspectRatio: AspectRatio = DEFAULT_ASPECT;

  @IsOptional()
  @IsIn(REFRAME_MODES)
  reframe: ReframeMode = DEFAULT_REFRAME;

  @IsOptional()
  @IsBoolean()
  twoSpeakers?: boolean;

  @IsOptional()
  @IsBoolean()
  facecam?: boolean;

  @IsOptional()
  @IsBoolean()
  captions?: boolean;
}
