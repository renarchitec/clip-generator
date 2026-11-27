import { apiUrl } from "@/lib/desktop"
import type { CaptionStyle } from "@/lib/caption-style"
import type { JobWatermarkValue, WatermarkChromaKey } from "@/lib/watermark"

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled"
export type Reframe = "center_crop" | "face_tracking" | "blurred_fill" | "black_bars"
export type AspectRatio = "9:16" | "1:1" | "16:9"
export type MaxSourceSec = number | null
export type CaptionLanguage = "auto" | "id" | "en"
export const CAPTION_LANGUAGES: CaptionLanguage[] = ["auto", "id", "en"]
export const isCaptionLanguage = (value: unknown): value is CaptionLanguage => value === "auto" || value === "id" || value === "en"
export type TranscriptSource = "youtube" | "auto" | "live_chat_stt"
export const TRANSCRIPT_SOURCES: readonly TranscriptSource[] = ["youtube", "auto", "live_chat_stt"]
export const DEFAULT_TRANSCRIPT_SOURCE: TranscriptSource = "youtube"
export const isTranscriptSource = (value: unknown): value is TranscriptSource => value === "youtube" || value === "auto" || value === "live_chat_stt"
export type LlmStatus = {
  workerOnline: boolean
  configured: boolean
  model: string | null
  sttConfigured?: boolean
  sttModel?: string | null
  lastCall: null | { ok: boolean; at: string; error?: string }
  updatedAt: string | null
}
export const CUSTOM_HASHTAGS_MAX = 15
export const CUSTOM_HASHTAG_MAX_LENGTH = 50

export function parseCustomHashtags(raw: unknown): string[] {
  const items = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : []
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    for (const part of item.split(/[\s,#]+/)) {
      const tag = part.replace(/[^\p{L}\p{N}_]/gu, "").slice(0, CUSTOM_HASHTAG_MAX_LENGTH)
      if (!tag) continue
      const key = tag.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push(tag)
      if (result.length >= CUSTOM_HASHTAGS_MAX) return result
    }
  }
  return result
}

export function formatCustomHashtagsInput(tags: string[] | null | undefined): string {
  const parsed = parseCustomHashtags(tags)
  return parsed.map((tag) => `#${tag}`).join(" ")
}

export type JobPreview = { id: string; url: string; transcriptSource?: TranscriptSource; status: "queued" | "running" | "done" | "failed"; error: string | null; candidates: { start: number; end: number; title: string; reason: string; viralScore?: number | null; hookText?: string | null }[] | null; cues: { start: number; end: number; text: string }[] | null }
export type Job = { id: string; url: string; mode: string; reframe: Reframe; captions: boolean; hookBanner?: boolean; normalizeAudio?: boolean; twoSpeakers: boolean; facecam: boolean; aspectRatio: AspectRatio; maxSourceSec: MaxSourceSec; clipCount: number; targetDurationSec: number; description: string | null; captionLanguage?: CaptionLanguage; transcriptSource?: TranscriptSource; captionStyle?: CaptionStyle | null; customHashtags?: string[]; watermark?: JobWatermarkValue; status: JobStatus; stage: "download" | "transcribe" | "select" | "render" | "save" | null; progress: number; message: string | null; error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; clipsCount: number }
export type PublishMode = "direct" | "inbox"
export type PublicationStatus = "scheduled" | "queued" | "uploading" | "processing" | "published" | "failed" | "cancelled"
export const UPLOADING_PUBLICATION_STATUSES: readonly PublicationStatus[] = ["queued", "uploading", "processing"]
export const ACTIVE_PUBLICATION_STATUSES: readonly PublicationStatus[] = ["scheduled", "queued", "uploading", "processing"]
export const isUploadingPublication = (status: PublicationStatus) => UPLOADING_PUBLICATION_STATUSES.includes(status)
export const isScheduledPublication = (status: PublicationStatus) => status === "scheduled"
export const isActivePublication = (status: PublicationStatus) => ACTIVE_PUBLICATION_STATUSES.includes(status)

export type PlatformCaptionVariant = {
  title?: string
  caption: string
  hashtags: string[]
}
export type PlatformCaptions = Partial<Record<"youtube" | "tiktok" | "instagram", PlatformCaptionVariant>>

export type TikTokCreatorInfo = { nickname: string; username: string; avatarUrl: string | null; privacyLevelOptions: string[]; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean; maxVideoPostDurationSec: number }
export type TiktokPublishOptions = {
  privacyLevel: string
  disableComment: boolean
  disableDuet: boolean
  disableStitch: boolean
  brandContent: boolean
  brandOrganic: boolean
}
export interface ClipPublicationSummary {
  platform: "youtube" | "instagram" | "tiktok"
  status: PublicationStatus
  externalUrl: string | null
  mode?: PublishMode
  scheduledAt?: string | null
  viewCount?: number | null
  likeCount?: number | null
  commentCount?: number | null
  metricsUpdatedAt?: string | null
  metricsError?: string | null
}
export interface Publication {
  id: string
  clipId: string
  platform: "youtube" | "instagram" | "tiktok"
  accountId: string | null
  accountName: string
  title: string
  caption: string
  privacy: string
  mode: PublishMode
  status: PublicationStatus
  progress: number
  externalId: string | null
  externalUrl: string | null
  error: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  scheduledAt?: string | null
  viewCount: number | null
  likeCount: number | null
  commentCount: number | null
  metricsUpdatedAt: string | null
  metricsError: string | null
  coverTimestampMs?: number | null
  coverError?: string | null
}
export interface ClipCoverUploadResponse {
  coverId: string
}
export interface BatchSchedulePublishRequest {
  clipIds?: string[]
  accountIds: string[]
  startAt?: string
  intervalHours: number
  privacy?: "public" | "unlisted" | "private"
  madeForKids?: boolean
  tiktokMode?: PublishMode
  tiktok?: TiktokPublishOptions
}
export interface BatchSchedulePublishResponse {
  scheduled: Publication[]
  skipped: { clipId: string; accountId: string; reason: string }[]
}
export interface BulkRefreshMetricsResponse {
  refreshed: number
  skipped: number
  nextAllowedAt: string | null
}
export type Clip = { id: string; title: string; startSec: number; endSec: number; downloadedAt: string | null; deletedAt: string | null; caption?: string | null; hashtags?: string[]; platformCaptions?: PlatformCaptions | null; viralScore?: number | null; hookText?: string | null; publications?: ClipPublicationSummary[] }
export type RecentClip = { id: string; title: string; startSec: number; endSec: number; createdAt: string; caption?: string | null; hashtags?: string[]; platformCaptions?: PlatformCaptions | null; viralScore?: number | null; hookText?: string | null; publications?: ClipPublicationSummary[]; job: { id: string; url: string; aspectRatio: AspectRatio } }
export type JobSnapshot = { id: string; url: string; mode: string; reframe: Reframe; captions: boolean; hookBanner?: boolean; normalizeAudio?: boolean; twoSpeakers: boolean; facecam: boolean; aspectRatio: AspectRatio; maxSourceSec: MaxSourceSec; clipCount?: number; targetDurationSec?: number; ranges?: { start: number; end: number; title?: string; reason?: string; hookText?: string }[] | null; description: string | null; captionLanguage?: CaptionLanguage; transcriptSource?: TranscriptSource; captionStyle?: CaptionStyle | null; customHashtags?: string[]; watermark?: JobWatermarkValue; outro?: JobOutro | null; status: JobStatus; stage: Job["stage"]; progress: number; message: string | null; error: string | null; clips: Clip[] }
export type User = { id: string; email: string; name: string | null }

export type JobOutro = { outroId: string; filePath: string | null; durationSec: number }
export type JobWatermark = { watermarkId: string; x: number; y: number; scale: number; opacity: number; filePath: string | null; mimeType?: string; chromaKey?: WatermarkChromaKey | null }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), { ...init, headers: { "content-type": "application/json", ...init?.headers } })
  if (!response.ok) {
    const error = new Error(response.statusText || "Request failed") as Error & { status: number }
    error.status = response.status
    throw error
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function uploadClipCover(clipId: string, blob: Blob): Promise<ClipCoverUploadResponse> {
  // The shared api() helper forces JSON content-type; FormData must set its own boundary.
  const body = new FormData()
  body.append("file", blob, "cover.jpg")
  const response = await fetch(apiUrl(`/clips/${encodeURIComponent(clipId)}/cover`), {
    method: "POST",
    body,
    credentials: "same-origin",
  })
  if (!response.ok) {
    const error = new Error(response.statusText || "Cover upload failed") as Error & { status: number }
    error.status = response.status
    throw error
  }
  return response.json() as Promise<ClipCoverUploadResponse>
}

export function refreshBulkPublicationMetrics(clipIds?: string[]) {
  return api<BulkRefreshMetricsResponse>("/publications/refresh-metrics", {
    method: "POST",
    body: JSON.stringify(clipIds ? { clipIds } : {}),
  })
}

export function safeRedirectTarget(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return undefined
  return value
}
