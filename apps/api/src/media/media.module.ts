import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import { MulterModule } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { MEDIA_UPLOAD_MAX_BYTES } from '@clipper/shared';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { AppConfig } from '../config/app-config.service';
import { CAPTION_QUEUE_NAME } from '../queue/queue.constants';
import { QueueModule } from '../queue/queue.module';
import { redisConnection } from '../queue/redis';
import { MEDIA_QUEUE_EVENTS, MediaActionsService } from './media-actions.service';
import { ensureMediaDirectory } from './media-helpers';
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
  imports: [QueueModule, BullModule.registerQueue({ name: CAPTION_QUEUE_NAME }), MulterModule.registerAsync({
    inject: [AppConfig],
    useFactory: (config: AppConfig): MulterOptions => ({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
          ensureMediaDirectory(config.clipsDir, 0o700, '.tmp-uploads').then(
            (directory) => cb(null, directory), (error: Error) => cb(error, ''),
          );
        },
        filename: (_req, _file, cb) => cb(null, randomUUID()),
      }),
      limits: { fileSize: MEDIA_UPLOAD_MAX_BYTES + 1, files: 1, fields: 4 },
    }),
  })],
  controllers: [MediaController],
  providers: [MediaService, MediaResolverService, MediaActionsService, {
    provide: MEDIA_QUEUE_EVENTS,
    inject: [AppConfig],
    useFactory: (config: AppConfig) => new QueueEvents(CAPTION_QUEUE_NAME, {
      connection: redisConnection(config.redisUrl),
    }),
  }],
  exports: [MediaResolverService],
})
export class MediaModule {}
