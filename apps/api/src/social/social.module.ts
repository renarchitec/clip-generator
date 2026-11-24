import { Module } from '@nestjs/common';
import { OAuthStateStore } from './oauth-state.store';
import { SocialController } from './social.controller';
import { TiktokProvider, YoutubeProvider } from './social-provider';
import { SocialService } from './social.service';

@Module({
  controllers: [SocialController],
  providers: [OAuthStateStore, YoutubeProvider, TiktokProvider, SocialService],
  exports: [SocialService],
})
export class SocialModule {}
