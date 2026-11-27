import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { LoaderCircle } from "lucide-react"
import { HookThumbnailOverlay } from "@/components/hook-thumbnail-overlay"
import { SubtitleOverlay } from "@/components/subtitle-overlay"
import { WatermarkMedia } from "@/components/watermark-media"
import type { AspectRatio } from "@/lib/api"
import type { CaptionStyle } from "@/lib/caption-style"
import { useT } from "@/lib/i18n"
import {
  clamp,
  clampWatermark,
  stripLayerId,
  watermarkFrameSize,
  type Watermark,
  type WatermarkLayer,
  type WatermarkSettings,
} from "@/lib/watermark"

/** A frame rendered by the worker at the exact output size. */
export type OverlayFrame = { imageUrl: string; width: number; height: number; alt: string; caption: string; busy?: boolean; onImageError?: () => void }

export type WatermarkOverlayLayer = {
  layer: WatermarkLayer
  watermark: Watermark
}

type Props = {
  aspectRatio: AspectRatio
  layers: WatermarkOverlayLayer[]
  selectedLayerId?: string | null
  onSelectLayer?: (layerId: string) => void
  onChangeLayer: (layerId: string, next: WatermarkSettings) => void
  /** When set, the real rendered frame replaces the dashed guide and overlays are dragged on top of it. */
  frame?: OverlayFrame | undefined
  captions?: boolean
  captionStyle?: CaptionStyle
  twoSpeakers?: boolean
  onCaptionStyleChange?: (next: CaptionStyle) => void
  showSafeZone?: boolean
  showHookPreview?: boolean
  hookPreviewText?: string
}

/**
 * Output-aspect frame over the source monitor; watermark layers and subtitle are dragged in normalized frame coordinates.
 * Both modes share one math: width = scale * frame width, center = (x, y) as a fraction of the frame.
 */
export function WatermarkOverlay({
  aspectRatio,
  layers,
  selectedLayerId,
  onSelectLayer,
  onChangeLayer,
  frame,
  captions = false,
  captionStyle,
  twoSpeakers = false,
  onCaptionStyleChange,
  showSafeZone = false,
  showHookPreview = false,
  hookPreviewText = "",
}: Props) {
  const t = useT()
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ layerId: string; pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null)
  const [frameSizePx, setFrameSizePx] = useState({ width: 0, height: 0 })
  const frameWidthPx = frameSizePx.width
  const frameHeightPx = frameSizePx.height

  const hasLayers = layers.length > 0
  const multiLayer = layers.length > 1
  const showSubtitle = Boolean(captions && captionStyle && onCaptionStyleChange)
  const safeZoneVisible = Boolean(showSafeZone && aspectRatio === "9:16")
  const ratio = frame ? frame.width / frame.height : null

  const getLayerSize = (watermark: Watermark, scale: number) => {
    const base = watermarkFrameSize(watermark, scale, aspectRatio)
    // Height as a fraction of the frame: width * image ratio * (frame width / frame height). The frame's own shape wins over the preset.
    const width = base.width
    const height =
      ratio !== null
        ? clamp(base.width * (watermark.height > 0 ? watermark.height / watermark.width : 1) * ratio, 0, 1)
        : base.height
    return { width, height }
  }

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const commitSize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return
      setFrameSizePx((prev) =>
        Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
          ? prev
          : { width, height },
      )
    }
    const update = () => {
      const rect = el.getBoundingClientRect()
      commitSize(rect.width, rect.height)
    }
    update()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) commitSize(rect.width, rect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [aspectRatio, frame?.width, frame?.height])

  const moveLayerCenter = (item: WatermarkOverlayLayer, cx: number, cy: number) => {
    const { width, height } = getLayerSize(item.watermark, item.layer.scale)
    const halfW = width / 2
    const halfH = height / 2
    onChangeLayer(
      item.layer.layerId,
      clampWatermark({
        ...stripLayerId(item.layer),
        x: clamp(cx, halfW, 1 - halfW),
        y: clamp(cy, halfH, 1 - halfH),
      }),
    )
  }

  const handlePointerDown = (item: WatermarkOverlayLayer) => (event: PointerEvent<HTMLButtonElement>) => {
    if (!frameRef.current) return
    event.preventDefault()
    event.stopPropagation()
    onSelectLayer?.(item.layer.layerId)
    const bounds = frameRef.current.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    drag.current = {
      layerId: item.layer.layerId,
      pointerId: event.pointerId,
      offsetX: (event.clientX - bounds.left) / bounds.width - item.layer.x,
      offsetY: (event.clientY - bounds.top) / bounds.height - item.layer.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingLayerId(item.layer.layerId)
  }

  const handlePointerMove = (item: WatermarkOverlayLayer) => (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.layerId !== item.layer.layerId || drag.current.pointerId !== event.pointerId || !frameRef.current) return
    const bounds = frameRef.current.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    moveLayerCenter(
      item,
      (event.clientX - bounds.left) / bounds.width - drag.current.offsetX,
      (event.clientY - bounds.top) / bounds.height - drag.current.offsetY,
    )
  }

  const handlePointerEnd = (layerId: string) => (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.layerId !== layerId || drag.current.pointerId !== event.pointerId) return
    drag.current = null
    setDraggingLayerId(null)
  }

  const handleKeyDown = (item: WatermarkOverlayLayer) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 0.05 : 0.01
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = delta[event.key]
    if (!move) return
    event.preventDefault()
    moveLayerCenter(item, item.layer.x + move[0], item.layer.y + move[1])
  }

  // Fit inside the monitor: wide frames are limited by width, everything else by height.
  const wide = ratio !== null ? ratio > 16 / 9 : aspectRatio === "16:9"
  const frameStyle = {
    aspectRatio: ratio !== null ? `${frame?.width} / ${frame?.height}` : aspectRatio.replace(":", " / "),
    height: wide ? "auto" : "100%",
    width: wide ? "100%" : "auto",
  }

  return (
    <div
      className={`absolute inset-0 z-10 grid place-items-center p-3 ${frame ? "bg-zinc-950" : "pointer-events-none"}`}
      aria-hidden={!hasLayers && !frame && !showSubtitle && !safeZoneVisible && !showHookPreview}
    >
      <div
        ref={frameRef}
        data-testid={frame ? "watermark-frame-image" : "watermark-frame-guide"}
        className={`relative max-h-full max-w-full overflow-hidden rounded-sm ${frame ? "shadow-2xl ring-1 ring-white/15" : "border border-dashed border-accent/60 shadow-[0_0_0_9999px_rgba(0,0,0,.16)]"}`}
        style={frameStyle}
      >
        {frame && <img src={frame.imageUrl} alt={frame.alt} draggable={false} onError={frame.onImageError} className="absolute inset-0 size-full select-none object-fill" />}
        {showHookPreview && (
          <HookThumbnailOverlay
            aspectRatio={aspectRatio}
            text={hookPreviewText}
            frameWidthPx={frameWidthPx}
            frameHeightPx={frameHeightPx}
            hasFrame={Boolean(frame)}
          />
        )}
        {safeZoneVisible && (
          <div
            data-testid="safe-zone-overlay"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[15]"
          >
            {/* Top UI bar (TikTok / Reels / Shorts nav & tabs) */}
            <div className="absolute inset-x-0 top-0 h-[13%] border-b border-dashed border-rose-400/50 bg-rose-500/18" />
            {/* Right action rail (Like / Comment / Share) */}
            <div className="absolute bottom-[22%] right-0 top-[44%] w-[16%] border-l border-t border-dashed border-rose-400/50 bg-rose-500/18" />
            {/* Bottom caption & navigation bar */}
            <div className="absolute inset-x-0 bottom-0 h-[22%] border-t border-dashed border-rose-400/50 bg-rose-500/18" />
            {/* Safe rectangle indicator badge */}
            <span className="absolute left-1.5 top-[14.5%] rounded-sm border border-zinc-300/35 bg-black/65 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-zinc-100 backdrop-blur-[2px]">
              {t.safeZoneBadge}
            </span>
          </div>
        )}
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-20 rounded-sm bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white">
          {frame ? frame.caption : aspectRatio}
        </span>
        {frame?.busy && (
          <div role="status" className="absolute inset-0 z-30 grid place-items-center bg-black/40">
            <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-white motion-reduce:animate-none" />
            <span className="sr-only">{t.frameRendering}</span>
          </div>
        )}
        {!showHookPreview && layers.map((item, index) => {
          const { layer, watermark } = item
          const { width, height } = getLayerSize(watermark, layer.scale)
          const leftFrac = layer.x - width / 2
          const topFrac = layer.y - height / 2
          const isSelected = selectedLayerId === layer.layerId
          const isDragging = draggingLayerId === layer.layerId
          const badgeInside = topFrac < 0.08
          const layerNumber = index + 1
          const ariaLabel = multiLayer
            ? `${t.watermarkLayerLabel.replace("{index}", String(layerNumber))}: ${watermark.name}. ${t.watermarkDragHint}`
            : t.watermarkDragHint

          return (
            <button
              key={layer.layerId}
              type="button"
              data-testid={`watermark-layer-${layerNumber}`}
              aria-label={ariaLabel}
              title={multiLayer ? `#${layerNumber} · ${watermark.name}` : t.watermarkDragHint}
              onPointerDown={handlePointerDown(item)}
              onPointerMove={handlePointerMove(item)}
              onPointerUp={handlePointerEnd(layer.layerId)}
              onPointerCancel={handlePointerEnd(layer.layerId)}
              onFocus={() => onSelectLayer?.(layer.layerId)}
              onKeyDown={handleKeyDown(item)}
              className={`group/wm pointer-events-auto absolute z-10 grid touch-none place-items-center rounded-[2px] outline-none ring-offset-0 transition-shadow focus-visible:ring-2 focus-visible:ring-accent/90 ${
                isDragging
                  ? "cursor-grabbing ring-2 ring-accent/90"
                  : isSelected
                    ? multiLayer
                      ? "cursor-grab ring-1 ring-accent/70 hover:ring-2 hover:ring-accent/85"
                      : "cursor-grab hover:ring-2 hover:ring-accent/80"
                    : "cursor-grab border border-transparent hover:border-dashed hover:border-white/80 hover:bg-black/15"
              }`}
              style={{
                width: `${width * 100}%`,
                height: `${height * 100}%`,
                left: `${leftFrac * 100}%`,
                top: `${topFrac * 100}%`,
              }}
            >
              {multiLayer && (
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-0 z-10 rounded-sm px-1 py-0.5 font-mono text-[9px] font-semibold leading-none tabular-nums shadow-xs backdrop-blur-[2px] transition-opacity ${
                    badgeInside ? "left-0.5 top-0.5" : "-top-4"
                  } ${
                    isDragging
                      ? "bg-accent text-accent-foreground opacity-100"
                      : isSelected
                        ? "bg-accent/90 text-accent-foreground opacity-85 group-hover/wm:opacity-100 group-focus-visible/wm:opacity-100"
                        : "bg-black/75 text-white opacity-0 group-hover/wm:opacity-100 group-focus-visible/wm:opacity-100 [@media(hover:none)]:opacity-100"
                  }`}
                >
                  #{layerNumber}
                </span>
              )}
              <span className="block size-full" style={{ opacity: layer.opacity }}>
                <WatermarkMedia
                  watermark={watermark}
                  chromaKey={layer.chromaKey}
                  dropShadow={!frame}
                  className="size-full"
                />
              </span>
            </button>
          )
        })}
        {!showHookPreview && showSubtitle && captionStyle && onCaptionStyleChange && frameHeightPx > 0 && (
          <SubtitleOverlay
            style={captionStyle}
            twoSpeakers={twoSpeakers}
            frameHeightPx={frameHeightPx}
            onChange={onCaptionStyleChange}
          />
        )}
      </div>
    </div>
  )
}
