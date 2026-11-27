import { MediaSourcesDto } from '../../media/media.dto';
import { IsBoolean, IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import type { AspectRatio, CaptionStyle, ReframeMode } from '@clipper/shared';
import { IsCaptionStyle } from '../../jobs/dto/create-job.dto';
import { ASPECT_RATIOS, DEFAULT_ASPECT, DEFAULT_REFRAME, REFRAME_MODES } from '@clipper/shared';

export class CreateFrameDto extends MediaSourcesDto {

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

  @IsOptional()
  @IsBoolean()
  hookBanner?: boolean;

  @IsOptional()
  @IsCaptionStyle()
  captionStyle?: CaptionStyle | null;
}
