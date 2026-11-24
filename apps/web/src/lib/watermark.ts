import type { AspectRatio } from "@/lib/api"

export type Watermark = { id: string; name: string; width: number; height: number; mimeType: string; createdAt: string; url: string }
export type WatermarkSettings = { watermarkId: string; x: number; y: number; scale: number; opacity: number }
export type JobWatermark = WatermarkSettings & { filePath: string | null }

export const WATERMARK_SCALE_MIN = 0.03
export const WATERMARK_SCALE_MAX = 0.6
export const WATERMARK_OPACITY_MIN = 0.1

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function clampWatermark(settings: WatermarkSettings): WatermarkSettings {
  return {
    ...settings,
    x: clamp(settings.x, 0, 1),
    y: clamp(settings.y, 0, 1),
    scale: clamp(settings.scale, WATERMARK_SCALE_MIN, WATERMARK_SCALE_MAX),
    opacity: clamp(settings.opacity, WATERMARK_OPACITY_MIN, 1),
  }
}

export function defaultWatermarkSettings(id: string): WatermarkSettings {
  return { watermarkId: id, x: 0.5, y: 0.5, scale: 0.18, opacity: 0.8 }
}

export async function uploadWatermark(file: File, name?: string): Promise<Watermark> {
  // The shared api() helper forces JSON content-type; FormData must set its own boundary.
  const body = new FormData()
  body.append("file", file)
  if (name?.trim()) body.append("name", name.trim())
  const response = await fetch("/api/watermarks", { method: "POST", body, credentials: "same-origin" })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error((data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : null) || `Upload failed (${response.status})`)
  return data as Watermark
}

export const ASPECT_VALUES: Record<AspectRatio, number> = { "9:16": 9 / 16, "1:1": 1, "16:9": 16 / 9 }

/** Watermark width is a fraction of the output width; height follows the image's aspect ratio. */
export function watermarkFrameSize(watermark: Watermark | undefined, scale: number, aspectRatio: AspectRatio) {
  const width = clamp(scale, WATERMARK_SCALE_MIN, WATERMARK_SCALE_MAX)
  const imageRatio = watermark && watermark.height > 0 ? watermark.height / watermark.width : 1
  return { width, height: clamp(width * imageRatio * ASPECT_VALUES[aspectRatio], 0, 1) }
}
