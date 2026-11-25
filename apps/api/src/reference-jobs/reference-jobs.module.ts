import { Module } from '@nestjs/common';
import { createQueueEventsProvider, QueueModule, registerServerQueue } from '../queue/queue.module';
import { REFERENCE_QUEUE_EVENTS, REFERENCE_QUEUE_NAME } from '../queue/queue.constants';
import { ReferenceEventsService } from './reference-events.service';
import { ReferenceJobsController } from './reference-jobs.controller';
import { ReferenceJobsService } from './reference-jobs.service';
import { ReferenceQueueListener } from './reference-queue.listener';

@Module({
  imports: [QueueModule, ...registerServerQueue(REFERENCE_QUEUE_NAME)],
  controllers: [ReferenceJobsController],
  providers: [
    ReferenceJobsService,
    ReferenceEventsService,
    ReferenceQueueListener,
    createQueueEventsProvider(REFERENCE_QUEUE_EVENTS, REFERENCE_QUEUE_NAME),
  ],
  exports: [ReferenceJobsService],
})
export class ReferenceJobsModule {}
