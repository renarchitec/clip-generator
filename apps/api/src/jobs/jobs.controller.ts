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
import type { AuthUser } from '../auth/auth.types';
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
  create(@Body() dto: CreateJobDto, @CurrentUser() user: AuthUser) {
    return this.jobs.create(dto, user.id, user.role);
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

  /** Buat job baru dari konfigurasi job lama; hanya job failed/cancelled. */
  @Post(':id/retry')
  retry(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobs.retry(id, user.id, user.role);
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
