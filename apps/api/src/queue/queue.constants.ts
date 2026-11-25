export { REFERENCE_QUEUE_NAME } from '@clipper/shared';

export const QUEUE_EVENTS = 'QUEUE_EVENTS';
export const REFERENCE_QUEUE_EVENTS = 'REFERENCE_QUEUE_EVENTS';

/**
 * Harus sama dengan QUEUE_NAME di packages/shared/src/index.ts.
 * Paket shared hanya berisi TypeScript, jadi konstanta nilainya tidak bisa
 * di-require saat runtime; yang diimpor dari sana hanya tipe.
 */
export const QUEUE_NAME = 'clip-jobs';

/**
 * Antrean terpisah untuk pratinjau momen. Harus sama dengan PREVIEW_QUEUE_NAME
 * di packages/shared/src/index.ts dan worker/clipper/models.py.
 */
export const PREVIEW_QUEUE_NAME = 'previews';

/** Antrean render satu frame untuk pratinjau watermark. */
export const FRAME_QUEUE_NAME = 'clip-frames';

/**
 * Kunci Redis untuk sinyal pembatalan; worker memeriksanya di batas tahap.
 * Harus sama dengan CANCEL_KEY di worker/clipper/models.py.
 */
export function cancelKey(jobId: string): string {
  return `cancel:${jobId}`;
}

/**
 * Antrean publikasi ke platform sosial; diproses oleh API (PublishProcessor).
 * Harus sama dengan PUBLISH_QUEUE_NAME di packages/shared/src/index.ts.
 */
export const PUBLISH_QUEUE_NAME = 'publish';

/**
 * Antrean regenerasi caption satu klip; dikonsumsi worker Python (kredensial LLM
 * hanya ada di worker). Harus sama dengan CAPTION_QUEUE_NAME di
 * packages/shared/src/index.ts dan worker/clipper/models.py.
 */
export const CAPTION_QUEUE_NAME = 'captions';

/** Batas tunggu hasil regenerasi caption sebelum API membalas 503 (ms). */
export const CAPTION_WAIT_TIMEOUT_MS = 60_000;
