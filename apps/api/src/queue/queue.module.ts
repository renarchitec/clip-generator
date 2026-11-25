import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueEvents } from 'bullmq';
import type { JobData } from '@clipper/shared';
import { AppConfig } from '../config/app-config.service';
import { JobEventsService } from './job-events.service';
import { FRAME_QUEUE_NAME, QUEUE_EVENTS, PREVIEW_QUEUE_NAME, QUEUE_NAME, REFERENCE_QUEUE_NAME } from './queue.constants';
import { QueueListener } from './queue.listener';
import { redisConnection } from './redis';

@Module({
  imports: [
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
  ],
  providers: [
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
  exports: [JobEventsService, BullModule],
})
export class QueueModule {}
