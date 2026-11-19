import type { Reframe } from "@/lib/api"

export type ReviewDraft = {
  url: string
  mode: "auto" | "manual"
  reframe: Reframe
  captions: boolean
  clipCount: number
  duration: number
  description: string
  ranges: { start: string; end: string }[]
  reviewFirst: boolean
  previewId: string | null
  selectedCandidates: number[]
  cueRanges: { start: number; end: number }[]
  selectedCueStart: number | null
  selectedCueEnd: number | null
}

const KEY = "clipper-review-draft"

// ponytail: loose shape check instead of a schema; a corrupt entry is dropped wholesale.
export function loadReviewDraft(): ReviewDraft | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as ReviewDraft
    if (typeof d.url !== "string" || (d.mode !== "auto" && d.mode !== "manual")) return null
    if (!Array.isArray(d.cueRanges) || d.cueRanges.some((r) => typeof r?.start !== "number" || typeof r?.end !== "number")) return null
    if (d.cueRanges.length > 10) return null
    if (!Array.isArray(d.ranges) || d.ranges.some((r) => typeof r?.start !== "string" || typeof r?.end !== "string")) return null
    if (!["face_tracking", "blurred_fill", "black_bars"].includes(d.reframe)) return null
    return { ...d, selectedCandidates: Array.isArray(d.selectedCandidates) ? d.selectedCandidates.filter((i) => Number.isInteger(i)) : [] }
  } catch {
    return null
  }
}

export function saveReviewDraft(draft: ReviewDraft) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(draft))
  } catch {}
}

export function clearReviewDraft() {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {}
}
