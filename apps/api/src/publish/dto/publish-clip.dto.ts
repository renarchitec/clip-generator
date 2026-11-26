import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
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

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}

export class PublishClipDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400_000)
  coverTimestampMs?: number;

  @IsOptional()
  @IsUUID()
  coverId?: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TARGETS_MAX)
  @ValidateNested({ each: true })
  @Type(() => PublishTargetDto)
  targets: PublishTargetDto[];
}

export class BatchSchedulePublishDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  clipIds?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  accountIds: string[];

  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsNumber()
  @Min(0.5)
  @Max(168)
  intervalHours: number;

  @IsOptional()
  @IsIn(PRIVACIES)
  privacy?: PublicationPrivacy;

  @IsOptional()
  @IsBoolean()
  madeForKids?: boolean;

  @IsOptional()
  @IsIn(PUBLISH_MODES)
  tiktokMode?: PublishMode;

  @IsOptional()
  @ValidateNested()
  @Type(() => TiktokOptionsDto)
  tiktok?: TiktokOptionsDto;
}
