import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { MEDIA_UPLOAD_MAX_BYTES } from '@clipper/shared';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { AppConfig } from '../config/app-config.service';
import { MediaController } from './media.controller';
import { MediaResolverService } from './media-resolver.service';
import { MediaService } from './media.service';

// Resolve Multer from the Nest adapter that owns the dependency (pnpm strict resolution).
const multer: {
  diskStorage(options: {
    destination(req: unknown, file: unknown, cb: (error: Error | null, dir: string) => void): void;
    filename(req: unknown, file: unknown, cb: (error: null, filename: string) => void): void;
  }): NonNullable<MulterOptions['storage']>;
} = createRequire(require.resolve('@nestjs/platform-express'))('multer');

@Module({
  imports: [MulterModule.registerAsync({
    inject: [AppConfig],
    useFactory: (config: AppConfig): MulterOptions => {
      const directory = path.join(config.clipsDir, '.tmp-uploads');
      return {
        storage: multer.diskStorage({
          destination: (_req, _file, cb) => {
            mkdir(directory, { recursive: true, mode: 0o700 }).then(
              () => cb(null, directory), (error: Error) => cb(error, directory),
            );
          },
          filename: (_req, _file, cb) => cb(null, randomUUID()),
        }),
        limits: { fileSize: MEDIA_UPLOAD_MAX_BYTES + 1, files: 1, fields: 4 },
      };
    },
  })],
  controllers: [MediaController],
  providers: [MediaService, MediaResolverService],
  exports: [MediaResolverService],
})
export class MediaModule {}
