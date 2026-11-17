import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Akses env yang sudah divalidasi, dalam bentuk bertipe. */
@Injectable()
export class AppConfig {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly clipsDir: string;
  readonly port: number;

  constructor(config: ConfigService) {
    this.databaseUrl = config.getOrThrow<string>('DATABASE_URL');
    this.redisUrl = config.getOrThrow<string>('REDIS_URL');
    this.clipsDir = config.getOrThrow<string>('CLIPS_DIR');
    this.port = Number(config.get('PORT') ?? 3000);
  }
}
