import type { UserRole } from '@clipper/shared';

/** Pengguna terautentikasi yang ditempel guard ke request. */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  authProvider: string;
  avatarUrl: string | null;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
