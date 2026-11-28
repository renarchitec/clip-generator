import { useEffect, useRef, useState } from "react"
import { VIDEO_CATEGORIES } from "../data/studio-presets.ts"
import type { MarqueeClip, VideoCategoryId } from "../data/studio-presets.ts"
import type { LandingCopy, Locale } from "../data/translations.ts"
import { PauseIcon, PlayIcon } from "./Icons.tsx"
import { Reveal } from "./Reveal.tsx"

export interface MarqueeShowcaseSectionProps {
  copy: LandingCopy["marquee"]
  clips: readonly MarqueeClip[]
  locale: Locale
}

type CategoryFilter = "all" | VideoCategoryId

const CATEGORY_DOT_COLORS: Record<VideoCategoryId, string> = {
  gaming: "#E4E4E7",
  sport: "#E4E4E7",
  comedy: "#E4E4E7",
  podcast: "#E4E4E7",
}

const FILTER_DOT_COLORS: Record<VideoCategoryId, string> = {
  gaming: "var(--cat-gaming)",
  sport: "var(--cat-sport)",
  comedy: "var(--cat-comedy)",
  podcast: "var(--cat-podcast)",
}

function getCategoryLabel(category: VideoCategoryId, locale: Locale): string {
  const match = VIDEO_CATEGORIES.find((item) => item.id === category)
  if (!match) return category
  return locale === "id" ? match.labelId : match.labelEn
}

// The implicit observer root clips against both the browser viewport and the
// marquee's overflow-hidden ancestor, including while the track is moving.
const PREVIEW_VISIBILITY = 0.25

function useShowcaseMotion(category: CategoryFilter, clips: readonly MarqueeClip[]) {
  const sectionRef = useRef<HTMLElement>(null)
  const pausedRef = useRef(false)
  const updatePlaybackRef = useRef<(() => void) | null>(null)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const section = sectionRef.current
    if (!section || typeof IntersectionObserver !== "function") return

    const preference = window.matchMedia("(prefers-reduced-motion: reduce)")
    const videos = Array.from(section.querySelectorAll<HTMLVideoElement>("video[data-preview-src]"))
    const visible = new Set<HTMLVideoElement>()
    const failed = new Set<string>()
    const playing = new Set<HTMLVideoElement>()
    const attempts = new Map<HTMLVideoElement, Promise<void>>()
    let autoplayBlocked = false
    let observer: IntersectionObserver | null = null

    function stop(video: HTMLVideoElement) {
      playing.delete(video)
      attempts.delete(video)
      video.pause()
      // Keep decoded previews for a quick resume, but cancel cold loads.
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && video.hasAttribute("src")) {
        delete video.dataset.previewReady
        video.removeAttribute("src")
        video.load()
      }
    }

    function stopAll() {
      for (const video of playing) stop(video)
    }

    function updatePlayback() {
      if (pausedRef.current || preference.matches || document.hidden || autoplayBlocked) {
        stopAll()
        return
      }

      for (const video of playing) {
        if (!visible.has(video)) stop(video)
      }

      for (const video of visible) {
        const src = video.dataset.previewSrc
        if (!src || failed.has(src) || playing.has(video)) continue
        playing.add(video)
        video.muted = true
        if (!video.hasAttribute("src")) video.src = src

        const attempt = video.play()
        attempts.set(video, attempt)
        void attempt.catch((error: unknown) => {
          if (attempts.get(video) !== attempt) return
          if (error instanceof DOMException && error.name === "NotAllowedError") {
            autoplayBlocked = true
            delete video.dataset.previewReady
            stopAll()
            return
          }
          usePoster(video)
        })
      }
    }

    function usePoster(video: HTMLVideoElement) {
      if (video.dataset.previewSrc) failed.add(video.dataset.previewSrc)
      delete video.dataset.previewReady
      stop(video)
    }

    const listeners = new AbortController()
    for (const video of videos) {
      video.addEventListener("playing", () => {
        if (playing.has(video)) video.dataset.previewReady = "true"
      }, { signal: listeners.signal })
      video.addEventListener("waiting", () => {
        if (playing.has(video)) delete video.dataset.previewReady
      }, { signal: listeners.signal })
      video.addEventListener("error", () => usePoster(video), { signal: listeners.signal })
    }

    function syncPreference() {
      observer?.disconnect()
      observer = null
      visible.clear()
      stopAll()
      if (preference.matches) {
        for (const video of videos) {
          delete video.dataset.previewReady
          if (!video.hasAttribute("src")) continue
          video.removeAttribute("src")
          video.load()
        }
        return
      }

      const nextObserver = new IntersectionObserver((entries) => {
        if (observer !== nextObserver) return
        for (const entry of entries) {
          const video = entry.target as HTMLVideoElement
          if (entry.isIntersecting && entry.intersectionRatio >= PREVIEW_VISIBILITY) {
            visible.add(video)
          } else {
            visible.delete(video)
          }
        }
        updatePlayback()
      }, { threshold: PREVIEW_VISIBILITY })
      observer = nextObserver
      videos.forEach((video) => nextObserver.observe(video))
    }

    updatePlaybackRef.current = () => {
      if (!pausedRef.current) autoplayBlocked = false
      updatePlayback()
    }
    document.addEventListener("visibilitychange", updatePlayback)
    preference.addEventListener("change", syncPreference)
    syncPreference()

    return () => {
      updatePlaybackRef.current = null
      preference.removeEventListener("change", syncPreference)
      document.removeEventListener("visibilitychange", updatePlayback)
      observer?.disconnect()
      observer = null
      listeners.abort()
      stopAll()
    }
  }, [category, clips])

  function toggleMotion() {
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
    updatePlaybackRef.current?.()
  }

  return { sectionRef, paused, toggleMotion }
}

interface MarqueeCardProps {
  clip: MarqueeClip
  locale: Locale
  duplicate?: boolean
  layout?: "marquee" | "grid"
}

function MarqueeCard({
  clip,
  locale,
  duplicate = false,
  layout = "marquee",
}: MarqueeCardProps) {
  const title = locale === "id" ? clip.titleId : clip.titleEn
  const categoryLabel = getCategoryLabel(clip.category, locale)
  const dotColor = CATEGORY_DOT_COLORS[clip.category]

  const sizeClass =
    layout === "marquee"
      ? "w-[168px] shrink-0 sm:w-[196px]"
      : "mx-auto w-full max-w-[228px] sm:max-w-none"

  return (
    <article className={`${sizeClass} cursor-default select-none`}>
      <figure className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-[#050507] shadow-[var(--marquee-card-shadow)]">
        <img
          src={clip.imageSrc}
          alt={duplicate ? "" : `${title} (${categoryLabel}, ${clip.aspectRatio})`}
          width={196}
          height={348}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover"
        />
        <video
          data-preview-src={clip.previewSrc}
          aria-hidden="true"
          disablePictureInPicture
          disableRemotePlayback
          muted
          playsInline
          loop
          preload="none"
          className="marquee-preview pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 data-[preview-ready=true]:opacity-100"
        />

        {/* Top scrim for guaranteed WCAG AA badge contrast over bright frames */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#050507]/82 via-[#050507]/32 to-transparent"
          aria-hidden="true"
        />

        {/* Top-left video category pill (category only, never a feature label) */}
        <span className="font-mono-spec pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-[6px] bg-[#09090B]/78 px-2 py-0.5 text-[10px] font-medium text-[#FAFAFA] backdrop-blur-xs">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: dotColor }}
            aria-hidden="true"
          />
          <span>{categoryLabel}</span>
        </span>

        {/* Top-right monospace duration badge */}
        <span className="font-mono-spec pointer-events-none absolute right-2.5 top-2.5 rounded-[6px] bg-[#09090B]/78 px-1.5 py-0.5 text-[10px] font-medium text-[#FAFAFA] backdrop-blur-xs">
          {clip.duration}
        </span>

        {/* High-contrast bottom scrim & caption */}
        <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#050507] via-[#050507]/88 to-transparent px-3 pb-3 pt-12">
          <span className="font-mono-spec mb-1 inline-block text-[9px] font-medium uppercase tracking-wider text-[#E4E4E7]">
            {clip.aspectRatio}
          </span>
          <p className="line-clamp-2 text-xs font-semibold leading-snug text-[#FAFAFA]">
            {title}
          </p>
        </figcaption>
      </figure>
    </article>
  )
}

export function MarqueeShowcaseSection({
  copy,
  clips,
  locale,
}: MarqueeShowcaseSectionProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all")
  const { sectionRef, paused, toggleMotion } = useShowcaseMotion(activeCategory, clips)

  if (clips.length === 0) return null

  const filteredClips =
    activeCategory === "all"
      ? clips
      : clips.filter((clip) => clip.category === activeCategory)

  return (
    <section
      ref={sectionRef}
      data-motion-paused={paused}
      aria-labelledby="marquee-showcase-heading"
      className="py-14 sm:py-16"
    >
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <Reveal>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="font-mono-spec text-xs font-medium uppercase tracking-widest text-[var(--accent)]">
                {copy.eyebrow}
              </p>
              <h2
                id="marquee-showcase-heading"
                className="font-display mt-2.5 text-2xl font-semibold leading-[1.14] text-[var(--ink)] sm:text-3xl"
              >
                {copy.title}
              </h2>
              <p className="mt-2.5 text-sm leading-relaxed text-[var(--ink-muted)] sm:text-base">
                {copy.subtitle}
              </p>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2 lg:justify-end">
              {/* Video category filter controls */}
              <div
                role="group"
                aria-label={copy.eyebrow}
                className="flex flex-wrap items-center gap-1.5"
              >
                <button
                  type="button"
                  aria-pressed={activeCategory === "all"}
                  onClick={() => setActiveCategory("all")}
                  className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-3.5 text-xs font-medium transition-colors md:min-h-[36px] ${
                    activeCategory === "all"
                      ? "bg-[var(--accent-solid)] font-semibold text-[var(--accent-ink)]"
                      : "bg-[var(--surface-2)] text-[var(--ink-subtle)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
                  }`}
                >
                  {copy.allLabel}
                </button>

                {VIDEO_CATEGORIES.map((category) => {
                  const active = activeCategory === category.id
                  const label = locale === "id" ? category.labelId : category.labelEn
                  return (
                    <button
                      key={category.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setActiveCategory(category.id)}
                      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-3.5 text-xs font-medium transition-colors md:min-h-[36px] ${
                        active
                          ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                          : "bg-[var(--surface-2)] text-[var(--ink-subtle)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
                      }`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: FILTER_DOT_COLORS[category.id] }}
                        aria-hidden="true"
                      />
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={toggleMotion}
                aria-controls="marquee-showcase-clips"
                className="marquee-motion-control inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[8px] bg-[var(--surface-2)] px-3.5 text-xs font-medium text-[var(--ink-subtle)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--ink)] md:min-h-[36px]"
              >
                {paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
                {paused ? copy.resumeLabel : copy.pauseLabel}
              </button>
            </div>
          </div>
        </Reveal>
      </div>

      {activeCategory === "all" ? (
        /* Full-bleed overflow-hidden continuous non-clickable CSS marquee track */
        <div
          id="marquee-showcase-clips"
          className="marquee-viewport relative mt-8 w-full cursor-default select-none overflow-hidden py-1"
        >
          {/* Left & right soft edge fades matching var(--bg) in Dark and Light */}
          <div
            className="marquee-edge-fade pointer-events-none absolute inset-y-0 left-0 z-10 w-10 sm:w-20 lg:w-32"
            style={{
              background: "linear-gradient(to right, var(--bg) 0%, transparent 100%)",
            }}
            aria-hidden="true"
          />
          <div
            className="marquee-edge-fade pointer-events-none absolute inset-y-0 right-0 z-10 w-10 sm:w-20 lg:w-32"
            style={{
              background: "linear-gradient(to left, var(--bg) 0%, transparent 100%)",
            }}
            aria-hidden="true"
          />

          <div className="marquee-track">
            <div className="marquee-group">
              {clips.map((clip) => (
                <MarqueeCard key={clip.id} clip={clip} locale={locale} />
              ))}
            </div>

            <div
              className="marquee-group marquee-group-duplicate"
              aria-hidden="true"
            >
              {clips.map((clip) => (
                <MarqueeCard
                  key={`${clip.id}-dup`}
                  clip={clip}
                  locale={locale}
                  duplicate
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Focused 2-card showcase strip for a single selected category */
        <div
          key={activeCategory}
          id="marquee-showcase-clips"
          className="animate-clip-swap mx-auto mt-8 grid max-w-[460px] grid-cols-1 gap-4 px-4 sm:grid-cols-2 sm:px-6"
        >
          {filteredClips.map((clip) => (
            <MarqueeCard
              key={clip.id}
              clip={clip}
              locale={locale}
              layout="grid"
            />
          ))}
        </div>
      )}
    </section>
  )
}
