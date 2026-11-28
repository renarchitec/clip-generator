import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

/** Guard untuk endpoint khusus admin. Membutuhkan AuthGuard jalan lebih dulu. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.user?.role !== 'admin') {
      throw new ForbiddenException('Hanya admin yang dapat mengakses halaman ini.');
    }
    return true;
  }
}
