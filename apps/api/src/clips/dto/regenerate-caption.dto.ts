import { IsIn } from 'class-validator';
import type { CaptionLanguage } from '@clipper/shared';
import { CAPTION_LANGUAGES } from '@clipper/shared';

/** Body POST /api/clips/:id/caption. */
export class RegenerateCaptionDto {
  @IsIn(CAPTION_LANGUAGES)
  language: CaptionLanguage;
}
