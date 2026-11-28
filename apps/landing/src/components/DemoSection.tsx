import { useCallback, useEffect, useRef, useState } from "react"
import { PLATFORM_DEMO_VIDEO } from "../data/studio-presets.ts"
import type { LandingCopy } from "../data/translations.ts"
import { PauseIcon, PlayIcon, RefreshResetIcon } from "./Icons.tsx"
import { Reveal } from "./Reveal.tsx"

export interface DemoSectionProps {
  demo: LandingCopy["demo"]
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

export function DemoSection({ demo }: DemoSectionProps) {
  const sectionRef = useRef<HTMLElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const userPausedRef = useRef(false)
  const pendingSeekRef = useRef<number | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const blobLoadingRef = useRef<Promise<string | null> | null>(null)

  const [videoSrc, setVideoSrc] = useState<string>(PLATFORM_DEMO_VIDEO.videoSrc)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState<number>(PLATFORM_DEMO_VIDEO.durationSec)

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
      }
    }
  }, [])

  const chapters = demo.chapters

  const activeChapterIndex = Math.max(
    0,
    chapters.findIndex(
      (chapter, idx) =>
        currentTime >= chapter.startSec &&
        (currentTime < chapter.endSec || idx === chapters.length - 1),
    ),
  )
  const activeChapter = chapters[activeChapterIndex] ?? chapters[0]

  // Smooth progress updates while playing
  useEffect(() => {
    const video = videoRef.current
    if (!video || !isPlaying) return

    let rafId = 0
    const tick = () => {
      setCurrentTime(video.currentTime)
      rafId = window.requestAnimationFrame(tick)
    }
    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [isPlaying])

  // Autoplay gently when section scrolls into view (unless user paused or prefers reduced motion)
  useEffect(() => {
    const section = sectionRef.current
    const video = videoRef.current
    if (!section || !video || typeof IntersectionObserver === "undefined") return

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        if (entry.isIntersecting) {
          if (!reducedMotion && !userPausedRef.current) {
            video.play().catch(() => {})
          }
        } else if (!video.paused) {
          video.pause()
        }
      },
      { threshold: 0.35 },
    )

    observer.observe(section)
    return () => observer.disconnect()
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      userPausedRef.current = false
      video.play().catch(() => {})
    } else {
      userPausedRef.current = true
      video.pause()
    }
  }, [])

  const seekToTime = useCallback((targetSec: number) => {
    const video = videoRef.current
    if (!video) return
    const total = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : PLATFORM_DEMO_VIDEO.durationSec
    const clamped = Math.max(0, Math.min(targetSec, total))
    userPausedRef.current = false

    // Servers without HTTP Range support report a 0s seekable window; fall back to an in-memory Blob URL so chapter jumps always work.
    const maxSeekable = video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : 0
    const cannotSeekDirectly =
      video.readyState >= 1 && clamped > 0.25 && maxSeekable < clamped && !blobUrlRef.current

    if (cannotSeekDirectly) {
      pendingSeekRef.current = clamped
      setCurrentTime(clamped)
      if (!blobLoadingRef.current) {
        blobLoadingRef.current = fetch(PLATFORM_DEMO_VIDEO.videoSrc)
          .then((res) => (res.ok ? res.blob() : null))
          .then((blob) => {
            if (!blob) return null
            const url = URL.createObjectURL(blob)
            blobUrlRef.current = url
            setVideoSrc(url)
            return url
          })
          .catch(() => null)
      }
      return
    }

    if (video.readyState < 1) {
      pendingSeekRef.current = clamped
      setCurrentTime(clamped)
      video.load()
      return
    }

    video.currentTime = clamped
    setCurrentTime(clamped)
    video.play().catch(() => {})
  }, [])

  const handleReplay = useCallback(() => {
    seekToTime(0)
  }, [seekToTime])

  return (
    <section
      ref={sectionRef}
      id="demo"
      aria-labelledby="demo-heading"
      className="scroll-mt-16 py-20 sm:py-24"
    >
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        {/* Editorial Section Header */}
        <Reveal>
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <p className="font-mono-spec text-xs font-medium uppercase tracking-widest text-[var(--accent)]">
                {demo.kicker}
              </p>
              <h2
                id="demo-heading"
                className="font-display mt-3 text-3xl font-semibold leading-[1.12] text-[var(--ink)] sm:text-4xl"
              >
                {demo.heading}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-[var(--ink-muted)]">
                {demo.subheading}
              </p>
            </div>

            <div className="flex items-center gap-2 self-start lg:self-end">
              <span className="font-mono-spec inline-flex items-center gap-2 rounded-[8px] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--ink-subtle)] shadow-[var(--card-shadow)]">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${
                    isPlaying
                      ? "bg-[var(--accent-solid)]"
                      : "bg-[var(--ink-muted)]/50"
                  }`}
                />
                <span>{demo.badge}</span>
                <span aria-hidden="true" className="text-[var(--ink-muted)]">
                  ·
                </span>
                <span>{formatClock(duration)}</span>
              </span>
            </div>
          </div>
        </Reveal>

        {/* Studio-Framed 16:9 Platform Demo Monitor */}
        <Reveal delayMs={70} className="mt-8">
          <div className="overflow-hidden rounded-[20px] border border-[var(--stage-border)] bg-[var(--stage)] text-[var(--stage-ink)] shadow-[var(--stage-shadow)]">
            {/* Top Monitor Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--stage-border)] bg-[var(--stage-bar)] px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="font-mono-spec inline-flex shrink-0 items-center rounded-[6px] bg-[var(--stage-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--stage-accent)]">
                  {activeChapter.number}
                </span>
                <span className="truncate text-xs font-medium text-[var(--stage-ink)] sm:text-sm">
                  {activeChapter.title}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono-spec hidden text-[11px] text-[var(--stage-muted)] sm:inline">
                  {formatClock(currentTime)} / {formatClock(duration)}
                </span>

                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={isPlaying ? demo.pauseAria : demo.playAria}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[var(--stage-surface)] px-3 text-xs font-medium text-[var(--stage-ink)] transition-colors hover:bg-[var(--stage-surface-hover)]"
                >
                  {isPlaying ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
                  <span>{isPlaying ? demo.pauseLabel : demo.playLabel}</span>
                </button>

                <button
                  type="button"
                  onClick={handleReplay}
                  aria-label={demo.replayAria}
                  title={demo.replayLabel}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--stage-surface)] text-[var(--stage-subtle)] transition-colors hover:bg-[var(--stage-surface-hover)] hover:text-[var(--stage-ink)]"
                >
                  <RefreshResetIcon size={14} />
                </button>
              </div>
            </div>

            {/* 16:9 Video Viewport */}
            <div className="relative aspect-video w-full bg-[#09090B]">
              <video
                ref={videoRef}
                src={videoSrc}
                poster={PLATFORM_DEMO_VIDEO.posterSrc}
                width={PLATFORM_DEMO_VIDEO.width}
                height={PLATFORM_DEMO_VIDEO.height}
                muted
                loop
                playsInline
                preload="auto"
                onClick={togglePlay}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onLoadedMetadata={(e) => {
                  const vid = e.currentTarget
                  if (Number.isFinite(vid.duration) && vid.duration > 0) {
                    setDuration(vid.duration)
                  }
                  if (pendingSeekRef.current !== null) {
                    const target = pendingSeekRef.current
                    pendingSeekRef.current = null
                    vid.currentTime = target
                    setCurrentTime(target)
                    if (!userPausedRef.current) {
                      vid.play().catch(() => {})
                    }
                  }
                }}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                className="h-full w-full cursor-pointer object-cover"
              />

              {/* Centered Play Overlay when Paused */}
              {!isPlaying && (
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={demo.playAria}
                  className="group absolute inset-0 flex items-center justify-center bg-[#09090B]/35 transition-colors hover:bg-[#09090B]/25"
                >
                  <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-[#09090B]/85 text-[#FAFAFA] shadow-2xl backdrop-blur-sm transition-transform group-hover:scale-105">
                    <PlayIcon size={24} className="translate-x-0.5" />
                  </span>
                </button>
              )}
            </div>

            {/* Interactive 4-Segment Chapter Progress Strip */}
            <div
              role="group"
              aria-label={demo.timelineAria}
              className="border-t border-[var(--stage-border)] bg-[var(--stage-subbar)] px-4 py-3 sm:px-5"
            >
              <div className="grid grid-cols-4 gap-2">
                {chapters.map((chapter, idx) => {
                  const span = Math.max(0.1, chapter.endSec - chapter.startSec)
                  const fillPct =
                    idx < activeChapterIndex
                      ? 100
                      : idx > activeChapterIndex
                        ? 0
                        : Math.max(0, Math.min(100, ((currentTime - chapter.startSec) / span) * 100))

                  return (
                    <button
                      key={chapter.number}
                      type="button"
                      onClick={() => seekToTime(chapter.startSec)}
                      aria-label={`${chapter.number} ${chapter.title} (${chapter.timestamp})`}
                      className="group py-1.5 text-left"
                    >
                      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--stage-surface-2)]">
                        <span
                          className="block h-full rounded-full bg-[var(--stage-accent-solid)] transition-[width] duration-100 ease-linear"
                          style={{ width: `${fillPct}%` }}
                        />
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </Reveal>

        {/* 4 Clickable Chapter Cards */}
        <Reveal delayMs={130} className="mt-4">
          <div
            role="group"
            aria-label={demo.chaptersAria}
            className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4"
          >
            {chapters.map((chapter, idx) => {
              const isActive = idx === activeChapterIndex
              const span = Math.max(0.1, chapter.endSec - chapter.startSec)
              const chapterPct = isActive
                ? Math.max(0, Math.min(100, ((currentTime - chapter.startSec) / span) * 100))
                : idx < activeChapterIndex
                  ? 100
                  : 0

              return (
                <button
                  key={chapter.number}
                  type="button"
                  onClick={() => seekToTime(chapter.startSec)}
                  aria-pressed={isActive}
                  className={`group relative flex flex-col justify-between overflow-hidden rounded-[14px] border p-4 text-left transition-all ${
                    isActive
                      ? "border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--card-shadow)]"
                      : "border-[var(--border)] bg-[var(--surface)]/65 hover:border-[var(--border-strong)] hover:bg-[var(--surface)]"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-mono-spec inline-flex items-center rounded-[6px] px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                          isActive
                            ? "bg-[var(--accent-solid)] text-[var(--accent-ink)]"
                            : "bg-[var(--surface-2)] text-[var(--ink-muted)] group-hover:text-[var(--ink)]"
                        }`}
                      >
                        {chapter.number}
                      </span>

                      <span
                        className={`font-mono-spec text-[11px] transition-colors ${
                          isActive
                            ? "font-medium text-[var(--ink)]"
                            : "text-[var(--ink-muted)]"
                        }`}
                      >
                        {chapter.timestamp}
                      </span>
                    </div>

                    <h3 className="font-display mt-3 text-[15px] font-semibold leading-snug text-[var(--ink)]">
                      {chapter.title}
                    </h3>

                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-muted)] sm:text-[13px]">
                      {chapter.summary}
                    </p>
                  </div>

                  {/* Subtle Bottom Progress Rail */}
                  <span
                    aria-hidden="true"
                    className="mt-4 block h-[2px] w-full overflow-hidden rounded-full bg-[var(--border)]"
                  >
                    <span
                      className={`block h-full rounded-full transition-[width] duration-100 ease-linear ${
                        isActive ? "bg-[var(--accent-solid)]" : "bg-[var(--ink-muted)]/35"
                      }`}
                      style={{ width: `${chapterPct}%` }}
                    />
                  </span>
                </button>
              )
            })}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
