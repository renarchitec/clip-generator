import { Module } from '@nestjs/common';
import { PUBLISH_QUEUE_NAME } from '../queue/queue.constants';
import { isDesktopMode, QueueModule, registerServerQueue } from '../queue/queue.module';
import { SocialModule } from '../social/social.module';
import { PublishController } from './publish.controller';
import { PublishProcessor } from './publish.processor';
import { PublishService } from './publish.service';
import { InstagramUploader } from './instagram-uploader';
import { TiktokUploader } from './tiktok-uploader';
import { YoutubeUploader } from './youtube-uploader';

@Module({
  // QueueModule menyediakan koneksi BullMQ root; registerQueue lokal untuk @InjectQueue.
  imports: [
    QueueModule,
    SocialModule,
    ...registerServerQueue(PUBLISH_QUEUE_NAME),
  ],
  controllers: [PublishController],
  providers: [
    PublishService,
    ...(isDesktopMode() ? [] : [PublishProcessor]),
    YoutubeUploader,
    TiktokUploader,
    InstagramUploader,
  ],
})
export class PublishModule {}
