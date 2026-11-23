import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { PublicationPrivacy } from '@clipper/shared';
import {
  CAPTION_MAX,
  PRIVACIES,
  TARGETS_MAX,
  TITLE_MAX,
} from '../publish-helpers';

export class PublishTargetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  accountId: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(TITLE_MAX)
  @Matches(/^[^<>]*$/, { message: "title tidak boleh memuat '<' atau '>'." })
  title: string;

  @IsString()
  @MaxLength(CAPTION_MAX)
  caption: string;

  @IsIn(PRIVACIES)
  privacy: PublicationPrivacy;

  @IsOptional()
  @IsBoolean()
  madeForKids?: boolean;
}

export class PublishClipDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TARGETS_MAX)
  @ValidateNested({ each: true })
  @Type(() => PublishTargetDto)
  targets: PublishTargetDto[];
}
