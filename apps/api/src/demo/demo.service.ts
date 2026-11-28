import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RedisConnection, type RedisClient } from 'bullmq';
import type {
  DemoQuotaSummary,
  TranscriptSource,
  UserEventType,
  UserRole,
} from '@clipper/shared';
import { DEMO_LIMITS } from '@clipper/shared';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { redisConnection } from '../queue/redis';
import {
  isDemoRole,
  utcDateKey,
  validateDemoJob,
  validateDemoPreview,
} from './demo-policy';

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;
const DAILY_KEY_TTL_SEC = 48 * 3600;
const GOOGLE_OAUTH_STATE_TTL_SEC = 600;

export interface GoogleAuthStatePayload {
  codeVerifier: string;
  redirect?: string;
  signupSource?: string;
  utmSource?: string;
  utmCampaign?: string;
  contentType?: string;
}

@Injectable()
export class DemoService implements OnModuleDestroy {
  private readonly logger = new Logger(DemoService.name);
  private readonly connection: RedisConnection;
  private clientPromise: Promise<RedisClient> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {
    this.connection = new RedisConnection(redisConnection(config.redisUrl));
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.close();
  }

  private client(): Promise<RedisClient> {
    this.clientPromise ??= this.connection.client.then((client) => {
      client.defineCommand('googleAuthConsume', {
        numberOfKeys: 1,
        lua: `
          local value = redis.call('GET', KEYS[1])
          if value then redis.call('DEL', KEYS[1]) end
          return value
        `,
      });
      client.defineCommand('demoIncrDaily', {
        numberOfKeys: 1,
        lua: `
          local nextVal = redis.call('INCR', KEYS[1])
          if nextVal == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
          return nextVal
        `,
      });
      return client;
    });
    return this.clientPromise;
  }

  async saveGoogleAuthState(
    state: string,
    payload: GoogleAuthStatePayload,
  ): Promise<void> {
    const client = await this.client();
    await client.set(
      `auth:google:state:${state}`,
      JSON.stringify(payload),
      { EX: GOOGLE_OAUTH_STATE_TTL_SEC },
    );
  }

  async consumeGoogleAuthState(
    state: string,
  ): Promise<GoogleAuthStatePayload | null> {
    const client = await this.client();
    const raw = (await client.runCommand('googleAuthConsume', [
      `auth:google:state:${state}`,
    ])) as unknown;
    if (typeof raw !== 'string') return null;
    try {
      const parsed = JSON.parse(raw) as Partial<GoogleAuthStatePayload>;
      if (typeof parsed.codeVerifier !== 'string' || !parsed.codeVerifier) {
        return null;
      }
      return parsed as GoogleAuthStatePayload;
    } catch {
      return null;
    }
  }

  async recordEvent(
    userId: string,
    event: UserEventType,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.userEvent.create({
        data: {
          userId,
          event,
          meta: meta ? (meta as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Gagal mencatat event ${event}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  touchLastSeen(userId: string, currentLastSeen: Date | null): void {
    const now = Date.now();
    if (
      currentLastSeen &&
      now - currentLastSeen.getTime() < LAST_SEEN_THROTTLE_MS
    ) {
      return;
    }
    void this.prisma.user
      .update({
        where: { id: userId },
        data: { lastSeenAt: new Date(now) },
      })
      .catch(() => undefined);
  }

  async getQuota(userId: string): Promise<DemoQuotaSummary> {
    const [jobsUsed, activeJobs, clipsUsed, previewsUsed] = await Promise.all([
      this.prisma.job.count({ where: { userId } }),
      this.prisma.job.count({
        where: { userId, status: { in: ['queued', 'running'] } },
      }),
      this.prisma.clip.count({ where: { job: { userId } } }),
      this.prisma.userEvent.count({
        where: { userId, event: 'preview_created' },
      }),
    ]);

    return {
      clipsUsed,
      clipsLimit: DEMO_LIMITS.maxClipsTotal,
      jobsUsed,
      jobsLimit: DEMO_LIMITS.maxJobsTotal,
      activeJobs,
      maxActiveJobs: DEMO_LIMITS.maxActiveJobs,
      previewsUsed,
      previewsLimit: DEMO_LIMITS.maxPreviewsTotal,
      maxSourceSec: DEMO_LIMITS.maxSourceSec,
      maxTargetDurationSec: DEMO_LIMITS.maxTargetDurationSec,
      maxWatermarks: DEMO_LIMITS.maxWatermarks,
      maxOutros: DEMO_LIMITS.maxOutros,
      allowedTranscriptSources: DEMO_LIMITS.allowedTranscriptSources,
      lockedFeatures: DEMO_LIMITS.lockedFeatures,
    };
  }

  async getDailyDemoJobsUsage(): Promise<{ used: number; limit: number }> {
    const key = `demo:jobs:daily:${utcDateKey()}`;
    try {
      const client = await this.client();
      const raw = await client.get(key);
      const parsed = raw ? Number.parseInt(raw, 10) : 0;
      return {
        used: Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
        limit: this.config.demoDailyJobLimit,
      };
    } catch {
      return { used: 0, limit: this.config.demoDailyJobLimit };
    }
  }

  async assertRegistrationIpAllowed(ip: string): Promise<void> {
    const cleanIp = ip.trim() || 'unknown';
    const key = `demo:reg:ip:${cleanIp}:${utcDateKey()}`;
    try {
      const client = await this.client();
      const currentRaw = await client.get(key);
      const current = currentRaw ? Number.parseInt(currentRaw, 10) : 0;
      if (Number.isFinite(current) && current >= this.config.registerIpDailyLimit) {
        throw new HttpException(
          'Terlalu banyak pendaftaran dari jaringan ini hari ini. Coba lagi besok atau gunakan akun yang sudah ada.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await client.runCommand('demoIncrDaily', [
        key,
        String(DAILY_KEY_TTL_SEC),
      ]);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `Rate-limit registrasi dilewati karena Redis bermasalah: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async assertPreviewAllowed(
    userId: string,
    role: UserRole | undefined,
    input: {
      transcriptSource: TranscriptSource;
      maxSourceSec?: number | null;
      targetDurationSec: number;
    },
  ): Promise<{ maxSourceSec: number | null }> {
    if (!isDemoRole(role)) {
      return { maxSourceSec: input.maxSourceSec ?? null };
    }

    const previewsUsed = await this.prisma.userEvent.count({
      where: { userId, event: 'preview_created' },
    });

    const result = validateDemoPreview({
      transcriptSource: input.transcriptSource,
      maxSourceSec: input.maxSourceSec,
      targetDurationSec: input.targetDurationSec,
      previewsUsed,
    });

    if (!result.ok) {
      throw new ForbiddenException(result.message);
    }

    return { maxSourceSec: result.data.effectiveMaxSourceSec };
  }

  async assertJobAllowed(
    userId: string,
    role: UserRole | undefined,
    input: {
      mode: 'auto' | 'manual';
      transcriptSource: TranscriptSource;
      targetDurationSec: number;
      ranges: readonly { start: number; end: number }[];
    },
  ): Promise<void> {
    if (!isDemoRole(role)) return;

    const quota = await this.getQuota(userId);
    const result = validateDemoJob({
      mode: input.mode,
      transcriptSource: input.transcriptSource,
      targetDurationSec: input.targetDurationSec,
      ranges: input.ranges,
      jobsUsed: quota.jobsUsed,
      activeJobs: quota.activeJobs,
      clipsUsed: quota.clipsUsed,
    });

    if (!result.ok) {
      throw new ForbiddenException(result.message);
    }

    const daily = await this.getDailyDemoJobsUsage();
    if (daily.used >= daily.limit) {
      throw new HttpException(
        'Kapasitas render demo harian server sudah penuh. Coba lagi besok atau unduh aplikasi desktop DartClip.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordDemoJobCreated(): Promise<void> {
    const key = `demo:jobs:daily:${utcDateKey()}`;
    try {
      const client = await this.client();
      await client.runCommand('demoIncrDaily', [
        key,
        String(DAILY_KEY_TTL_SEC),
      ]);
    } catch {
      // Best-effort counter; jangan gagalkan job yang sudah antre.
    }
  }

  assertPublishOrSocialAllowed(role: UserRole | undefined): void {
    if (isDemoRole(role)) {
      throw new ForbiddenException(
        'Koneksi akun sosial dan publikasi tidak tersedia di mode demo. Gunakan aplikasi desktop atau self-host.',
      );
    }
  }

  watermarkLimitForRole(role: UserRole | undefined, defaultLimit: number): number {
    return isDemoRole(role) ? DEMO_LIMITS.maxWatermarks : defaultLimit;
  }

  outroLimitForRole(role: UserRole | undefined, defaultLimit: number): number {
    return isDemoRole(role) ? DEMO_LIMITS.maxOutros : defaultLimit;
  }
}
