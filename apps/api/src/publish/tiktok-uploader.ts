import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { TiktokApiError, tiktokPost } from '../social/tiktok-api';
import { PublishError } from './publish-helpers';
import {
  mapTiktokApiError,
  planTiktokChunks,
  tiktokChunkRange,
  tiktokContentRange,
  type TiktokStatusOutcome,
  interpretTiktokStatus,
  TIKTOK_MAX_CHUNK_RETRIES,
} from './tiktok-helpers';

export interface TiktokDirectPostInfo {
  title: string;
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContent: boolean;
  brandOrganic: boolean;
}

export interface TiktokPublishSession {
  publishId: string;
  uploadUrl: string;
}

/** TikTok Content Posting API: init, upload FILE_UPLOAD chunks, status/fetch. */
@Injectable()
export class TiktokUploader {
  async startSession(
    accessToken: string,
    mode: 'direct' | 'inbox',
    post: TiktokDirectPostInfo | null,
    size: number,
  ): Promise<TiktokPublishSession> {
    const plan = planTiktokChunks(size);
    if (!plan) throw new PublishError('Clip is too large for TikTok upload');
    const sourceInfo = {
      source: 'FILE_UPLOAD',
      video_size: plan.videoSize,
      chunk_size: plan.chunkSize,
      total_chunk_count: plan.totalChunkCount,
    };
    try {
      const data = await tiktokPost(
        mode === 'inbox'
          ? '/v2/post/publish/inbox/video/init/'
          : '/v2/post/publish/video/init/',
        accessToken,
        mode === 'inbox'
          ? { source_info: sourceInfo }
          : {
              post_info: {
                title: post!.title,
                privacy_level: post!.privacyLevel,
                disable_comment: post!.disableComment,
                disable_duet: post!.disableDuet,
                disable_stitch: post!.disableStitch,
                brand_content_toggle: post!.brandContent,
                brand_organic_toggle: post!.brandOrganic,
              },
              source_info: sourceInfo,
            },
      );
      if (
        typeof data.publish_id !== 'string' ||
        !data.publish_id ||
        typeof data.upload_url !== 'string' ||
        !data.upload_url
      ) {
        throw new PublishError('TikTok did not return an upload session');
      }
      return { publishId: data.publish_id, uploadUrl: data.upload_url };
    } catch (error) {
      throw this.toPublishError(error);
    }
  }

  /** Unggah semua bagian secara berurutan seperti diwajibkan TikTok. */
  async uploadFile(
    uploadUrl: string,
    filePath: string,
    size: number,
    onProgress: (sent: number) => Promise<void>,
  ): Promise<void> {
    const plan = planTiktokChunks(size);
    if (!plan) throw new PublishError('Clip is too large for TikTok upload');
    for (let index = 0; index < plan.totalChunkCount; index += 1) {
      const range = tiktokChunkRange(plan, index)!;
      let attempt = 0;
      for (;;) {
        try {
          await this.putChunk(uploadUrl, filePath, range.start, range.end, size);
          await onProgress(range.end + 1);
          break;
        } catch (error) {
          const publishError = this.toPublishError(error);
          if (!publishError.transient || ++attempt > TIKTOK_MAX_CHUNK_RETRIES) {
            throw publishError;
          }
          await sleep(Math.min(1_000 * 2 ** (attempt - 1), 8_000));
        }
      }
    }
  }

  async publishStatus(
    accessToken: string,
    publishId: string,
    mode: 'direct' | 'inbox',
  ): Promise<TiktokStatusOutcome> {
    try {
      return interpretTiktokStatus(
        await tiktokPost('/v2/post/publish/status/fetch/', accessToken, {
          publish_id: publishId,
        }),
        mode,
      );
    } catch (error) {
      throw this.toPublishError(error);
    }
  }

  private async putChunk(
    uploadUrl: string,
    filePath: string,
    start: number,
    end: number,
    size: number,
  ): Promise<void> {
    const file = createReadStream(filePath, { start, end });
    let response: Response;
    try {
      response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(end - start + 1),
          'Content-Range': tiktokContentRange({ start, end }, size),
        },
        body: Readable.toWeb(file) as unknown as RequestInit['body'],
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
    } catch {
      file.destroy();
      throw new PublishError('Network error while uploading to TikTok', true);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new PublishError(
        response.status === 401 || response.status === 403
          ? 'Reconnect your TikTok account'
          : response.status === 429
            ? 'Too many requests to TikTok, try again in a minute'
            : response.status >= 500
              ? 'TikTok is temporarily unavailable, retry later'
              : 'TikTok rejected an upload chunk',
        response.status >= 500 || response.status === 429,
      );
    }
    await response.body?.cancel().catch(() => undefined);
  }

  private toPublishError(error: unknown): PublishError {
    if (error instanceof PublishError) return error;
    if (error instanceof TiktokApiError) {
      return new PublishError(
        mapTiktokApiError(error.code, error.httpStatus),
        error.transient,
      );
    }
    return new PublishError('TikTok publishing failed');
  }
}
