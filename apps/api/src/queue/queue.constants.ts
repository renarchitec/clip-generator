export const QUEUE_EVENTS = 'QUEUE_EVENTS';

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

/**
 * Kunci Redis untuk sinyal pembatalan; worker memeriksanya di batas tahap.
 * Harus sama dengan CANCEL_KEY di worker/clipper/models.py.
 */
export function cancelKey(jobId: string): string {
  return `cancel:${jobId}`;
}
