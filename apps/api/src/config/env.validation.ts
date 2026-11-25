import { z } from 'zod';

const envSchema = z
  .object({
    DARTCLIP_MODE: z.enum(['server', 'desktop']).default('server'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().optional(),
    CLIPS_DIR: z.string().min(1),
    TEMP_ROOT: z.string().optional(),
    DARTCLIP_WORKER_BIN: z.string().optional(),
    DARTCLIP_LLM_CONFIG_PATH: z.string().optional(),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    HOST: z.string().optional(),
    SOCIAL_TOKEN_KEY: z.string().optional(),
    PUBLIC_WEB_URL: z.string().url().default('https://clipper.rencraft.site'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    TIKTOK_CLIENT_KEY: z.string().optional(),
    TIKTOK_CLIENT_SECRET: z.string().optional(),
    INSTAGRAM_CLIENT_ID: z.string().optional(),
    INSTAGRAM_CLIENT_SECRET: z.string().optional(),
    INSTAGRAM_CONFIG_ID: z.string().optional(),
    ALLOW_REGISTRATION: z
      .enum(['true', 'false'])
      .optional()
      .transform((val) => val === 'true'),
  })
  .superRefine((val, ctx) => {
    if (val.DARTCLIP_MODE === 'server' && !val.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'Required',
      });
    }
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
