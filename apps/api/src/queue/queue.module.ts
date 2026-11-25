import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { QueueEvents } from 'bullmq';
import { AppConfig } from '../config/app-config.service';
import { JobEventsService } from './job-events.service';
import { LocalQueueBackend } from './local-queue.backend';
import {
  CAPTION_QUEUE_NAME,
  FRAME_QUEUE_NAME,
  PREVIEW_QUEUE_NAME,
  PUBLISH_QUEUE_NAME,
  QUEUE_EVENTS,
  QUEUE_NAME,
  REFERENCE_QUEUE_NAME,
} from './queue.constants';
import { QueueListener } from './queue.listener';
import { redisConnection } from './redis';

const ALL_LOCAL_QUEUES = [
  QUEUE_NAME,
  PREVIEW_QUEUE_NAME,
  FRAME_QUEUE_NAME,
  CAPTION_QUEUE_NAME,
  REFERENCE_QUEUE_NAME,
  PUBLISH_QUEUE_NAME,
] as const;

export function isDesktopMode(): boolean {
  return process.env.DARTCLIP_MODE === 'desktop';
}

/**
 * Helper dipakai modul fitur (`JobsModule`, `BriefsModule`, dll.) untuk mendaftarkan
 * token BullMQ hanya di mode server. Di mode desktop token antrean sudah disediakan
 * global oleh `QueueModule` lewat `LocalQueueBackend`.
 */
export function registerServerQueue(name: string): DynamicModule[] {
  return isDesktopMode() ? [] : [BullModule.registerQueue({ name })];
}

/** Factory provider `QueueEvents` yang memilih BullMQ di server dan adapter lokal di desktop. */
export function createQueueEventsProvider(
  provide: string,
  queueName: string,
): Provider {
  return isDesktopMode()
    ? {
        provide,
        inject: [LocalQueueBackend],
        useFactory: (backend: LocalQueueBackend) => backend.getQueueEvents(queueName),
      }
    : {
        provide,
        inject: [AppConfig],
        useFactory: (config: AppConfig) =>
          new QueueEvents(queueName, {
            connection: redisConnection(config.redisUrl),
          }),
      };
}

function buildDesktopProviders(): Provider[] {
  const queueProviders: Provider[] = ALL_LOCAL_QUEUES.map((name) => ({
    provide: getQueueToken(name),
    inject: [LocalQueueBackend],
    useFactory: (backend: LocalQueueBackend) => backend.getQueue(name),
  }));

  return [
    LocalQueueBackend,
    ...queueProviders,
    JobEventsService,
    QueueListener,
    {
      provide: QUEUE_EVENTS,
      inject: [LocalQueueBackend],
      useFactory: (backend: LocalQueueBackend) => backend.getQueueEvents(QUEUE_NAME),
    },
  ];
}

function buildServerImports(): DynamicModule[] {
  return [
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: redisConnection(config.redisUrl),
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_NAME }),
    BullModule.registerQueue({ name: PREVIEW_QUEUE_NAME }),
    BullModule.registerQueue({ name: FRAME_QUEUE_NAME }),
    BullModule.registerQueue({ name: REFERENCE_QUEUE_NAME }),
  ];
}

@Global()
@Module({
  imports: isDesktopMode() ? [] : buildServerImports(),
  providers: isDesktopMode()
    ? buildDesktopProviders()
    : [
        JobEventsService,
        QueueListener,
        {
          provide: QUEUE_EVENTS,
          inject: [AppConfig],
          useFactory: (config: AppConfig) =>
            new QueueEvents(QUEUE_NAME, {
              connection: redisConnection(config.redisUrl),
            }),
        },
      ],
  exports: isDesktopMode()
    ? [
        JobEventsService,
        LocalQueueBackend,
        ...ALL_LOCAL_QUEUES.map((name) => getQueueToken(name)),
      ]
    : [JobEventsService, BullModule],
})
export class QueueModule {}
