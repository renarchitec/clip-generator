import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { LoaderCircle } from "lucide-react"
import type { AspectRatio } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { clamp, clampWatermark, watermarkFrameSize, type Watermark, type WatermarkSettings } from "@/lib/watermark"

/** A frame rendered by the worker at the exact output size. */
export type OverlayFrame = { imageUrl: string; width: number; height: number; alt: string; caption: string; busy?: boolean; onImageError?: () => void }

type Props = {
  aspectRatio: AspectRatio
  watermark: Watermark | undefined
  settings: WatermarkSettings | null
  onChange: (settings: WatermarkSettings) => void
  /** When set, the real rendered frame replaces the dashed guide and the watermark is dragged on top of it. */
  frame?: OverlayFrame | undefined
}

/**
 * Output-aspect frame over the source monitor; the watermark is dragged in normalized frame coordinates.
 * Both modes share one math: width = scale * frame width, center = (x, y) as a fraction of the frame.
 */
export function WatermarkOverlay({ aspectRatio, watermark, settings, onChange, frame }: Props) {
  const t = useT()
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const active = settings && watermark ? settings : null
  const ratio = frame ? frame.width / frame.height : null
  const base = watermarkFrameSize(watermark, active?.scale ?? 0.18, aspectRatio)
  // Height as a fraction of the frame: width * image ratio * (frame width / frame height). The frame's own shape wins over the preset.
  const width = base.width
  const height = ratio !== null ? clamp(base.width * (watermark && watermark.height > 0 ? watermark.height / watermark.width : 1) * ratio, 0, 1) : base.height

  const moveCenter = (cx: number, cy: number) => {
    if (!active) return
    const halfW = width / 2
    const halfH = height / 2
    onChange(clampWatermark({ ...active, x: clamp(cx, halfW, 1 - halfW), y: clamp(cy, halfH, 1 - halfH) }))
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!frameRef.current || !active) return
    event.preventDefault()
    const bounds = frameRef.current.getBoundingClientRect()
    drag.current = { pointerId: event.pointerId, offsetX: (event.clientX - bounds.left) / bounds.width - active.x, offsetY: (event.clientY - bounds.top) / bounds.height - active.y }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId || !frameRef.current) return
    const bounds = frameRef.current.getBoundingClientRect()
    moveCenter((event.clientX - bounds.left) / bounds.width - drag.current.offsetX, (event.clientY - bounds.top) / bounds.height - drag.current.offsetY)
  }
  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!active) return
    const step = event.shiftKey ? 0.05 : 0.01
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const move = delta[event.key]
    if (!move) return
    event.preventDefault()
    moveCenter(active.x + move[0], active.y + move[1])
  }

  // Fit inside the monitor: wide frames are limited by width, everything else by height.
  const wide = ratio !== null ? ratio > 16 / 9 : aspectRatio === "16:9"
  const frameStyle = { aspectRatio: ratio !== null ? `${frame?.width} / ${frame?.height}` : aspectRatio.replace(":", " / "), height: wide ? "auto" : "100%", width: wide ? "100%" : "auto" }

  return <div className={`absolute inset-0 z-10 grid place-items-center p-3 ${frame ? "bg-zinc-950" : "pointer-events-none"}`} aria-hidden={!active && !frame}>
    <div ref={frameRef} data-testid={frame ? "watermark-frame-image" : "watermark-frame-guide"} className={`relative max-h-full max-w-full overflow-hidden rounded-sm ${frame ? "shadow-2xl ring-1 ring-white/15" : "border border-dashed border-accent/60 shadow-[0_0_0_9999px_rgba(0,0,0,.16)]"}`} style={frameStyle}>
      {frame && <img src={frame.imageUrl} alt={frame.alt} draggable={false} onError={frame.onImageError} className="absolute inset-0 size-full select-none object-fill"/>}
      <span className="absolute left-1.5 top-1.5 rounded-sm bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white">{frame ? frame.caption : aspectRatio}</span>
      {frame?.busy && <div role="status" className="absolute inset-0 grid place-items-center bg-black/40"><LoaderCircle aria-hidden="true" className="size-6 animate-spin text-white motion-reduce:animate-none"/><span className="sr-only">{t.frameRendering}</span></div>}
      {active && watermark && <button type="button" aria-label={t.watermarkDragHint} title={t.watermarkDragHint} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={onKeyDown} className={`pointer-events-auto absolute grid touch-none place-items-center rounded-[2px] outline-none ring-offset-0 focus-visible:ring-2 focus-visible:ring-accent ${dragging ? "cursor-grabbing" : "cursor-grab"}`} style={{ width: `${width * 100}%`, height: `${height * 100}%`, left: `${(active.x - width / 2) * 100}%`, top: `${(active.y - height / 2) * 100}%`, opacity: active.opacity }}>
        <img src={watermark.url} alt="" draggable={false} className={`size-full select-none object-contain ${frame ? "" : "drop-shadow-[0_1px_3px_rgba(0,0,0,.8)]"}`}/>
      </button>}
    </div>
  </div>
}
