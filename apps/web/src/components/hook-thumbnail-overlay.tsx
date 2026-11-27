import { useMemo } from "react"
import type { AspectRatio } from "@/lib/api"
import { useT } from "@/lib/i18n"

type Props = {
  aspectRatio: AspectRatio
  text: string
  frameWidthPx: number
  frameHeightPx: number
  /** When false (e.g. over empty monitor or video embed without a rendered frame), adds a sleek dark backdrop for crisp readability. */
  hasFrame?: boolean
}

type AspectSpec = {
  refW: number
  refH: number
  maxTextWidthPct: number
  startFontRef: number
  minFontRef: number
}

const ASPECT_SPECS: Record<AspectRatio, AspectSpec> = {
  "9:16": {
    refW: 1080,
    refH: 1920,
    maxTextWidthPct: 74,
    startFontRef: Math.round(1080 * 0.078),
    minFontRef: Math.round(1080 * 0.048),
  },
  "1:1": {
    refW: 1080,
    refH: 1080,
    maxTextWidthPct: 80,
    startFontRef: Math.round(1080 * 0.068),
    minFontRef: Math.round(1080 * 0.048),
  },
  "16:9": {
    refW: 1920,
    refH: 1080,
    maxTextWidthPct: 76,
    startFontRef: Math.round(1080 * 0.08),
    minFontRef: Math.round(1080 * 0.048),
  },
}

const SCRIM_BACKGROUNDS = [
  "linear-gradient(to bottom, rgba(5, 8, 17, 0.24) 0%, rgba(5, 8, 17, 0) 18%)",
  "linear-gradient(to bottom, rgba(5, 8, 17, 0) 26%, rgba(5, 8, 17, 0.36) 38%, rgba(5, 8, 17, 0.56) 50%, rgba(5, 8, 17, 0.36) 62%, rgba(5, 8, 17, 0) 74%)",
  "linear-gradient(to bottom, rgba(5, 8, 17, 0) 72%, rgba(5, 8, 17, 0.28) 100%)",
  "radial-gradient(ellipse at center, transparent 58%, rgba(5, 8, 17, 0.22) 100%)",
].join(", ")

const HEADLINE_FONT_FAMILY = '"Montserrat", "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif'

function charWidthRatio(ch: string): number {
  if (ch === " ") return 0.3
  if ("I|!1.,;:'\"’‘·".includes(ch)) return 0.36
  if ("JLT()[]{}/\\-".includes(ch)) return 0.58
  if ("MW@".includes(ch)) return 0.96
  if (ch === "…") return 0.84
  if ("OQGDHNU".includes(ch)) return 0.78
  return 0.69
}

function estimateLineWidth(line: string, fontSizeRef: number, strokeRef: number): number {
  let units = 0
  for (let i = 0; i < line.length; i++) {
    units += charWidthRatio(line[i])
  }
  return units * fontSizeRef + strokeRef * 2
}

function normalizeHookText(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "")
    .trim()
    .toUpperCase()
    .slice(0, 80)
    .trimEnd()
}

/**
 * Mirrors rust/crates/dartclip-core/src/hook_thumbnail.rs `balanced_lines`:
 * finds the fewest fitting lines (1–3), then minimizes line-width variance and orphan last words.
 */
function findBalancedLines(words: string[], measure: (line: string) => number, maxWidth: number): string[] {
  const n = words.length
  if (n === 0) return []
  const cache = new Map<string, number>()
  const spanWidth = (start: number, end: number) => {
    const key = `${start}:${end}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const measured = measure(words.slice(start, end).join(" "))
    cache.set(key, measured)
    return measured
  }

  const maxLines = Math.min(3, n)
  for (let count = 1; count <= maxLines; count++) {
    let best: string[] = []
    let bestScore = Number.POSITIVE_INFINITY

    const evaluate = (bounds: number[]) => {
      const sizes: number[] = []
      for (let i = 0; i < count; i++) {
        const size = spanWidth(bounds[i], bounds[i + 1])
        if (size > maxWidth) return
        sizes.push(size)
      }
      const mean = sizes.reduce((sum, val) => sum + val, 0) / count
      let score = sizes.reduce((sum, val) => sum + (val - mean) ** 2, 0)
      const lastWordCount = bounds[count] - bounds[count - 1]
      if (count > 1 && lastWordCount === 1 && sizes[count - 1] < mean * 0.65) {
        score += maxWidth * maxWidth
      }
      if (score < bestScore) {
        bestScore = score
        best = Array.from({ length: count }, (_, i) => words.slice(bounds[i], bounds[i + 1]).join(" "))
      }
    }

    if (count === 1) {
      evaluate([0, n])
    } else if (count === 2) {
      for (let c1 = 1; c1 < n; c1++) {
        evaluate([0, c1, n])
      }
    } else {
      for (let c1 = 1; c1 < n - 1; c1++) {
        if (spanWidth(0, c1) > maxWidth) break
        for (let c2 = c1 + 1; c2 < n; c2++) {
          if (spanWidth(c1, c2) > maxWidth) break
          evaluate([0, c1, c2, n])
        }
      }
    }

    if (best.length > 0) return best
  }

  return []
}

function layoutHookHeadline(rawText: string, spec: AspectSpec): { lines: string[]; fontSizeRef: number } {
  const text = normalizeHookText(rawText)
  if (!text) return { lines: [], fontSizeRef: spec.startFontRef }

  // Slight 6% safety margin so real browser Montserrat kerning never unexpectedly wraps a pre-balanced line.
  const maxTextW = spec.refW * (spec.maxTextWidthPct / 100) * 0.94
  const words = text.split(" ")
  let size = Math.max(spec.minFontRef, spec.startFontRef)
  let lines: string[] = []
  let measure = (line: string) => estimateLineWidth(line, size, Math.max(2, Math.round(size * 0.05)))

  while (true) {
    const stroke = Math.max(2, Math.round(size * 0.05))
    measure = (line: string) => estimateLineWidth(line, size, stroke)
    lines = findBalancedLines(words, measure, maxTextW)
    if (lines.length > 0 || size === spec.minFontRef) break
    size = Math.max(spec.minFontRef, size - 4)
  }

  if (lines.length === 0) {
    const tokens = [...words]
    while (tokens.length > 0) {
      const candidate = [...tokens.slice(0, -1), `${tokens[tokens.length - 1]}…`]
      lines = findBalancedLines(candidate, measure, maxTextW)
      if (lines.length > 0) break
      tokens.pop()
    }
    if (lines.length === 0) {
      let prefix = words[0] ?? ""
      while (prefix.length > 0 && measure(`${prefix}…`) > maxTextW) {
        prefix = prefix.slice(0, -1)
      }
      lines = [`${prefix}…`]
    }
  }

  return { lines, fontSizeRef: size }
}

export function HookThumbnailOverlay({ aspectRatio, text, frameWidthPx, frameHeightPx, hasFrame = true }: Props) {
  const t = useT()
  const spec = ASPECT_SPECS[aspectRatio]

  const { lines, fontSizeRef } = useMemo(() => layoutHookHeadline(text, spec), [text, spec])

  const effectiveWidth = frameWidthPx > 0 ? frameWidthPx : spec.refW * 0.25
  const effectiveHeight = frameHeightPx > 0 ? frameHeightPx : spec.refH * 0.25
  const scale = effectiveWidth / spec.refW

  const fontSizePx = Math.max(10, Math.round(fontSizeRef * scale * 10) / 10)
  const strokeRef = Math.max(2, Math.round(fontSizeRef * 0.05))
  // With `paintOrder: "stroke fill"`, CSS centers the stroke on the glyph edge (half outside), so 2× matches Pillow's outer stroke width.
  const strokePx = Math.max(1, Math.round(strokeRef * 2 * scale * 10) / 10)
  const shadowOffY = Math.max(2, Math.round(Math.max(6, fontSizeRef * 0.1) * scale * 10) / 10)
  const shadowBlur = Math.max(3, Math.round(Math.max(8, fontSizeRef * 0.18) * scale * 10) / 10)

  const pillHeightPx = Math.max(3, Math.round(effectiveHeight * 0.005))
  const pillGapPx = Math.max(4, Math.round(fontSizePx * 0.38))

  const textStyle = {
    WebkitTextStroke: `${strokePx}px #080C16`,
    paintOrder: "stroke fill" as const,
    textShadow: `0 ${shadowOffY}px ${shadowBlur}px rgba(0, 0, 0, 0.88)`,
  }

  const singleLineSplit = useMemo(() => {
    if (lines.length !== 1) return null
    const tokens = lines[0].split(" ")
    if (tokens.length <= 1) return null
    const split = Math.floor(tokens.length / 2)
    return {
      first: tokens.slice(0, split).join(" "),
      second: tokens.slice(split).join(" "),
    }
  }, [lines])

  return (
    <div
      data-testid="hook-thumbnail-overlay"
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-[12] select-none overflow-hidden ${hasFrame ? "" : "bg-zinc-950/60"}`}
    >
      {/* Center-balanced cinematic scrim + subtle top, bottom & radial vignette matching rust/crates/dartclip-core/src/hook_thumbnail.rs */}
      <div
        className="absolute inset-0"
        style={{ backgroundImage: SCRIM_BACKGROUNDS }}
      />

      {/* Top-right indicator pill */}
      <span className="absolute right-1.5 top-1.5 rounded-sm border border-amber-400/40 bg-black/65 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-amber-200 backdrop-blur-[2px]">
        {t.hookPreviewBadge}
      </span>

      {/* Editorial headline + glowing gold accent pill centered vertically & horizontally */}
      {lines.length > 0 && (
        <div
          className="absolute inset-x-0 flex flex-col items-center text-center"
          style={{ top: "50%", transform: "translateY(-50%)" }}
        >
          <div
            className="rounded-full bg-[#FACC15]"
            style={{
              width: "10.5%",
              height: pillHeightPx,
              marginBottom: pillGapPx,
              boxShadow: "0 0 12px rgba(250, 204, 21, 0.55)",
            }}
          />
          <div
            className="flex flex-col items-center"
            style={{
              maxWidth: `${spec.maxTextWidthPct}%`,
              fontFamily: HEADLINE_FONT_FAMILY,
              fontWeight: 800,
              fontSize: fontSizePx,
              lineHeight: 1.13,
              textTransform: "uppercase",
              letterSpacing: "-0.01em",
            }}
          >
            {singleLineSplit ? (
              <span className="block whitespace-nowrap">
                <span style={{ color: "#FFFFFF", ...textStyle }}>{singleLineSplit.first}</span>
                <span> </span>
                <span style={{ color: "#FACC15", ...textStyle }}>{singleLineSplit.second}</span>
              </span>
            ) : (
              lines.map((line, index) => {
                const isHighlight = index === lines.length - 1
                return (
                  <span
                    key={`${index}-${line}`}
                    className="block whitespace-nowrap"
                    style={{
                      color: isHighlight ? "#FACC15" : "#FFFFFF",
                      ...textStyle,
                    }}
                  >
                    {line}
                  </span>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
