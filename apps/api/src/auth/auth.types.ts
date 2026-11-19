/** Pengguna terautentikasi yang ditempel guard ke request. */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
