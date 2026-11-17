export const QUEUE_EVENTS = 'QUEUE_EVENTS';

/**
 * Harus sama dengan QUEUE_NAME di packages/shared/src/index.ts.
 * Paket shared hanya berisi TypeScript, jadi konstanta nilainya tidak bisa
 * di-require saat runtime; yang diimpor dari sana hanya tipe.
 */
export const QUEUE_NAME = 'clip-jobs';
