export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled"
export type Reframe = "face_tracking" | "blurred_fill" | "black_bars"
export type AspectRatio = "9:16" | "1:1" | "16:9"
export type MaxSourceSec = number | null
export type JobPreview = { id: string; url: string; status: "queued" | "running" | "done" | "failed"; error: string | null; candidates: { start: number; end: number; title: string; reason: string }[] | null; cues: { start: number; end: number; text: string }[] | null }
export type Job = { id: string; url: string; mode: string; reframe: Reframe; captions: boolean; twoSpeakers: boolean; aspectRatio: AspectRatio; maxSourceSec: MaxSourceSec; clipCount: number; targetDurationSec: number; description: string | null; status: JobStatus; stage: "download" | "transcribe" | "select" | "render" | "save" | null; progress: number; message: string | null; error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; clipsCount: number }
export type Clip = { id: string; title: string; startSec: number; endSec: number; downloadedAt: string | null; deletedAt: string | null }
export type JobSnapshot = { id: string; url: string; mode: string; reframe: Reframe; captions: boolean; twoSpeakers: boolean; aspectRatio: AspectRatio; maxSourceSec: MaxSourceSec; clipCount?: number; targetDurationSec?: number; ranges?: { start: number; end: number }[] | null; description: string | null; status: JobStatus; stage: Job["stage"]; progress: number; message: string | null; error: string | null; clips: Clip[] }
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
