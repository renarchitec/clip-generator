import { apiUrl, type AspectRatio } from "@/lib/api"

export type Watermark = { id: string; name: string; width: number; height: number; mimeType: string; createdAt: string; url: string }
export type WatermarkSettings = { watermarkId: string; x: number; y: number; scale: number; opacity: number }
export type JobWatermark = WatermarkSettings & { filePath: string | null }

export const WATERMARK_SCALE_MIN = 0.03
export const WATERMARK_SCALE_MAX = 1
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

/**
 * Crops fully transparent borders (e.g. a logo exported on a 1080x1920 canvas). The padding would
 * otherwise count as watermark area: it blocks dragging near the edges and caps the visible size.
 */
export async function trimTransparentPadding(file: File): Promise<File> {
  if (file.type !== "image/png" && file.type !== "image/webp") return file
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) return file
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const pixels = context.getImageData(0, 0, width, height).data
    let top = height, left = width, right = -1, bottom = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] === 0) continue
        if (y < top) top = y
        if (y > bottom) bottom = y
        if (x < left) left = x
        if (x > right) right = x
      }
    }
    if (right < 0) return file
    const cropW = right - left + 1
    const cropH = bottom - top + 1
    if (cropW === width && cropH === height) return file
    const cropped = document.createElement("canvas")
    cropped.width = cropW
    cropped.height = cropH
    cropped.getContext("2d")?.drawImage(canvas, left, top, cropW, cropH, 0, 0, cropW, cropH)
    const blob = await new Promise<Blob | null>((resolve) => cropped.toBlob(resolve, "image/png"))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" })
  } catch {
    return file
  }
}

export async function uploadWatermark(file: File, name?: string): Promise<Watermark> {
  // The shared api() helper forces JSON content-type; FormData must set its own boundary.
  const body = new FormData()
  body.append("file", await trimTransparentPadding(file))
  if (name?.trim()) body.append("name", name.trim())
  const response = await fetch(apiUrl("/watermarks"), { method: "POST", body, credentials: "same-origin" })
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
