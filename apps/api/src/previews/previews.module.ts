import { Module } from '@nestjs/common';
import { PREVIEW_QUEUE_NAME } from '../queue/queue.constants';
import { QueueModule, registerServerQueue } from '../queue/queue.module';
import { PreviewsController } from './previews.controller';
import { PreviewsService } from './previews.service';

@Module({
  imports: [QueueModule, ...registerServerQueue(PREVIEW_QUEUE_NAME)],
  controllers: [PreviewsController],
  providers: [PreviewsService],
  exports: [PreviewsService],
})
export class PreviewsModule {}
