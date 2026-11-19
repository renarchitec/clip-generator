import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.types';
import { hashToken } from './crypto';
import { IS_PUBLIC_KEY } from './public.decorator';

export const SESSION_COOKIE = 'clipper_session';

/** Ambil token dari `Authorization: Bearer` atau cookie sesi. */
export function extractToken(request: Request): string | null {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    return token || null;
  }

  return parseCookie(request.headers.cookie, SESSION_COOKIE) ?? null;
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }

  return undefined;
}

/** Guard global: semua route butuh sesi valid kecuali yang ditandai @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractToken(request);
    if (!token) throw new UnauthorizedException();

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException();
    }

    const user: AuthUser = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
    request.user = user;
    return true;
  }
}
