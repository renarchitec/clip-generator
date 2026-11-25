import { Body, Controller, Delete, Get, HttpCode, MessageEvent, Param, Post, Res, Sse, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Observable, concat, map, of } from 'rxjs';
import type { ReferenceFootageItem, ReferenceJobResponse } from '@clipper/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { ReferenceEventsService } from './reference-events.service';
import { ReferenceJobsService } from './reference-jobs.service';
import { REFERENCE_MAX_FILE_BYTES } from './reference-helpers';

interface UploadedVideo { originalname: string; mimetype: string; size: number; buffer: Buffer }

@Controller('reference-jobs')
export class ReferenceJobsController {
  constructor(private readonly jobs: ReferenceJobsService, private readonly referenceEvents: ReferenceEventsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: REFERENCE_MAX_FILE_BYTES + 1, files: 1 } }))
  upload(@UploadedFile() file: UploadedVideo | undefined, @CurrentUser() user: { id: string }): Promise<ReferenceFootageItem> { return this.jobs.upload(file, user.id); }

  @Post()
  create(@Body() dto: unknown, @CurrentUser() user: { id: string }): Promise<ReferenceJobResponse> { return this.jobs.create((dto ?? {}) as never, user.id); }

  @Get()
  findAll(@CurrentUser() user: { id: string }): Promise<ReferenceJobResponse[]> { return this.jobs.findAll(user.id); }

  // Static routes must precede :id routes.
  @Get('uploads/:fileId')
  uploadStream(@Param('fileId') fileId: string, @Res() res: Response, @CurrentUser() user: { id: string }): Promise<void> { return this.jobs.sendUpload(fileId, user.id, res); }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: { id: string }): Promise<ReferenceJobResponse> { return this.jobs.findOne(id, user.id); }

  @Get(':id/stream')
  stream(@Param('id') id: string, @Res() res: Response, @CurrentUser() user: { id: string }): Promise<void> { return this.jobs.sendOutput(id, user.id, res, false); }

  @Get(':id/download')
  download(@Param('id') id: string, @Res() res: Response, @CurrentUser() user: { id: string }): Promise<void> { return this.jobs.sendOutput(id, user.id, res, true); }

  @Sse(':id/events')
  async events(@Param('id') id: string, @CurrentUser() user: { id: string }): Promise<Observable<MessageEvent>> {
    const current = await this.jobs.findOne(id, user.id);
    if (['done', 'failed', 'cancelled'].includes(current.status)) return of({ data: current } as MessageEvent);
    return concat(of({ data: current } as MessageEvent), this.referenceEvents.watch(id).pipe(map((data) => ({ data } as MessageEvent))));
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: { id: string }): Promise<ReferenceJobResponse> { return this.jobs.cancel(id, user.id); }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string }): Promise<void> { await this.jobs.remove(id, user.id); }
}
