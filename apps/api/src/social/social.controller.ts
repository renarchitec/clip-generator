import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { SocialPlatform } from '@clipper/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppConfig } from '../config/app-config.service';
import { buildSettingsRedirect } from './oauth';
import { SocialProviderError } from './social-provider';
import { SocialService } from './social.service';

@Controller('social')
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly config: AppConfig,
  ) {}

  @Get('providers')
  providers() {
    return this.social.listProviders();
  }

  @Get('accounts')
  accounts(@CurrentUser() user: { id: string }) {
    return this.social.listAccounts(user.id);
  }

  @Delete('accounts/:id')
  @HttpCode(204)
  async removeAccount(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.social.removeAccount(id, user.id);
  }

  @Get('accounts/:id/tiktok/creator-info')
  tiktokCreatorInfo(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.social.tiktokCreatorInfo(id, user.id);
  }

  @Get('youtube/connect')
  youtubeConnect(
    @Res() res: Response,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    return this.connect(res, user.id, 'youtube');
  }

  @Get('youtube/callback')
  youtubeCallback(
    @Res() res: Response,
    @CurrentUser() user: { id: string },
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<void> {
    return this.callback(res, user.id, 'youtube', code, state);
  }

  @Get('tiktok/connect')
  tiktokConnect(
    @Res() res: Response,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    return this.connect(res, user.id, 'tiktok');
  }

  @Get('tiktok/callback')
  tiktokCallback(
    @Res() res: Response,
    @CurrentUser() user: { id: string },
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') providerError?: string,
  ): Promise<void> {
    // TikTok mengirim ?error=access_denied bila pengguna menolak.
    if (providerError) {
      this.redirectError(res, new SocialProviderError('access_denied'), 'oauth_failed');
      return Promise.resolve();
    }
    return this.callback(res, user.id, 'tiktok', code, state);
  }

  @Get('instagram/connect')
  instagramConnect(
    @Res() res: Response,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    return this.connect(res, user.id, 'instagram');
  }

  @Get('instagram/callback')
  instagramCallback(
    @Res() res: Response,
    @CurrentUser() user: { id: string },
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') providerError?: string,
  ): Promise<void> {
    // Instagram mengirim ?error=access_denied bila pengguna menolak.
    if (providerError) {
      const code =
        providerError === 'access_denied' ? 'access_denied' : 'oauth_failed';
      this.redirectError(res, new SocialProviderError(code), 'oauth_failed');
      return Promise.resolve();
    }
    return this.callback(res, user.id, 'instagram', code, state);
  }

  private async connect(
    res: Response,
    userId: string,
    platform: SocialPlatform,
  ): Promise<void> {
    try {
      res.redirect(302, await this.social.connectUrl(userId, platform));
    } catch (error) {
      this.redirectError(res, error, 'oauth_start');
    }
  }

  private async callback(
    res: Response,
    userId: string,
    platform: SocialPlatform,
    code: string | undefined,
    state: string | undefined,
  ): Promise<void> {
    try {
      await this.social.completeCallback(userId, platform, code, state);
      res.redirect(
        302,
        buildSettingsRedirect(this.config.publicWebUrl, { connected: platform }),
      );
    } catch (error) {
      this.redirectError(res, error, 'oauth_failed');
    }
  }

  private redirectError(res: Response, error: unknown, fallback: string): void {
    const candidate = error instanceof SocialProviderError ? error.code : fallback;
    const code = /^[a-z_]{1,40}$/.test(candidate) ? candidate : fallback;
    res.redirect(
      302,
      buildSettingsRedirect(this.config.publicWebUrl, { social_error: code }),
    );
  }
}
