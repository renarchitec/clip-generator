import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface JobSnapshot {
  id: string;
  url: string;
  description: string | null;
  mode: string;
  reframe: string;
  captions: boolean;
  twoSpeakers: boolean;
  facecam: boolean;
  aspectRatio: string;
  /** Bahasa caption sosial: auto | id | en. */
  captionLanguage: string;
  clipCount?: number;
  targetDurationSec?: number;
  /** Batas pemindaian sumber (detik); null = durasi penuh. */
  maxSourceSec?: number | null;
  ranges?: unknown;
  status: string;
  stage: string | null;
  progress: number;
  message: string | null;
  error: string | null;
  clips: ClipSnapshot[];
}

export interface ClipSnapshot {
  id: string;
  title: string;
  startSec: number;
  endSec: number;
  caption: string | null;
  hashtags: string[];
  downloadedAt: Date | null;
  deletedAt: Date | null;
  /** Ringkasan publikasi terbaru per akun untuk badge kartu. */
  publications?: { platform: string; status: string; externalUrl: string | null }[];
}

/**
 * Jembatan antara listener QueueEvents dan endpoint SSE.
 * Subject per job id; ditutup begitu job mencapai status akhir karena klien
 * baru selalu menerima state terbaru dari database lebih dulu.
 */
@Injectable()
export class JobEventsService {
  private readonly streams = new Map<string, Subject<JobSnapshot>>();

  publish(snapshot: JobSnapshot): void {
    this.streamFor(snapshot.id).next(snapshot);
  }

  watch(jobId: string): Observable<JobSnapshot> {
    return this.streamFor(jobId).asObservable();
  }

  close(jobId: string): void {
    const stream = this.streams.get(jobId);
    if (!stream) return;

    stream.complete();
    this.streams.delete(jobId);
  }

  private streamFor(jobId: string): Subject<JobSnapshot> {
    let stream = this.streams.get(jobId);
    if (!stream) {
      stream = new Subject<JobSnapshot>();
      this.streams.set(jobId, stream);
    }
    return stream;
  }
}
