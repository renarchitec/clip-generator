// Sumber kebenaran bentuk data job. Worker Python (worker/clipper/models.py) wajib mengikuti file ini.

export const QUEUE_NAME = 'clip-jobs';

/** Antrean terpisah untuk pratinjau momen (subtitle + LLM saja, tanpa render). */
export const PREVIEW_QUEUE_NAME = 'previews';

/** Antrean render satu frame untuk pratinjau watermark. */
export const FRAME_QUEUE_NAME = 'clip-frames';

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

/** Batas jumlah dan panjang hashtag kustom per job. */
export const CUSTOM_HASHTAGS_MAX = 15;
export const CUSTOM_HASHTAG_MAX_LENGTH = 50;

/**
 * Normalisasi daftar/teks hashtag kustom: pecah per spasi/koma/'#', buang
 * karakter selain huruf/angka Unicode dan underscore, potong 50 karakter,
 * deduplikasi case-insensitive (simpan penulisan pertama), maksimal 15 item.
 */
export function normalizeCustomHashtags(raw: unknown): string[] {
  const items =
    typeof raw === 'string'
      ? [raw]
      : Array.isArray(raw)
        ? raw.filter((item): item is string => typeof item === 'string')
        : [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const part of item.split(/[\s,#]+/)) {
      const tag = part.replace(/[^\p{L}\p{N}_]/gu, '').slice(0, CUSTOM_HASHTAG_MAX_LENGTH);
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(tag);
      if (result.length >= CUSTOM_HASHTAGS_MAX) return result;
    }
  }
  return result;
}

/** Batas panjang cuplikan transkrip per klip yang disimpan. */
export const CLIP_TRANSCRIPT_MAX = 2000;

/** Batas pemindaian sumber (detik): null/absent = durasi penuh (default). */
export const MIN_SOURCE_SEC = 60;
export const MAX_SOURCE_SEC = 36000;


export const CAPTION_FONTS = [
  'Anton',
  'Bebas Neue',
  'Montserrat',
  'Plus Jakarta Sans',
  'Oswald',
  'Bangers',
] as const;
export type CaptionFont = (typeof CAPTION_FONTS)[number];

export const CAPTION_EFFECTS = ['outline', 'shadow', 'box', 'none'] as const;
export type CaptionEffect = (typeof CAPTION_EFFECTS)[number];

export const CAPTION_POSITIONS = ['bottom', 'center', 'top'] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];

export const CAPTION_PRESETS = ['hook', 'beast', 'boxed', 'neon', 'cinema', 'custom'] as const;
export type CaptionPreset = (typeof CAPTION_PRESETS)[number];

export const CAPTION_FONT_SIZE_MIN = 44;
export const CAPTION_FONT_SIZE_MAX = 120;
export const DEFAULT_CAPTION_FONT_SIZE = 80;
export const CAPTION_POSITION_Y_MIN = 0.05;
export const CAPTION_POSITION_Y_MAX = 0.95;

export interface CaptionStyle {
  preset: CaptionPreset;
  fontFamily: CaptionFont;
  /** Ukuran font pada referensi tinggi 1920px (44..120, default 80). */
  fontSize: number;
  /** Warna teks utama (#RRGGBB, mis. '#FFFFFF'). */
  primaryColor: string;
  /** Warna highlight kata aktif (#RRGGBB, mis. '#FFFF00'). */
  highlightColor: string;
  /** Warna outline / latar kotak (#RRGGBB, mis. '#000000'). */
  outlineColor: string;
  effect: CaptionEffect;
  uppercase: boolean;
  position: CaptionPosition;
  /** Posisi vertikal kustom (0.05..0.95 dari tinggi frame, dari atas); absen/null = ikuti preset position. */
  positionY?: number | null;
  italic: boolean;
  animate: boolean;
}

export const CAPTION_PRESET_STYLES: Record<Exclude<CaptionPreset, 'custom'>, CaptionStyle> = {
  hook: { preset: 'hook', fontFamily: 'Anton', fontSize: 80, primaryColor: '#FFFFFF', highlightColor: '#FFFF00', outlineColor: '#000000', effect: 'outline', uppercase: true, position: 'bottom', italic: false, animate: true },
  beast: { preset: 'beast', fontFamily: 'Montserrat', fontSize: 84, primaryColor: '#FFFFFF', highlightColor: '#22C55E', outlineColor: '#000000', effect: 'outline', uppercase: true, position: 'bottom', italic: false, animate: true },
  boxed: { preset: 'boxed', fontFamily: 'Plus Jakarta Sans', fontSize: 68, primaryColor: '#FFFFFF', highlightColor: '#FACC15', outlineColor: '#000000', effect: 'box', uppercase: false, position: 'bottom', italic: false, animate: false },
  neon: { preset: 'neon', fontFamily: 'Bebas Neue', fontSize: 92, primaryColor: '#FFFFFF', highlightColor: '#5CE1C4', outlineColor: '#09090B', effect: 'shadow', uppercase: true, position: 'bottom', italic: false, animate: false },
  cinema: { preset: 'cinema', fontFamily: 'Oswald', fontSize: 68, primaryColor: '#FEF08A', highlightColor: '#FFFFFF', outlineColor: '#000000', effect: 'shadow', uppercase: false, position: 'bottom', italic: false, animate: false },
};
export const DEFAULT_CAPTION_STYLE: CaptionStyle = CAPTION_PRESET_STYLES.hook;

export function normalizeCaptionStyle(raw: unknown): CaptionStyle | null {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const named = typeof value.preset === 'string' &&
    CAPTION_PRESETS.slice(0, -1).includes(value.preset as CaptionPreset)
    ? value.preset as Exclude<CaptionPreset, 'custom'> : undefined;
  const result: CaptionStyle = { ...(named ? CAPTION_PRESET_STYLES[named] : DEFAULT_CAPTION_STYLE) };
  if (typeof value.fontFamily === 'string' && (CAPTION_FONTS as readonly string[]).includes(value.fontFamily)) result.fontFamily = value.fontFamily as CaptionFont;
  if (typeof value.fontSize === 'number' && Number.isFinite(value.fontSize)) result.fontSize = Math.max(CAPTION_FONT_SIZE_MIN, Math.min(CAPTION_FONT_SIZE_MAX, Math.round(value.fontSize)));
  for (const key of ['primaryColor', 'highlightColor', 'outlineColor'] as const) {
    const color = value[key];
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) result[key] = color.toUpperCase();
  }
  if (typeof value.effect === 'string' && (CAPTION_EFFECTS as readonly string[]).includes(value.effect)) result.effect = value.effect as CaptionEffect;
  if (typeof value.uppercase === 'boolean') result.uppercase = value.uppercase;
  if (typeof value.position === 'string' && (CAPTION_POSITIONS as readonly string[]).includes(value.position)) result.position = value.position as CaptionPosition;
  if (typeof value.positionY === 'number' && Number.isFinite(value.positionY)) {
    const clamped = Math.max(CAPTION_POSITION_Y_MIN, Math.min(CAPTION_POSITION_Y_MAX, value.positionY));
    result.positionY = Math.round(clamped * 10000) / 10000;
  }
  if (typeof value.italic === 'boolean') result.italic = value.italic;
  if (typeof value.animate === 'boolean') result.animate = value.animate;
  const fields: (keyof Omit<CaptionStyle, 'preset'>)[] = ['fontFamily', 'fontSize', 'primaryColor', 'highlightColor', 'outlineColor', 'effect', 'uppercase', 'position', 'italic', 'animate'];
  result.preset = (Object.keys(CAPTION_PRESET_STYLES) as Exclude<CaptionPreset, 'custom'>[]).find((preset) => result.positionY === undefined && fields.every((field) => result[field] === CAPTION_PRESET_STYLES[preset][field])) ?? 'custom';
  return result;
}

export interface ManualRange {
  /** detik */
  start: number;
  /** detik */
  end: number;
  /** judul momen hasil tinjauan LLM; opsional */
  title?: string;
  /** alasan momen hasil tinjauan LLM; opsional */
  reason?: string;
  hookText?: string;
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
  hookBanner: boolean;
  normalizeAudio: boolean;
  /** tata letak dua pembicara (panel atas/bawah 1080x960 vstack); default false; hanya berlaku untuk 9:16 */
  twoSpeakers: boolean;
  /** tata letak streamer (facecam di atas, gameplay di bawah); default false; hanya 9:16 dan eksklusif dengan twoSpeakers */
  facecam: boolean;
  /** rasio output klip; default 9:16; 16:9 mengabaikan reframe */
  aspectRatio: AspectRatio;
  /** bahasa caption sosial; default 'auto' (worker memakai 'auto' bila absent) */
  captionLanguage: CaptionLanguage;
  /** hashtag kustom per job; bila diisi, worker tidak membuat hashtag otomatis */
  customHashtags?: string[];
  captionStyle?: CaptionStyle | null;
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
  /**
   * Satu klip yang baru selesai dirender, dikirim tepat setelah file-nya
   * ditulis ke CLIPS_DIR/<jobId>/<file>. Dipakai API untuk menyimpan baris clip
   * selagi job masih berjalan, jadi UI bisa menampilkannya lebih awal.
   * Boleh tanpa caption/hashtags.
   */
  clip?: ClipResult;
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
  platformCaptions?: PlatformCaptions | null;
  /** Cuplikan transkrip klip (≤ 2000 karakter); tidak ada bila kosong. */
  transcript?: string;
  viralScore?: number | null;
  hookText?: string | null;
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
  /** hashtag kustom job; bila diisi, worker tidak membuat hashtag otomatis */
  customHashtags?: string[];
}

/** Hasil job antrean `captions`; juga body respons POST /api/clips/:id/caption. */
export interface CaptionJobResult {
  caption: string;
  hashtags: string[];
  platformCaptions?: PlatformCaptions | null;
}

/** Payload job `brief` pada antrean `captions` (enhance brief). */
export interface BriefJobData {
  brief: string;
}

/** Hasil job `brief` dan body respons POST /api/briefs/expand. */
export interface BriefJobResult {
  brief: string;
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

export interface FrameJobData {
  url: string;
  atSec: number;
  aspectRatio: AspectRatio;
  reframe: ReframeMode;
  twoSpeakers: boolean;
  facecam: boolean;
  captions: boolean;
  hookBanner?: boolean;
  captionSample: string;
  captionStyle?: CaptionStyle | null;
  outPath: string;
  userId: string;
}

export type FrameStatus = 'queued' | 'running' | 'done' | 'failed';


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

export interface PlatformCaptionVariant {
  title?: string;
  caption: string;
  hashtags: string[];
}

export type PlatformCaptions = Partial<Record<SocialPlatform, PlatformCaptionVariant>>;

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
  'scheduled',
  'queued',
  'uploading',
  'processing',
  'published',
  'failed',
  'cancelled',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const PUBLICATION_PRIVACIES = ['public', 'unlisted', 'private'] as const;
export type PublicationPrivacy = (typeof PUBLICATION_PRIVACIES)[number];

/** Batas metadata unggahan YouTube. */
export const PUBLISH_TITLE_MAX = 100;
export const PUBLISH_CAPTION_MAX = 5000;
export const PUBLISH_TARGETS_MAX = 5;

/** Batas caption TikTok (UTF-16 code unit). */
export const PUBLISH_TIKTOK_CAPTION_MAX = 2200;

/** Batas caption Instagram (UTF-16 code unit) dan jumlah hashtag per Reel. */
export const PUBLISH_INSTAGRAM_CAPTION_MAX = 2200;
export const PUBLISH_INSTAGRAM_MAX_HASHTAGS = 30;
/** Batas durasi Reels (detik). */
export const PUBLISH_INSTAGRAM_MAX_DURATION_SEC = 15 * 60;

/** Mode publikasi: 'direct' = Direct Post (video.publish), 'inbox' = draf di inbox TikTok (video.upload). */
export const PUBLISH_MODES = ['direct', 'inbox'] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

export interface TiktokPublishOptions {
  /** salah satu privacyLevelOptions dari creator_info (mis. SELF_ONLY) */
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContent: boolean;
  brandOrganic: boolean;
}

export interface PublishTarget {
  accountId: string;
  /** YouTube: 1..100 karakter, tanpa '<' atau '>'. TikTok/Instagram: opsional (diabaikan). */
  title: string;
  /**
   * YouTube: 0..5000 karakter (deskripsi). TikTok/Instagram: 0..2200 karakter
   * (caption; untuk TikTok tidak dipakai pada mode inbox).
   */
  caption: string;
  /** Wajib untuk YouTube; diabaikan untuk TikTok dan Instagram. */
  privacy?: PublicationPrivacy;
  madeForKids?: boolean;
  /** Hanya TikTok; default 'direct'. */
  mode?: PublishMode;
  /** Hanya TikTok mode direct (wajib di sana); diabaikan pada inbox. */
  tiktok?: TiktokPublishOptions;
  scheduledAt?: string | null;
}

/** Respons GET /api/social/accounts/:id/tiktok/creator-info. */
export interface TiktokCreatorInfoResponse {
  nickname: string;
  username: string;
  avatarUrl: string | null;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

/** Body POST /api/clips/:id/publish (1..5 target). */
export interface PublishRequest {
  targets: PublishTarget[];
  scheduledAt?: string | null;
}

/** Body POST /api/jobs/:id/schedule-publish. */
export interface BatchSchedulePublishRequest {
  clipIds?: string[];
  accountIds: string[];
  startAt?: string;
  intervalHours: number;
  privacy?: PublicationPrivacy;
  madeForKids?: boolean;
  tiktokMode?: PublishMode;
  tiktok?: TiktokPublishOptions;
}

export interface BatchSchedulePublishResponse {
  scheduled: PublicationResponse[];
  skipped: { clipId: string; accountId: string; reason: string }[];
}

export interface PublicationResponse {
  id: string;
  clipId: string;
  platform: SocialPlatform;
  accountId: string | null;
  accountName: string;
  title: string;
  caption: string;
  /** YouTube: public|unlisted|private. TikTok: privacy_level (direct) atau 'inbox'. Instagram: selalu 'public'. */
  privacy: string;
  mode: PublishMode;
  status: PublicationStatus;
  /** 0-100, persentase unggah */
  progress: number;
  externalId: string | null;
  externalUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  scheduledAt?: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  metricsUpdatedAt: string | null;
  metricsError: string | null;
}

/** Ringkasan publikasi untuk badge kartu klip (terbaru per akun). */
export interface ClipPublicationSummary {
  platform: SocialPlatform;
  status: PublicationStatus;
  externalUrl: string | null;
  scheduledAt?: string | null;
  mode?: PublishMode;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  metricsUpdatedAt?: string | null;
  metricsError?: string | null;
}

export interface RefreshMetricsResponse {
  publications: PublicationResponse[];
  refreshed: number;
  skipped: number;
  nextAllowedAt: string | null;
}

export interface BulkRefreshMetricsResponse {
  refreshed: number;
  skipped: number;
  nextAllowedAt: string | null;
}

/** Payload job BullMQ antrean `publish`. */
export type PublishJobData =
  | { publicationId: string; kind: 'upload' | 'check'; checks?: number }
  | { kind: 'sync-metrics' };

/** Antrean BullMQ modul Reference Edit (analisis referensi + footage + rencana edit + render). */
export const REFERENCE_QUEUE_NAME = 'reference-jobs';

export const REFERENCE_STAGES = [
  'analyze_reference',
  'analyze_footage',
  'plan_edit',
  'render',
  'save',
] as const;

export type ReferenceStage = (typeof REFERENCE_STAGES)[number];
export type ReferenceJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export const REFERENCE_MAX_FOOTAGE_FILES = 12;
export const REFERENCE_MAX_FILE_BYTES = 100 * 1024 * 1024;

export interface ReferenceFootageItem {
  id: string;
  name: string;
  /** path relatif di bawah CLIPS_DIR, mis. reference/<jobId>/footage-01.mp4 */
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
}

export interface ReferenceTemplateSlot {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  shotType: string;
  description: string;
  overlayText?: string | null;
  zoom?: 'none' | 'in' | 'out';
  beatSync?: boolean;
}

export interface ReferencePlanSlot {
  slotIndex: number;
  footageId: string;
  footageName: string;
  sourceStartSec: number;
  sourceEndSec: number;
  targetDurationSec: number;
  shotType: string;
  reason: string;
  overlayText?: string | null;
  zoom?: 'none' | 'in' | 'out';
}

export interface ReferenceJobData {
  jobId: string;
  userId: string;
  title: string;
  brief?: string | null;
  aspectRatio: AspectRatio;
  reframe: ReframeMode;
  captions: boolean;
  beatSync: boolean;
  /** URL referensi (YouTube/TikTok/IG) atau null bila memakai file upload */
  referenceUrl?: string | null;
  /** Path relatif di bawah CLIPS_DIR bila video referensi di-upload */
  referenceFilePath?: string | null;
  referenceDurationSec?: number | null;
  footage: ReferenceFootageItem[];
}

export interface ReferenceJobProgress {
  stage: ReferenceStage;
  percent: number;
  message?: string;
  templateSlots?: ReferenceTemplateSlot[];
  planSlots?: ReferencePlanSlot[];
}

export interface ReferenceJobResult {
  outputFilePath: string;
  durationSec: number;
  templateSlots: ReferenceTemplateSlot[];
  planSlots: ReferencePlanSlot[];
  caption?: string;
  hashtags?: string[];
}

export interface ReferenceJobResponse {
  id: string;
  title: string;
  brief: string | null;
  aspectRatio: AspectRatio;
  reframe: ReframeMode;
  captions: boolean;
  beatSync: boolean;
  referenceUrl: string | null;
  referenceFilePath: string | null;
  referenceDurationSec: number | null;
  footage: ReferenceFootageItem[];
  status: ReferenceJobStatus;
  stage: ReferenceStage | null;
  progress: number;
  message: string | null;
  error: string | null;
  templateSlots: ReferenceTemplateSlot[] | null;
  planSlots: ReferencePlanSlot[] | null;
  outputFilePath: string | null;
  outputDurationSec: number | null;
  caption: string | null;
  hashtags: string[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
