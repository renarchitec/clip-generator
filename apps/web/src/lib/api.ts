export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled"
export type Reframe = "face_tracking" | "blurred_fill" | "black_bars"
export type AspectRatio = "9:16" | "1:1" | "16:9"
export type MaxSourceSec = number | null
export type CaptionLanguage = "auto" | "id" | "en"
export const CAPTION_LANGUAGES: CaptionLanguage[] = ["auto", "id", "en"]
export const isCaptionLanguage = (value: unknown): value is CaptionLanguage => value === "auto" || value === "id" || value === "en"
export type JobPreview = { id: string; url: string; status: "queued" | "running" | "done" | "failed"; error: string | null; candidates: { start: number; end: number; title: string; reason: string }[] | null; cues: { start: number; end: number; text: string }[] | null }
export type Job = { id: string; url: string; mode: string; reframe: Reframe; captions: boolean; twoSpeakers: boolean; facecam: boolean; aspectRatio: AspectRatio; maxSourceSec: MaxSourceSec; clipCount: number; targetDurationSec: number; description: string | null; captionLanguage?: CaptionLanguage; status: JobStatus; stage: "download" | "transcribe" | "select" | "render" | "save" | null; progress: number; message: string | null; error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; clipsCount: number }
export type PublishMode = "direct" | "inbox"
export type TikTokCreatorInfo = { nickname: string; username: string; avatarUrl: string | null; privacyLevelOptions: string[]; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean; maxVideoPostDurationSec: number }
export type ClipPublicationSummary = { platform: "youtube" | "instagram" | "tiktok"; status: "queued" | "uploading" | "processing" | "published" | "failed"; externalUrl: string | null; mode?: PublishMode }
export type Clip = { id: string; title: string; startSec: number; endSec: number; downloadedAt: string | null; deletedAt: string | null; caption?: string | null; hashtags?: string[]; publications?: ClipPublicationSummary[] }
export type RecentClip = { id: string; title: string; startSec: number; endSec: number; createdAt: string; caption?: string | null; hashtags?: string[]; publications?: ClipPublicationSummary[]; job: { id: string; url: string; aspectRatio: AspectRatio } }
export type JobSnapshot = { id: string; url: string; mode: string; reframe: Reframe; captions: boolean; twoSpeakers: boolean; facecam: boolean; aspectRatio: AspectRatio; maxSourceSec: MaxSourceSec; clipCount?: number; targetDurationSec?: number; ranges?: { start: number; end: number }[] | null; description: string | null; captionLanguage?: CaptionLanguage; status: JobStatus; stage: Job["stage"]; progress: number; message: string | null; error: string | null; clips: Clip[] }
export type User = { id: string; email: string; name: string | null }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } })
  if (!response.ok) {
    const error = new Error(response.statusText || "Request failed") as Error & { status: number }
    error.status = response.status
    throw error
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function safeRedirectTarget(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return undefined
  return value
}
