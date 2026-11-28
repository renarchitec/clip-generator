import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  extractClientIp,
  extractToken,
  parseCookie,
} from './auth.guard';
import { AuthService, GOOGLE_STATE_COOKIE } from './auth.service';
import type { AuthUser } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Pendaftaran: hanya saat belum ada pengguna, atau bila ALLOW_REGISTRATION=true. */
  @Public()
  @Post('register')
  register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.register(dto, res, extractClientIp(req));
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, res);
  }

  @Public()
  @Get('google')
  googleStart(
    @Query('redirect') redirect: string | undefined,
    @Query('src') src: string | undefined,
    @Query('utm_source') utm_source: string | undefined,
    @Query('utm_campaign') utm_campaign: string | undefined,
    @Query('content_type') content_type: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    return this.auth.startGoogleAuth(
      { redirect, src, utm_source, utm_campaign, content_type },
      res,
    );
  }

  @Public()
  @Get('google/callback')
  googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const stateCookie = parseCookie(req.headers.cookie, GOOGLE_STATE_COOKIE);
    return this.auth.handleGoogleCallback(
      { code, state, error },
      stateCookie,
      extractClientIp(req),
      res,
    );
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(extractToken(req), res);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Public()
  @Get('config')
  config() {
    return this.auth.getAuthConfig();
  }
}
