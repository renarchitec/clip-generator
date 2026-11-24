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
import type { PublicationPrivacy, PublishMode } from '@clipper/shared';
import {
  CAPTION_MAX,
  PRIVACIES,
  PUBLISH_MODES,
  TIKTOK_PRIVACY_LEVEL_MAX,
  TARGETS_MAX,
} from '../publish-helpers';

/** Opsi Direct Post TikTok; aturan lintas-field divalidasi di publish-helpers. */
export class TiktokOptionsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TIKTOK_PRIVACY_LEVEL_MAX)
  @Matches(/^[A-Z_]+$/, { message: 'privacyLevel tidak valid.' })
  privacyLevel: string;

  @IsBoolean()
  disableComment: boolean;

  @IsBoolean()
  disableDuet: boolean;

  @IsBoolean()
  disableStitch: boolean;

  @IsBoolean()
  brandContent: boolean;

  @IsBoolean()
  brandOrganic: boolean;
}

export class PublishTargetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  accountId: string;

  /** Wajib untuk YouTube (dicek di service); opsional/boleh kosong untuk TikTok. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Matches(/^[^<>]*$/, { message: "title tidak boleh memuat '<' atau '>'." })
  title?: string;

  /** Batas 5000 (YouTube); TikTok dibatasi 2200 di service. */
  @IsString()
  @MaxLength(CAPTION_MAX)
  caption: string;

  /** Wajib untuk YouTube (dicek di service); diabaikan untuk TikTok. */
  @IsOptional()
  @IsIn(PRIVACIES)
  privacy?: PublicationPrivacy;

  @IsOptional()
  @IsIn(PUBLISH_MODES)
  mode?: PublishMode;

  @IsOptional()
  @ValidateNested()
  @Type(() => TiktokOptionsDto)
  tiktok?: TiktokOptionsDto;

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
