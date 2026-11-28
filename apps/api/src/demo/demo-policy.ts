import {
  DEMO_LIMITS,
  type TranscriptSource,
  type UserRole,
} from '@clipper/shared';

export type PolicyResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export function isDemoRole(role: UserRole | string | undefined): boolean {
  return role === 'demo';
}

export function validateDemoPreview(input: {
  transcriptSource: TranscriptSource;
  maxSourceSec?: number | null;
  targetDurationSec: number;
  previewsUsed: number;
}): PolicyResult<{ effectiveMaxSourceSec: number }> {
  if (!DEMO_LIMITS.allowedTranscriptSources.includes(input.transcriptSource)) {
    return {
      ok: false,
      message:
        'Mode demo hanya mendukung subtitle YouTube. Gunakan aplikasi desktop atau self-host untuk mode STT/Live Chat.',
    };
  }

  if (
    input.maxSourceSec !== null &&
    input.maxSourceSec !== undefined &&
    input.maxSourceSec > DEMO_LIMITS.maxSourceSec
  ) {
    return {
      ok: false,
      message: `Mode demo maksimal memindai ${Math.round(DEMO_LIMITS.maxSourceSec / 60)} menit pertama video.`,
    };
  }

  if (input.targetDurationSec > DEMO_LIMITS.maxTargetDurationSec) {
    return {
      ok: false,
      message: `Mode demo maksimal durasi target klip ${DEMO_LIMITS.maxTargetDurationSec} detik.`,
    };
  }

  if (input.previewsUsed >= DEMO_LIMITS.maxPreviewsTotal) {
    return {
      ok: false,
      message: `Kuota pratinjau mode demo (${DEMO_LIMITS.maxPreviewsTotal}x) sudah habis. Unduh aplikasi desktop atau self-host untuk akses tanpa batas.`,
    };
  }

  return {
    ok: true,
    data: {
      effectiveMaxSourceSec: input.maxSourceSec ?? DEMO_LIMITS.maxSourceSec,
    },
  };
}

export function validateDemoJob(input: {
  mode: 'auto' | 'manual';
  transcriptSource: TranscriptSource;
  targetDurationSec: number;
  ranges: readonly { start: number; end: number }[];
  jobsUsed: number;
  activeJobs: number;
  clipsUsed: number;
}): PolicyResult<undefined> {
  if (!DEMO_LIMITS.allowedTranscriptSources.includes(input.transcriptSource)) {
    return {
      ok: false,
      message:
        'Mode demo hanya mendukung subtitle YouTube. Gunakan aplikasi desktop atau self-host untuk mode STT/Live Chat.',
    };
  }

  if (input.mode !== 'manual') {
    return {
      ok: false,
      message:
        'Mode demo memakai alur Tinjau Dulu atau Rentang Manual agar video hingga 120 menit tetap ringan diproses.',
    };
  }

  if (input.activeJobs >= DEMO_LIMITS.maxActiveJobs) {
    return {
      ok: false,
      message:
        'Mode demo hanya mengizinkan 1 proses render aktif pada satu waktu. Tunggu proses sebelumnya selesai.',
    };
  }

  if (input.jobsUsed >= DEMO_LIMITS.maxJobsTotal) {
    return {
      ok: false,
      message: `Kuota job mode demo (maks ${DEMO_LIMITS.maxJobsTotal} job) sudah habis. Unduh aplikasi desktop atau self-host untuk akses tanpa batas.`,
    };
  }

  if (input.targetDurationSec > DEMO_LIMITS.maxTargetDurationSec) {
    return {
      ok: false,
      message: `Mode demo maksimal durasi target klip ${DEMO_LIMITS.maxTargetDurationSec} detik.`,
    };
  }

  const requestedClips = input.ranges.length;
  const remainingClips = Math.max(0, DEMO_LIMITS.maxClipsTotal - input.clipsUsed);
  if (requestedClips < 1) {
    return { ok: false, message: 'Pilih minimal 1 momen klip.' };
  }

  if (input.clipsUsed + requestedClips > DEMO_LIMITS.maxClipsTotal) {
    return {
      ok: false,
      message:
        remainingClips === 0
          ? `Kuota klip mode demo (maks ${DEMO_LIMITS.maxClipsTotal} klip) sudah habis. Unduh aplikasi desktop atau self-host untuk akses tanpa batas.`
          : `Kuota klip mode demo tersisa ${remainingClips} dari ${DEMO_LIMITS.maxClipsTotal} klip. Kurangi jumlah momen yang dipilih.`,
    };
  }

  for (const range of input.ranges) {
    if (range.end > DEMO_LIMITS.maxSourceSec) {
      return {
        ok: false,
        message: `Mode demo hanya mendukung momen dalam ${Math.round(DEMO_LIMITS.maxSourceSec / 60)} menit pertama video.`,
      };
    }
    if (range.end - range.start > DEMO_LIMITS.maxRangeDurationSec) {
      return {
        ok: false,
        message: `Durasi tiap klip pada mode demo maksimal ${DEMO_LIMITS.maxRangeDurationSec} detik.`,
      };
    }
  }

  return { ok: true, data: undefined };
}

export function utcDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
