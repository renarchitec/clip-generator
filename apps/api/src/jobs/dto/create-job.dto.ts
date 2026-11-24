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
import type { AspectRatio, CaptionLanguage, JobMode, ReframeMode } from '@clipper/shared';
import {
  ASPECT_RATIOS,
  CAPTION_LANGUAGES,
  DEFAULT_ASPECT,
  DEFAULT_CAPTION_LANGUAGE,
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

  /** Bahasa caption sosial: auto (ikut transkrip), id, en; default auto. */
  @IsOptional()
  @IsIn(CAPTION_LANGUAGES)
  captionLanguage: CaptionLanguage = DEFAULT_CAPTION_LANGUAGE;

  /**
   * Batas pemindaian sumber dalam detik (60–36000); null/absent = durasi penuh.
   * Hanya berlaku untuk mode auto & preview; mode manual mengabaikannya.
   */
  @IsOptional()
  @IsInt()
  @Min(MIN_SOURCE_SEC)
  @Max(MAX_SOURCE_SEC)
  maxSourceSec?: number | null;

  /** Watermark dari pustaka pengguna; null = tanpa watermark. Divalidasi lewat zod. */
  @IsOptional()
  @IsWatermarkSettings()
  watermark?: WatermarkSettingsDto | null;
}

/** Objek pengaturan watermark; prop didefinisikan agar tidak dihapus ValidationPipe(whitelist). */
export class WatermarkSettingsDto {
  watermarkId?: string;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
}

/** Izinkan null atau settings { watermarkId, x, y, scale, opacity }; nilai dibatasi zod di service. */
export function IsWatermarkSettings(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isWatermarkSettings',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          if (value === null) return true;
          if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
          const candidate = value as Record<string, unknown>;
          return (
            typeof candidate.watermarkId === 'string' &&
            typeof candidate.x === 'number' &&
            typeof candidate.y === 'number' &&
            typeof candidate.scale === 'number' &&
            typeof candidate.opacity === 'number'
          );
        },
        defaultMessage() {
          return 'watermark harus null atau { watermarkId, x, y, scale, opacity }.';
        },
      },
    });
  };
}

