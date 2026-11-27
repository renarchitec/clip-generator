import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BriefsModule } from '../briefs/briefs.module';
import { QUEUE_NAME } from '../queue/queue.constants';
import { QueueModule } from '../queue/queue.module';
import { OutrosModule } from '../outros/outros.module';
import { WatermarksModule } from '../watermarks/watermarks.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { MediaModule } from '../media/media.module';

@Module({
  // registerQueue lokal supaya @InjectQueue tersedia di modul ini; konfigurasi koneksi dari QueueModule.
  imports: [MediaModule,QueueModule, WatermarksModule, OutrosModule, BriefsModule, BullModule.registerQueue({ name: QUEUE_NAME })],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
