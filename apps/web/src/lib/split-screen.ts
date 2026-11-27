export const MEDIA_SOURCE_KINDS = ["url", "upload", "clip"] as const
export type MediaSourceKind = (typeof MEDIA_SOURCE_KINDS)[number]

export const MEDIA_UPLOAD_MAX_BYTES = 100 * 1024 * 1024
export const MEDIA_UPLOAD_MAX_DURATION_SEC = 60 * 60
export const MEDIA_MAX_PER_USER = 50

export interface MediaAssetResponse {
  id: string
  name: string
  mimeType: string
  durationSec: number
  width: number
  height: number
  sizeBytes: number
  createdAt: string
}

export interface PrimaryMediaSource {
  kind: MediaSourceKind
  url?: string
  mediaId?: string
  clipId?: string
  /** Path relatif terhadap CLIPS_DIR (diisi API sebelum masuk worker). */
  filePath?: string
  label?: string
  durationSec?: number | null
}

export const SPLIT_SCREEN_RATIOS = ["50:50", "40:60", "60:40"] as const
export type SplitScreenRatio = (typeof SPLIT_SCREEN_RATIOS)[number]
export const DEFAULT_SPLIT_SCREEN_RATIO: SplitScreenRatio = "50:50"

export const SPLIT_PANEL_FITS = ["cover", "contain_blur"] as const
export type SplitPanelFit = (typeof SPLIT_PANEL_FITS)[number]

export const SPLIT_MATCH_MODES = ["auto", "sequential"] as const
export type SplitMatchMode = (typeof SPLIT_MATCH_MODES)[number]
export const DEFAULT_SPLIT_MATCH_MODE: SplitMatchMode = "auto"

export const SPLIT_SCREEN_MAX_CLIPS = 10

export interface SplitScreenClipSource {
  id: string
  kind: MediaSourceKind
  url?: string
  mediaId?: string
  clipId?: string
  filePath?: string
  label: string
  description?: string | null
  startSec?: number | null
  endSec?: number | null
  durationSec?: number | null
}

export interface SplitScreenSegment {
  atStart: number
  atEnd: number
  clipId: string
  sourceStartSec?: number
  reason?: string
}

export interface SplitScreenConfig {
  enabled: boolean
  ratio: SplitScreenRatio
  swap: boolean
  primaryFit: SplitPanelFit
  secondaryFit: SplitPanelFit
  /** 0..1 (0 = mute default) */
  secondaryVolume: number
  matchMode: SplitMatchMode
  clips: SplitScreenClipSource[]
}

export function splitScreenRatioTopFraction(ratio: SplitScreenRatio): number {
  switch (ratio) {
    case "50:50":
      return 0.5
    case "40:60":
      return 0.4
    case "60:40":
      return 0.6
  }
}

export const defaultSplit: SplitScreenConfig = {
  enabled: false,
  ratio: "50:50",
  swap: false,
  primaryFit: "cover",
  secondaryFit: "contain_blur",
  secondaryVolume: 0,
  matchMode: "auto",
  clips: [],
}
export function sourceVideo(s?: PrimaryMediaSource | null) {
  return s?.kind === "upload" && s.mediaId
    ? `/api/media/${encodeURIComponent(s.mediaId)}/file`
    : s?.kind === "clip" && s.clipId
      ? `/api/clips/${encodeURIComponent(s.clipId)}/stream`
      : undefined
}
export function clipColor(id: string) {
  let hash = 0
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0
  return `hsl(${Math.abs(hash) % 360} 55% 44%)`
}
