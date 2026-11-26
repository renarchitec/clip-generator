import type { ClipPublicationSummary } from "@/lib/api"
import type { SocialPlatform } from "@/components/social-accounts"

const PLATFORM_ORDER: readonly SocialPlatform[] = ["youtube", "tiktok", "instagram"]

export interface PlatformViewSummary {
  platform: SocialPlatform
  viewCount: number | null
  likeCount: number | null
  commentCount: number | null
  externalUrl: string | null
  metricsError: string | null
}

export interface ClipViewsSummary {
  totalViews: number | null
  hasPublished: boolean
  byPlatform: PlatformViewSummary[]
}

function formatScaled(value: number, divisor: number, suffix: string): string {
  const formatted = (value / divisor).toFixed(1).replace(/\.0$/, "")
  return `${formatted}${suffix}`
}

export function formatCompactCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0"
  const value = Math.round(n)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) {
    if (Number((value / 1_000).toFixed(1)) >= 1_000) return "1M"
    return formatScaled(value, 1_000, "K")
  }
  if (value < 1_000_000_000) {
    if (Number((value / 1_000_000).toFixed(1)) >= 1_000) return "1B"
    return formatScaled(value, 1_000_000, "M")
  }
  return formatScaled(value, 1_000_000_000, "B")
}

export function formatExactCount(n: number, lang: "en" | "id" = "en"): string {
  if (!Number.isFinite(n) || n <= 0) return "0"
  return new Intl.NumberFormat(lang === "id" ? "id-ID" : "en-US").format(Math.round(n))
}

function sumNullable(current: number | null, next: number | null | undefined): number | null {
  if (typeof next !== "number" || !Number.isFinite(next)) return current
  return (current ?? 0) + next
}

export function summarizeClipViews(publications?: ReadonlyArray<ClipPublicationSummary>): ClipViewsSummary {
  if (!publications?.length) {
    return { totalViews: null, hasPublished: false, byPlatform: [] }
  }

  const published = publications.filter((item) => item.status === "published")
  if (!published.length) {
    return { totalViews: null, hasPublished: false, byPlatform: [] }
  }

  let totalViews: number | null = null
  const grouped = new Map<SocialPlatform, PlatformViewSummary>()

  for (const item of published) {
    if (typeof item.viewCount === "number" && Number.isFinite(item.viewCount)) {
      totalViews = (totalViews ?? 0) + item.viewCount
    }

    const existing = grouped.get(item.platform)
    if (!existing) {
      grouped.set(item.platform, {
        platform: item.platform,
        viewCount: typeof item.viewCount === "number" && Number.isFinite(item.viewCount) ? item.viewCount : null,
        likeCount: typeof item.likeCount === "number" && Number.isFinite(item.likeCount) ? item.likeCount : null,
        commentCount: typeof item.commentCount === "number" && Number.isFinite(item.commentCount) ? item.commentCount : null,
        externalUrl: item.externalUrl ?? null,
        metricsError: item.metricsError ?? null,
      })
    } else {
      const nextViews = sumNullable(existing.viewCount, item.viewCount)
      existing.viewCount = nextViews
      existing.likeCount = sumNullable(existing.likeCount, item.likeCount)
      existing.commentCount = sumNullable(existing.commentCount, item.commentCount)
      if (!existing.externalUrl && item.externalUrl) existing.externalUrl = item.externalUrl
      existing.metricsError = nextViews !== null ? null : (existing.metricsError ?? item.metricsError ?? null)
    }
  }

  const byPlatform = PLATFORM_ORDER
    .map((platform) => grouped.get(platform))
    .filter((entry): entry is PlatformViewSummary => entry !== undefined)

  return {
    totalViews,
    hasPublished: true,
    byPlatform,
  }
}
