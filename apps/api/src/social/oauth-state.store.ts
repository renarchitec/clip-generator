import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { RedisConnection, type RedisClient } from 'bullmq';
import { AppConfig } from '../config/app-config.service';
import { redisConnection } from '../queue/redis';
import {
  OAUTH_STATE_TTL_SECONDS,
  type OAuthStatePayload,
  type PendingOAuthState,
  socialOAuthStateKey,
} from './oauth';
import { SOCIAL_PLATFORM_LIST } from './social.constants';

/** State OAuth disimpan singkat dan dikonsumsi atomik agar hanya sekali pakai. */
@Injectable()
export class OAuthStateStore implements OnModuleDestroy {
  private readonly connection: RedisConnection;
  private clientPromise: Promise<RedisClient> | null = null;

  constructor(config: AppConfig) {
    this.connection = new RedisConnection(redisConnection(config.redisUrl));
  }

  async save(pending: PendingOAuthState): Promise<void> {
    const client = await this.client();
    await client.set(
      socialOAuthStateKey(pending.state),
      JSON.stringify(pending.payload),
      { EX: OAUTH_STATE_TTL_SECONDS },
    );
  }

  async consume(state: string): Promise<OAuthStatePayload | null> {
    const client = await this.client();
    const raw = (await client.runCommand('socialOauthConsume', [
      socialOAuthStateKey(state),
    ])) as unknown;
    if (typeof raw !== 'string') return null;

    try {
      const parsed = JSON.parse(raw) as Partial<OAuthStatePayload>;
      if (
        typeof parsed.userId !== 'string' ||
        typeof parsed.codeVerifier !== 'string' ||
        typeof parsed.platform !== 'string' ||
        !SOCIAL_PLATFORM_LIST.includes(
          parsed.platform as (typeof SOCIAL_PLATFORM_LIST)[number],
        )
      ) {
        return null;
      }
      return parsed as OAuthStatePayload;
    } catch {
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.close();
  }

  private client(): Promise<RedisClient> {
    this.clientPromise ??= this.connection.client.then((client) => {
      client.defineCommand('socialOauthConsume', {
        numberOfKeys: 1,
        lua: `
          local value = redis.call('GET', KEYS[1])
          if value then redis.call('DEL', KEYS[1]) end
          return value
        `,
      });
      return client;
    });
    return this.clientPromise;
  }
}
