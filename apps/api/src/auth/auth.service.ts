import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import {
  DEMO_CONTENT_TYPES,
  type AuthConfigResponse,
  type DemoContentType,
  type UserRole,
} from '@clipper/shared';
import { AppConfig } from '../config/app-config.service';
import { DemoService } from '../demo/demo.service';
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
export const GOOGLE_STATE_COOKIE = 'clipper_google_state';
const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleStartQuery {
  redirect?: string;
  src?: string;
  utm_source?: string;
  utm_campaign?: string;
  content_type?: string;
}

function cleanTag(value: string | undefined, max = 64): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function cleanContentType(value: string | undefined): DemoContentType | null {
  if (!value) return null;
  return (DEMO_CONTENT_TYPES as readonly string[]).includes(value)
    ? (value as DemoContentType)
    : null;
}

function safeRedirectPath(value: string | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  return value;
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Optional() private readonly demo?: DemoService,
  ) {}

  async isRegistrationOpen(): Promise<boolean> {
    const userCount = await this.prisma.user.count();
    return userCount === 0 || this.config.allowRegistration;
  }

  async getAuthConfig(): Promise<AuthConfigResponse> {
    return {
      registrationOpen: await this.isRegistrationOpen(),
      googleAuthEnabled: this.config.googleAuthConfigured,
      defaultRole: this.config.registrationDefaultRole,
    };
  }

  async register(dto: RegisterDto, res: Response, clientIp = 'unknown') {
    const email = dto.email.trim().toLowerCase();
    const userCount = await this.prisma.user.count();
    const isFirstUser = userCount === 0;

    if (!isFirstUser && !this.config.allowRegistration) {
      throw new ForbiddenException('Pendaftaran pengguna baru dinonaktifkan.');
    }

    if (!isFirstUser && this.demo) {
      await this.demo.assertRegistrationIpAllowed(clientIp);
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email sudah terdaftar.');
    }

    const passwordHash = await hashPassword(dto.password);
    const role: UserRole = isFirstUser
      ? 'admin'
      : this.config.registrationDefaultRole;
    const signupSource = cleanTag(dto.signupSource);
    const utmSource = cleanTag(dto.utmSource);
    const utmCampaign = cleanTag(dto.utmCampaign);
    const contentType = cleanContentType(dto.contentType);

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name?.trim() || null,
        passwordHash,
        role,
        authProvider: 'email',
        signupSource,
        utmSource,
        utmCampaign,
        contentType,
        lastSeenAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        authProvider: true,
        avatarUrl: true,
      },
    });

    if (isFirstUser) {
      // Klaim semua job tanpa pemilik sebelumnya
      await this.prisma.job.updateMany({
        where: { userId: null },
        data: { userId: user.id },
      });
    }

    await this.demo?.recordEvent(user.id, 'registered', {
      provider: 'email',
      role,
      signupSource,
      utmSource,
      utmCampaign,
      contentType,
    });

    await this.issueSession(user.id, res);
    const demoQuota =
      user.role === 'demo' && this.demo
        ? await this.demo.getQuota(user.id)
        : null;
    return { user, demoQuota };
  }

  async login(dto: LoginDto, res: Response) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new UnauthorizedException('Email atau password salah.');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'Akun ini terdaftar melalui Google. Silakan masuk dengan Google.',
      );
    }

    const valid = await verifyPassword(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Email atau password salah.');
    }

    void this.prisma.user
      .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

    await this.issueSession(user.id, res);
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      authProvider: user.authProvider,
      avatarUrl: user.avatarUrl,
    };
    const demoQuota =
      authUser.role === 'demo' && this.demo
        ? await this.demo.getQuota(authUser.id)
        : null;
    return { user: authUser, demoQuota };
  }

  async startGoogleAuth(query: GoogleStartQuery, res: Response): Promise<void> {
    if (!this.config.googleAuthConfigured || !this.demo) {
      this.redirectLoginError(res, 'google_not_configured');
      return;
    }

    const state = randomBytes(24).toString('base64url');
    const { verifier, challenge } = createPkcePair();
    const redirect = safeRedirectPath(query.redirect);

    await this.demo.saveGoogleAuthState(state, {
      codeVerifier: verifier,
      redirect,
      signupSource: cleanTag(query.src) ?? undefined,
      utmSource: cleanTag(query.utm_source) ?? undefined,
      utmCampaign: cleanTag(query.utm_campaign) ?? undefined,
      contentType: cleanContentType(query.content_type) ?? undefined,
    });

    this.setCookie(
      res,
      GOOGLE_STATE_COOKIE,
      state,
      new Date(Date.now() + GOOGLE_STATE_TTL_MS),
    );

    const callbackUrl = this.googleCallbackUrl();
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', this.config.googleAuthClientId!);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('prompt', 'select_account');

    res.redirect(302, authUrl.toString());
  }

  async handleGoogleCallback(
    params: { code?: string; state?: string; error?: string },
    stateCookie: string | undefined,
    clientIp: string,
    res: Response,
  ): Promise<void> {
    this.clearCookie(res, GOOGLE_STATE_COOKIE);

    if (!this.config.googleAuthConfigured || !this.demo) {
      this.redirectLoginError(res, 'google_not_configured');
      return;
    }

    if (params.error) {
      this.redirectLoginError(
        res,
        params.error === 'access_denied' ? 'google_denied' : 'google_failed',
      );
      return;
    }

    if (!params.code || !params.state || !stateCookie || params.state !== stateCookie) {
      this.redirectLoginError(res, 'google_invalid_state');
      return;
    }

    const pending = await this.demo.consumeGoogleAuthState(params.state);
    if (!pending) {
      this.redirectLoginError(res, 'google_invalid_state');
      return;
    }

    let profile: {
      sub: string;
      email: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    try {
      profile = await this.fetchGoogleUserInfo(params.code, pending.codeVerifier);
    } catch (error) {
      this.logger.warn(
        `Google Sign-In gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.redirectLoginError(res, 'google_failed');
      return;
    }

    const email = profile.email.trim().toLowerCase();
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [{ googleId: profile.sub }, { email }],
      },
    });

    if (user) {
      const updates: {
        googleId?: string;
        avatarUrl?: string;
        name?: string;
        lastSeenAt: Date;
      } = { lastSeenAt: new Date() };
      if (!user.googleId) updates.googleId = profile.sub;
      if (!user.avatarUrl && profile.picture) updates.avatarUrl = profile.picture;
      if (!user.name && profile.name) updates.name = profile.name.slice(0, 100);
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: updates,
      });
    } else {
      const userCount = await this.prisma.user.count();
      const isFirstUser = userCount === 0;
      if (!isFirstUser && !this.config.allowRegistration) {
        this.redirectLoginError(res, 'registration_closed');
        return;
      }
      if (!isFirstUser) {
        try {
          await this.demo.assertRegistrationIpAllowed(clientIp);
        } catch (error) {
          if (error instanceof HttpException && error.getStatus() === 429) {
            this.redirectLoginError(res, 'rate_limited');
            return;
          }
          throw error;
        }
      }

      const role: UserRole = isFirstUser
        ? 'admin'
        : this.config.registrationDefaultRole;
      user = await this.prisma.user.create({
        data: {
          email,
          name: profile.name?.trim().slice(0, 100) || null,
          passwordHash: null,
          role,
          googleId: profile.sub,
          authProvider: 'google',
          avatarUrl: profile.picture || null,
          signupSource: cleanTag(pending.signupSource),
          utmSource: cleanTag(pending.utmSource),
          utmCampaign: cleanTag(pending.utmCampaign),
          contentType: cleanContentType(pending.contentType),
          lastSeenAt: new Date(),
        },
      });

      if (isFirstUser) {
        await this.prisma.job.updateMany({
          where: { userId: null },
          data: { userId: user.id },
        });
      }

      await this.demo.recordEvent(user.id, 'registered', {
        provider: 'google',
        role,
        signupSource: user.signupSource,
        utmSource: user.utmSource,
        utmCampaign: user.utmCampaign,
        contentType: user.contentType,
      });
    }

    await this.issueSession(user.id, res);
    res.redirect(302, safeRedirectPath(pending.redirect));
  }

  async logout(token: string | null, res: Response): Promise<void> {
    if (token) {
      await this.prisma.session
        .delete({ where: { tokenHash: hashToken(token) } })
        .catch(() => undefined);
    }
    this.clearCookie(res, SESSION_COOKIE);
  }

  async me(user: AuthUser) {
    const demoQuota =
      user.role === 'demo' && this.demo
        ? await this.demo.getQuota(user.id)
        : null;
    return { user, demoQuota };
  }

  private googleCallbackUrl(): string {
    return `${this.config.publicWebUrl.replace(/\/+$/, '')}/api/auth/google/callback`;
  }

  private redirectLoginError(res: Response, code: string): void {
    const base = this.config.publicWebUrl.replace(/\/+$/, '');
    res.redirect(302, `${base}/login?auth_error=${encodeURIComponent(code)}`);
  }

  private async fetchGoogleUserInfo(
    code: string,
    codeVerifier: string,
  ): Promise<{
    sub: string;
    email: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  }> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.googleAuthClientId!,
        client_secret: this.config.googleAuthClientSecret!,
        redirect_uri: this.googleCallbackUrl(),
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Token exchange HTTP ${tokenRes.status}`);
    }
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      throw new Error('Access token kosong dari Google');
    }

    const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!userRes.ok) {
      throw new Error(`Userinfo HTTP ${userRes.status}`);
    }
    const profile = (await userRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!profile.sub || !profile.email || profile.email_verified === false) {
      throw new Error('Profil email terverifikasi tidak tersedia dari Google');
    }

    return {
      sub: profile.sub,
      email: profile.email,
      email_verified: profile.email_verified,
      name: profile.name,
      picture: profile.picture,
    };
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

    this.setCookie(res, SESSION_COOKIE, token, expiresAt);
    return token;
  }

  private setCookie(
    res: Response,
    name: string,
    value: string,
    expires: Date,
  ): void {
    const isProd = process.env.NODE_ENV === 'production';
    const parts = [
      `${name}=${encodeURIComponent(value)}`,
      'HttpOnly',
      'Path=/',
      'SameSite=Lax',
      `Expires=${expires.toUTCString()}`,
    ];
    if (isProd) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  private clearCookie(res: Response, name: string): void {
    const isProd = process.env.NODE_ENV === 'production';
    const parts = [
      `${name}=`,
      'HttpOnly',
      'Path=/',
      'SameSite=Lax',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'Max-Age=0',
    ];
    if (isProd) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }
}
