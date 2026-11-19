import { Controller, Get } from '@nestjs/common';
import { LlmStatusService } from './llm-status.service';

@Controller('system')
export class LlmStatusController {
  constructor(private readonly llmStatus: LlmStatusService) {}

  @Get('llm-status')
  get() {
    return this.llmStatus.get();
  }
}
