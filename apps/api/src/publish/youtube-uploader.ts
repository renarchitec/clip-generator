import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  contentRange,
  MAX_CHUNK_RETRIES,
  mapGoogleError,
  nextChunk,
  parseResumeOffset,
  PublishError,
  retryDelayMs,
  sniffCoverImageMime,
  statusQueryRange,
  type VideoStatusOutcome,
  interpretVideoStatus,
} from './publish-helpers';

const UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

export interface YoutubeVideoMetadata {
  title: string;
  description: string;
  privacyStatus: string;
  madeForKids: boolean;
}

type ChunkResult =
  | { kind: 'done'; videoId: string }
  | { kind: 'resume'; offset: number };

/**
 * Klien YouTube Data API v3 untuk resumable upload. Token hanya dipakai di
 * header Authorization; tidak pernah dicatat atau dimasukkan ke pesan galat.
 */
@Injectable()
export class YoutubeUploader {
  async setThumbnail(accessToken: string, videoId: string, filePath: string): Promise<void> {
    const buffer = await readFile(filePath).catch(() => {
      throw new PublishError('Cover thumbnail file is missing');
    });
    const image = sniffCoverImageMime(buffer);
    if (!image) throw new PublishError('Invalid cover thumbnail image');

    let response: Response;
    try {
      response = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': image.mime,
            'Content-Length': String(buffer.length),
          },
          body: buffer,
        },
      );
    } catch {
      throw new PublishError('Could not reach YouTube, retry later', true);
    }
    if (!response.ok) {
      throw new PublishError(
        mapGoogleError(response.status, await safeJson(response)),
        response.status >= 500,
      );
    }
  }

  /** Buat sesi resumable dan kembalikan URL sesi (header Location). */
  async startSession(
    accessToken: string,
    metadata: YoutubeVideoMetadata,
    size: number,
  ): Promise<string> {
    let response: Response;
    try {
      response = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(size),
        },
        body: JSON.stringify({
          snippet: {
            title: metadata.title,
            description: metadata.description,
            categoryId: '22',
          },
          status: {
            privacyStatus: metadata.privacyStatus,
            selfDeclaredMadeForKids: metadata.madeForKids,
          },
        }),
      });
    } catch {
      throw new PublishError('Could not reach YouTube, retry later', true);
    }
    if (!response.ok) {
      throw new PublishError(
        mapGoogleError(response.status, await safeJson(response)),
        response.status >= 500,
      );
    }
    const location = response.headers.get('location');
    if (!location) {
      throw new PublishError('YouTube did not return an upload session');
    }
    return location;
  }

  /**
   * Unggah file per chunk 8 MiB dari disk (stream, tanpa buffer penuh).
   * 308 → lanjut dari header Range; 5xx/jaringan → backoff, tanya status sesi,
   * lanjut dari offset yang diterima (maks 5 kali per chunk).
   */
  async uploadFile(
    sessionUrl: string,
    accessToken: string,
    filePath: string,
    size: number,
    onProgress: (sent: number) => Promise<void>,
  ): Promise<string> {
    let offset = 0;
    let retries = 0;
    for (;;) {
      const chunk = nextChunk(offset, size);
      let result: ChunkResult;
      try {
        if (!chunk) {
          // Semua byte terkirim tapi belum ada respons final: tanya status.
          result = await this.queryStatus(sessionUrl, accessToken, size);
        } else {
          result = await this.putChunk(
            sessionUrl,
            accessToken,
            filePath,
            chunk.start,
            chunk.end,
            size,
          );
        }
      } catch (error) {
        if (!(error instanceof PublishError) || !error.transient) throw error;
        retries += 1;
        if (retries > MAX_CHUNK_RETRIES) {
          throw new PublishError(error.message);
        }
        await sleep(retryDelayMs(retries));
        result = await this.queryStatusTolerant(sessionUrl, accessToken, size, offset);
      }

      if (result.kind === 'done') {
        await onProgress(size);
        return result.videoId;
      }
      if (result.offset > offset) {
        retries = 0;
      } else {
        // Server tidak menerima byte baru: hitung sebagai percobaan agar tidak berputar tanpa akhir.
        retries += 1;
        if (retries > MAX_CHUNK_RETRIES) {
          throw new PublishError('YouTube stopped accepting the upload, retry later');
        }
        await sleep(retryDelayMs(retries));
      }
      offset = result.offset;
      await onProgress(offset);
    }
  }

  /** Ambil status video untuk menentukan published/failed/pending. */
  async videoStatus(
    accessToken: string,
    videoId: string,
  ): Promise<VideoStatusOutcome> {
    const url = new URL(VIDEOS_URL);
    url.searchParams.set('part', 'status,processingDetails');
    url.searchParams.set('id', videoId);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new PublishError('Could not reach YouTube, retry later', true);
    }
    const body = await safeJson(response);
    if (!response.ok) {
      throw new PublishError(
        mapGoogleError(response.status, body),
        response.status >= 500 || response.status === 429,
      );
    }
    const items = (body as { items?: unknown[] } | null)?.items;
    return interpretVideoStatus(Array.isArray(items) ? items[0] : null);
  }

  private async putChunk(
    sessionUrl: string,
    accessToken: string,
    filePath: string,
    start: number,
    end: number,
    size: number,
  ): Promise<ChunkResult> {
    const file = createReadStream(filePath, { start, end });
    let response: Response;
    try {
      response = await fetch(sessionUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'video/mp4',
          'Content-Length': String(end - start + 1),
          'Content-Range': contentRange({ start, end }, size),
        },
        body: Readable.toWeb(file) as unknown as RequestInit['body'],
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
    } catch {
      file.destroy();
      throw new PublishError('Network error while uploading to YouTube', true);
    }
    return this.interpretUploadResponse(response);
  }

  private async queryStatus(
    sessionUrl: string,
    accessToken: string,
    size: number,
  ): Promise<ChunkResult> {
    let response: Response;
    try {
      response = await fetch(sessionUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Length': '0',
          'Content-Range': statusQueryRange(size),
        },
      });
    } catch {
      throw new PublishError('Network error while uploading to YouTube', true);
    }
    return this.interpretUploadResponse(response);
  }

  /** Query status setelah galat sementara; bila gagal lagi, ulangi dari offset terakhir. */
  private async queryStatusTolerant(
    sessionUrl: string,
    accessToken: string,
    size: number,
    fallbackOffset: number,
  ): Promise<ChunkResult> {
    try {
      return await this.queryStatus(sessionUrl, accessToken, size);
    } catch (error) {
      if (error instanceof PublishError && error.transient) {
        return { kind: 'resume', offset: fallbackOffset };
      }
      throw error;
    }
  }

  private async interpretUploadResponse(
    response: Response,
  ): Promise<ChunkResult> {
    if (response.status === 200 || response.status === 201) {
      const body = (await safeJson(response)) as { id?: unknown } | null;
      if (typeof body?.id !== 'string' || !body.id) {
        throw new PublishError('YouTube did not return a video id');
      }
      return { kind: 'done', videoId: body.id };
    }
    if (response.status === 308) {
      await response.body?.cancel().catch(() => undefined);
      const offset = parseResumeOffset(response.headers.get('range'));
      if (offset === null) {
        throw new PublishError('Unexpected upload response from YouTube', true);
      }
      return { kind: 'resume', offset };
    }
    const body = await safeJson(response);
    throw new PublishError(
      mapGoogleError(response.status, body),
      response.status >= 500,
    );
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
