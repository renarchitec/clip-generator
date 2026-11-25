import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma as PgPrisma, PrismaClient } from '@prisma/client';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface LoadedPrismaModule {
  PrismaClient: typeof PrismaClient;
  Prisma: typeof PgPrisma;
}

function loadPrismaModule(): LoadedPrismaModule {
  if (process.env.DARTCLIP_MODE !== 'desktop') {
    return { PrismaClient, Prisma: PgPrisma };
  }

  // Client SQLite dibangkitkan terpisah dari prisma/schema.sqlite.prisma supaya
  // @prisma/client PostgreSQL untuk mode server tidak tertimpa.
  const candidates = [
    process.env.DARTCLIP_SQLITE_CLIENT_PATH,
    path.resolve(__dirname, '../../../node_modules/.prisma/sqlite-client'),
    path.resolve(__dirname, '../../node_modules/.prisma/sqlite-client'),
    path.resolve(process.cwd(), 'node_modules/.prisma/sqlite-client'),
    path.resolve(process.cwd(), 'apps/api/node_modules/.prisma/sqlite-client'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(candidate) as LoadedPrismaModule;
      return mod;
    }
  }

  throw new Error(
    `SQLite Prisma client tidak ditemukan (jalankan pnpm --filter api prisma:sqlite:generate). Dicari: ${candidates.join(', ')}`,
  );
}

function resolveSqliteInitSql(): string | null {
  const candidates = [
    process.env.DARTCLIP_SQLITE_INIT_SQL,
    path.resolve(__dirname, '../../../prisma/sqlite-init.sql'),
    path.resolve(__dirname, '../../prisma/sqlite-init.sql'),
    path.resolve(process.cwd(), 'prisma/sqlite-init.sql'),
    path.resolve(process.cwd(), 'apps/api/prisma/sqlite-init.sql'),
  ].filter((p): p is string => Boolean(p));

  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Terjemahkan sentinel `Prisma.DbNull`/`JsonNull`/`AnyNull` dari `@prisma/client`
 * ke sentinel milik SQLite client SEBELUM masuk ke delegate Prisma (Prisma `$extends`
 * meng-clone args lebih dulu dan merusak sentinel kelas asing menjadi `{}`).
 */
function remapNullSentinels(value: unknown, target: typeof PgPrisma): unknown {
  if (value === PgPrisma.DbNull) return target.DbNull;
  if (value === PgPrisma.JsonNull) return target.JsonNull;
  if (value === PgPrisma.AnyNull) return target.AnyNull;
  if (Array.isArray(value)) {
    return value.map((item) => remapNullSentinels(item, target));
  }
  if (
    value &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = remapNullSentinels(v, target);
    }
    return out;
  }
  return value;
}

const MODEL_DELEGATES = new Set([
  'user',
  'session',
  'job',
  'watermark',
  'outro',
  'briefHistory',
  'referenceJob',
  'clip',
  'socialAccount',
  'publication',
]);

function wrapDelegate<T extends object>(delegate: T, targetPrisma: typeof PgPrisma): T {
  return new Proxy(delegate, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) =>
        value.apply(
          obj,
          args.map((arg) => remapNullSentinels(arg, targetPrisma)),
        );
    },
  });
}

function wrapClient<T extends object>(client: T, targetPrisma: typeof PgPrisma): T {
  const delegateCache = new Map<PropertyKey, unknown>();
  return new Proxy(client, {
    get(obj, prop, receiver) {
      if (typeof prop === 'string' && MODEL_DELEGATES.has(prop)) {
        if (!delegateCache.has(prop)) {
          const raw = Reflect.get(obj, prop, obj) as object;
          delegateCache.set(prop, wrapDelegate(raw, targetPrisma));
        }
        return delegateCache.get(prop);
      }
      if (prop === '$transaction') {
        const rawTx = Reflect.get(obj, prop, obj) as (
          arg: unknown,
          opts?: unknown,
        ) => Promise<unknown>;
        return (arg: unknown, opts?: unknown) => {
          if (typeof arg === 'function') {
            return rawTx.call(
              obj,
              (tx: object) => (arg as (t: object) => unknown)(wrapClient(tx, targetPrisma)),
              opts,
            );
          }
          return rawTx.call(obj, arg, opts);
        };
      }
      const value = Reflect.get(obj, prop, receiver);
      return typeof value === 'function' ? value.bind(obj) : value;
    },
  });
}

const LoadedPrisma = loadPrismaModule();
const BasePrismaClient = LoadedPrisma.PrismaClient;

@Injectable()
export class PrismaService
  extends BasePrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    if (process.env.DARTCLIP_MODE === 'desktop') {
      const url = process.env.DATABASE_URL ?? '';
      if (url.startsWith('file:')) {
        const dbPath = url.slice('file:'.length).split('?')[0];
        if (dbPath && dbPath !== ':memory:') {
          mkdirSync(path.dirname(dbPath), { recursive: true });
        }
      }
    }
    super();

    if (process.env.DARTCLIP_MODE === 'desktop' && LoadedPrisma.Prisma !== PgPrisma) {
      return wrapClient(this, LoadedPrisma.Prisma);
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    if (process.env.DARTCLIP_MODE === 'desktop') {
      await this.initSqliteSchema();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private async initSqliteSchema(): Promise<void> {
    const sqlPath = resolveSqliteInitSql();
    if (!sqlPath) {
      throw new Error('prisma/sqlite-init.sql tidak ditemukan untuk inisialisasi SQLite desktop.');
    }
    const raw = readFileSync(sqlPath, 'utf8');
    const statements = raw
      .split(/;\s*\n/)
      .map((chunk) =>
        chunk
          .split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim(),
      )
      .filter(Boolean);

    for (const stmt of statements) {
      if (/^PRAGMA\b/i.test(stmt)) {
        await this.$queryRawUnsafe(stmt);
      } else {
        await this.$executeRawUnsafe(stmt);
      }
    }
    await this.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await this.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
    this.logger.log(`SQLite schema siap (${sqlPath})`);
  }
}
