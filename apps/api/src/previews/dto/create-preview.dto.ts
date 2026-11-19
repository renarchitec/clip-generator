import { IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class CreatePreviewDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url: string;

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
}
