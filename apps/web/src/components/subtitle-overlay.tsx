import { GripHorizontal } from "lucide-react"
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
import {
  CAPTION_POSITION_Y_MAX,
  CAPTION_POSITION_Y_MIN,
  resolveCaptionY,
  type CaptionPosition,
  type CaptionStyle,
} from "@/lib/caption-style"
import { useT } from "@/lib/i18n"

type Props = {
  style: CaptionStyle
  twoSpeakers?: boolean
  frameHeightPx: number
  onChange: (next: CaptionStyle) => void
}

const CENTER_SNAP_THRESHOLD = 0.012

function clampY(value: number): number {
  const clamped = Math.max(CAPTION_POSITION_Y_MIN, Math.min(CAPTION_POSITION_Y_MAX, value))
  return Math.round(clamped * 10000) / 10000
}

function positionForY(y: number): CaptionPosition {
  if (y < 0.33) return "top"
  if (y > 0.67) return "bottom"
  return "center"
}

function scaledEffectCss(style: CaptionStyle, scale: number): CSSProperties {
  if (style.effect === "outline") {
    const px = Math.max(1, Math.round(6 * scale * 10) / 10)
    const blur = Math.max(2, Math.round(14 * scale * 10) / 10)
    const dropY = Math.max(1, Math.round(5 * scale * 10) / 10)
    const stroke = Math.max(0.4, Math.round(2.5 * scale * 10) / 10)
    return {
      WebkitTextStroke: `${stroke}px ${style.outlineColor}`,
      paintOrder: "stroke fill",
      textShadow: [
        `-${px}px -${px}px 0 ${style.outlineColor}`,
        `0 -${px}px 0 ${style.outlineColor}`,
        `${px}px -${px}px 0 ${style.outlineColor}`,
        `-${px}px 0 0 ${style.outlineColor}`,
        `${px}px 0 0 ${style.outlineColor}`,
        `-${px}px ${px}px 0 ${style.outlineColor}`,
        `0 ${px}px 0 ${style.outlineColor}`,
        `${px}px ${px}px 0 ${style.outlineColor}`,
        `0 ${dropY}px ${blur}px rgb(0 0 0 / 55%)`,
      ].join(", "),
    }
  }
  if (style.effect === "shadow") {
    const offY = Math.max(1, Math.round(5 * scale * 10) / 10)
    const tightBlur = Math.max(1, Math.round(4 * scale * 10) / 10)
    const softY = Math.max(2, Math.round(12 * scale * 10) / 10)
    const softBlur = Math.max(4, Math.round(26 * scale * 10) / 10)
    const stroke = Math.max(0.25, Math.round(1.2 * scale * 10) / 10)
    return {
      WebkitTextStroke: `${stroke}px ${style.outlineColor}`,
      textShadow: `0 ${offY}px ${tightBlur}px ${style.outlineColor}, 0 ${softY}px ${softBlur}px rgb(0 0 0 / 70%)`,
    }
  }
  if (style.effect === "box") {
    return {
      textShadow: `0 ${Math.max(1, Math.round(3 * scale))}px ${Math.max(2, Math.round(8 * scale))}px rgb(0 0 0 / 45%)`,
    }
  }
  return {
    textShadow: `0 ${Math.max(1, Math.round(3 * scale))}px ${Math.max(2, Math.round(8 * scale))}px rgb(0 0 0 / 75%)`,
  }
}

export function SubtitleOverlay({ style, twoSpeakers = false, frameHeightPx, onChange }: Props) {
  const t = useT()
  const drag = useRef<{ pointerId: number; offsetY: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [snappedCenter, setSnappedCenter] = useState(false)

  const y = resolveCaptionY(style, twoSpeakers)
  const scale = frameHeightPx > 0 ? frameHeightPx / 1920 : 0.2
  const fontSize = Math.max(10, Math.round(style.fontSize * scale))
  const effectCss = scaledEffectCss(style, scale)

  const boxWordStyle: CSSProperties | undefined = style.effect === "box"
    ? {
        backgroundColor: `${style.outlineColor}bf`,
        borderRadius: Math.max(3, Math.round(14 * scale)),
        padding: `${Math.max(2, Math.round(8 * scale))}px ${Math.max(4, Math.round(14 * scale))}px`,
      }
    : undefined

  const sampleParts = t.subtitleOverlaySample.trim().split(/\s+/)
  const firstWord = sampleParts[0] || "Sample"
  const highlightWord = sampleParts.slice(1).join(" ") || "caption"

  const commitY = (nextY: number) => {
    const clamped = clampY(nextY)
    onChange({
      ...style,
      positionY: clamped,
      position: positionForY(clamped),
      preset: "custom",
    })
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    const parent = event.currentTarget.parentElement
    if (!parent) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = parent.getBoundingClientRect()
    if (bounds.height <= 0) return
    drag.current = {
      pointerId: event.pointerId,
      offsetY: (event.clientY - bounds.top) / bounds.height - y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    setSnappedCenter(Math.abs(y - 0.5) <= CENTER_SNAP_THRESHOLD)
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    const parent = event.currentTarget.parentElement
    if (!parent) return
    const bounds = parent.getBoundingClientRect()
    if (bounds.height <= 0) return
    const rawY = (event.clientY - bounds.top) / bounds.height - drag.current.offsetY
    const clamped = clampY(rawY)
    const snap = Math.abs(clamped - 0.5) <= CENTER_SNAP_THRESHOLD
    setSnappedCenter(snap)
    commitY(snap ? 0.5 : clamped)
  }

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    setSnappedCenter(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    event.preventDefault()
    const step = event.shiftKey ? 0.05 : 0.01
    const delta = event.key === "ArrowUp" ? -step : step
    commitY(y + delta)
  }

  const yPercent = Math.round(y * 100)

  return (
    <>
      {dragging && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-1/2 z-10 border-t border-dashed transition-colors ${
            snappedCenter ? "border-accent" : "border-white/35"
          }`}
        />
      )}
      <button
        type="button"
        data-testid="subtitle-overlay-handle"
        aria-label={`${t.subtitleDragHint} (Y ${yPercent}%)`}
        title={t.subtitleDragHint}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className={`group/sub pointer-events-auto absolute left-1/2 z-20 max-w-[92%] touch-none select-none rounded-sm border px-2 py-1 outline-none transition-colors focus-visible:border-dashed focus-visible:border-accent focus-visible:bg-black/25 focus-visible:ring-2 focus-visible:ring-accent/70 ${
          dragging
            ? "cursor-ns-resize border-dashed border-accent bg-black/25"
            : "cursor-ns-resize border-transparent hover:border-dashed hover:border-accent/80 hover:bg-black/20"
        }`}
        style={{
          top: `${y * 100}%`,
          transform: "translate(-50%, -50%)",
        }}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-sm bg-black/75 px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums text-white shadow-sm backdrop-blur-[2px] transition-opacity ${
            y < 0.16 ? "-bottom-5" : "-top-5"
          } ${
            dragging
              ? "opacity-100"
              : "opacity-0 group-hover/sub:opacity-100 group-focus-visible/sub:opacity-100"
          }`}
        >
          <GripHorizontal className="size-3" />
          <span>Y {yPercent}%</span>
        </span>
        <span
          className="flex flex-wrap items-center justify-center gap-x-[0.26em] gap-y-[0.12em] text-center leading-[1.08]"
          style={{
            fontFamily: `"${style.fontFamily}", sans-serif`,
            fontWeight: 700,
            fontSize,
            fontStyle: style.italic ? "italic" : "normal",
            textTransform: style.uppercase ? "uppercase" : "none",
          }}
        >
          <span style={{ color: style.primaryColor, ...effectCss, ...boxWordStyle }}>
            {firstWord}
          </span>
          <span
            className={`inline-block transition-transform duration-150 ${style.animate ? "scale-105" : ""}`}
            style={{ color: style.highlightColor, ...effectCss, ...boxWordStyle }}
          >
            {highlightWord}
          </span>
        </span>
      </button>
    </>
  )
}
