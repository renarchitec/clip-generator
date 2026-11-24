import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class ExpandBriefDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(2, 500)
  brief: string;
}
