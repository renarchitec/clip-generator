import { BadRequestException } from '@nestjs/common';

const ALLOWED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'instagram.com',
];

export function assertAllowedUrl(raw: string): string {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException(`URL tidak valid: ${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('URL harus memakai http atau https.');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const allowed = ALLOWED_HOSTS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );

  if (!allowed) {
    throw new BadRequestException(
      `Host ${host} tidak didukung. Gunakan tautan YouTube, TikTok, atau Instagram.`,
    );
  }

  return url.toString();
}

/** trim + batas 500 karakter; kosong -> null. */
export function normalizeDescription(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) {
    throw new BadRequestException(
      `description maksimal 500 karakter (diterima ${trimmed.length}).`,
    );
  }
  return trimmed;
}
