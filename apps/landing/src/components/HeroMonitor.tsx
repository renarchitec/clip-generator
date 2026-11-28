import { useEffect, useRef, useState } from "react"
import { SHOWCASE_CLIPS, VIDEO_CATEGORIES } from "../data/studio-presets.ts"
import type { ShowcaseClip, VideoCategoryId } from "../data/studio-presets.ts"
import type { Locale } from "../data/translations.ts"
import {
  CropReticleIcon,
  PauseIcon,
  PhoneBookmarkIcon,
  PhoneCameraIcon,
  PhoneCommentIcon,
  PhoneHeartIcon,
  PhoneMoreVertIcon,
  PhoneMusicNoteIcon,
  PhoneSearchIcon,
  PhoneShareArrowIcon,
  PhoneSharePlaneIcon,
  PhoneThumbDownIcon,
  PhoneThumbUpIcon,
  PlayIcon,
  ReelsPlatformIcon,
  ShortsPlatformIcon,
  TikTokPlatformIcon,
  VolumeOffIcon,
  VolumeOnIcon,
} from "./Icons.tsx"

export type PlatformViewId = "reels" | "tiktok" | "shorts"

export interface HeroMonitorLabels {
  realRenderBadge: string
  playLabel: string
  pauseLabel: string
  playAria: string
  pauseAria: string
  muteAria: string
  unmuteAria: string
  clipSwitcherAria: string
  platformViewLabel: string
  platformSwitcherAria: string
}

export interface HeroMonitorProps {
  clips?: readonly ShowcaseClip[]
  locale?: Locale
  labels?: Partial<HeroMonitorLabels>
  className?: string
}

const DEFAULT_LABELS: HeroMonitorLabels = {
  realRenderBadge: "Hasil render DartClip",
  playLabel: "Putar",
  pauseLabel: "Jeda",
  playAria: "Putar klip",
  pauseAria: "Jeda klip",
  muteAria: "Matikan suara",
  unmuteAria: "Nyalakan suara",
  clipSwitcherAria: "Pilih contoh klip hasil render",
  platformViewLabel: "Tampilan platform",
  platformSwitcherAria: "Pilih pratinjau platform",
}

const PLATFORM_OPTIONS: readonly {
  id: PlatformViewId
  label: string
  specLabel: string
}[] = [
  { id: "reels", label: "IG Reels", specLabel: "Instagram Reels" },
  { id: "tiktok", label: "TikTok", specLabel: "TikTok" },
  { id: "shorts", label: "Shorts", specLabel: "YouTube Shorts" },
]

const CATEGORY_DOT_COLORS: Record<VideoCategoryId, string> = {
  gaming: "var(--cat-gaming)",
  sport: "var(--cat-sport)",
  comedy: "var(--cat-comedy)",
  podcast: "var(--cat-podcast)",
}

const MOCK_PLATFORM_METRICS: Record<
  VideoCategoryId,
  { likes: string; comments: string; bookmarks: string; shares: string }
> = {
  gaming: { likes: "148K", comments: "2.3K", bookmarks: "19.4K", shares: "12.8K" },
  sport: { likes: "214K", comments: "4.8K", bookmarks: "27.1K", shares: "31.2K" },
  comedy: { likes: "96.4K", comments: "1.9K", bookmarks: "11.6K", shares: "14.7K" },
  podcast: { likes: "72.8K", comments: "1.4K", bookmarks: "9.2K", shares: "8.6K" },
}

const CATEGORY_HANDLES: Record<VideoCategoryId, string> = {
  gaming: "@dartclip.gaming",
  sport: "@dartclip.sport",
  comedy: "@dartclip.comedy",
  podcast: "@dartclip.podcast",
}

const RAIL_COUNT_CLASS =
  "whitespace-nowrap text-[9.5px] font-semibold leading-none tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"

function getCategoryLabel(category: VideoCategoryId, locale: Locale): string {
  const found = VIDEO_CATEGORIES.find((item) => item.id === category)
  if (!found) return category
  return locale === "id" ? found.labelId : found.labelEn
}

function getInitialPlayState(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true
  }
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

function PlatformTabIcon({ id, active }: { id: PlatformViewId; active: boolean }) {
  const colorClass = active ? "text-[var(--stage-accent-ink)]" : "text-[var(--stage-muted)]"
  if (id === "reels") return <ReelsPlatformIcon size={13} className={colorClass} />
  if (id === "tiktok") return <TikTokPlatformIcon size={13} className={colorClass} />
  return <ShortsPlatformIcon size={13} className={colorClass} />
}

function PhoneStatusBar() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex select-none items-center justify-between px-4 pt-[7px] text-white"
    >
      <span className="font-mono-spec text-[10px] font-semibold leading-none tracking-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
        9:41
      </span>

      {/* Dynamic Island pill */}
      <span className="flex h-[15px] w-[58px] items-center justify-end rounded-full border border-white/[0.08] bg-[#050507] pr-[5px]">
        <span className="h-[5px] w-[5px] rounded-full bg-[#27272A] ring-1 ring-white/15" />
      </span>

      {/* Minimal iOS signal, wifi, battery glyphs */}
      <span className="flex items-center gap-[3px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
        <svg width="11" height="8" viewBox="0 0 11 8" fill="currentColor" aria-hidden="true">
          <rect x="0.5" y="5" width="1.7" height="2.5" rx="0.5" />
          <rect x="3.2" y="3.5" width="1.7" height="4" rx="0.5" />
          <rect x="5.9" y="2" width="1.7" height="5.5" rx="0.5" />
          <rect x="8.6" y="0.5" width="1.7" height="7" rx="0.5" />
        </svg>
        <svg width="10" height="8" viewBox="0 0 12 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <path d="M1.2 3.3a6.8 6.8 0 0 1 9.6 0" />
          <path d="M3.2 5.4a4 4 0 0 1 5.6 0" />
          <circle cx="6" cy="7.5" r="0.8" fill="currentColor" stroke="none" />
        </svg>
        <svg width="15" height="8" viewBox="0 0 17 9" fill="none" aria-hidden="true">
          <rect x="0.75" y="1" width="13" height="7" rx="1.8" stroke="currentColor" strokeWidth="1.1" />
          <rect x="2.25" y="2.4" width="9.8" height="4.2" rx="0.8" fill="currentColor" />
          <path d="M15.2 3.1v2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  )
}

interface PlatformOverlayProps {
  platform: PlatformViewId
  clipTitle: string
  category: VideoCategoryId
  handle: string
  progressPct: number
  animateSwap?: boolean
}

function PlatformOverlay({
  platform,
  clipTitle,
  category,
  handle,
  progressPct,
  animateSwap = true,
}: PlatformOverlayProps) {
  const metrics = MOCK_PLATFORM_METRICS[category]
  const swapClass = animateSwap ? "animate-overlay-swap " : ""

  if (platform === "reels") {
    return (
      <div
        key="reels"
        aria-hidden="true"
        className={`${swapClass}pointer-events-none absolute inset-0 z-10 select-none text-white`}
      >
        {/* Top Reels Header */}
        <div className="absolute inset-x-0 top-[29px] flex items-center justify-between px-3.5">
          <span className="text-[13px] font-bold tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
            Reels
          </span>
          <PhoneCameraIcon
            size={16}
            className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
          />
        </div>

        {/* Right Bottom Action Rail */}
        <div className="absolute bottom-[22px] right-2 flex min-w-[34px] flex-col items-center gap-2.5">
          <div className="flex flex-col items-center gap-[3px]">
            <PhoneHeartIcon
              size={19}
              className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
            />
            <span className={RAIL_COUNT_CLASS}>{metrics.likes}</span>
          </div>
          <div className="flex flex-col items-center gap-[3px]">
            <PhoneCommentIcon
              size={18}
              className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
            />
            <span className={RAIL_COUNT_CLASS}>{metrics.comments}</span>
          </div>
          <div className="flex flex-col items-center gap-[3px]">
            <PhoneSharePlaneIcon
              size={18}
              className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
            />
            <span className={RAIL_COUNT_CLASS}>{metrics.shares}</span>
          </div>
          <PhoneMoreVertIcon
            size={15}
            className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
          />
          <span className="mt-0.5 block h-[22px] w-[22px] overflow-hidden rounded-[5px] border-[1.5px] border-white/90 bg-[#18181B] shadow-sm">
            <img
              src="/app-icon.svg"
              alt=""
              width={22}
              height={22}
              className="h-full w-full object-cover"
            />
          </span>
        </div>

        {/* Bottom-Left Creator & Clip Details */}
        <div className="absolute bottom-[22px] left-3 right-12">
          <div className="flex items-center gap-1.5">
            <span className="block h-[22px] w-[22px] shrink-0 overflow-hidden rounded-full border border-white/80 bg-[#18181B]">
              <img
                src="/app-icon.svg"
                alt=""
                width={22}
                height={22}
                className="h-full w-full object-cover"
              />
            </span>
            <span className="truncate text-[11px] font-semibold tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              {handle}
            </span>
          </div>

          <p className="mt-1.5 line-clamp-2 text-[10.5px] font-medium leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            {clipTitle}
          </p>

          <div className="mt-1.5 flex items-center gap-1 text-[9.5px] font-medium text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            <PhoneMusicNoteIcon size={10} className="shrink-0 text-white" />
            <span className="truncate">Original audio · DartClip</span>
          </div>
        </div>
      </div>
    )
  }

  if (platform === "tiktok") {
    return (
      <div
        key="tiktok"
        aria-hidden="true"
        className={`${swapClass}pointer-events-none absolute inset-0 z-10 select-none text-white`}
      >
        {/* Top TikTok Feed Tabs */}
        <div className="absolute inset-x-0 top-[29px] flex items-center justify-center px-3.5">
          <div className="flex items-start gap-3">
            <span className="text-[11px] font-medium text-white/75 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
              Following
            </span>
            <span className="flex flex-col items-center">
              <span className="text-[11px] font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
                For You
              </span>
              <span className="mt-[3px] h-[2px] w-6 rounded-full bg-white" />
            </span>
          </div>
          <PhoneSearchIcon
            size={15}
            className="absolute right-3.5 top-0.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
          />
        </div>

        {/* Right Bottom Action Rail (static disc) */}
        <div className="absolute bottom-[22px] right-2 flex min-w-[34px] flex-col items-center gap-2">
          <div className="relative mb-1">
            <span className="block h-[28px] w-[28px] overflow-hidden rounded-full border-[1.5px] border-white bg-[#18181B]">
              <img
                src="/app-icon.svg"
                alt=""
                width={28}
                height={28}
                className="h-full w-full object-cover"
              />
            </span>
            <span className="absolute -bottom-[5px] left-1/2 flex h-[12px] w-[12px] -translate-x-1/2 items-center justify-center rounded-full bg-[#52525B] text-[9px] font-bold leading-none text-white">
              +
            </span>
          </div>

          <div className="flex flex-col items-center gap-[2px]">
            <PhoneHeartIcon
              size={19}
              filled
              className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
            />
            <span className={RAIL_COUNT_CLASS}>{metrics.likes}</span>
          </div>
          <div className="flex flex-col items-center gap-[2px]">
            <PhoneCommentIcon
              size={18}
              filled
              className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
            />
            <span className={RAIL_COUNT_CLASS}>{metrics.comments}</span>
          </div>
          <div className="flex flex-col items-center gap-[2px]">
            <PhoneBookmarkIcon
              size={17}
              className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
            />
            <span className={RAIL_COUNT_CLASS}>{metrics.bookmarks}</span>
          </div>
          <div className="flex flex-col items-center gap-[2px]">
            <PhoneShareArrowIcon
              size={18}
              className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
            />
            <span className={RAIL_COUNT_CLASS}>{metrics.shares}</span>
          </div>

          {/* Static audio disc (R-19: no endless spin) */}
          <span className="mt-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-full border-[4px] border-[#26262C] bg-[#0B0B0F] ring-1 ring-white/25">
            <span className="block h-[11px] w-[11px] overflow-hidden rounded-full bg-[#18181B]">
              <img
                src="/app-icon.svg"
                alt=""
                width={11}
                height={11}
                className="h-full w-full object-cover"
              />
            </span>
          </span>
        </div>

        {/* Bottom-Left Handle, Clip Title & Category Hashtag */}
        <div className="absolute bottom-[22px] left-3 right-12">
          <p className="truncate text-[11.5px] font-bold tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            {handle}
          </p>
          <p className="mt-1 line-clamp-2 text-[10.5px] font-normal leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            {clipTitle}{" "}
            <span className="font-semibold text-white">#{category}</span>
          </p>
          <div className="mt-1.5 flex items-center gap-1 text-[9.5px] font-medium text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            <PhoneMusicNoteIcon size={10} className="shrink-0 text-white" />
            <span className="truncate">Original sound · DartClip</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      key="shorts"
      aria-hidden="true"
      className={`${swapClass}pointer-events-none absolute inset-0 z-10 select-none text-white`}
    >
      {/* Top YouTube Shorts Header */}
      <div className="absolute inset-x-0 top-[29px] flex items-center justify-between px-3.5">
        <span className="text-[13px] font-bold tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
          Shorts
        </span>
        <span className="flex items-center gap-2.5">
          <PhoneSearchIcon
            size={15}
            className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
          />
          <PhoneMoreVertIcon
            size={15}
            className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
          />
        </span>
      </div>

      {/* Right Bottom Action Rail */}
      <div className="absolute bottom-[26px] right-2 flex min-w-[34px] flex-col items-center gap-2.5">
        <div className="flex flex-col items-center gap-[3px]">
          <PhoneThumbUpIcon
            size={18}
            className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
          />
          <span className={RAIL_COUNT_CLASS}>{metrics.likes}</span>
        </div>
        <div className="flex flex-col items-center gap-[3px]">
          <PhoneThumbDownIcon
            size={18}
            className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
          />
          <span className={RAIL_COUNT_CLASS}>Dislike</span>
        </div>
        <div className="flex flex-col items-center gap-[3px]">
          <PhoneCommentIcon
            size={18}
            filled
            className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
          />
          <span className={RAIL_COUNT_CLASS}>{metrics.comments}</span>
        </div>
        <div className="flex flex-col items-center gap-[3px]">
          <PhoneShareArrowIcon
            size={18}
            className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
          />
          <span className={RAIL_COUNT_CLASS}>{metrics.shares}</span>
        </div>
        <span className="mt-0.5 block h-[22px] w-[22px] overflow-hidden rounded-[4px] border border-white/85 bg-[#18181B]">
          <img
            src="/app-icon.svg"
            alt=""
            width={22}
            height={22}
            className="h-full w-full object-cover"
          />
        </span>
      </div>

      {/* Bottom-Left Channel Row & Real Clip Title */}
      <div className="absolute bottom-[28px] left-3 right-12">
        <div className="flex items-center gap-1.5">
          <span className="block h-[22px] w-[22px] shrink-0 overflow-hidden rounded-full border border-white/75 bg-[#18181B]">
            <img
              src="/app-icon.svg"
              alt=""
              width={22}
              height={22}
              className="h-full w-full object-cover"
            />
          </span>
          <span className="truncate text-[10.5px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            {handle}
          </span>
          <span className="shrink-0 rounded-full bg-white px-2 py-[2px] text-[9px] font-bold leading-tight text-[#0F0F0F]">
            Subscribe
          </span>
        </div>

        <p className="mt-1.5 line-clamp-2 text-[10.5px] font-medium leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
          {clipTitle}
        </p>
      </div>

      {/* Synced YouTube Shorts playback bar right above home indicator */}
      <div className="absolute inset-x-3 bottom-[14px] h-[2.5px] overflow-hidden rounded-full bg-white/30">
        <div
          className="h-full rounded-full bg-[#E4E4E7] transition-[width] duration-150 ease-linear"
          style={{ width: `${progressPct.toFixed(1)}%` }}
        />
      </div>
    </div>
  )
}

export function HeroMonitor({
  clips = SHOWCASE_CLIPS,
  locale = "id",
  labels,
  className = "",
}: HeroMonitorProps) {
  const safeClips = clips.length > 0 ? clips : SHOWCASE_CLIPS
  const [activeClipId, setActiveClipId] = useState<string>(safeClips[0].id)
  const [outgoingClip, setOutgoingClip] = useState<ShowcaseClip | null>(null)
  const [transitionKey, setTransitionKey] = useState<number>(0)
  const [activePlatform, setActivePlatform] = useState<PlatformViewId>("reels")
  const [isPlaying, setIsPlaying] = useState<boolean>(getInitialPlayState)
  const [isMuted, setIsMuted] = useState<boolean>(true)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [duration, setDuration] = useState<number>(safeClips[0].durationSec)
  const [swipeDirection, setSwipeDirection] = useState<"up" | "down">("up")
  const [dragOffsetY, setDragOffsetY] = useState<number>(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const pointerStartYRef = useRef<number | null>(null)
  const activePointerIdRef = useRef<number | null>(null)

  const mergedLabels: HeroMonitorLabels = {
    ...DEFAULT_LABELS,
    ...labels,
  }

  const activeClip =
    safeClips.find((clip) => clip.id === activeClipId) ?? safeClips[0]

  const activePlatformMeta =
    PLATFORM_OPTIONS.find((item) => item.id === activePlatform) ?? PLATFORM_OPTIONS[0]

  // Clear outgoing slide once the vertical feed transition finishes
  useEffect(() => {
    if (!outgoingClip) return
    const timer = window.setTimeout(() => {
      setOutgoingClip(null)
    }, 390)
    return () => window.clearTimeout(timer)
  }, [outgoingClip, transitionKey])

  // Sync play/pause & clip switches safely without unhandled promise rejections
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = isMuted
    if (isPlaying) {
      const playPromise = video.play()
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          // Autoplay may be blocked in headless or restricted browsers
        })
      }
    } else {
      video.pause()
    }
  }, [activeClip.id, isPlaying, isMuted])

  const handleSelectClip = (clip: ShowcaseClip, direction: "up" | "down" = "up") => {
    if (clip.id === activeClip.id) return
    setOutgoingClip(activeClip)
    setSwipeDirection(direction)
    setTransitionKey((prev) => prev + 1)
    setActiveClipId(clip.id)
    setCurrentTime(0)
    setDuration(clip.durationSec)
  }

  const handleStepClip = (direction: "up" | "down") => {
    if (safeClips.length <= 1) return
    const currentIndex = safeClips.findIndex((clip) => clip.id === activeClip.id)
    const nextIndex =
      direction === "up"
        ? (currentIndex + 1) % safeClips.length
        : (currentIndex - 1 + safeClips.length) % safeClips.length
    handleSelectClip(safeClips[nextIndex], direction)
  }

  const handleClipEnded = () => {
    handleStepClip("up")
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return
    pointerStartYRef.current = event.clientY
    activePointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerStartYRef.current == null || activePointerIdRef.current !== event.pointerId) {
      return
    }
    const delta = event.clientY - pointerStartYRef.current
    setDragOffsetY(Math.max(-48, Math.min(48, delta * 0.45)))
  }

  const handlePointerFinish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerStartYRef.current == null || activePointerIdRef.current !== event.pointerId) {
      return
    }
    const startY = pointerStartYRef.current
    pointerStartYRef.current = null
    activePointerIdRef.current = null
    setDragOffsetY(0)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const delta = startY - event.clientY
    if (Math.abs(delta) < 36) return
    handleStepClip(delta > 0 ? "up" : "down")
  }

  const handleScreenKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault()
      handleStepClip("up")
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault()
      handleStepClip("down")
    }
  }

  const progressPct =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0

  const clipTitle = locale === "id" ? activeClip.labelId : activeClip.labelEn
  const clipMeta = locale === "id" ? activeClip.metaId : activeClip.metaEn
  const categoryLabel = getCategoryLabel(activeClip.category, locale)
  const categoryDotColor = CATEGORY_DOT_COLORS[activeClip.category]
  const activeHandle = CATEGORY_HANDLES[activeClip.category]

  return (
    <div className={`hero-monitor-glow w-full min-w-0 ${className}`}>
      <div className="studio-frame overflow-hidden text-[var(--stage-ink)]">
        {/* Top Broadcast Telemetry Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--stage-bar)] px-3.5 py-2.5 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: categoryDotColor }}
              aria-hidden="true"
            />
            <span className="font-mono-spec text-xs font-medium uppercase tracking-wide text-[var(--stage-ink)]">
              {categoryLabel} · {activeClip.aspectRatio}
            </span>
            <span className="font-mono-spec rounded-[6px] bg-[var(--stage-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--stage-accent)]">
              {mergedLabels.realRenderBadge}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsMuted((prev) => !prev)}
              aria-pressed={!isMuted}
              aria-label={isMuted ? mergedLabels.unmuteAria : mergedLabels.muteAria}
              title={isMuted ? mergedLabels.unmuteAria : mergedLabels.muteAria}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[8px] bg-[var(--stage-surface)] text-[var(--stage-ink)] transition-colors hover:bg-[var(--stage-surface-hover)] sm:min-h-[34px] sm:min-w-[34px]"
            >
              {isMuted ? (
                <VolumeOffIcon size={15} className="text-[var(--stage-muted)]" />
              ) : (
                <VolumeOnIcon size={15} className="text-[var(--stage-accent)]" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsPlaying((prev) => !prev)}
              aria-pressed={isPlaying}
              aria-label={isPlaying ? mergedLabels.pauseAria : mergedLabels.playAria}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-[8px] bg-[var(--stage-surface)] px-3 text-xs font-medium text-[var(--stage-ink)] transition-colors hover:bg-[var(--stage-surface-hover)] sm:min-h-[34px] sm:min-w-0 sm:px-2.5"
            >
              {isPlaying ? (
                <>
                  <PauseIcon size={13} className="text-[var(--stage-accent)]" />
                  <span>{mergedLabels.pauseLabel}</span>
                </>
              ) : (
                <>
                  <PlayIcon size={13} className="text-[var(--stage-accent)]" />
                  <span>{mergedLabels.playLabel}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Platform View Switcher Bar */}
        <div className="flex flex-col gap-2 bg-[var(--stage-subbar)] px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <span className="font-mono-spec text-[10px] uppercase tracking-wider text-[var(--stage-muted)]">
            {mergedLabels.platformViewLabel}
          </span>

          <div
            role="group"
            aria-label={mergedLabels.platformSwitcherAria}
            className="grid w-full grid-cols-3 gap-1 rounded-[9px] bg-[var(--stage-surface-2)]/70 p-1 sm:inline-flex sm:w-auto"
          >
            {PLATFORM_OPTIONS.map((option) => {
              const active = option.id === activePlatform
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActivePlatform(option.id)}
                  className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[7px] px-2.5 text-xs font-medium transition-colors sm:min-h-[32px] sm:px-3 ${
                    active
                      ? "bg-[var(--stage-accent-solid)] font-semibold text-[var(--stage-accent-ink)]"
                      : "text-[var(--stage-subtle)] hover:bg-[var(--stage-surface)]/70 hover:text-[var(--stage-ink)]"
                  }`}
                >
                  <PlatformTabIcon id={option.id} active={active} />
                  <span className="truncate">{option.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Main Stage: iPhone Mockup with Live Platform UI + Framing Telemetry Rail */}
        <div className="grid grid-cols-1 items-center gap-5 p-4 sm:grid-cols-[minmax(0,264px)_minmax(0,1fr)] sm:gap-5 sm:p-5">
          {/* Authentic iPhone Hardware Shell */}
          <div className="mx-auto w-full max-w-[264px] px-[3px]">
            <div className="iphone-chassis w-full">
              {/* Subtle titanium side hardware buttons */}
              <span
                aria-hidden="true"
                className="iphone-side-btn pointer-events-none absolute -left-[3px] top-[72px] h-5 w-[2.5px] rounded-l-sm"
              />
              <span
                aria-hidden="true"
                className="iphone-side-btn pointer-events-none absolute -left-[3px] top-[104px] h-9 w-[2.5px] rounded-l-sm"
              />
              <span
                aria-hidden="true"
                className="iphone-side-btn pointer-events-none absolute -left-[3px] top-[148px] h-9 w-[2.5px] rounded-l-sm"
              />
              <span
                aria-hidden="true"
                className="iphone-side-btn pointer-events-none absolute -right-[3px] top-[112px] h-12 w-[2.5px] rounded-r-sm"
              />

              {/* Inner iPhone Screen */}
              <div
                tabIndex={0}
                role="region"
                aria-label={mergedLabels.clipSwitcherAria}
                className="iphone-screen relative aspect-[9/16.5] w-full cursor-grab select-none overflow-hidden touch-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--stage-accent)] active:cursor-grabbing"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerFinish}
                onPointerCancel={handlePointerFinish}
                onKeyDown={handleScreenKeyDown}
              >
                {/* Outgoing feed card sliding out like TikTok / Reels / Shorts */}
                {outgoingClip && (
                  <div
                    key={`out-${outgoingClip.id}-${transitionKey}`}
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-0 z-[1] ${
                      swipeDirection === "up"
                        ? "animate-clip-swipe-out-up"
                        : "animate-clip-swipe-out-down"
                    }`}
                  >
                    <img
                      src={outgoingClip.posterSrc}
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-24 bg-gradient-to-b from-black/80 via-black/38 to-transparent"
                    />
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-40 bg-gradient-to-t from-black/90 via-black/58 to-transparent"
                    />
                    <PlatformOverlay
                      platform={activePlatform}
                      clipTitle={locale === "id" ? outgoingClip.labelId : outgoingClip.labelEn}
                      category={outgoingClip.category}
                      handle={CATEGORY_HANDLES[outgoingClip.category]}
                      progressPct={0}
                      animateSwap={false}
                    />
                  </div>
                )}

                {/* Incoming / active feed card */}
                <div
                  key={`in-${activeClip.id}-${transitionKey}`}
                  className={`absolute inset-0 z-[2] ${
                    outgoingClip
                      ? swipeDirection === "up"
                        ? "animate-clip-swipe-in-up"
                        : "animate-clip-swipe-in-down"
                      : ""
                  }`}
                >
                  <div
                    className="relative h-full w-full"
                    style={
                      dragOffsetY !== 0
                        ? { transform: `translateY(${dragOffsetY}px)` }
                        : { transition: "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)" }
                    }
                  >
                    <video
                      ref={videoRef}
                      src={activeClip.videoSrc}
                      poster={activeClip.posterSrc}
                      playsInline
                      loop={safeClips.length <= 1}
                      muted={isMuted}
                      preload="metadata"
                      onEnded={handleClipEnded}
                      onLoadedMetadata={(event) => {
                        const videoDuration = event.currentTarget.duration
                        if (Number.isFinite(videoDuration) && videoDuration > 0) {
                          setDuration(videoDuration)
                        }
                      }}
                      onTimeUpdate={(event) => {
                        setCurrentTime(event.currentTarget.currentTime)
                      }}
                      aria-label={clipTitle}
                      className="pointer-events-none h-full w-full object-cover"
                    />

                    {/* Top & bottom contrast scrims for >= 4.5:1 overlay legibility (R-25) */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-24 bg-gradient-to-b from-black/80 via-black/38 to-transparent"
                    />
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-40 bg-gradient-to-t from-black/90 via-black/58 to-transparent"
                    />

                    {/* Selected Vertical Platform Overlay */}
                    <PlatformOverlay
                      platform={activePlatform}
                      clipTitle={clipTitle}
                      category={activeClip.category}
                      handle={activeHandle}
                      progressPct={progressPct}
                      animateSwap={!outgoingClip}
                    />
                  </div>
                </div>

                {/* Minimal iOS Status Bar + Dynamic Island */}
                <PhoneStatusBar />

                {/* Bottom iOS Home Indicator */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-[6px] z-20 flex justify-center"
                >
                  <span className="h-[3.5px] w-[84px] rounded-full bg-white/85" />
                </div>
              </div>
            </div>
          </div>

          {/* Right Rail: Clip Details, Synced Video Progress & 3-Clip Switcher */}
          <div className="flex min-w-0 flex-col justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-1.5 font-mono-spec text-[11px] font-medium text-[var(--stage-accent)]">
                <CropReticleIcon size={13} />
                <span>1080x1920 · 9:16 HD</span>
                <span className="font-normal text-[var(--stage-muted)]">
                  · {activePlatformMeta.specLabel}
                </span>
              </div>

              <h2 className="font-display mt-2 text-lg font-semibold leading-snug text-[var(--stage-ink)] sm:text-xl">
                {clipTitle}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--stage-muted)]">
                {clipMeta}
              </p>

              {/* Synced Real Video Progress Bar */}
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between font-mono-spec text-[11px] text-[var(--stage-muted)]">
                  <span>{formatClock(currentTime)}</span>
                  <span>{formatClock(duration)}</span>
                </div>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--stage-surface-2)]"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full bg-[var(--stage-accent-solid)] transition-[width] duration-150 ease-linear"
                    style={{ width: `${progressPct.toFixed(1)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* 3 Real Rendered Clip Switcher */}
            <div>
              <p className="font-mono-spec mb-2 text-[10px] uppercase tracking-wider text-[var(--stage-muted)]">
                {mergedLabels.clipSwitcherAria}
              </p>
              <div
                role="group"
                aria-label={mergedLabels.clipSwitcherAria}
                className="grid grid-cols-1 gap-1.5"
              >
                {safeClips.map((clip, idx) => {
                  const active = clip.id === activeClip.id
                  const label = locale === "id" ? clip.labelId : clip.labelEn
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        const currentIndex = safeClips.findIndex((c) => c.id === activeClip.id)
                        handleSelectClip(clip, idx >= currentIndex ? "up" : "down")
                      }}
                      className={`relative flex min-h-[52px] items-center gap-3 overflow-hidden rounded-[10px] px-3 py-2 text-left transition-colors ${
                        active
                          ? "bg-[var(--stage-accent-soft)] text-[var(--stage-ink)]"
                          : "bg-[var(--stage-surface)]/75 text-[var(--stage-subtle)] hover:bg-[var(--stage-surface)] hover:text-[var(--stage-ink)]"
                      }`}
                    >
                      {active && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-[var(--stage-accent-solid)]"
                        />
                      )}
                      <img
                        src={clip.posterSrc}
                        alt=""
                        width={28}
                        height={40}
                        aria-hidden="true"
                        className="h-10 w-7 shrink-0 rounded-[5px] object-cover"
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-xs font-semibold leading-tight ${
                            active ? "text-[var(--stage-accent)]" : "text-[var(--stage-ink)]"
                          }`}
                        >
                          {label}
                        </span>
                        <span className="font-mono-spec mt-0.5 block truncate text-[10px] text-[var(--stage-muted)]">
                          0{idx + 1} · {clip.aspectRatio} · {clip.durationSec}s
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
