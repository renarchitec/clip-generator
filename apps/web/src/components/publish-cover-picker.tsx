import { Film, ImageOff, Info, RotateCcw } from "lucide-react"
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const MAX_CAPTURE_WIDTH = 1080
const MAX_CAPTURE_HEIGHT = 1920
const FRAME_END_BUFFER_SEC = 0.1
const NUDGE_STEP_SEC = 0.5
const SLIDER_STEP_SEC = 0.1

export interface PublishCoverPickerHandle {
  captureJpeg: () => Promise<Blob>
}

interface PublishCoverPickerProps {
  ref?: Ref<PublishCoverPickerHandle>
  clipId: string
  fallbackDurationSec?: number | null
  value: number | null
  onChange: (nextMs: number | null) => void
  hasCoverSupportingTarget: boolean
  hasYouTube: boolean
  hasTikTokInbox: boolean
}

function formatCoverTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const mins = Math.floor(safe / 60)
  const secs = safe - mins * 60
  return `${mins}:${secs.toFixed(1).padStart(4, "0")}`
}

function roundTenth(seconds: number): number {
  return Math.round(seconds * 10) / 10
}

function computeMaxSec(durationSec: number | null): number {
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= FRAME_END_BUFFER_SEC) return 0
  return Math.max(0, Math.floor((durationSec - FRAME_END_BUFFER_SEC) * 10) / 10)
}

function waitForEvent(element: HTMLVideoElement, eventNames: readonly string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      window.clearTimeout(timer)
      for (const name of eventNames) element.removeEventListener(name, onReady)
      element.removeEventListener("error", onError)
    }
    const onReady = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const onError = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error("Video failed to load"))
    }
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error("Timed out waiting for video frame"))
    }, timeoutMs)

    for (const name of eventNames) element.addEventListener(name, onReady, { once: true })
    element.addEventListener("error", onError, { once: true })
  })
}

export function PublishCoverPicker({
  ref,
  clipId,
  fallbackDurationSec = null,
  value,
  onChange,
  hasCoverSupportingTarget,
  hasYouTube,
  hasTikTokInbox,
}: PublishCoverPickerProps) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastCustomMsRef = useRef<number>(0)

  const [videoDurationSec, setVideoDurationSec] = useState<number | null>(null)
  const [frameReady, setFrameReady] = useState(false)
  const [videoError, setVideoError] = useState(false)

  const enabled = value !== null && hasCoverSupportingTarget
  const effectiveDuration = videoDurationSec ?? (fallbackDurationSec && fallbackDurationSec > 0 ? fallbackDurationSec : null)
  const maxSec = computeMaxSec(effectiveDuration)
  const currentSec = value !== null ? Math.min(maxSec > 0 ? maxSec : value / 1000, Math.max(0, value / 1000)) : 0

  useEffect(() => {
    if (value !== null) {
      lastCustomMsRef.current = value
    }
  }, [value])

  // Reset media state if clipId changes or picker is toggled off
  useEffect(() => {
    if (!enabled) {
      setFrameReady(false)
      setVideoError(false)
    }
  }, [enabled, clipId])

  // Keep paused video synced to the chosen timestamp
  useEffect(() => {
    if (!enabled) return
    const video = videoRef.current
    if (!video || video.readyState < 1) return
    const clampedSec = Math.min(maxSec, Math.max(0, currentSec))
    const seekTarget = clampedSec === 0 && effectiveDuration && effectiveDuration > 0.05 ? 0.01 : clampedSec
    if (Math.abs(video.currentTime - seekTarget) > 0.03) {
      video.currentTime = seekTarget
    }
  }, [enabled, currentSec, maxSec, effectiveDuration])

  useImperativeHandle(
    ref,
    () => ({
      async captureJpeg(): Promise<Blob> {
        const video = videoRef.current
        if (!video) throw new Error("Cover video element is not mounted")

        if (video.error) throw new Error("Cover video failed to load")

        if (video.readyState < 2) {
          if (video.preload === "none") video.preload = "auto"
          video.load()
          await waitForEvent(video, ["loadeddata", "canplay"], 8000)
        }

        const realDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : effectiveDuration
        const realMaxSec = computeMaxSec(realDuration)
        const targetSec = Math.min(realMaxSec, Math.max(0, (value ?? 0) / 1000))
        const seekTarget = targetSec === 0 && realDuration && realDuration > 0.05 ? 0.01 : targetSec

        if (video.seeking) {
          await waitForEvent(video, ["seeked"], 5000)
        }
        if (Math.abs(video.currentTime - seekTarget) > 0.08) {
          const seekPromise = waitForEvent(video, ["seeked"], 5000)
          video.currentTime = seekTarget
          await seekPromise
        }

        const naturalWidth = video.videoWidth
        const naturalHeight = video.videoHeight
        if (!naturalWidth || !naturalHeight) {
          throw new Error("Video frame dimensions unavailable")
        }

        const scale = Math.min(1, MAX_CAPTURE_WIDTH / naturalWidth, MAX_CAPTURE_HEIGHT / naturalHeight)
        const width = Math.max(1, Math.round(naturalWidth * scale))
        const height = Math.max(1, Math.round(naturalHeight * scale))

        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("Canvas 2D context unavailable")
        ctx.drawImage(video, 0, 0, width, height)

        return await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob)
              else reject(new Error("Failed to encode JPEG cover"))
            },
            "image/jpeg",
            0.92,
          )
        })
      },
    }),
    [effectiveDuration, value],
  )

  function commitSec(nextSec: number) {
    const clamped = Math.min(maxSec, Math.max(0, roundTenth(nextSec)))
    onChange(Math.round(clamped * 1000))
  }

  function handleToggle(checked: boolean) {
    if (!hasCoverSupportingTarget) return
    if (checked) {
      const restoredSec = Math.min(maxSec, Math.max(0, lastCustomMsRef.current / 1000))
      onChange(Math.round(roundTenth(restoredSec) * 1000))
    } else {
      onChange(null)
    }
  }

  const presets =
    maxSec >= 1
      ? [
          { key: "start", label: t.publishCoverStart, sec: 0 },
          { key: "25", label: "25%", sec: roundTenth(maxSec * 0.25) },
          { key: "50", label: "50%", sec: roundTenth(maxSec * 0.5) },
          { key: "75", label: "75%", sec: roundTenth(maxSec * 0.75) },
        ]
      : []

  const canScrub = maxSec > 0 && !videoError

  return (
    <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-3.5 sm:p-4">
      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Film aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <label htmlFor="publish-cover-toggle" className="text-sm font-medium">
              {t.publishCoverTitle}
            </label>
            {enabled && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-primary">
                {formatCoverTime(currentSec)}
              </span>
            )}
          </div>
          {!enabled && hasCoverSupportingTarget && (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t.publishCoverDefaultHint}</p>
          )}
        </div>
        <div className="relative flex shrink-0 items-center gap-2">
          <Switch
            id="publish-cover-toggle"
            checked={enabled}
            disabled={!hasCoverSupportingTarget}
            onCheckedChange={handleToggle}
            aria-label={t.publishCoverToggle}
          />
        </div>
      </div>

      {!hasCoverSupportingTarget && hasTikTokInbox && (
        <p className="flex items-start gap-1.5 rounded-lg bg-background/80 px-3 py-2 text-xs leading-5 text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/80" />
          <span>{t.publishCoverTikTokInboxHint}</span>
        </p>
      )}

      {enabled && (
        <div className="space-y-3 border-t border-border/70 pt-3">
          <div className="flex items-stretch gap-3.5">
            {/* Compact 9:16 portrait preview */}
            <div className="relative aspect-[9/16] w-[76px] shrink-0 overflow-hidden rounded-lg border border-border bg-black shadow-xs sm:w-[88px]">
              <video
                ref={videoRef}
                src={`/api/clips/${clipId}/stream`}
                preload="metadata"
                muted
                playsInline
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget
                  const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
                  setVideoDurationSec(dur)
                  setVideoError(false)
                  const realMax = computeMaxSec(dur)
                  const desiredSec = Math.min(realMax, Math.max(0, (value ?? 0) / 1000))
                  if (value !== null && value / 1000 > realMax) {
                    onChange(Math.round(realMax * 1000))
                  }
                  const initialTarget = desiredSec === 0 && dur && dur > 0.05 ? 0.01 : desiredSec
                  video.currentTime = initialTarget
                }}
                onLoadedData={() => setFrameReady(true)}
                onSeeked={() => setFrameReady(true)}
                onError={() => {
                  setVideoError(true)
                  setFrameReady(false)
                }}
                className={cn("h-full w-full object-cover transition-opacity duration-200", frameReady ? "opacity-100" : "opacity-0")}
              />
              {!frameReady && !videoError && <Skeleton className="absolute inset-0 rounded-none" />}
              {videoError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted/90 p-1.5 text-center text-muted-foreground">
                  <ImageOff aria-hidden="true" className="size-4" />
                  <span className="text-[10px] leading-tight">{t.publishCoverPreviewUnavailable}</span>
                </div>
              )}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-1.5 pb-1.5 pt-4 text-center"
              >
                <span className="inline-block rounded bg-black/65 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none tabular-nums text-white backdrop-blur-[2px]">
                  {formatCoverTime(currentSec)}
                </span>
              </div>
            </div>

            {/* Scrubber & fine controls */}
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
                  <span className="text-sm font-medium text-foreground">{formatCoverTime(currentSec)}</span>
                  {effectiveDuration !== null && (
                    <span className="text-xs text-muted-foreground">/ {formatCoverTime(effectiveDuration)}</span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onChange(null)}
                >
                  <RotateCcw aria-hidden="true" className="size-3" />
                  {t.publishCoverReset}
                </Button>
              </div>

              <div className="relative py-1.5">
                <Slider
                  min={0}
                  max={maxSec > 0 ? maxSec : 1}
                  step={SLIDER_STEP_SEC}
                  value={[canScrub ? currentSec : 0]}
                  disabled={!canScrub}
                  onValueChange={(next) => {
                    const sec = next[0]
                    if (typeof sec === "number" && Number.isFinite(sec)) {
                      commitSec(sec)
                    }
                  }}
                  aria-label={t.publishCoverScrubLabel}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 bg-background px-2 font-mono text-xs tabular-nums"
                    disabled={!canScrub || currentSec <= 0}
                    aria-label={t.publishCoverNudgeBack}
                    onClick={() => commitSec(currentSec - NUDGE_STEP_SEC)}
                  >
                    -0.5s
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 bg-background px-2 font-mono text-xs tabular-nums"
                    disabled={!canScrub || currentSec >= maxSec}
                    aria-label={t.publishCoverNudgeForward}
                    onClick={() => commitSec(currentSec + NUDGE_STEP_SEC)}
                  >
                    +0.5s
                  </Button>
                </div>

                {presets.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {presets.map((preset) => {
                      const active = Math.abs(currentSec - preset.sec) <= 0.15
                      return (
                        <Button
                          key={preset.key}
                          type="button"
                          variant={active ? "secondary" : "ghost"}
                          size="xs"
                          disabled={!canScrub}
                          className={cn(
                            "h-6 rounded-md px-2 text-[11px] font-medium tabular-nums",
                            active ? "bg-primary/12 text-primary hover:bg-primary/18" : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => commitSec(preset.sec)}
                        >
                          {preset.label}
                        </Button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {(hasTikTokInbox || hasYouTube) && (
            <div className="space-y-1 text-xs leading-5 text-muted-foreground">
              {hasTikTokInbox && (
                <p className="flex items-start gap-1.5">
                  <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/80" />
                  <span>{t.publishCoverTikTokInboxHint}</span>
                </p>
              )}
              {hasYouTube && (
                <p className="flex items-start gap-1.5">
                  <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/80" />
                  <span>{t.publishCoverYouTubeHint}</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
