import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user) throw new UnauthorizedException();
    return user;
  },
);
