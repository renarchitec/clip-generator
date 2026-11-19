import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CLIPS_DIR: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
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
