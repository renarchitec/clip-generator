import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { extractToken } from './auth.guard';
import { AuthService } from './auth.service';
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
  register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.register(dto, res);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, res);
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
  async config() {
    return { registrationOpen: await this.auth.isRegistrationOpen() };
  }
}
