import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { JobMode } from '@clipper/shared';

export class ManualRangeDto {
  @IsNumber()
  @Min(0)
  start: number;

  @IsNumber()
  @Min(0)
  end: number;
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
}
