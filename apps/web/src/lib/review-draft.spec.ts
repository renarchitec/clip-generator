import assert from "node:assert/strict"
import { clearReviewDraft, loadReviewDraft, saveReviewDraft, type ReviewDraft } from "./review-draft.ts"

// Mock window.sessionStorage
const store = new Map<string, string>()
;(globalThis as unknown as { window: unknown }).window = {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
  },
}

const sample: ReviewDraft = {
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  mode: "auto",
  reframe: "face_tracking",
  captions: true,
  twoSpeakers: false,
  aspectRatio: "9:16",
  maxSourceSec: null,
  clipCount: 3,
  duration: 45,
  description: "highlights",
  ranges: [{ start: "", end: "" }],
  reviewFirst: true,
  previewId: "prev-123",
  selectedCandidates: [0, 2],
  cueRanges: [{ start: 10, end: 20 }],
  selectedCueStart: 1,
  selectedCueEnd: 4,
}

// 1. Save and load
saveReviewDraft(sample)
assert.deepEqual(loadReviewDraft(), sample)

store.set("clipper-review-draft", JSON.stringify({ ...sample, twoSpeakers: undefined, aspectRatio: undefined, maxSourceSec: undefined }))
assert.equal(loadReviewDraft()?.twoSpeakers, false)
assert.equal(loadReviewDraft()?.aspectRatio, "9:16")
assert.equal(loadReviewDraft()?.maxSourceSec, null)

// 2. Clear
clearReviewDraft()
assert.equal(loadReviewDraft(), null)

// 3. Drop malformed
store.set("clipper-review-draft", JSON.stringify({ mode: "invalid" }))
assert.equal(loadReviewDraft(), null)

console.log("review-draft self-check passed")
