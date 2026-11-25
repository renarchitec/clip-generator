import { Injectable } from '@nestjs/common';
import { PublishError } from './publish-helpers';
import {
  INSTAGRAM_GRAPH_URL,
  interpretInstagramContainerStatus,
  isPublicHttpsUrl,
  mapInstagramApiErrorDetail,
  type InstagramContainerOutcome,
} from './instagram-helpers';

export interface InstagramContainerInput {
  accessToken: string;
  /** IG user id (SocialAccount.externalId). */
  igUserId: string;
  /** HTTPS URL publik yang bisa diunduh Instagram, mis. tautan bertanda tangan. */
  videoUrl: string;
  caption: string;
}

export interface InstagramPublishResult {
  mediaId: string | null;
  /** mis. CAPTION_NOT_ATTACHED: publish sukses sebagian, reel tetap tayang. */
  configIssue: string | null;
}

/**
 * Instagram Content Publishing API (Instagram Login), jalur `video_url`:
 * buat container REELS → tunggu status FINISHED → media_publish → permalink.
 *
 * Catatan: jalur resumable upload (rupload.facebook.com) hanya untuk app
 * dengan Facebook Login for Business, jadi tidak tersedia untuk Instagram
 * Login. Karena itu pemroses menyiapkan URL HTTPS publik bertanda tangan.
 */
@Injectable()
export class InstagramUploader {
  async createContainer(input: InstagramContainerInput): Promise<string> {
    if (!isPublicHttpsUrl(input.videoUrl)) {
      throw new PublishError(
        'INSTAGRAM_MEDIA_URL_INVALID: set PUBLIC_WEB_URL to a publicly reachable HTTPS URL',
      );
    }

    const body = new URLSearchParams({
      media_type: 'REELS',
      video_url: input.videoUrl,
      caption: input.caption,
      share_to_feed: 'true',
    });
    const data = await this.request<{ id?: unknown }>(
      `${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(input.igUserId)}/media`,
      input.accessToken,
      { method: 'POST', body },
    );
    if (typeof data.id !== 'string' || !data.id) {
      throw new PublishError('Instagram did not return a media container');
    }
    return data.id;
  }

  async containerStatus(
    accessToken: string,
    containerId: string,
  ): Promise<InstagramContainerOutcome> {
    const data = await this.request(
      `${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(containerId)}`,
      accessToken,
      { fields: 'status_code,status' },
    );
    return interpretInstagramContainerStatus(data);
  }

  async publishContainer(
    accessToken: string,
    igUserId: string,
    containerId: string,
  ): Promise<InstagramPublishResult> {
    const data = await this.request<{ id?: unknown; config_issue?: unknown }>(
      `${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(igUserId)}/media_publish`,
      accessToken,
      {
        method: 'POST',
        body: new URLSearchParams({ creation_id: containerId }),
      },
    );
    return {
      mediaId: typeof data.id === 'string' && data.id ? data.id : null,
      configIssue:
        typeof data.config_issue === 'string' && data.config_issue
          ? data.config_issue
          : null,
    };
  }

  async fetchPermalink(
    accessToken: string,
    mediaId: string,
  ): Promise<string | null> {
    const data = await this.request<{ permalink?: unknown }>(
      `${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(mediaId)}`,
      accessToken,
      { fields: 'permalink' },
    );
    return typeof data.permalink === 'string' && data.permalink
      ? data.permalink
      : null;
  }

  private async request<T extends Record<string, unknown> = Record<string, unknown>>(
    url: string,
    accessToken: string,
    options: { method?: 'GET' | 'POST'; body?: URLSearchParams; fields?: string } = {},
  ): Promise<T> {
    const target = new URL(url);
    if (options.fields) {
      target.searchParams.set('fields', options.fields);
    }
    const method = options.method ?? 'GET';

    let response: Response;
    try {
      response = await fetch(target, {
        method,
        headers: options.body
          ? {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            }
          : { Authorization: `Bearer ${accessToken}` },
        ...(options.body ? { body: options.body } : {}),
      });
    } catch {
      throw new PublishError('Could not reach Instagram, retry later', true);
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const mapped = mapInstagramApiErrorDetail(response.status, body);
      throw new PublishError(mapped.message, mapped.transient);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new PublishError('Instagram returned an unexpected response');
    }
    const record = body as Record<string, unknown>;
    if (record.error) {
      const mapped = mapInstagramApiErrorDetail(response.status, body);
      throw new PublishError(mapped.message, mapped.transient);
    }
    return record as T;
  }
}
