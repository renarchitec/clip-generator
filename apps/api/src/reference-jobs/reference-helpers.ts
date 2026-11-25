import { ASPECT_RATIOS, REFRAME_MODES } from '@clipper/shared';
import type { AspectRatio, ReframeMode } from '@clipper/shared';

export const REFERENCE_MIN_DURATION_SEC = 0.5;
export const REFERENCE_MAX_DURATION_SEC = 600;
export const REFERENCE_MAX_FILE_BYTES = 100 * 1024 * 1024;

export function normalizeAspectRatio(raw: unknown): AspectRatio | null {
  if (raw === undefined || raw === null) return '9:16';
  if (typeof raw === 'string' && (ASPECT_RATIOS as readonly string[]).includes(raw)) {
    return raw as AspectRatio;
  }
  return null;
}

export function normalizeReframeMode(raw: unknown): ReframeMode | null {
  if (raw === undefined || raw === null) return 'face_tracking';
  if (typeof raw === 'string' && (REFRAME_MODES as readonly string[]).includes(raw)) {
    return raw as ReframeMode;
  }
  return null;
}

export function sanitizeReferenceTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, 200);
}

export function sanitizeReferenceBrief(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, 500);
  return trimmed || null;
}
