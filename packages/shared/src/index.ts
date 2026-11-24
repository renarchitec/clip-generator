// Sumber kebenaran bentuk data job. Worker Python (worker/clipper/models.py) wajib mengikuti file ini.

export const QUEUE_NAME = 'clip-jobs';

/** Antrean terpisah untuk pratinjau momen (subtitle + LLM saja, tanpa render). */
export const PREVIEW_QUEUE_NAME = 'previews';

export const JOB_STAGES = [
  'download',
  'transcribe',
  'select',
  'render',
  'save',
] as const;

export type JobStage = (typeof JOB_STAGES)[number];
export type JobMode = 'auto' | 'manual';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export const REFRAME_MODES = ['face_tracking', 'black_bars', 'blurred_fill'] as const;
export type ReframeMode = (typeof REFRAME_MODES)[number];
export const DEFAULT_REFRAME: ReframeMode = 'face_tracking';

/** Rasio output klip: 9:16 (default), 1:1, 16:9. */
export const ASPECT_RATIOS = ['9:16', '1:1', '16:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export const DEFAULT_ASPECT: AspectRatio = '9:16';

/** Antrean regenerasi caption sosial satu klip (dikonsumsi worker Python yang memegang kredensial LLM). */
export const CAPTION_QUEUE_NAME = 'captions';

/** Bahasa caption sosial: 'auto' = sama dengan bahasa transkrip (default), 'id' = Bahasa Indonesia, 'en' = English. */
export const CAPTION_LANGUAGES = ['auto', 'id', 'en'] as const;
export type CaptionLanguage = (typeof CAPTION_LANGUAGES)[number];
export const DEFAULT_CAPTION_LANGUAGE: CaptionLanguage = 'auto';

/** Batas panjang cuplikan transkrip per klip yang disimpan. */
export const CLIP_TRANSCRIPT_MAX = 2000;

/** Batas pemindaian sumber (detik): null/absent = durasi penuh (default). */
export const MIN_SOURCE_SEC = 60;
export const MAX_SOURCE_SEC = 36000;

export interface ManualRange {
  /** detik */
  start: number;
  /** detik */
  end: number;
  /** judul momen hasil tinjauan LLM; opsional */
  title?: string;
  /** alasan momen hasil tinjauan LLM; opsional */
  reason?: string;
}

export interface JobParams {
  clipCount: number;
  targetDurationSec: number;
}

export interface JobData {
  jobId: string;
  url: string;
  mode: JobMode;
  reframe: ReframeMode;
  /** apakah subtitle dibakar ke clip; default true */
  captions: boolean;
  /** tata letak dua pembicara (panel atas/bawah 1080x960 vstack); default false; hanya berlaku untuk 9:16 */
  twoSpeakers: boolean;
  /** tata letak streamer (facecam di atas, gameplay di bawah); default false; hanya 9:16 dan eksklusif dengan twoSpeakers */
  facecam: boolean;
  /** rasio output klip; default 9:16; 16:9 mengabaikan reframe */
  aspectRatio: AspectRatio;
  /** bahasa caption sosial; default 'auto' (worker memakai 'auto' bila absent) */
  captionLanguage: CaptionLanguage;
  /** preferensi konten dari pengguna untuk pemilihan momen; null bila kosong */
  description?: string | null;
  /**
   * Batas pemindaian sumber dalam detik (60–36000); null/absent = durasi penuh.
   * Berlaku untuk mode auto & preview: hanya bagian 0–limit yang dipindai/diunduh.
   * Mode manual mengabaikan nilai ini (rentang sudah eksplisit).
   */
  maxSourceSec?: number | null;
  params: JobParams;
  /** hanya dipakai mode manual */
  ranges: ManualRange[];
}

export interface JobProgress {
  stage: JobStage;
  /** 0-100 */
  percent: number;
  message?: string;
}

export interface ClipResult {
  title: string;
  start: number;
  end: number;
  /** path relatif di dalam CLIPS_DIR/<job_id>/ */
  file: string;
  /** Dihasilkan LLM worker; tidak ada bila LLM tidak tersedia. */
  caption?: string;
  /** Dihasilkan LLM worker; tidak ada bila LLM tidak tersedia. */
  hashtags?: string[];
  /** Cuplikan transkrip klip (≤ 2000 karakter); tidak ada bila kosong. */
  transcript?: string;
}

/** Payload job BullMQ antrean `captions` (regenerasi caption satu klip). */
export interface CaptionJobData {
  clipId: string;
  title: string;
  /** transkrip klip; null untuk klip lama */
  transcript: string | null;
  currentCaption: string | null;
  description: string | null;
  language: CaptionLanguage;
}

/** Hasil job antrean `captions`; juga body respons POST /api/clips/:id/caption. */
export interface CaptionJobResult {
  caption: string;
  hashtags: string[];
}

/** Body POST /api/clips/:id/caption. */
export interface RegenerateCaptionRequest {
  language: CaptionLanguage;
}

export interface JobResult {
  clips: ClipResult[];
}

export interface PreviewCandidate {
  start: number;
  end: number;
  title: string;
  reason: string;
}

export interface PreviewCue {
  start: number;
  end: number;
  text: string;
}

export type PreviewStatus = 'queued' | 'running' | 'done' | 'failed';

export interface PreviewJobData {
  url: string;
  userId: string;
  description?: string | null;
  clipCount: number;
  targetDurationSec: number;
  /** Batas pemindaian sumber (detik, 60–36000); null/absent = durasi penuh. */
  maxSourceSec?: number | null;
}

export interface PreviewJobResult {
  candidates: PreviewCandidate[];
  cues: PreviewCue[];
}

export interface PreviewResponse {
  id: string;
  url: string;
  status: PreviewStatus;
  error: string | null;
  candidates: PreviewCandidate[] | null;
  cues: PreviewCue[] | null;
}

export const SOCIAL_PLATFORMS = ['youtube', 'instagram', 'tiktok'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface SocialProviderResponse {
  platform: SocialPlatform;
  configured: boolean;
  available: boolean;
}

export interface SocialAccountResponse {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  avatarUrl: string | null;
  connectedAt: string;
  expiresAt: string | null;
  needsReconnect: boolean;
}

/** Antrean publikasi klip ke platform sosial (diproses oleh API, bukan worker Python). */
export const PUBLISH_QUEUE_NAME = 'publish';

export const PUBLICATION_STATUSES = [
  'queued',
  'uploading',
  'processing',
  'published',
  'failed',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const PUBLICATION_PRIVACIES = ['public', 'unlisted', 'private'] as const;
export type PublicationPrivacy = (typeof PUBLICATION_PRIVACIES)[number];

/** Batas metadata unggahan YouTube. */
export const PUBLISH_TITLE_MAX = 100;
export const PUBLISH_CAPTION_MAX = 5000;
export const PUBLISH_TARGETS_MAX = 5;

export interface PublishTarget {
  accountId: string;
  /** 1..100 karakter, tanpa '<' atau '>' */
  title: string;
  /** 0..5000 karakter; dipakai sebagai deskripsi video */
  caption: string;
  privacy: PublicationPrivacy;
  madeForKids?: boolean;
}

/** Body POST /api/clips/:id/publish (1..5 target). */
export interface PublishRequest {
  targets: PublishTarget[];
}

export interface PublicationResponse {
  id: string;
  clipId: string;
  platform: SocialPlatform;
  accountId: string;
  accountName: string;
  title: string;
  caption: string;
  privacy: PublicationPrivacy;
  status: PublicationStatus;
  /** 0-100, persentase unggah */
  progress: number;
  externalId: string | null;
  externalUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

/** Ringkasan publikasi untuk badge kartu klip (terbaru per akun). */
export interface ClipPublicationSummary {
  platform: SocialPlatform;
  status: PublicationStatus;
  externalUrl: string | null;
}

/** Payload job BullMQ antrean `publish`. */
export interface PublishJobData {
  publicationId: string;
  /** 'upload' = unggah file; 'check' = cek status pemrosesan YouTube. */
  kind: 'upload' | 'check';
  /** jumlah pengecekan status yang sudah dilakukan (kind=check) */
  checks?: number;
}
