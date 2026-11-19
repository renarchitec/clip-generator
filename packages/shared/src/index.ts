// Sumber kebenaran bentuk data job. Worker Python (worker/clipper/models.py) wajib mengikuti file ini.

export const QUEUE_NAME = 'clip-jobs';

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

export interface ManualRange {
  /** detik */
  start: number;
  /** detik */
  end: number;
}

export interface JobParams {
  clipCount: number;
  targetDurationSec: number;
}

export interface JobData {
  jobId: string;
  url: string;
  mode: JobMode;
  /** preferensi konten dari pengguna untuk pemilihan momen; null bila kosong */
  description?: string | null;
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
