import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import type { AspectRatio } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { clamp, clampWatermark, watermarkFrameSize, type Watermark, type WatermarkSettings } from "@/lib/watermark"

type Props = {
  aspectRatio: AspectRatio
  watermark: Watermark | undefined
  settings: WatermarkSettings
  onChange: (settings: WatermarkSettings) => void
}

/** Output-aspect frame over the source monitor; the watermark is dragged in normalized frame coordinates. */
export function WatermarkOverlay({ aspectRatio, watermark, settings, onChange }: Props) {
  const t = useT()
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const { width, height } = watermarkFrameSize(watermark, settings.scale, aspectRatio)

  const moveCenter = (cx: number, cy: number) => {
    const halfW = width / 2
    const halfH = height / 2
    onChange(clampWatermark({ ...settings, x: clamp(cx, halfW, 1 - halfW), y: clamp(cy, halfH, 1 - halfH) }))
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!frameRef.current || !watermark) return
    event.preventDefault()
    const bounds = frameRef.current.getBoundingClientRect()
    drag.current = { pointerId: event.pointerId, offsetX: (event.clientX - bounds.left) / bounds.width - settings.x, offsetY: (event.clientY - bounds.top) / bounds.height - settings.y }
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
    const step = event.shiftKey ? 0.05 : 0.01
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const move = delta[event.key]
    if (!move) return
    event.preventDefault()
    moveCenter(settings.x + move[0], settings.y + move[1])
  }

  return <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-3" aria-hidden={!watermark}>
    <div ref={frameRef} className="relative max-h-full max-w-full overflow-hidden rounded-sm border border-dashed border-accent/60 shadow-[0_0_0_9999px_rgba(0,0,0,.16)]" style={{ aspectRatio: aspectRatio.replace(":", " / "), height: aspectRatio === "16:9" ? "auto" : "100%", width: aspectRatio === "16:9" ? "100%" : "auto" }}>
      <span className="absolute left-1.5 top-1.5 rounded-sm bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white">{aspectRatio}</span>
      {watermark && <button type="button" aria-label={t.watermarkDragHint} title={t.watermarkDragHint} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={onKeyDown} className={`pointer-events-auto absolute grid touch-none place-items-center rounded-[2px] outline-none ring-offset-0 focus-visible:ring-2 focus-visible:ring-accent ${dragging ? "cursor-grabbing" : "cursor-grab"}`} style={{ width: `${width * 100}%`, height: `${height * 100}%`, left: `${(settings.x - width / 2) * 100}%`, top: `${(settings.y - height / 2) * 100}%`, opacity: settings.opacity }}>
        <img src={watermark.url} alt="" draggable={false} className="size-full select-none object-contain drop-shadow-[0_1px_3px_rgba(0,0,0,.8)]"/>
      </button>}
    </div>
  </div>
}
