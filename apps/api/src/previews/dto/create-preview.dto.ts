import { MediaSourcesDto } from '../../media/media.dto';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { AspectRatio, TranscriptSource } from '@clipper/shared';
import { ASPECT_RATIOS, DEFAULT_ASPECT, MAX_SOURCE_SEC, MIN_SOURCE_SEC, TRANSCRIPT_SOURCES } from '@clipper/shared';

export class CreatePreviewDto extends MediaSourcesDto {
  @IsOptional()
  @IsIn(ASPECT_RATIOS)
  aspectRatio: AspectRatio = DEFAULT_ASPECT;

  @IsOptional()
  @IsBoolean()
  twoSpeakers?: boolean;

  @IsOptional()
  @IsBoolean()
  facecam?: boolean;

  @IsOptional()
  @IsIn(TRANSCRIPT_SOURCES)
  transcriptSource?: TranscriptSource;

  /** Brief opsional; batas 500 karakter dicek di service bersama job. */
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  clipCount: number = 5;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(180)
  targetDurationSec: number = 45;

  /** Batas pemindaian sumber dalam detik (60–36000); null/absent = durasi penuh. */
  @IsOptional()
  @IsInt()
  @Min(MIN_SOURCE_SEC)
  @Max(MAX_SOURCE_SEC)
  maxSourceSec?: number | null;
}
