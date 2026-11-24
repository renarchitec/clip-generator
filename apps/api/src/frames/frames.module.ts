import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FRAME_QUEUE_NAME } from '../queue/queue.constants';
import { QueueModule } from '../queue/queue.module';
import { FramesController } from './frames.controller';
import { FramesService } from './frames.service';
@Module({ imports: [QueueModule, BullModule.registerQueue({ name: FRAME_QUEUE_NAME })], controllers: [FramesController], providers: [FramesService] })
export class FramesModule {}
