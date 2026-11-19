import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { LlmStatusController } from './llm-status.controller';
import { LlmStatusService } from './llm-status.service';

@Module({
  imports: [QueueModule],
  controllers: [LlmStatusController],
  providers: [LlmStatusService],
})
export class SystemModule {}
