import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Tandai route yang boleh diakses tanpa sesi. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
