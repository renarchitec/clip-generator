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

  @Get('youtube/connect')
  async youtubeConnect(
    @Res() res: Response,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    try {
      const url = await this.social.youtubeConnectUrl(user.id);
      res.redirect(302, url);
    } catch (error) {
      this.redirectError(res, error, 'oauth_start');
    }
  }

  @Get('youtube/callback')
  async youtubeCallback(
    @Res() res: Response,
    @CurrentUser() user: { id: string },
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<void> {
    try {
      await this.social.completeYoutubeCallback(user.id, code, state);
      res.redirect(
        302,
        buildSettingsRedirect(this.config.publicWebUrl, {
          connected: 'youtube',
        }),
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
