import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { OUTRO_MAX_BYTES } from './outro-helpers';
import { OutrosService } from './outros.service';

/** Bentuk file dari multer memory storage (tanpa @types/multer). */
interface UploadedVideo {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('outros')
export class OutrosController {
  constructor(private readonly outros: OutrosService) {}

  /** Unggah video outro (multipart `file`, opsional `name`); MP4/MOV, maks 50 MB. */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // Memory storage; ftyp + durasi diverifikasi di service. +1 agar >50 MB terdeteksi di service (400).
      limits: { fileSize: OUTRO_MAX_BYTES + 1, files: 1, fields: 4 },
    }),
  )
  upload(
    @UploadedFile() file: UploadedVideo | undefined,
    @Body() body: { name?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.outros.upload(file, body?.name, user.id, user.role);
  }

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.outros.list(user.id);
  }

  /** Harus di atas rute :id agar tidak tertangkap sebagai id outro. */
  @Get('default')
  getDefault(@CurrentUser() user: { id: string }) {
    return this.outros.getDefault(user.id);
  }

  @Put('default')
  setDefault(@Body() body: unknown, @CurrentUser() user: { id: string }) {
    // Body bisa { outroId } atau null; validasi lewat zod di service.
    return this.outros.setDefault(body ?? null, user.id);
  }

  /** Streaming dengan dukungan HTTP Range (res.sendFile) agar <video> bisa seek. */
  @Get(':id/file')
  stream(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user: { id: string },
  ) {
    return this.outros.stream(id, user.id, res);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.outros.remove(id, user.id);
  }
}
