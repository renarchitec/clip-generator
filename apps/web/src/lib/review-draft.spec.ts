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
  facecam: false,
  aspectRatio: "9:16",
  maxSourceSec: null,
  clipCount: 3,
  duration: 45,
  description: "highlights",
  captionLanguage: "id",
  transcriptSource: "live_chat_stt",
  customHashtags: "",
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

const centerCropSample: ReviewDraft = { ...sample, reframe: "center_crop" }
saveReviewDraft(centerCropSample)
assert.deepEqual(loadReviewDraft(), centerCropSample)

store.set("clipper-review-draft", JSON.stringify({ ...sample, twoSpeakers: undefined, facecam: undefined, aspectRatio: undefined, maxSourceSec: undefined }))
assert.equal(loadReviewDraft()?.twoSpeakers, false)
assert.equal(loadReviewDraft()?.facecam, false)
assert.equal(loadReviewDraft()?.aspectRatio, "9:16")
assert.equal(loadReviewDraft()?.maxSourceSec, null)
store.set("clipper-review-draft", JSON.stringify({ ...sample, captionLanguage: "fr", transcriptSource: "invalid" }))
assert.equal(loadReviewDraft()?.captionLanguage, "auto")
assert.equal(loadReviewDraft()?.transcriptSource, "youtube")

// 2. Clear
clearReviewDraft()
assert.equal(loadReviewDraft(), null)

// 3. Drop malformed
store.set("clipper-review-draft", JSON.stringify({ mode: "invalid" }))
assert.equal(loadReviewDraft(), null)

console.log("review-draft self-check passed")
