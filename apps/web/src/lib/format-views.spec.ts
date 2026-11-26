import assert from "node:assert/strict"
import { formatCompactCount, formatExactCount, summarizeClipViews } from "./format-views.ts"
import type { ClipPublicationSummary } from "./api.ts"

// 1. formatCompactCount
assert.equal(formatCompactCount(0), "0")
assert.equal(formatCompactCount(-5), "0")
assert.equal(formatCompactCount(Number.NaN), "0")
assert.equal(formatCompactCount(1), "1")
assert.equal(formatCompactCount(950), "950")
assert.equal(formatCompactCount(999), "999")
assert.equal(formatCompactCount(1000), "1K")
assert.equal(formatCompactCount(1049), "1K")
assert.equal(formatCompactCount(1200), "1.2K")
assert.equal(formatCompactCount(12500), "12.5K")
assert.equal(formatCompactCount(999_949), "999.9K")
assert.equal(formatCompactCount(999_950), "1M")
assert.equal(formatCompactCount(1_000_000), "1M")
assert.equal(formatCompactCount(1_500_000), "1.5M")
assert.equal(formatCompactCount(999_950_000), "1B")
assert.equal(formatCompactCount(1_000_000_000), "1B")
assert.equal(formatCompactCount(2_350_000_000), "2.4B")

// 2. formatExactCount
assert.equal(formatExactCount(0), "0")
assert.equal(formatExactCount(12345, "en"), "12,345")
assert.equal(formatExactCount(12345, "id"), "12.345")
assert.equal(formatExactCount(-10, "en"), "0")

// 3. summarizeClipViews — empty / non-published
assert.deepEqual(summarizeClipViews(undefined), { totalViews: null, hasPublished: false, byPlatform: [] })
assert.deepEqual(summarizeClipViews([]), { totalViews: null, hasPublished: false, byPlatform: [] })
assert.deepEqual(
  summarizeClipViews([
    { platform: "youtube", status: "uploading", externalUrl: null, viewCount: 500 },
    { platform: "tiktok", status: "failed", externalUrl: null, viewCount: 100 },
  ]),
  { totalViews: null, hasPublished: false, byPlatform: [] },
)

// 4. summarizeClipViews — published with no fetched metrics yet
const publishedNoMetrics = summarizeClipViews([
  { platform: "tiktok", status: "published", externalUrl: "https://tiktok.com/@a/1", viewCount: null, metricsError: "missing_scope" },
])
assert.equal(publishedNoMetrics.hasPublished, true)
assert.equal(publishedNoMetrics.totalViews, null)
assert.deepEqual(publishedNoMetrics.byPlatform, [
  {
    platform: "tiktok",
    viewCount: null,
    likeCount: null,
    commentCount: null,
    externalUrl: "https://tiktok.com/@a/1",
    metricsError: "missing_scope",
  },
])

// 5. summarizeClipViews — published across multiple platforms (including zero views)
const multi: ClipPublicationSummary[] = [
  { platform: "instagram", status: "published", externalUrl: "https://instagram.com/reel/1", viewCount: 0, likeCount: 2, commentCount: 0 },
  { platform: "youtube", status: "published", externalUrl: "https://youtu.be/abc", viewCount: 1200, likeCount: 80, commentCount: 12 },
  { platform: "tiktok", status: "published", externalUrl: null, viewCount: null, metricsError: "post_id_unavailable" },
  { platform: "youtube", status: "failed", externalUrl: null, viewCount: 9999 },
]
const multiSummary = summarizeClipViews(multi)
assert.equal(multiSummary.hasPublished, true)
assert.equal(multiSummary.totalViews, 1200)
assert.deepEqual(
  multiSummary.byPlatform.map((item) => item.platform),
  ["youtube", "tiktok", "instagram"],
)
assert.equal(multiSummary.byPlatform[0].viewCount, 1200)
assert.equal(multiSummary.byPlatform[1].viewCount, null)
assert.equal(multiSummary.byPlatform[1].metricsError, "post_id_unavailable")
assert.equal(multiSummary.byPlatform[2].viewCount, 0)

// 6. summarizeClipViews — aggregates multiple published accounts on same platform
const dupPlatform = summarizeClipViews([
  { platform: "youtube", status: "published", externalUrl: "https://youtu.be/1", viewCount: 400, likeCount: 10, commentCount: 2 },
  { platform: "youtube", status: "published", externalUrl: "https://youtu.be/2", viewCount: 600, likeCount: 25, commentCount: null },
])
assert.equal(dupPlatform.totalViews, 1000)
assert.equal(dupPlatform.byPlatform.length, 1)
assert.equal(dupPlatform.byPlatform[0].viewCount, 1000)
assert.equal(dupPlatform.byPlatform[0].likeCount, 35)
assert.equal(dupPlatform.byPlatform[0].commentCount, 2)

console.log("format-views self-check passed")
