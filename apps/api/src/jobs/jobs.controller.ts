import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import { Observable, concat, map, of } from 'rxjs';
import { JobEventsService } from '../queue/job-events.service';
import { CreateJobDto } from './dto/create-job.dto';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly jobEvents: JobEventsService,
  ) {}

  @Post()
  create(@Body() dto: CreateJobDto) {
    return this.jobs.create(dto);
  }

  @Get()
  findAll() {
    return this.jobs.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobs.findOne(id);
  }

  @Sse(':id/events')
  async stream(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    // State sekarang dikirim lebih dulu supaya klien SSE tidak perlu request terpisah.
    const current = await this.jobs.snapshot(id);

    if (current.status === 'done' || current.status === 'failed') {
      return of({ data: current } as MessageEvent);
    }

    return concat(
      of({ data: current } as MessageEvent),
      this.jobEvents.watch(id).pipe(map((snapshot) => ({ data: snapshot }))),
    );
  }
}
