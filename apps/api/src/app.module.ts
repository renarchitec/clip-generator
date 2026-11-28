import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BriefsModule } from './briefs/briefs.module';
import { ClipsModule } from './clips/clips.module';
import { AppConfigModule } from './config/app-config.module';
import { validateEnv } from './config/env.validation';
import { MediaModule } from './media/media.module';
import { DemoModule } from './demo/demo.module';
import { JobsModule } from './jobs/jobs.module';
import { FramesModule } from './frames/frames.module';
import { PreviewsModule } from './previews/previews.module';
import { PrismaModule } from './prisma/prisma.module';
import { PublishModule } from './publish/publish.module';
import { SocialModule } from './social/social.module';
import { SystemModule } from './system/system.module';
import { OutrosModule } from './outros/outros.module';
import { WatermarksModule } from './watermarks/watermarks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    AppConfigModule,
    PrismaModule,
    DemoModule,
    AuthModule,
    AdminModule,
    JobsModule,
    MediaModule,
    WatermarksModule,
    OutrosModule,
    PreviewsModule,
    FramesModule,
    ClipsModule,
    BriefsModule,
    SocialModule,
    PublishModule,
    SystemModule,
  ],
})
export class AppModule {}
