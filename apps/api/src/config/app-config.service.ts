import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Akses env yang sudah divalidasi, dalam bentuk bertipe. */
@Injectable()
export class AppConfig {
  readonly mode: 'server' | 'desktop';
  readonly isDesktop: boolean;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly clipsDir: string;
  readonly tempRoot: string | undefined;
  readonly workerBin: string | undefined;
  readonly llmConfigPath: string | undefined;
  readonly port: number;
  readonly host: string;
  readonly allowRegistration: boolean;
  readonly socialTokenKey: string | undefined;
  readonly publicWebUrl: string;
  readonly googleClientId: string | undefined;
  readonly googleClientSecret: string | undefined;
  readonly tiktokClientKey: string | undefined;
  readonly tiktokClientSecret: string | undefined;
  readonly instagramClientId: string | undefined;
  readonly instagramClientSecret: string | undefined;
  readonly instagramConfigId: string | undefined;

  constructor(config: ConfigService) {
    this.mode = (config.get<'server' | 'desktop'>('DARTCLIP_MODE') ?? 'server');
    this.isDesktop = this.mode === 'desktop';
    this.databaseUrl = config.getOrThrow<string>('DATABASE_URL');
    this.redisUrl = config.get<string>('REDIS_URL') ?? '';
    this.clipsDir = config.getOrThrow<string>('CLIPS_DIR');
    this.tempRoot = config.get<string>('TEMP_ROOT') || undefined;
    this.workerBin = config.get<string>('DARTCLIP_WORKER_BIN') || undefined;
    this.llmConfigPath = config.get<string>('DARTCLIP_LLM_CONFIG_PATH') || undefined;
    this.port = Number(config.get('PORT') ?? 3000);
    this.host = config.get<string>('HOST') || (this.isDesktop ? '127.0.0.1' : '0.0.0.0');
    this.allowRegistration = config.get<boolean>('ALLOW_REGISTRATION') ?? false;
    this.socialTokenKey = config.get<string>('SOCIAL_TOKEN_KEY') || undefined;
    this.publicWebUrl =
      config.get<string>('PUBLIC_WEB_URL') ?? 'https://clipper.rencraft.site';
    this.googleClientId = config.get<string>('GOOGLE_CLIENT_ID') || undefined;
    this.googleClientSecret =
      config.get<string>('GOOGLE_CLIENT_SECRET') || undefined;
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
}
