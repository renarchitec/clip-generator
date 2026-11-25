import { Film } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/lib/i18n"
import { clamp, DEFAULT_CHROMA_KEY, isVideoWatermark, type Watermark, type WatermarkChromaKey } from "@/lib/watermark"

type Props = {
  watermark: Watermark
  chromaKey?: WatermarkChromaKey | null
  className?: string
  compact?: boolean
  dropShadow?: boolean
}

const SQRT3 = Math.sqrt(3)

function parseHexRgb(hex: string): [number, number, number] {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex.trim()) ? hex.trim().slice(1) : DEFAULT_CHROMA_KEY.color.slice(1)
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ]
}

export function videoFormatBadge(watermark: Pick<Watermark, "mimeType" | "name">): string {
  if (watermark.mimeType === "video/quicktime" || /\.mov$/i.test(watermark.name)) return "MOV"
  if (watermark.mimeType === "video/webm" || /\.webm$/i.test(watermark.name)) return "WEBM"
  if (watermark.mimeType === "video/mp4" || /\.mp4$/i.test(watermark.name)) return "MP4"
  return "VID"
}

function applyChromaKeyFrame(data: Uint8ClampedArray, chromaKey: WatermarkChromaKey) {
  const [kr, kg, kb] = parseHexRgb(chromaKey.color)
  const maxK = Math.max(kr, kg, kb)
  const minK = Math.min(kr, kg, kb)
  const saturation = maxK === 0 ? 0 : (maxK - minK) / maxK
  const similarity = clamp(chromaKey.similarity, 0.01, 0.5)
  const blend = clamp(chromaKey.blend, 0, 0.5)
  const hasBlend = blend > 0.0001

  if (saturation >= 0.15) {
    // Chromatic key: BT.601 YUV chroma plane distance (matches FFmpeg chromakey) + green/blue despill.
    const uKey = -0.168736 * kr - 0.331264 * kg + 0.5 * kb
    const vKey = 0.5 * kr - 0.418688 * kg - 0.081312 * kb
    const greenSpill = kg > kr && kg > kb
    const blueSpill = !greenSpill && kb > kr && kb > kg
    const despillRange = blend + 0.15

    for (let i = 0; i < data.length; i += 4) {
      const a0 = data[i + 3]
      if (a0 === 0) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const u = -0.168736 * r - 0.331264 * g + 0.5 * b
      const v = 0.5 * r - 0.418688 * g - 0.081312 * b
      const dist = Math.hypot(u - uKey, v - vKey) / 255

      let alpha: number
      if (dist <= similarity) {
        alpha = 0
      } else if (hasBlend) {
        alpha = Math.min(1, (dist - similarity) / blend)
      } else {
        alpha = 1
      }

      if (alpha === 0) {
        data[i + 3] = 0
        continue
      }

      if (greenSpill) {
        const limit = (r + b) * 0.5
        if (g > limit) {
          const strength = alpha < 1 ? 1 : Math.max(0, 1 - (dist - similarity) / despillRange)
          if (strength > 0) data[i + 1] = Math.round(g - (g - limit) * strength)
        }
      } else if (blueSpill) {
        const limit = (r + g) * 0.5
        if (b > limit) {
          const strength = alpha < 1 ? 1 : Math.max(0, 1 - (dist - similarity) / despillRange)
          if (strength > 0) data[i + 2] = Math.round(b - (b - limit) * strength)
        }
      }

      if (alpha < 1) {
        data[i + 3] = Math.round(a0 * alpha)
      }
    }
    return
  }

  // Achromatic key (black/white/gray): normalized RGB distance (matches FFmpeg colorkey).
  const norm = 255 * SQRT3
  for (let i = 0; i < data.length; i += 4) {
    const a0 = data[i + 3]
    if (a0 === 0) continue
    const dr = data[i] - kr
    const dg = data[i + 1] - kg
    const db = data[i + 2] - kb
    const dist = Math.hypot(dr, dg, db) / norm

    let alpha: number
    if (dist <= similarity) {
      alpha = 0
    } else if (hasBlend) {
      alpha = Math.min(1, (dist - similarity) / blend)
    } else {
      alpha = 1
    }

    if (alpha < 1) {
      data[i + 3] = Math.round(a0 * alpha)
    }
  }
}

export function WatermarkMedia({ watermark, chromaKey, className = "", compact = false, dropShadow = false }: Props) {
  const t = useT()
  const video = isVideoWatermark(watermark)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chromaRef = useRef<WatermarkChromaKey | null | undefined>(chromaKey)
  chromaRef.current = chromaKey

  const [unsupported, setUnsupported] = useState(false)
  const [canvasFailed, setCanvasFailed] = useState(false)

  useEffect(() => {
    setUnsupported(false)
    setCanvasFailed(false)
  }, [watermark.url])

  const chromaEnabled = video && Boolean(chromaKey?.enabled) && !unsupported && !canvasFailed

  useEffect(() => {
    if (!chromaEnabled) return
    let rafId = 0
    let active = true
    const maxW = compact ? 160 : 480

    const renderFrame = () => {
      if (!active) return
      const videoEl = videoRef.current
      const canvasEl = canvasRef.current
      const currentChroma = chromaRef.current

      if (videoEl && canvasEl && currentChroma?.enabled && videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        const scale = Math.min(1, maxW / videoEl.videoWidth)
        const targetW = Math.max(1, Math.round(videoEl.videoWidth * scale))
        const targetH = Math.max(1, Math.round(videoEl.videoHeight * scale))
        if (canvasEl.width !== targetW || canvasEl.height !== targetH) {
          canvasEl.width = targetW
          canvasEl.height = targetH
        }
        const ctx = canvasEl.getContext("2d", { willReadFrequently: true })
        if (ctx) {
          try {
            ctx.clearRect(0, 0, targetW, targetH)
            ctx.drawImage(videoEl, 0, 0, targetW, targetH)
            const frame = ctx.getImageData(0, 0, targetW, targetH)
            applyChromaKeyFrame(frame.data, currentChroma)
            ctx.putImageData(frame, 0, 0)
          } catch {
            setCanvasFailed(true)
            return
          }
        }
      }
      rafId = window.requestAnimationFrame(renderFrame)
    }

    rafId = window.requestAnimationFrame(renderFrame)
    return () => {
      active = false
      window.cancelAnimationFrame(rafId)
    }
  }, [chromaEnabled, compact, watermark.url])

  const shadowClass = dropShadow ? "drop-shadow-[0_1px_3px_rgba(0,0,0,.8)]" : ""

  if (!video) {
    return (
      <img
        src={watermark.url}
        alt=""
        draggable={false}
        className={`size-full select-none object-contain ${shadowClass} ${className}`}
      />
    )
  }

  if (unsupported) {
    const ext = videoFormatBadge(watermark)
    const ratio = watermark.width > 0 && watermark.height > 0 ? `${watermark.width} / ${watermark.height}` : undefined
    return (
      <div
        title={t.watermarkVideoPreviewUnavailable}
        className={`flex size-full flex-col items-center justify-center overflow-hidden rounded-[3px] border border-dashed border-white/25 bg-[linear-gradient(45deg,rgba(255,255,255,0.08)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.08)_75%),linear-gradient(45deg,rgba(255,255,255,0.08)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.08)_75%)] bg-[length:10px_10px] bg-[position:0_0,5px_5px] bg-zinc-900/75 px-2 py-1.5 text-center text-white backdrop-blur-[2px] ${className}`}
        style={ratio ? { aspectRatio: ratio } : undefined}
      >
        <div className="flex items-center gap-1">
          <Film aria-hidden="true" className={compact ? "size-3 text-accent" : "size-3.5 text-accent"} />
          <Badge variant="secondary" className="h-4 rounded-sm bg-black/60 px-1 font-mono text-[9px] text-white">
            {ext}
          </Badge>
        </div>
        {!compact && (
          <>
            <span className="mt-1 max-w-full truncate text-[10px] font-medium leading-tight text-white/95">
              {watermark.name}
            </span>
            <span className="mt-0.5 line-clamp-2 text-[9px] leading-tight text-white/70">
              {t.watermarkVideoPreviewShort}
            </span>
          </>
        )}
      </div>
    )
  }

  return (
    <div className={`relative size-full ${className}`}>
      <video
        ref={videoRef}
        src={watermark.url}
        autoPlay
        loop
        muted
        playsInline
        crossOrigin="anonymous"
        aria-hidden="true"
        tabIndex={-1}
        onError={() => setUnsupported(true)}
        className={
          chromaEnabled
            ? "pointer-events-none absolute inset-0 size-full opacity-0"
            : `size-full select-none object-contain ${shadowClass}`
        }
      />
      {chromaEnabled && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className={`size-full select-none object-contain ${shadowClass}`}
        />
      )}
    </div>
  )
}
