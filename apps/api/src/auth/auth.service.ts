import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.types';
import { SESSION_COOKIE } from './auth.guard';
import {
  generateSessionToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from './crypto';
import { LoginDto, RegisterDto } from './dto/auth.dto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async isRegistrationOpen(): Promise<boolean> {
    const userCount = await this.prisma.user.count();
    return userCount === 0 || this.config.allowRegistration;
  }

  async register(dto: RegisterDto, res: Response) {
    const email = dto.email.trim().toLowerCase();
    const userCount = await this.prisma.user.count();
    const isFirstUser = userCount === 0;

    if (!isFirstUser && !this.config.allowRegistration) {
      throw new ForbiddenException('Pendaftaran pengguna baru dinonaktifkan.');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email sudah terdaftar.');
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name?.trim() || null,
        passwordHash,
      },
      select: { id: true, email: true, name: true },
    });

    if (isFirstUser) {
      // Klaim semua job tanpa pemilik sebelumnya
      await this.prisma.job.updateMany({
        where: { userId: null },
        data: { userId: user.id },
      });
    }

    await this.issueSession(user.id, res);
    return { user };
  }

  async login(dto: LoginDto, res: Response) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new UnauthorizedException('Email atau password salah.');
    }

    const valid = await verifyPassword(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Email atau password salah.');
    }

    await this.issueSession(user.id, res);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    };
  }

  async logout(token: string | null, res: Response): Promise<void> {
    if (token) {
      await this.prisma.session
        .delete({ where: { tokenHash: hashToken(token) } })
        .catch(() => undefined);
    }
    this.clearSessionCookie(res);
  }

  me(user: AuthUser) {
    return { user };
  }

  private async issueSession(userId: string, res: Response): Promise<string> {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
      },
    });

    this.setSessionCookie(res, token, expiresAt);
    return token;
  }

  private setSessionCookie(res: Response, token: string, expires: Date): void {
    const isProd = process.env.NODE_ENV === 'production';
    const parts = [
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      'HttpOnly',
      'Path=/',
      'SameSite=Lax',
      `Expires=${expires.toUTCString()}`,
    ];
    if (isProd) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  private clearSessionCookie(res: Response): void {
    const isProd = process.env.NODE_ENV === 'production';
    const parts = [
      `${SESSION_COOKIE}=`,
      'HttpOnly',
      'Path=/',
      'SameSite=Lax',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'Max-Age=0',
    ];
    if (isProd) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }
}
