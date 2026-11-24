import { Module } from '@nestjs/common';
import { OutrosController } from './outros.controller';
import { OutrosService } from './outros.service';

@Module({
  controllers: [OutrosController],
  providers: [OutrosService],
  exports: [OutrosService],
})
export class OutrosModule {}
