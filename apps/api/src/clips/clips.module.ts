import { Module } from '@nestjs/common';
import { createQueueEventsProvider, QueueModule, registerServerQueue } from '../queue/queue.module';
import { CAPTION_QUEUE_NAME } from '../queue/queue.constants';
import { CAPTION_QUEUE_EVENTS, ClipCaptionsService } from './clip-captions.service';
import { ClipsController } from './clips.controller';
import { PublicMediaController } from './public-media.controller';
import { ClipsService } from './clips.service';

@Module({
  // QueueModule menyediakan koneksi BullMQ root; antrean `captions` didaftarkan lokal.
  imports: [QueueModule, ...registerServerQueue(CAPTION_QUEUE_NAME)],
  controllers: [ClipsController, PublicMediaController],
  providers: [
    ClipsService,
    ClipCaptionsService,
    createQueueEventsProvider(CAPTION_QUEUE_EVENTS, CAPTION_QUEUE_NAME),
  ],
})
export class ClipsModule {}
