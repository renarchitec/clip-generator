export type Outro = { id: string; name: string; mimeType: string; durationSec: number; width: number; height: number; sizeBytes: number; createdAt: string }
export type OutroSettings = { outroId: string }

export const OUTRO_MAX_BYTES = 50 * 1024 * 1024
export const OUTRO_MAX_COUNT = 20
export const OUTRO_ACCEPT = "video/mp4,video/quicktime"

export const outroFileUrl = (id: string) => `/api/outros/${encodeURIComponent(id)}/file`

/** MIME types are sometimes empty for .mov on some browsers, so fall back to the extension. */
export function isOutroFileType(file: File) {
  if (file.type === "video/mp4" || file.type === "video/quicktime") return true
  return !file.type && /\.(mp4|mov)$/i.test(file.name)
}

/** 3 → "3s", 3.46 → "3.5s". */
export function formatOutroDuration(durationSec: number) {
  return `${Number(durationSec.toFixed(1))}s`
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function uploadOutro(file: File, name?: string): Promise<Outro> {
  // The shared api() helper forces JSON content-type; FormData must set its own boundary.
  const body = new FormData()
  body.append("file", file)
  if (name?.trim()) body.append("name", name.trim())
  const response = await fetch("/api/outros", { method: "POST", body, credentials: "same-origin" })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error((data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : null) || `Upload failed (${response.status})`)
  return data as Outro
}
