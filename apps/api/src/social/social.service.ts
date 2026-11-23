import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  SocialAccountResponse,
  SocialPlatform,
  SocialProviderResponse,
} from '@clipper/shared';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { OAuthStateStore } from './oauth-state.store';
import {
  buildYoutubeAuthorizationUrl,
  createOAuthState,
  createPkceChallenge,
  YOUTUBE_SCOPES,
  youtubeCallbackUrl,
} from './oauth';
import { SOCIAL_PLATFORM_LIST } from './social.constants';
import {
  SocialProviderError,
  YoutubeProvider,
  type SocialProvider,
} from './social-provider';
import { decryptSocialToken, encryptSocialToken } from './token-crypto';

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

@Injectable()
export class SocialService {
  private readonly providers: Map<SocialPlatform, SocialProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly youtube: YoutubeProvider,
    private readonly oauthStates: OAuthStateStore,
  ) {
    this.providers = new Map([[youtube.platform, youtube]]);
  }

  listProviders(): SocialProviderResponse[] {
    return SOCIAL_PLATFORM_LIST.map((platform) => {
      const provider = this.providers.get(platform);
      return {
        platform,
        configured: provider?.configured ?? false,
        available: provider?.available ?? false,
      };
    });
  }

  async listAccounts(userId: string): Promise<SocialAccountResponse[]> {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const now = Date.now();

    return accounts.map((account) => ({
      id: account.id,
      platform: account.platform,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      connectedAt: account.createdAt.toISOString(),
      expiresAt: account.expiresAt?.toISOString() ?? null,
      needsReconnect: Boolean(
        !account.refreshTokenEnc &&
          account.expiresAt &&
          account.expiresAt.getTime() <= now,
      ),
    }));
  }

  async removeAccount(id: string, userId: string): Promise<void> {
    const account = await this.prisma.socialAccount.findFirst({
      where: { id, userId },
    });
    if (!account) {
      throw new NotFoundException('Akun sosial tidak ditemukan.');
    }

    const provider = this.providers.get(account.platform);
    if (account.platform === 'youtube' && provider?.revoke) {
      try {
        const accessToken = decryptSocialToken(
          account.accessTokenEnc,
          this.tokenKey(),
        );
        await provider.revoke(accessToken);
      } catch {
        // Revokasi bersifat best-effort; pemutusan lokal tetap dilanjutkan.
      }
    }

    await this.prisma.socialAccount.deleteMany({ where: { id, userId } });
  }

  async youtubeConnectUrl(userId: string): Promise<string> {
    if (!this.youtube.configured) {
      throw new SocialProviderError('not_configured');
    }

    const pending = createOAuthState(userId, 'youtube');
    await this.oauthStates.save(pending);

    return buildYoutubeAuthorizationUrl({
      clientId: this.config.googleClientId!,
      redirectUri: youtubeCallbackUrl(this.config.publicWebUrl),
      state: pending.state,
      codeChallenge: createPkceChallenge(pending.payload.codeVerifier),
    });
  }

  async completeYoutubeCallback(
    userId: string,
    code: string | undefined,
    state: string | undefined,
  ): Promise<void> {
    if (!state) throw new SocialProviderError('invalid_state');

    // GET + DEL atomik: callback yang sama tidak dapat dipakai ulang.
    const pending = await this.oauthStates.consume(state);
    if (
      !pending ||
      pending.userId !== userId ||
      pending.platform !== 'youtube'
    ) {
      throw new SocialProviderError('invalid_state');
    }
    if (!code) throw new SocialProviderError('missing_code');

    const tokens = await this.youtube.exchangeCode(
      code,
      pending.codeVerifier,
      youtubeCallbackUrl(this.config.publicWebUrl),
    );
    const external = await this.youtube.fetchAccount(tokens.accessToken);
    const key = this.tokenKey();
    const accessTokenEnc = encryptSocialToken(tokens.accessToken, key);
    const refreshTokenEnc = tokens.refreshToken
      ? encryptSocialToken(tokens.refreshToken, key)
      : undefined;
    const expiresAt = tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000)
      : null;
    const scopes = tokens.scopes ?? [...YOUTUBE_SCOPES];

    await this.prisma.socialAccount.upsert({
      where: {
        userId_platform_externalId: {
          userId,
          platform: 'youtube',
          externalId: external.externalId,
        },
      },
      create: {
        userId,
        platform: 'youtube',
        externalId: external.externalId,
        displayName: external.displayName,
        avatarUrl: external.avatarUrl,
        accessTokenEnc,
        refreshTokenEnc: refreshTokenEnc ?? null,
        expiresAt,
        scopes,
      },
      update: {
        displayName: external.displayName,
        avatarUrl: external.avatarUrl,
        accessTokenEnc,
        // Google sering tidak mengirim refresh_token pada connect berikutnya.
        refreshTokenEnc: refreshTokenEnc ?? undefined,
        expiresAt,
        scopes,
      },
    });
  }

  /**
   * Helper untuk fase publish: mengembalikan access token valid dan me-refresh
   * bila kedaluwarsa dalam 60 detik. Token baru disimpan terenkripsi.
   */
  async getValidAccessToken(accountId: string): Promise<string> {
    const account = await this.prisma.socialAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new NotFoundException('Akun sosial tidak ditemukan.');

    const key = this.tokenKey();
    const accessToken = decryptSocialToken(account.accessTokenEnc, key);
    const expiresSoon = Boolean(
      account.expiresAt &&
        account.expiresAt.getTime() - Date.now() <=
          ACCESS_TOKEN_REFRESH_SKEW_MS,
    );
    if (!expiresSoon) return accessToken;

    if (!account.refreshTokenEnc) {
      throw new SocialProviderError('reconnect_required');
    }
    const provider = this.providers.get(account.platform);
    if (!provider) throw new SocialProviderError('provider_unavailable');

    const refreshToken = decryptSocialToken(account.refreshTokenEnc, key);
    const tokens = await provider.refresh(refreshToken);
    await this.prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: encryptSocialToken(tokens.accessToken, key),
        refreshTokenEnc: tokens.refreshToken
          ? encryptSocialToken(tokens.refreshToken, key)
          : account.refreshTokenEnc,
        expiresAt: tokens.expiresIn
          ? new Date(Date.now() + tokens.expiresIn * 1000)
          : null,
        scopes: tokens.scopes ?? account.scopes,
      },
    });

    return tokens.accessToken;
  }

  private tokenKey(): string {
    if (!this.config.socialTokenKey) {
      throw new SocialProviderError('not_configured');
    }
    return this.config.socialTokenKey;
  }
}
