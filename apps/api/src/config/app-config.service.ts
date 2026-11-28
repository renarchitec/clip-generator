import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Akses env yang sudah divalidasi, dalam bentuk bertipe. */
@Injectable()
export class AppConfig {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly clipsDir: string;
  readonly port: number;
  readonly allowRegistration: boolean;
  readonly registrationDefaultRole: 'demo' | 'member';
  readonly demoDailyJobLimit: number;
  readonly registerIpDailyLimit: number;
  readonly socialTokenKey: string | undefined;
  readonly publicWebUrl: string;
  readonly googleClientId: string | undefined;
  readonly googleClientSecret: string | undefined;
  readonly googleAuthClientId: string | undefined;
  readonly googleAuthClientSecret: string | undefined;
  readonly tiktokClientKey: string | undefined;
  readonly tiktokClientSecret: string | undefined;
  readonly tiktokEnableVideoList: boolean;
  readonly metricsSyncIntervalMs: number;
  readonly instagramClientId: string | undefined;
  readonly instagramClientSecret: string | undefined;
  readonly instagramConfigId: string | undefined;

  constructor(config: ConfigService) {
    this.databaseUrl = config.getOrThrow<string>('DATABASE_URL');
    this.redisUrl = config.getOrThrow<string>('REDIS_URL');
    this.clipsDir = config.getOrThrow<string>('CLIPS_DIR');
    this.port = Number(config.get('PORT') ?? 3000);
    this.allowRegistration = config.get<boolean>('ALLOW_REGISTRATION') ?? false;
    this.registrationDefaultRole =
      config.get<'demo' | 'member'>('REGISTRATION_DEFAULT_ROLE') ?? 'demo';
    this.demoDailyJobLimit = Number(config.get('DEMO_DAILY_JOB_LIMIT') ?? 30);
    this.registerIpDailyLimit = Number(
      config.get('REGISTER_IP_DAILY_LIMIT') ?? 5,
    );
    this.socialTokenKey = config.get<string>('SOCIAL_TOKEN_KEY') || undefined;
    this.publicWebUrl =
      config.get<string>('PUBLIC_WEB_URL') ?? 'https://clipper.rencraft.site';
    this.googleClientId = config.get<string>('GOOGLE_CLIENT_ID') || undefined;
    this.googleClientSecret =
      config.get<string>('GOOGLE_CLIENT_SECRET') || undefined;
    this.googleAuthClientId =
      config.get<string>('GOOGLE_AUTH_CLIENT_ID') || this.googleClientId;
    this.googleAuthClientSecret =
      config.get<string>('GOOGLE_AUTH_CLIENT_SECRET') ||
      this.googleClientSecret;
    this.tiktokEnableVideoList = process.env.TIKTOK_ENABLE_VIDEO_LIST === 'true';
    const defaultMetricsInterval = 6 * 60 * 60 * 1000;
    const metricsInterval = Number(config.get<string>('METRICS_SYNC_INTERVAL_MS')?.trim() || defaultMetricsInterval);
    this.metricsSyncIntervalMs = Math.max(
      15 * 60 * 1000,
      Number.isSafeInteger(metricsInterval) ? metricsInterval : defaultMetricsInterval,
    );
    this.tiktokClientKey = config.get<string>('TIKTOK_CLIENT_KEY') || undefined;
    this.tiktokClientSecret =
      config.get<string>('TIKTOK_CLIENT_SECRET') || undefined;
    this.instagramClientId =
      config.get<string>('INSTAGRAM_CLIENT_ID') || undefined;
    this.instagramClientSecret =
      config.get<string>('INSTAGRAM_CLIENT_SECRET') || undefined;
    this.instagramConfigId =
      config.get<string>('INSTAGRAM_CONFIG_ID') || undefined;
  }

  get googleAuthConfigured(): boolean {
    return Boolean(this.googleAuthClientId && this.googleAuthClientSecret);
  }
}
