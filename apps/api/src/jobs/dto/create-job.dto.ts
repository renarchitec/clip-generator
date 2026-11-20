import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { AspectRatio, JobMode, ReframeMode } from '@clipper/shared';
import {
  ASPECT_RATIOS,
  DEFAULT_ASPECT,
  DEFAULT_REFRAME,
  MAX_SOURCE_SEC,
  MIN_SOURCE_SEC,
  REFRAME_MODES,
} from '@clipper/shared';

export class ManualRangeDto {
  @IsNumber()
  @Min(0)
  start: number;

  @IsNumber()
  @Min(0)
  end: number;

  /** Judul hasil tinjauan LLM; opsional agar rentang transkrip tetap valid. */
  @IsOptional()
  @IsString()
  @MaxLength(70)
  title?: string;

  /** Alasan hasil tinjauan LLM; opsional. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class CreateJobDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url: string;

  @IsIn(['auto', 'manual'])
  mode: JobMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  clipCount: number = 3;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(180)
  targetDurationSec: number = 45;

  /** Wajib untuk mode manual; dicek di service karena bergantung pada `mode`. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualRangeDto)
  ranges?: ManualRangeDto[];

  /** Instruksi preferensi konten untuk pemilihan momen; opsional. */
  @IsOptional()
  @IsString()
  description?: string;

  /** Cara mengubah video landscape jadi portrait; default face_tracking. */
  @IsOptional()
  @IsIn(REFRAME_MODES)
  reframe: ReframeMode = DEFAULT_REFRAME;

  /** Apakah subtitle dibakar ke clip; default true untuk kompatibilitas. */
  @IsOptional()
  @IsBoolean()
  captions: boolean = true;

  /** Tata letak dua pembicara (panel atas/bawah); default false. Hanya berlaku untuk aspectRatio 9:16. */
  @IsOptional()
  @IsBoolean()
  twoSpeakers: boolean = false;

  /** Tata letak streamer (facecam di atas); default false. Hanya 9:16; eksklusif dengan twoSpeakers. */
  @IsOptional()
  @IsBoolean()
  facecam: boolean = false;

  /** Rasio output klip; default 9:16. Untuk 1:1 dan 16:9, twoSpeakers dinormalisasi ke false. */
  @IsOptional()
  @IsIn(ASPECT_RATIOS)
  aspectRatio: AspectRatio = DEFAULT_ASPECT;

  /**
   * Batas pemindaian sumber dalam detik (60–36000); null/absent = durasi penuh.
   * Hanya berlaku untuk mode auto & preview; mode manual mengabaikannya.
   */
  @IsOptional()
  @IsInt()
  @Min(MIN_SOURCE_SEC)
  @Max(MAX_SOURCE_SEC)
  maxSourceSec?: number | null;
}
