import type { ConnectionOptions } from 'bullmq';

/** BullMQ butuh ioredis, tapi RedisOptions dari URL lebih aman diurai sendiri daripada menambah dependency. */
export function redisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const db = url.pathname.replace('/', '');

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: db ? Number(db) : undefined,
    maxRetriesPerRequest: null,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
