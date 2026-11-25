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
import { CurrentUser } from '../auth/current-user.decorator';
import { WATERMARK_VIDEO_MAX_BYTES } from './watermark-helpers';
import { WatermarksService } from './watermarks.service';

/** Bentuk file dari multer memory storage (tanpa @types/multer). */
interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('watermarks')
export class WatermarksController {
  constructor(private readonly watermarks: WatermarksService) {}

  /** Unggah gambar watermark (multipart `file`, opsional `name`); png/jpeg/webp, maks 2 MB. */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // Multer default = memory storage; buffer diverifikasi lewat magic bytes di service.
      limits: { fileSize: WATERMARK_VIDEO_MAX_BYTES + 1, files: 1, fields: 4 },
    }),
  )
  upload(
    @UploadedFile() file: UploadedImage | undefined,
    @Body() body: { name?: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.watermarks.upload(file, body?.name, user.id);
  }

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.watermarks.list(user.id);
  }

  /** Harus di atas rute :id agar tidak tertangkap sebagai id watermark. */
  @Get('default')
  getDefault(@CurrentUser() user: { id: string }) {
    return this.watermarks.getDefault(user.id);
  }

  @Put('default')
  setDefault(@Body() body: unknown, @CurrentUser() user: { id: string }) {
    // Body bisa satu objek settings, array layer, atau null; validasi lewat zod di service.
    return this.watermarks.setDefault(body ?? null, user.id);
  }

  @Get(':id/file')
  stream(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user: { id: string },
  ) {
    return this.watermarks.stream(id, user.id, res);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.watermarks.remove(id, user.id);
  }
}
