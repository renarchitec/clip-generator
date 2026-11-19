import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  MessageEvent,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import { Observable, concat, map, of } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator';
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
  create(@Body() dto: CreateJobDto, @CurrentUser() user: { id: string }) {
    return this.jobs.create(dto, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.jobs.findAll(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.jobs.findOne(id, user.id);
  }

  /** Idempoten: job yang sudah selesai/gagal/dibatalkan dikembalikan apa adanya. */
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.jobs.cancel(id, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.jobs.remove(id, user.id);
  }

  @Sse(':id/events')
  async stream(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<Observable<MessageEvent>> {
    // State sekarang dikirim lebih dulu supaya klien SSE tidak perlu request terpisah.
    const current = await this.jobs.snapshot(id, user.id);

    if (
      current.status === 'done' ||
      current.status === 'failed' ||
      current.status === 'cancelled'
    ) {
      return of({ data: current } as MessageEvent);
    }

    return concat(
      of({ data: current } as MessageEvent),
      this.jobEvents.watch(id).pipe(map((snapshot) => ({ data: snapshot }))),
    );
  }
}
