import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DEMO_CONTENT_TYPES, type DemoContentType } from '@clipper/shared';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  signupSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  utmCampaign?: string;

  @IsOptional()
  @IsIn(DEMO_CONTENT_TYPES)
  contentType?: DemoContentType;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}
