import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BriefsModule } from './briefs/briefs.module';
import { ClipsModule } from './clips/clips.module';
import { AppConfigModule } from './config/app-config.module';
import { validateEnv } from './config/env.validation';
import { JobsModule } from './jobs/jobs.module';
import { FramesModule } from './frames/frames.module';
import { PreviewsModule } from './previews/previews.module';
import { PrismaModule } from './prisma/prisma.module';
import { PublishModule } from './publish/publish.module';
import { ReferenceJobsModule } from './reference-jobs/reference-jobs.module';
import { SocialModule } from './social/social.module';
import { SystemModule } from './system/system.module';
import { OutrosModule } from './outros/outros.module';
import { WatermarksModule } from './watermarks/watermarks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    AppConfigModule,
    PrismaModule,
    AuthModule,
    JobsModule,
    WatermarksModule,
    OutrosModule,
    PreviewsModule,
    FramesModule,
    ClipsModule,
    BriefsModule,
    SocialModule,
    PublishModule,
    ReferenceJobsModule,
    SystemModule,
  ],
})
export class AppModule {}
