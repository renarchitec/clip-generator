import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueEvents } from 'bullmq';
import { AppConfig } from '../config/app-config.service';
import { QueueModule } from '../queue/queue.module';
import { CAPTION_QUEUE_NAME } from '../queue/queue.constants';
import { redisConnection } from '../queue/redis';
import { BriefsController } from './briefs.controller';
import { BRIEF_QUEUE_EVENTS, BriefsService } from './briefs.service';

@Module({
  imports: [QueueModule, BullModule.registerQueue({ name: CAPTION_QUEUE_NAME })],
  controllers: [BriefsController],
  providers: [
    BriefsService,
    {
      provide: BRIEF_QUEUE_EVENTS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new QueueEvents(CAPTION_QUEUE_NAME, {
        connection: redisConnection(config.redisUrl),
      }),
    },
  ],
})
export class BriefsModule {}
