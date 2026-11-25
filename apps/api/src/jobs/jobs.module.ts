import { Module } from '@nestjs/common';
import { BriefsModule } from '../briefs/briefs.module';
import { QUEUE_NAME } from '../queue/queue.constants';
import { QueueModule, registerServerQueue } from '../queue/queue.module';
import { OutrosModule } from '../outros/outros.module';
import { WatermarksModule } from '../watermarks/watermarks.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  // registerQueue lokal supaya @InjectQueue tersedia di modul ini; konfigurasi koneksi dari QueueModule.
  imports: [QueueModule, WatermarksModule, OutrosModule, BriefsModule, ...registerServerQueue(QUEUE_NAME)],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
