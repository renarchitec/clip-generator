import { apiUrl } from "./desktop.ts"
import type { AspectRatio } from "@/lib/api"

export type WatermarkKind = "image" | "video"
export type WatermarkChromaKey = { enabled: boolean; color: string; similarity: number; blend: number }
export const DEFAULT_CHROMA_KEY: WatermarkChromaKey = { enabled: false, color: "#00FF00", similarity: 0.18, blend: 0.08 }
export const WATERMARK_CHROMA_SIMILARITY_MIN = 0.01
export const WATERMARK_CHROMA_SIMILARITY_MAX = 0.5
export const WATERMARK_CHROMA_BLEND_MIN = 0
export const WATERMARK_CHROMA_BLEND_MAX = 0.5

export type Watermark = { id: string; name: string; width: number; height: number; mimeType: string; kind?: WatermarkKind; durationSec?: number | null; createdAt: string; url: string }
export type WatermarkSettings = { watermarkId: string; x: number; y: number; scale: number; opacity: number; chromaKey?: WatermarkChromaKey | null }
export type WatermarkLayer = WatermarkSettings & { layerId: string }
export type JobWatermark = WatermarkSettings & { filePath: string | null; mimeType?: string }
export type WatermarkDefaultValue = WatermarkSettings | WatermarkSettings[] | null
export type JobWatermarkValue = JobWatermark | JobWatermark[] | null

export const WATERMARK_MAX_PER_JOB = 5
export const WATERMARK_SCALE_MIN = 0.03
export const WATERMARK_SCALE_MAX = 1
export const WATERMARK_OPACITY_MIN = 0.1

export const WATERMARK_STAGGER_POSITIONS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0.5, y: 0.5 },
  { x: 0.5, y: 0.22 },
  { x: 0.5, y: 0.78 },
  { x: 0.24, y: 0.24 },
  { x: 0.76, y: 0.76 },
]

let fallbackLayerCounter = 0

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function isVideoWatermark(watermark: Pick<Watermark, "mimeType" | "kind"> | undefined): boolean {
  return watermark?.kind === "video" || !!watermark?.mimeType?.startsWith("video/")
}

export function clampChromaKey(chromaKey: WatermarkChromaKey): WatermarkChromaKey {
  const color = typeof chromaKey.color === "string" && HEX_COLOR_RE.test(chromaKey.color.trim())
    ? chromaKey.color.trim().toUpperCase()
    : DEFAULT_CHROMA_KEY.color
  return {
    enabled: Boolean(chromaKey.enabled),
    color,
    similarity: clamp(Number.isFinite(chromaKey.similarity) ? chromaKey.similarity : DEFAULT_CHROMA_KEY.similarity, WATERMARK_CHROMA_SIMILARITY_MIN, WATERMARK_CHROMA_SIMILARITY_MAX),
    blend: clamp(Number.isFinite(chromaKey.blend) ? chromaKey.blend : DEFAULT_CHROMA_KEY.blend, WATERMARK_CHROMA_BLEND_MIN, WATERMARK_CHROMA_BLEND_MAX),
  }
}

export function clampWatermark(settings: WatermarkSettings): WatermarkSettings {
  const clamped: WatermarkSettings = {
    watermarkId: settings.watermarkId,
    x: clamp(settings.x, 0, 1),
    y: clamp(settings.y, 0, 1),
    scale: clamp(settings.scale, WATERMARK_SCALE_MIN, WATERMARK_SCALE_MAX),
    opacity: clamp(settings.opacity, WATERMARK_OPACITY_MIN, 1),
  }
  if (settings.chromaKey) {
    clamped.chromaKey = clampChromaKey(settings.chromaKey)
  } else if (settings.chromaKey === null) {
    clamped.chromaKey = null
  }
  return clamped
}

export function staggerWatermarkPosition(index: number): { x: number; y: number } {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0
  return WATERMARK_STAGGER_POSITIONS[safeIndex % WATERMARK_STAGGER_POSITIONS.length]
}

export function defaultWatermarkSettings(id: string, index = 0): WatermarkSettings {
  const pos = staggerWatermarkPosition(index)
  return { watermarkId: id, x: pos.x, y: pos.y, scale: 0.18, opacity: 0.8 }
}

export function toWatermarkLayer(settings: WatermarkSettings, layerId?: string): WatermarkLayer {
  const id =
    layerId ??
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `wm-${Date.now()}-${++fallbackLayerCounter}`)
  return { ...clampWatermark(settings), layerId: id }
}

export function stripLayerId({ layerId: _id, ...settings }: WatermarkLayer): WatermarkSettings {
  return settings
}

export function normalizeWatermarkSettingsList(raw: WatermarkDefaultValue | undefined): WatermarkSettings[] {
  if (!raw) return []
  const items = Array.isArray(raw) ? raw : [raw]
  return items
    .filter((item): item is WatermarkSettings => Boolean(item && typeof item === "object" && typeof item.watermarkId === "string"))
    .slice(0, WATERMARK_MAX_PER_JOB)
    .map(clampWatermark)
}

export function normalizeJobWatermarks(raw: JobWatermarkValue | undefined): JobWatermark[] {
  if (!raw) return []
  const items = Array.isArray(raw) ? raw : [raw]
  return items
    .filter((item): item is JobWatermark => Boolean(item && typeof item === "object" && typeof item.watermarkId === "string"))
    .slice(0, WATERMARK_MAX_PER_JOB)
}

export function serializeWatermarkList(layers: Array<WatermarkSettings | WatermarkLayer>): WatermarkDefaultValue {
  const cleaned = layers
    .slice(0, WATERMARK_MAX_PER_JOB)
    .map((layer) => clampWatermark("layerId" in layer ? stripLayerId(layer) : layer))
  if (cleaned.length === 0) return null
  if (cleaned.length === 1) return cleaned[0]
  return cleaned
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

function isVideoUploadFile(file: File): boolean {
  return file.type === "video/mp4" || file.type === "video/webm" || file.type === "video/quicktime" || file.type.startsWith("video/") || VIDEO_EXT_RE.test(file.name)
}

export async function uploadWatermark(file: File, name?: string): Promise<Watermark> {
  // The shared api() helper forces JSON content-type; FormData must set its own boundary.
  const body = new FormData()
  const prepared = !isVideoUploadFile(file) && (file.type === "image/png" || file.type === "image/webp")
    ? await trimTransparentPadding(file)
    : file
  body.append("file", prepared)
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
