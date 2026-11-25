import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
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
import type { AspectRatio, CaptionLanguage, CaptionStyle, JobMode, ReframeMode } from '@clipper/shared';
import {
  ASPECT_RATIOS,
  CAPTION_LANGUAGES,
  CAPTION_POSITION_Y_MAX,
  CAPTION_POSITION_Y_MIN,
  DEFAULT_ASPECT,
  DEFAULT_CAPTION_LANGUAGE,
  DEFAULT_REFRAME,
  MAX_SOURCE_SEC,
  MIN_SOURCE_SEC,
  REFRAME_MODES,
  normalizeCaptionStyle,
} from '@clipper/shared';
import { parseWatermarkSettings } from '../../watermarks/watermark-helpers';

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

  /** Bahasa caption sosial: auto (ikut transkrip), id, en; default auto. */
  @IsOptional()
  @IsIn(CAPTION_LANGUAGES)
  captionLanguage: CaptionLanguage = DEFAULT_CAPTION_LANGUAGE;

  /** Hashtag kustom per job (string dipisah spasi/koma atau array string). */
  @IsOptional()
  @IsCustomHashtags()
  customHashtags?: string[] | string | null;

  /**
   * Batas pemindaian sumber dalam detik (60–36000); null/absent = durasi penuh.
   * Hanya berlaku untuk mode auto & preview; mode manual mengabaikannya.
   */
  @IsOptional()
  @IsInt()
  @Min(MIN_SOURCE_SEC)
  @Max(MAX_SOURCE_SEC)
  maxSourceSec?: number | null;

  @IsOptional()
  @IsCaptionStyle()
  captionStyle?: CaptionStyle | null;

  /** Watermark dari pustaka pengguna; null = tanpa watermark. Divalidasi lewat zod. */
  @IsOptional()
  @IsWatermarkSettings()
  watermark?: WatermarkSettingsDto | null;

  /** Outro dari pustaka pengguna; null = tanpa outro. Divalidasi lewat zod di service. */
  @IsOptional()
  @IsOutroSettings()
  outro?: OutroSettingsDto | null;
}

/** Objek outro; prop didefinisikan agar tidak dihapus ValidationPipe(whitelist). */
export class OutroSettingsDto {
  outroId?: string;
}

/** Izinkan null atau { outroId: string }. */
export function IsOutroSettings(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isOutroSettings',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          if (value === null) return true;
          if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
          return typeof (value as Record<string, unknown>).outroId === 'string';
        },
        defaultMessage() {
          return 'outro harus null atau { outroId }.';
        },
      },
    });
  };
}

/** Pengaturan chroma key (greenscreen) untuk video watermark. */
export class WatermarkChromaKeyDto {
  @IsOptional()
  enabled?: boolean;

  @IsOptional()
  color?: string;

  @IsOptional()
  similarity?: number;

  @IsOptional()
  blend?: number;
}

/** Objek pengaturan watermark; prop didefinisikan agar tidak dihapus ValidationPipe(whitelist). */
export class WatermarkSettingsDto {
  @IsOptional()
  watermarkId?: string;

  @IsOptional()
  x?: number;

  @IsOptional()
  y?: number;

  @IsOptional()
  scale?: number;

  @IsOptional()
  opacity?: number;

  @IsOptional()
  chromaKey?: WatermarkChromaKeyDto | null;
}

/** Izinkan null atau pengaturan watermark yang lolos skema zod. */
export function IsWatermarkSettings(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isWatermarkSettings',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return value === null || parseWatermarkSettings(value).ok;
        },
        defaultMessage({ value }: ValidationArguments) {
          const parsed = parseWatermarkSettings(value);
          return parsed.ok ? 'Pengaturan watermark tidak valid.' : parsed.message;
        },
      },
    });
  };
}


/** Izinkan null atau objek CaptionStyle yang bisa dinormalisasi. */
export function IsCaptionStyle(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({ name: 'isCaptionStyle', target: object.constructor, propertyName, options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value === null) return true;
          if (normalizeCaptionStyle(value) === null) return false;
          const { positionY } = value as Record<string, unknown>;
          return positionY === undefined || positionY === null || (
            typeof positionY === 'number' && Number.isFinite(positionY) &&
            positionY >= CAPTION_POSITION_Y_MIN && positionY <= CAPTION_POSITION_Y_MAX
          );
        },
        defaultMessage() {
          return 'captionStyle harus null atau objek gaya subtitle yang valid (positionY: 0,05–0,95 atau null).';
        },
      },
    });
  };
}

/** Izinkan null, undefined, string (<= 500 chars), atau array string (<= 30 item, masing-masing <= 100 chars). */
export function IsCustomHashtags(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isCustomHashtags',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value === null || value === undefined) return true;
          if (typeof value === 'string') return value.length <= 500;
          if (Array.isArray(value)) {
            return (
              value.length <= 30 &&
              value.every((item) => typeof item === 'string' && item.length <= 100)
            );
          }
          return false;
        },
        defaultMessage() {
          return 'customHashtags harus string (maks 500 karakter) atau array string (maks 30 item, maks 100 karakter per item).';
        },
      },
    });
  };
}
