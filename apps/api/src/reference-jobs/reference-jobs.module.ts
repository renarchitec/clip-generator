import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueEvents } from 'bullmq';
import { AppConfig } from '../config/app-config.service';
import { QueueModule } from '../queue/queue.module';
import { REFERENCE_QUEUE_EVENTS, REFERENCE_QUEUE_NAME } from '../queue/queue.constants';
import { redisConnection } from '../queue/redis';
import { ReferenceEventsService } from './reference-events.service';
import { ReferenceJobsController } from './reference-jobs.controller';
import { ReferenceJobsService } from './reference-jobs.service';
import { ReferenceQueueListener } from './reference-queue.listener';

@Module({
  imports: [QueueModule, BullModule.registerQueue({ name: REFERENCE_QUEUE_NAME })],
  controllers: [ReferenceJobsController],
  providers: [ReferenceJobsService, ReferenceEventsService, ReferenceQueueListener, { provide: REFERENCE_QUEUE_EVENTS, inject: [AppConfig], useFactory: (config: AppConfig) => new QueueEvents(REFERENCE_QUEUE_NAME, { connection: redisConnection(config.redisUrl) }) }],
  exports: [ReferenceJobsService],
})
export class ReferenceJobsModule {}
