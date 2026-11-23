import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PUBLISH_QUEUE_NAME } from '../queue/queue.constants';
import { QueueModule } from '../queue/queue.module';
import { SocialModule } from '../social/social.module';
import { PublishController } from './publish.controller';
import { PublishProcessor } from './publish.processor';
import { PublishService } from './publish.service';
import { YoutubeUploader } from './youtube-uploader';

@Module({
  // QueueModule menyediakan koneksi BullMQ root; registerQueue lokal untuk @InjectQueue.
  imports: [
    QueueModule,
    SocialModule,
    BullModule.registerQueue({ name: PUBLISH_QUEUE_NAME }),
  ],
  controllers: [PublishController],
  providers: [PublishService, PublishProcessor, YoutubeUploader],
})
export class PublishModule {}
