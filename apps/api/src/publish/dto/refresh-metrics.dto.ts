import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

export class RefreshMetricsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  clipIds?: string[];
}
