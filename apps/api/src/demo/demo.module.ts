import { Global, Module } from '@nestjs/common';
import { DemoService } from './demo.service';
import { EventsController } from './events.controller';

@Global()
@Module({
  controllers: [EventsController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
