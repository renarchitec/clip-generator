import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  SocialAccountResponse,
  SocialPlatform,
  SocialProviderResponse,
  TiktokCreatorInfoResponse,
} from '@clipper/shared';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { OAuthStateStore } from './oauth-state.store';
import {
  buildInstagramAuthorizationUrl,
  buildTiktokAuthorizationUrl,
  buildYoutubeAuthorizationUrl,
  createOAuthState,
  createPkceChallenge,
  socialCallbackUrl,
  INSTAGRAM_SCOPES,
  INSTAGRAM_UNIFIED_SCOPES,
  TIKTOK_SCOPES,
  YOUTUBE_SCOPES,
} from './oauth';
import { SOCIAL_PLATFORM_LIST } from './social.constants';
import {
  InstagramProvider,
  SocialProviderError,
  TiktokProvider,
  YoutubeProvider,
  type SocialProvider,
} from './social-provider';
import { decideInstagramRefresh } from './instagram-token';
import { TiktokApiError, fetchTiktokCreatorInfo } from './tiktok-api';
import { decryptSocialToken, encryptSocialToken } from './token-crypto';

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

@Injectable()
export class SocialService {
  private readonly providers: Map<SocialPlatform, SocialProvider>;
  /** Refresh token TikTok berotasi: serialkan refresh per akun agar tidak saling menimpa. */
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly youtube: YoutubeProvider,
    private readonly tiktok: TiktokProvider,
    private readonly instagram: InstagramProvider,
    private readonly oauthStates: OAuthStateStore,
  ) {
    this.providers = new Map<SocialPlatform, SocialProvider>([
      [youtube.platform, youtube],
      [tiktok.platform, tiktok],
      [instagram.platform, instagram],
    ]);
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
    if (provider?.revoke) {
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

  async connectUrl(userId: string, platform: SocialPlatform): Promise<string> {
    const provider = this.providers.get(platform);
    if (!provider || !provider.available) {
      throw new SocialProviderError('provider_unavailable');
    }
    if (!provider.configured) throw new SocialProviderError('not_configured');

    const pending = createOAuthState(userId, platform);
    await this.oauthStates.save(pending);
    const redirectUri = socialCallbackUrl(this.config.publicWebUrl, platform);

    if (platform === 'tiktok') {
      // TikTok web: tanpa PKCE; state tetap dikonsumsi sekali pakai.
      return buildTiktokAuthorizationUrl({
        clientKey: this.config.tiktokClientKey!,
        redirectUri,
        state: pending.state,
      });
    }
    if (platform === 'instagram') {
      // Tanpa PKCE. config_id mengaktifkan Instagram API with Unified Login;
      // bila kosong, tetap memakai Instagram Login lama.
      return buildInstagramAuthorizationUrl({
        clientId: this.config.instagramClientId!,
        redirectUri,
        state: pending.state,
        configId: this.config.instagramConfigId,
      });
    }
    return buildYoutubeAuthorizationUrl({
      clientId: this.config.googleClientId!,
      redirectUri,
      state: pending.state,
      codeChallenge: createPkceChallenge(pending.payload.codeVerifier),
    });
  }

  async completeCallback(
    userId: string,
    platform: SocialPlatform,
    code: string | undefined,
    state: string | undefined,
  ): Promise<void> {
    const provider = this.providers.get(platform);
    if (!provider || !provider.available) {
      throw new SocialProviderError('provider_unavailable');
    }
    if (!state) throw new SocialProviderError('invalid_state');

    // GET + DEL atomik: callback yang sama tidak dapat dipakai ulang.
    const pending = await this.oauthStates.consume(state);
    if (
      !pending ||
      pending.userId !== userId ||
      pending.platform !== platform
    ) {
      throw new SocialProviderError('invalid_state');
    }
    if (!code) throw new SocialProviderError('missing_code');

    const tokens = await provider.exchangeCode(
      code,
      platform === 'tiktok' || platform === 'instagram'
        ? undefined
        : pending.codeVerifier,
      socialCallbackUrl(this.config.publicWebUrl, platform),
    );
    const external = await provider.fetchAccount(tokens.accessToken);
    const key = this.tokenKey();
    const accessTokenEnc = encryptSocialToken(tokens.accessToken, key);
    const refreshTokenEnc = tokens.refreshToken
      ? encryptSocialToken(tokens.refreshToken, key)
      : undefined;
    const expiresAt = tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000)
      : null;
    const scopes =
      tokens.scopes ??
      [...(platform === 'tiktok'
        ? TIKTOK_SCOPES
        : platform === 'instagram'
          ? this.config.instagramConfigId
            ? INSTAGRAM_UNIFIED_SCOPES
            : INSTAGRAM_SCOPES
          : YOUTUBE_SCOPES)];

    await this.prisma.socialAccount.upsert({
      where: {
        userId_platform_externalId: {
          userId,
          platform,
          externalId: external.externalId,
        },
      },
      create: {
        userId,
        platform,
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

  /** Creator info TikTok untuk akun milik pengguna sesi (privacy options, batas durasi, dsb). */
  async tiktokCreatorInfo(
    accountId: string,
    userId: string,
  ): Promise<TiktokCreatorInfoResponse> {
    const account = await this.prisma.socialAccount.findFirst({
      where: { id: accountId, userId },
      select: { id: true, platform: true, avatarUrl: true },
    });
    if (!account) throw new NotFoundException('Akun sosial tidak ditemukan.');
    if (account.platform !== 'tiktok') {
      throw new BadRequestException('platform_mismatch');
    }

    try {
      const accessToken = await this.getValidAccessToken(account.id);
      const info = await fetchTiktokCreatorInfo(accessToken);
      return {
        nickname: info.nickname,
        username: info.username,
        avatarUrl: info.avatarUrl ?? account.avatarUrl,
        privacyLevelOptions: info.privacyLevelOptions,
        commentDisabled: info.commentDisabled,
        duetDisabled: info.duetDisabled,
        stitchDisabled: info.stitchDisabled,
        maxVideoPostDurationSec: info.maxVideoPostDurationSec,
      };
    } catch (error) {
      if (error instanceof SocialProviderError) {
        if (error.code === 'not_configured') {
          throw new ServiceUnavailableException('not_configured');
        }
        throw new ConflictException('needs_reconnect');
      }
      if (error instanceof TiktokApiError) {
        if (error.needsReconnect) throw new ConflictException('needs_reconnect');
        throw new BadGatewayException(
          error.code === 'rate_limit_exceeded'
            ? 'rate_limited'
            : 'tiktok_unavailable',
        );
      }
      throw error;
    }
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

    if (account.platform === 'instagram') {
      // Instagram tidak punya refresh token: access token diperpanjang dengan
      // dirinya sendiri bila sisa umurnya <= 7 hari.
      const decision = decideInstagramRefresh(account.expiresAt);
      if (!decision.refresh) return accessToken;

      const inflightInstagram = this.refreshing.get(account.id);
      if (inflightInstagram) return inflightInstagram;

      const refreshInstagram = this.refreshInstagramAccount(
        account,
        accessToken,
        key,
      ).finally(() => this.refreshing.delete(account.id));
      this.refreshing.set(account.id, refreshInstagram);
      return refreshInstagram;
    }

    const expiresSoon = Boolean(
      account.expiresAt &&
        account.expiresAt.getTime() - Date.now() <=
          ACCESS_TOKEN_REFRESH_SKEW_MS,
    );
    if (!expiresSoon) return accessToken;

    if (!account.refreshTokenEnc) {
      throw new SocialProviderError('reconnect_required');
    }
    const inflight = this.refreshing.get(account.id);
    if (inflight) return inflight;

    const run = this.refreshAccount(account, key).finally(() =>
      this.refreshing.delete(account.id),
    );
    this.refreshing.set(account.id, run);
    return run;
  }

  private async refreshAccount(
    account: {
      id: string;
      platform: SocialPlatform;
      refreshTokenEnc: string | null;
      scopes: string[];
    },
    key: string,
  ): Promise<string> {
    const provider = this.providers.get(account.platform);
    if (!provider) throw new SocialProviderError('provider_unavailable');

    const refreshToken = decryptSocialToken(account.refreshTokenEnc!, key);
    const tokens = await provider.refresh(refreshToken);
    await this.prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: encryptSocialToken(tokens.accessToken, key),
        // TikTok merotasi refresh token: token baru selalu menggantikan yang lama.
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

  /**
   * Perpanjang access token Instagram dengan token itu sendiri. Bila refresh
   * gagal tetapi token lama masih valid, token lama tetap dipakai supaya
   * publish tidak gagal karena gangguan sesaat.
   */
  private async refreshInstagramAccount(
    account: { id: string; expiresAt: Date | null },
    accessToken: string,
    key: string,
  ): Promise<string> {
    const provider = this.providers.get('instagram');
    if (!provider) throw new SocialProviderError('provider_unavailable');

    try {
      const tokens = await provider.refresh(accessToken);
      await this.prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEnc: encryptSocialToken(tokens.accessToken, key),
          // Instagram tidak merotasi refresh token (tidak punya refresh token).
          refreshTokenEnc: null,
          expiresAt: tokens.expiresIn
            ? new Date(Date.now() + tokens.expiresIn * 1000)
            : account.expiresAt,
        },
      });
      return tokens.accessToken;
    } catch (error) {
      const stillValid =
        !account.expiresAt || account.expiresAt.getTime() > Date.now();
      if (stillValid) return accessToken;
      if (error instanceof SocialProviderError) throw error;
      throw new SocialProviderError('refresh_failed');
    }
  }

  private tokenKey(): string {
    if (!this.config.socialTokenKey) {
      throw new SocialProviderError('not_configured');
    }
    return this.config.socialTokenKey;
  }
}
