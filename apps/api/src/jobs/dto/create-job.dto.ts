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
import type { JobMode, ReframeMode } from '@clipper/shared';
import { DEFAULT_REFRAME, REFRAME_MODES } from '@clipper/shared';

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

  /** Tata letak dua pembicara (panel atas/bawah); default false. */
  @IsOptional()
  @IsBoolean()
  twoSpeakers: boolean = false;
}
