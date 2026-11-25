import { Module } from '@nestjs/common';
import { FRAME_QUEUE_NAME } from '../queue/queue.constants';
import { QueueModule, registerServerQueue } from '../queue/queue.module';
import { FramesController } from './frames.controller';
import { FramesService } from './frames.service';
@Module({ imports: [QueueModule, ...registerServerQueue(FRAME_QUEUE_NAME)], controllers: [FramesController], providers: [FramesService] })
export class FramesModule {}
