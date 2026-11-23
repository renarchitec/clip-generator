import { Module } from '@nestjs/common';
import { OAuthStateStore } from './oauth-state.store';
import { SocialController } from './social.controller';
import { YoutubeProvider } from './social-provider';
import { SocialService } from './social.service';

@Module({
  controllers: [SocialController],
  providers: [OAuthStateStore, YoutubeProvider, SocialService],
  exports: [SocialService],
})
export class SocialModule {}
