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
  /** rasio output klip; default 9:16; 16:9 mengabaikan reframe */
  aspectRatio: AspectRatio;
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
