import type { SocialPlatform } from '@clipper/shared';

/**
 * Harus sama dengan SOCIAL_PLATFORMS di packages/shared. Paket shared berisi
 * TypeScript ESM sehingga API CommonJS hanya mengimpor tipenya saat runtime.
 */
export const SOCIAL_PLATFORM_LIST = [
  'youtube',
  'instagram',
  'tiktok',
] as const satisfies readonly SocialPlatform[];
