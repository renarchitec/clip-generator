import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CLIPS_DIR: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SOCIAL_TOKEN_KEY: z.string().optional(),
  PUBLIC_WEB_URL: z.string().url().default('https://clipper.rencraft.site'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_ENABLE_VIDEO_LIST: z.string().optional(),
  METRICS_SYNC_INTERVAL_MS: z.string().optional(),
  INSTAGRAM_CLIENT_ID: z.string().optional(),
  INSTAGRAM_CLIENT_SECRET: z.string().optional(),
  INSTAGRAM_CONFIG_ID: z.string().optional(),
  ALLOW_REGISTRATION: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

export type Env = z.infer<typeof envSchema>;

/** Dipakai ConfigModule.forRoot({ validate }) supaya aplikasi gagal saat boot, bukan saat request pertama. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Env tidak valid:\n${lines.join('\n')}`);
  }

  return parsed.data;
}
