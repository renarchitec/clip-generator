import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsNumber, IsObject,
  IsOptional, IsString, IsUrl, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { MEDIA_SOURCE_KINDS, SPLIT_MATCH_MODES, SPLIT_PANEL_FITS, SPLIT_SCREEN_MAX_CLIPS, SPLIT_SCREEN_RATIOS } from '@clipper/shared';
import type { MediaSourceKind, SplitMatchMode, SplitPanelFit, SplitScreenRatio, SplitScreenSegment } from '@clipper/shared';

export class PrimaryMediaSourceDto {
  @IsIn(MEDIA_SOURCE_KINDS)
  kind: MediaSourceKind;

  @IsOptional()
  @IsString()
  url?: string;

  @ValidateIf((source: PrimaryMediaSourceDto) => source.kind === 'upload')
  @IsString()
  @IsNotEmpty()
  mediaId?: string;

  @ValidateIf((source: PrimaryMediaSourceDto) => source.kind === 'clip')
  @IsString()
  @IsNotEmpty()
  clipId?: string;

  @IsOptional()
  @IsString()
  label?: string;
}

export class SplitScreenClipDto extends PrimaryMediaSourceDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  startSec?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  endSec?: number | null;
}

export class SplitScreenDto {
  @IsBoolean()
  enabled: boolean;

  @ValidateIf((config: SplitScreenDto) => config.enabled)
  @IsIn(SPLIT_SCREEN_RATIOS)
  ratio: SplitScreenRatio;

  @ValidateIf((config: SplitScreenDto) => config.enabled)
  @IsBoolean()
  swap: boolean;

  @ValidateIf((config: SplitScreenDto) => config.enabled)
  @IsIn(SPLIT_PANEL_FITS)
  primaryFit: SplitPanelFit;

  @ValidateIf((config: SplitScreenDto) => config.enabled)
  @IsIn(SPLIT_PANEL_FITS)
  secondaryFit: SplitPanelFit;

  @ValidateIf((config: SplitScreenDto) => config.enabled)
  @IsNumber()
  secondaryVolume: number;

  @ValidateIf((config: SplitScreenDto) => config.enabled)
  @IsIn(SPLIT_MATCH_MODES)
  matchMode: SplitMatchMode;

  @ValidateIf((config: SplitScreenDto) => config.enabled)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SPLIT_SCREEN_MAX_CLIPS)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => SplitScreenClipDto)
  clips: SplitScreenClipDto[];
}

export class MediaSourcesDto {
  @ValidateIf((dto: MediaSourcesDto) => !dto.primarySource || (dto.primarySource.kind === 'url' && (!!dto.url || !dto.primarySource.url)))
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PrimaryMediaSourceDto)
  primarySource?: PrimaryMediaSourceDto | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SplitScreenDto)
  splitScreen?: SplitScreenDto | null;
}

export class SplitScreenSegmentDto implements SplitScreenSegment {
  @IsNumber()
  @Min(0)
  atStart: number;

  @IsNumber()
  @Min(0)
  atEnd: number;

  @IsString()
  @IsNotEmpty()
  clipId: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sourceStartSec?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
