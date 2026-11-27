import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PREVIEW_QUEUE_NAME } from '../queue/queue.constants';
import { QueueModule } from '../queue/queue.module';
import { PreviewsController } from './previews.controller';
import { PreviewsService } from './previews.service';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [MediaModule, QueueModule, BullModule.registerQueue({ name: PREVIEW_QUEUE_NAME })],
  controllers: [PreviewsController],
  providers: [PreviewsService],
  exports: [PreviewsService],
})
export class PreviewsModule {}
