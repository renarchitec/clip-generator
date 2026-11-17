import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClipsModule } from './clips/clips.module';
import { AppConfigModule } from './config/app-config.module';
import { validateEnv } from './config/env.validation';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    AppConfigModule,
    PrismaModule,
    JobsModule,
    ClipsModule,
  ],
})
export class AppModule {}
