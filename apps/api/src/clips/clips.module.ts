import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueEvents } from 'bullmq';
import { AppConfig } from '../config/app-config.service';
import { QueueModule } from '../queue/queue.module';
import { CAPTION_QUEUE_NAME } from '../queue/queue.constants';
import { redisConnection } from '../queue/redis';
import { CAPTION_QUEUE_EVENTS, ClipCaptionsService } from './clip-captions.service';
import { ClipsController } from './clips.controller';
import { PublicMediaController } from './public-media.controller';
import { ClipsService } from './clips.service';

@Module({
  // QueueModule menyediakan koneksi BullMQ root; antrean `captions` didaftarkan lokal.
  imports: [QueueModule, BullModule.registerQueue({ name: CAPTION_QUEUE_NAME })],
  controllers: [ClipsController, PublicMediaController],
  providers: [
    ClipsService,
    ClipCaptionsService,
    {
      provide: CAPTION_QUEUE_EVENTS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        new QueueEvents(CAPTION_QUEUE_NAME, {
          connection: redisConnection(config.redisUrl),
        }),
    },
  ],
})
export class ClipsModule {}
