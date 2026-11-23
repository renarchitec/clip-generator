import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ClipsModule } from './clips/clips.module';
import { AppConfigModule } from './config/app-config.module';
import { validateEnv } from './config/env.validation';
import { JobsModule } from './jobs/jobs.module';
import { PreviewsModule } from './previews/previews.module';
import { PrismaModule } from './prisma/prisma.module';
import { PublishModule } from './publish/publish.module';
import { SocialModule } from './social/social.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    AppConfigModule,
    PrismaModule,
    AuthModule,
    JobsModule,
    PreviewsModule,
    ClipsModule,
    SocialModule,
    PublishModule,
    SystemModule,
  ],
})
export class AppModule {}
