import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  CLEAN_FACECAM_CLIP,
  SHOWCASE_CLIPS_BY_MODE,
} from "../data/studio-presets.ts"
import type { ShowcaseClip } from "../data/studio-presets.ts"
import type { Locale } from "../data/translations.ts"
import {
  AudioWaveIcon,
  CropReticleIcon,
  PauseIcon,
  PlayIcon,
  RefreshResetIcon,
  ShieldSafeIcon,
  VolumeOffIcon,
  VolumeOnIcon,
  WatermarkIcon,
} from "./Icons.tsx"

export type AspectRatio = "9:16" | "1:1" | "16:9"

export type ReframeModeId =
  | "center_crop"
  | "face_tracking"
  | "facecam"
  | "two_speakers"
  | "blurred_fill"
  | "black_bars"

export type CaptionPresetId = "hook" | "beast" | "boxed" | "neon" | "cinema"

export interface ReframeModeSpec {
  id: ReframeModeId
  label: string
  shortDesc: string
  verticalOnly?: boolean
  aspectRatios?: readonly AspectRatio[]
}

export interface CaptionPresetSpec {
  id: CaptionPresetId
  label: string
  fontFamily: string
  fontLabel: string
  primaryColor: string
  highlightColor: string
  outlineColor: string
  effect: "outline" | "shadow" | "box"
  uppercase: boolean
  animate: boolean
}

export interface ClipStudioLabels {
  aspectTitle: string
  aspectGroupAria: string
  reframeTitle: string
  reframeGroupAria: string
  verticalOnlyNote: string
  captionTitle: string
  captionGroupAria: string
  stageLabel: string
  realOutputLabel: string
  overlayPreviewLabel: string
  realRenderNote: string
  illustrationBadge: string
  illustrationNote: string
  playCaptionLabel: string
  pauseCaptionLabel: string
  playCaptionAria: string
  pauseCaptionAria: string
  muteAria: string
  unmuteAria: string
  hookToggleLabel: string
  hookToggleHint: string
  hookInputLabel: string
  hookInputPlaceholder: string
  hookEmptyAlert: string
  hookEmptyBadge: string
  hookEmptyStageNote: string
  hookResetLabel: string
  hookIntroBadge: string
  safeZoneLabel: string
  safeZoneHint: string
  safeZoneTopLabel: string
  safeZoneActionLabel: string
  safeZoneBottomLabel: string
  watermarkLabel: string
  watermarkHint: string
  outroLabel: string
  outroHint: string
  outroTailBadge: string
  clipTimelineBadge: string
  specsTitle: string
  specResolution: string
  specReframe: string
  specFont: string
  specLoudness: string
  specAudioValue: string
  specCodec: string
  specCodecValue: string
}

export interface ClipStudioProps {
  locale?: Locale
  facecamClip?: ShowcaseClip
  cleanFacecamClip?: ShowcaseClip
  reframeModes?: readonly ReframeModeSpec[]
  captionPresets?: readonly CaptionPresetSpec[]
  sampleWords?: readonly string[]
  defaultHookText?: string
  watermarkHandle?: string
  labels?: Partial<ClipStudioLabels>
  className?: string
}

const DEFAULT_REFRAME_MODES: readonly ReframeModeSpec[] = [
  {
    id: "center_crop",
    label: "Crop tengah",
    shortDesc: "Potong sisi gambar, pertahankan bagian tengah.",
    aspectRatios: ["9:16", "1:1"],
  },
  {
    id: "face_tracking",
    label: "Pembicara aktif",
    shortDesc: "Geser crop mengikuti pembicara aktif.",
    aspectRatios: ["9:16", "1:1"],
  },
  {
    id: "facecam",
    label: "Facecam streamer",
    shortDesc: "Facecam 43,75% di atas, gameplay 1:1 di bawah.",
    verticalOnly: true,
    aspectRatios: ["9:16"],
  },
  {
    id: "two_speakers",
    label: "Dua pembicara",
    shortDesc: "Tumpuk dua panel untuk dua pembicara.",
    verticalOnly: true,
    aspectRatios: ["9:16"],
  },
  {
    id: "blurred_fill",
    label: "Latar buram",
    shortDesc: "Video utuh dengan latar buram.",
    aspectRatios: ["9:16", "1:1", "16:9"],
  },
  {
    id: "black_bars",
    label: "Bilah hitam",
    shortDesc: "Video utuh dengan bilah hitam.",
    aspectRatios: ["9:16", "1:1"],
  },
]

const DEFAULT_CAPTION_PRESETS: readonly CaptionPresetSpec[] = [
  {
    id: "hook",
    label: "Hook",
    fontFamily: '"Anton", sans-serif',
    fontLabel: "Anton",
    primaryColor: "#FFFFFF",
    highlightColor: "#FFFF00",
    outlineColor: "#000000",
    effect: "outline",
    uppercase: true,
    animate: true,
  },
  {
    id: "beast",
    label: "Beast",
    fontFamily: '"Montserrat", sans-serif',
    fontLabel: "Montserrat",
    primaryColor: "#FFFFFF",
    highlightColor: "#22C55E",
    outlineColor: "#000000",
    effect: "outline",
    uppercase: true,
    animate: true,
  },
  {
    id: "boxed",
    label: "Boxed",
    fontFamily: '"Plus Jakarta Sans", sans-serif',
    fontLabel: "Plus Jakarta Sans",
    primaryColor: "#FFFFFF",
    highlightColor: "#FACC15",
    outlineColor: "#000000",
    effect: "box",
    uppercase: false,
    animate: false,
  },
  {
    id: "neon",
    label: "Neon",
    fontFamily: '"Bebas Neue", sans-serif',
    fontLabel: "Bebas Neue",
    primaryColor: "#FFFFFF",
    highlightColor: "#5CE1C4",
    outlineColor: "#09090B",
    effect: "shadow",
    uppercase: true,
    animate: false,
  },
  {
    id: "cinema",
    label: "Cinema",
    fontFamily: '"Oswald", sans-serif',
    fontLabel: "Oswald",
    primaryColor: "#FEF08A",
    highlightColor: "#FFFFFF",
    outlineColor: "#000000",
    effect: "shadow",
    uppercase: false,
    animate: false,
  },
]

const DEFAULT_SAMPLE_WORDS: readonly string[] = [
  "Tunggu,",
  "dia",
  "masih",
  "punya",
  "satu",
  "peluru.",
]

const DEFAULT_HOOK_TEXT = "MOMEN INI BIKIN SATU STREAM KAGET"

const DEFAULT_LABELS: ClipStudioLabels = {
  aspectTitle: "Rasio aspek",
  aspectGroupAria: "Pilih rasio aspek output video",
  reframeTitle: "Mode framing",
  reframeGroupAria: "Pilih mode framing video",
  verticalOnlyNote: "Khusus 9:16",
  captionTitle: "Preset caption",
  captionGroupAria: "Pilih preset gaya caption",
  stageLabel: "MONITOR PRATINJAU",
  realOutputLabel: "Hasil render asli",
  overlayPreviewLabel: "Pratinjau overlay",
  realRenderNote:
    "Klip ini ditampilkan sebagaimana dirender oleh DartClip. Pengaturan pratinjau tidak mengubah file video.",
  illustrationBadge: "Ilustrasi framing",
  illustrationNote:
    "Ilustrasi skema framing untuk mode ini. Mode Facecam menampilkan klip asli hasil render DartClip.",
  playCaptionLabel: "Putar",
  pauseCaptionLabel: "Jeda",
  playCaptionAria: "Putar pratinjau",
  pauseCaptionAria: "Jeda pratinjau",
  muteAria: "Matikan suara klip",
  unmuteAria: "Nyalakan suara klip",
  hookToggleLabel: "Tampilkan kartu pembuka",
  hookToggleHint: "Kartu 0,9 detik Montserrat Bold dua warna dengan aksen kuning",
  hookInputLabel: "Teks kartu pembuka",
  hookInputPlaceholder: "Tulis kalimat pembuka",
  hookEmptyAlert: "Isi teks untuk menampilkan kartu pembuka.",
  hookEmptyBadge: "TEKS KOSONG",
  hookEmptyStageNote: "Isi teks untuk menampilkan kartu pembuka.",
  hookResetLabel: "Reset pratinjau",
  hookIntroBadge: "0.0d - 0.9d KARTU PEMBUKA",
  safeZoneLabel: "Panduan safe zone 9:16",
  safeZoneHint: "Batas aman antarmuka TikTok, Reels, dan Shorts",
  safeZoneTopLabel: "STATUS / NAV",
  safeZoneActionLabel: "AKSI",
  safeZoneBottomLabel: "DESKRIPSI & AUDIO",
  watermarkLabel: "Watermark contoh",
  watermarkHint: "Label identitas sudut kiri atas video",
  outroLabel: "Outro contoh",
  outroHint: "Tambahkan penutup 3 detik di akhir klip",
  outroTailBadge: "+ Outro 3.0d",
  clipTimelineBadge: "Klip Utama 10.0d",
  specsTitle: "Spesifikasi Render",
  specResolution: "Rasio output",
  specReframe: "Framing",
  specFont: "Caption",
  specLoudness: "Target audio",
  specAudioValue: "Audio seimbang",
  specCodec: "Format",
  specCodecValue: "MP4 · Siap unggah",
}

const ASPECT_OPTIONS: readonly AspectRatio[] = ["9:16", "1:1", "16:9"]

const RESOLUTION_MAP: Record<AspectRatio, string> = {
  "9:16": "1080x1920",
  "1:1": "1080x1080",
  "16:9": "1920x1080",
}

function getInitialPlayState(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true
  }
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function splitHookLines(raw: string): { whitePart: string; goldPart: string } {
  const words = raw.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return { whitePart: "", goldPart: "" }
  }
  if (words.length === 1) {
    return { whitePart: "", goldPart: words[0] }
  }
  const splitIdx = Math.max(1, Math.ceil(words.length * 0.52))
  return {
    whitePart: words.slice(0, splitIdx).join(" "),
    goldPart: words.slice(splitIdx).join(" "),
  }
}

interface StudioSwitchProps {
  id: string
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  disabledBadge?: string
  onToggle: () => void
  icon?: ReactNode
}

function StudioSwitch({
  id,
  label,
  hint,
  checked,
  disabled = false,
  disabledBadge,
  onToggle,
  icon,
}: StudioSwitchProps) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {icon}
          <label
            htmlFor={id}
            className={`text-sm font-medium leading-snug ${
              disabled ? "text-[var(--ink-muted)]" : "text-[var(--ink)]"
            }`}
          >
            {label}
          </label>
          {disabled && disabledBadge && (
            <span className="font-mono-spec rounded-[5px] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--ink-muted)]">
              {disabledBadge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-muted)]">
          {hint}
        </p>
      </div>

      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={disabled ? false : checked}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onToggle()
        }}
        className="flex min-h-[44px] min-w-[48px] shrink-0 items-center justify-end"
      >
        <span
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            disabled
              ? "bg-[var(--surface-2)] opacity-50"
              : checked
                ? "bg-[var(--accent-solid)]"
                : "bg-[var(--stage-surface-2)]"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full shadow-xs transition-transform ${
              !disabled && checked
                ? "translate-x-[24px] bg-[var(--accent-ink)]"
                : "translate-x-[4px] bg-[var(--surface)]"
            }`}
          />
        </span>
      </button>
    </div>
  )
}

interface FramingIllustrationProps {
  reframe: ReframeModeId
  aspect: AspectRatio
  isPlaying: boolean
}

function FramingIllustration({
  reframe,
  aspect,
  isPlaying,
}: FramingIllustrationProps) {
  if (reframe === "two_speakers" && aspect === "9:16") {
    return (
      <div className="flex h-full w-full flex-col bg-[var(--illus-bg)]">
        {/* Top Speaker A Panel (50%) */}
        <div className="relative h-1/2 w-full overflow-hidden border-b border-[var(--stage-accent-border)] bg-[var(--illus-panel-a)]">
          <svg viewBox="0 0 220 195" className="h-full w-full" aria-hidden="true">
            <defs>
              <radialGradient id="illus-spA-glow" cx="50%" cy="38%" r="58%">
                <stop offset="0%" stopColor="var(--illus-glow-a)" stopOpacity="0.58" />
                <stop offset="100%" stopColor="var(--illus-panel-a)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="220" height="195" fill="var(--illus-panel-a)" />
            <rect width="220" height="195" fill="url(#illus-spA-glow)" />
            <line x1="22" y1="18" x2="22" y2="112" stroke="var(--illus-slat)" strokeWidth="2.5" />
            <line x1="36" y1="18" x2="36" y2="112" stroke="var(--illus-slat)" strokeWidth="2.5" />
            <line x1="184" y1="18" x2="184" y2="112" stroke="var(--illus-slat)" strokeWidth="2.5" />
            <line x1="198" y1="18" x2="198" y2="112" stroke="var(--illus-slat)" strokeWidth="2.5" />
            <path d="M36 195 C44 142 74 126 110 126 C146 126 176 142 184 195 Z" fill="var(--illus-body-a)" stroke="var(--illus-body-a-stroke)" strokeWidth="1.4" />
            <rect x="98" y="102" width="24" height="26" rx="9" fill="var(--illus-neck-a)" />
            <ellipse cx="110" cy="76" rx="28" ry="34" fill="var(--illus-head-a)" stroke="var(--illus-head-a-stroke)" strokeWidth="1.4" />
            <path d="M174 195 L140 144" stroke="var(--illus-mic-arm)" strokeWidth="4" strokeLinecap="round" />
            <rect x="124" y="132" width="22" height="12" rx="6" fill="var(--illus-mic-body)" stroke="var(--illus-mic-stroke)" strokeWidth="1.2" />
          </svg>
          <div className="pointer-events-none absolute inset-x-2.5 top-2.5 flex items-center justify-between">
            <span className="font-mono-spec rounded-[4px] bg-[var(--illus-badge-bg)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--stage-accent)]">
              SPEAKER A · 50%
            </span>
            {/* Subtle audio meter */}
            <span className="flex items-end gap-0.5" aria-hidden="true">
              <span className="h-2 w-1 rounded-[1px] bg-[var(--stage-accent)]" />
              <span className="h-3.5 w-1 rounded-[1px] bg-[var(--stage-accent)]" />
              <span className="h-2.5 w-1 rounded-[1px] bg-[var(--stage-accent)]/70" />
            </span>
          </div>
        </div>

        {/* Bottom Speaker B Panel (50%) */}
        <div className="relative h-1/2 w-full overflow-hidden bg-[var(--illus-panel-b)]">
          <svg viewBox="0 0 220 195" className="h-full w-full" aria-hidden="true">
            <defs>
              <radialGradient id="illus-spB-glow" cx="50%" cy="38%" r="58%">
                <stop offset="0%" stopColor="var(--illus-glow-b)" stopOpacity="0.48" />
                <stop offset="100%" stopColor="var(--illus-panel-b)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="220" height="195" fill="var(--illus-panel-b)" />
            <rect width="220" height="195" fill="url(#illus-spB-glow)" />
            <path d="M40 195 C48 144 74 128 110 128 C146 128 172 144 180 195 Z" fill="var(--illus-body-b)" stroke="var(--illus-body-b-stroke)" strokeWidth="1.4" />
            <rect x="98" y="102" width="24" height="26" rx="9" fill="var(--illus-neck-b)" />
            <ellipse cx="110" cy="76" rx="27" ry="33" fill="var(--illus-head-b)" stroke="var(--illus-head-b-stroke)" strokeWidth="1.4" />
            <path d="M46 195 L80 144" stroke="var(--illus-mic-arm)" strokeWidth="4" strokeLinecap="round" />
            <rect x="74" y="132" width="22" height="12" rx="6" fill="var(--illus-mic-body)" stroke="var(--illus-mic-stroke)" strokeWidth="1.2" />
          </svg>
          <div className="pointer-events-none absolute inset-x-2.5 top-2.5 flex items-center justify-between">
            <span className="font-mono-spec rounded-[4px] bg-[var(--illus-badge-bg)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--stage-subtle)]">
              SPEAKER B · 50%
            </span>
            <span className="flex items-end gap-0.5" aria-hidden="true">
              <span className="h-1.5 w-1 rounded-[1px] bg-[var(--stage-muted)]/60" />
              <span className="h-2.5 w-1 rounded-[1px] bg-[var(--stage-muted)]" />
              <span className="h-1.5 w-1 rounded-[1px] bg-[var(--stage-muted)]/60" />
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (reframe === "blurred_fill" || reframe === "black_bars") {
    const isBlurred = reframe === "blurred_fill"
    return (
      <div
        className={`relative flex h-full w-full items-center justify-center overflow-hidden ${
          isBlurred ? "bg-[var(--illus-bg)]" : "bg-[var(--illus-bars-bg)]"
        }`}
      >
        {/* Soft blurred ambient fill bands for blurred_fill */}
        {isBlurred && (
          <>
            <div
              className="pointer-events-none absolute inset-0 scale-110 opacity-85 blur-2xl"
              style={{ background: "var(--illus-blur-bg)" }}
              aria-hidden="true"
            />
            <span className="font-mono-spec pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-[4px] bg-[var(--illus-badge-bg)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--stage-accent)]">
              BLURRED FILL
            </span>
          </>
        )}

        {/* Solid dark letterbox edge label for black_bars */}
        {!isBlurred && (
          <span className="font-mono-spec pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-[4px] bg-black/75 px-1.5 py-0.5 text-[9px] font-medium text-[#D4D4D8]">
            16:9 · BLACK BARS
          </span>
        )}

        {/* Preserved 16:9 widescreen content frame */}
        <div
          className={`relative z-10 aspect-video w-full overflow-hidden border-y ${
            isBlurred ? "border-[var(--stage-accent-border)]" : "border-white/15"
          } bg-[var(--illus-panel-a)]`}
        >
          <svg viewBox="0 0 320 180" className="h-full w-full" aria-hidden="true">
            <defs>
              <radialGradient id="illus-fit-glow" cx="50%" cy="38%" r="55%">
                <stop offset="0%" stopColor="var(--illus-glow-a)" stopOpacity="0.62" />
                <stop offset="100%" stopColor="var(--illus-panel-a)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="320" height="180" fill="var(--illus-panel-a)" />
            <rect width="320" height="180" fill="url(#illus-fit-glow)" />
            {/* Studio perspective desk grid */}
            <line x1="0" y1="138" x2="320" y2="138" stroke="var(--illus-desk)" strokeWidth="1" />
            <line x1="22" y1="22" x2="22" y2="112" stroke="var(--illus-slat)" strokeWidth="2.5" />
            <line x1="36" y1="22" x2="36" y2="112" stroke="var(--illus-slat)" strokeWidth="2.5" />
            <line x1="284" y1="22" x2="284" y2="112" stroke="var(--illus-slat)" strokeWidth="2.5" />
            <line x1="298" y1="22" x2="298" y2="112" stroke="var(--illus-slat)" strokeWidth="2.5" />
            <path d="M108 164 C114 122 132 108 160 108 C188 108 206 122 212 164 Z" fill="var(--illus-body-a)" stroke="var(--illus-body-a-stroke)" strokeWidth="1.2" />
            <ellipse cx="160" cy="74" rx="22" ry="27" fill="var(--illus-head-a)" stroke="var(--illus-head-a-stroke)" strokeWidth="1.2" />
            <path d="M137 72 C137 46 183 46 183 72" fill="none" stroke="var(--illus-headband)" strokeWidth="5" strokeLinecap="round" />
            <rect x="132" y="65" width="8" height="19" rx="3" fill="var(--illus-earcup)" stroke="var(--stage-accent)" strokeOpacity="0.75" />
            <rect x="180" y="65" width="8" height="19" rx="3" fill="var(--illus-earcup)" stroke="var(--stage-accent)" strokeOpacity="0.75" />
            <path d="M90 164 L132 120" stroke="var(--illus-mic-arm)" strokeWidth="3" strokeLinecap="round" />
            <rect x="128" y="112" width="16" height="9" rx="4.5" fill="var(--illus-mic-body)" stroke="var(--illus-mic-stroke)" strokeWidth="1" />
          </svg>
        </div>

        <span
          className={`font-mono-spec pointer-events-none absolute bottom-2.5 right-2.5 z-10 rounded-[4px] px-1.5 py-0.5 text-[9px] font-medium ${
            isBlurred
              ? "bg-[var(--illus-badge-bg)] text-[var(--stage-muted)]"
              : "bg-black/75 text-[#D4D4D8]"
          }`}
        >
          {aspect}
        </span>
      </div>
    )
  }

  /* Center Crop or Active Speaker framing illustration */
  const isFaceTrack = reframe === "face_tracking"
  const viewBox = aspect === "1:1" ? "0 0 260 260" : "0 0 220 390"
  const subjectOffset = aspect === "1:1" ? "translate(20, 14)" : "translate(0, 62)"

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--illus-panel-a)]">
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="illus-center-glow" cx="50%" cy="35%" r="55%">
            <stop offset="0%" stopColor="var(--illus-glow-a)" stopOpacity="0.68" />
            <stop offset="100%" stopColor="var(--illus-panel-a)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="var(--illus-panel-a)" />
        <rect width="100%" height="100%" fill="url(#illus-center-glow)" />

        {/* Acoustic backdrop slats */}
        <g stroke="var(--illus-slat)" strokeWidth="3">
          <line x1="20" y1="24" x2="20" y2="190" />
          <line x1="38" y1="24" x2="38" y2="190" />
          <line x1={aspect === "1:1" ? 222 : 182} y1="24" x2={aspect === "1:1" ? 222 : 182} y2="190" />
          <line x1={aspect === "1:1" ? 240 : 200} y1="24" x2={aspect === "1:1" ? 240 : 200} y2="190" />
        </g>

        {/* Studio speaker silhouette & condenser mic */}
        <g transform={subjectOffset}>
          <path
            d="M28 242 C36 176 66 152 110 152 C154 152 184 176 192 242 Z"
            fill="var(--illus-body-a)"
            stroke="var(--illus-body-a-stroke)"
            strokeWidth="1.5"
          />
          <path
            d="M84 154 L110 186 L136 154"
            fill="none"
            stroke="var(--stage-accent)"
            strokeOpacity="0.55"
            strokeWidth="2"
          />
          <rect x="97" y="122" width="26" height="30" rx="10" fill="var(--illus-neck-a)" />
          <ellipse cx="110" cy="86" rx="35" ry="43" fill="var(--illus-head-a)" stroke="var(--illus-head-a-stroke)" strokeWidth="1.5" />
          <path
            d="M73 82 C73 42 147 42 147 82"
            fill="none"
            stroke="var(--illus-headband)"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <rect x="66" y="72" width="12" height="29" rx="5" fill="var(--illus-earcup)" stroke="var(--stage-accent)" strokeOpacity="0.75" />
          <rect x="142" y="72" width="12" height="29" rx="5" fill="var(--illus-earcup)" stroke="var(--stage-accent)" strokeOpacity="0.75" />
          <path d="M14 242 L68 178 L92 162" fill="none" stroke="var(--illus-mic-arm)" strokeWidth="4" strokeLinecap="round" />
          <rect x="88" y="150" width="24" height="14" rx="7" fill="var(--illus-mic-body)" stroke="var(--illus-mic-stroke)" strokeWidth="1.4" />
        </g>
      </svg>

      {isFaceTrack ? (
        /* Animated face tracking guide */
        <div
          data-paused={!isPlaying ? "true" : "false"}
          className="animate-face-track pointer-events-none absolute left-1/2 top-[22%] h-[30%] w-[44%] max-w-[118px] -ml-[22%] rounded-[4px] border border-[var(--stage-accent)] bg-[var(--stage-accent-soft)]"
          aria-hidden="true"
        >
          <span className="font-mono-spec absolute -top-5 left-0 rounded-[4px] bg-[var(--illus-badge-bg)] px-1.5 py-0.5 text-[8px] font-medium text-[var(--stage-accent)]">
            FACE TRACK
          </span>
          {/* Subtle crosshair ticks */}
          <span className="absolute left-1/2 top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-[var(--stage-accent)]/75" />
          <span className="absolute left-1/2 top-1/2 h-px w-2.5 -translate-x-1/2 -translate-y-1/2 bg-[var(--stage-accent)]/75" />
          <span className="absolute -right-1 -top-1 h-1.5 w-1.5 bg-[var(--stage-accent)]" />
          <span className="absolute -bottom-1 -left-1 h-1.5 w-1.5 bg-[var(--stage-accent)]" />
        </div>
      ) : (
        /* Center Crop dimmed edge guides + centered reticle badge */
        <>
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-[9%] border-r border-dashed border-[var(--stage-accent-border)] bg-[var(--illus-crop-dim)]"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-[9%] border-l border-dashed border-[var(--stage-accent-border)] bg-[var(--illus-crop-dim)]"
            aria-hidden="true"
          />
          <span className="font-mono-spec pointer-events-none absolute left-2.5 top-2.5 rounded-[4px] bg-[var(--illus-badge-bg)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--stage-accent)]">
            CENTER CROP
          </span>
        </>
      )}
    </div>
  )
}

export function ClipStudio({
  locale = "id",
  facecamClip = SHOWCASE_CLIPS_BY_MODE.facecam ?? CLEAN_FACECAM_CLIP,
  cleanFacecamClip = CLEAN_FACECAM_CLIP,
  reframeModes = DEFAULT_REFRAME_MODES,
  captionPresets = DEFAULT_CAPTION_PRESETS,
  sampleWords = DEFAULT_SAMPLE_WORDS,
  defaultHookText = DEFAULT_HOOK_TEXT,
  watermarkHandle = "@dartclip",
  labels,
  className = "",
}: ClipStudioProps) {
  const [aspect, setAspect] = useState<AspectRatio>("9:16")
  const [reframe, setReframe] = useState<ReframeModeId>("facecam")
  const [presetId, setPresetId] = useState<CaptionPresetId>("hook")
  const [viewMode, setViewMode] = useState<"real" | "overlay">("real")
  const [hookEnabled, setHookEnabled] = useState<boolean>(false)
  const [hookText, setHookText] = useState<string>(defaultHookText)
  const prevDefaultHookRef = useRef<string>(defaultHookText)
  const [safeZoneEnabled, setSafeZoneEnabled] = useState<boolean>(false)
  const [watermarkEnabled, setWatermarkEnabled] = useState<boolean>(false)
  const [outroEnabled, setOutroEnabled] = useState<boolean>(false)
  const [isPlaying, setIsPlaying] = useState<boolean>(getInitialPlayState)
  const [isMuted, setIsMuted] = useState<boolean>(true)
  const [activeWordIndex, setActiveWordIndex] = useState<number>(1)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const t: ClipStudioLabels = {
    ...DEFAULT_LABELS,
    ...labels,
  }

  // Keep default hook text synced on language toggle if user has not edited it
  useEffect(() => {
    if (prevDefaultHookRef.current !== defaultHookText) {
      if (hookText === prevDefaultHookRef.current) {
        setHookText(defaultHookText)
      }
      prevDefaultHookRef.current = defaultHookText
    }
  }, [defaultHookText, hookText])

  const words = sampleWords.length > 0 ? sampleWords : DEFAULT_SAMPLE_WORDS
  const activePreset =
    captionPresets.find((p) => p.id === presetId) ??
    captionPresets[0] ??
    DEFAULT_CAPTION_PRESETS[0]
  const activeReframeSpec =
    reframeModes.find((m) => m.id === reframe) ??
    reframeModes[0] ??
    DEFAULT_REFRAME_MODES[0]

  // Only 9:16 + facecam plays the real Windah Basudara render video
  const hasRealVideo = aspect === "9:16" && reframe === "facecam"
  const showOverlays = !hasRealVideo || viewMode === "overlay"
  const activeVideoClip =
    viewMode === "overlay" ? cleanFacecamClip : facecamClip

  // Sync HTML5 video play/pause/mute cleanly when video mode is active
  useEffect(() => {
    if (!hasRealVideo) return
    const video = videoRef.current
    if (!video) return
    video.muted = isMuted
    if (isPlaying) {
      const promise = video.play()
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {
          // Ignore headless or browser autoplay restrictions
        })
      }
    } else {
      video.pause()
    }
  }, [hasRealVideo, activeVideoClip.videoSrc, isPlaying, isMuted])

  // Word-by-word highlight cycling whenever overlays are visible
  useEffect(() => {
    if (!isPlaying || !showOverlays || hookEnabled) return
    const timer = window.setInterval(() => {
      setActiveWordIndex((prev) => (prev + 1) % words.length)
    }, 520)
    return () => window.clearInterval(timer)
  }, [isPlaying, showOverlays, hookEnabled, words.length])

  const isModeDisabledForAspect = (
    mode: ReframeModeSpec,
    targetAspect: AspectRatio,
  ): boolean => {
    if (mode.aspectRatios && mode.aspectRatios.length > 0) {
      return !mode.aspectRatios.includes(targetAspect)
    }
    return Boolean(mode.verticalOnly && targetAspect !== "9:16")
  }

  const getDisabledAspectBadge = (mode: ReframeModeSpec): string => {
    if (mode.aspectRatios && mode.aspectRatios.length === 1) {
      return mode.aspectRatios[0]
    }
    if (mode.aspectRatios && mode.aspectRatios.length > 1) {
      return mode.aspectRatios.join(" / ")
    }
    return t.verticalOnlyNote
  }

  const handleAspectChange = (nextAspect: AspectRatio) => {
    setAspect(nextAspect)
    const currentSpec = reframeModes.find((m) => m.id === reframe)
    if (currentSpec && isModeDisabledForAspect(currentSpec, nextAspect)) {
      const fallback =
        reframeModes.find((m) => !isModeDisabledForAspect(m, nextAspect)) ??
        reframeModes[0]
      if (fallback) {
        setReframe(fallback.id)
      }
    }
  }

  const handleSelectPreset = (nextPresetId: CaptionPresetId) => {
    setPresetId(nextPresetId)
    if (hasRealVideo) {
      setViewMode("overlay")
    }
  }

  const handleToggleHook = () => {
    setHookEnabled((prev) => {
      const next = !prev
      if (next && hasRealVideo) setViewMode("overlay")
      return next
    })
  }

  const handleToggleWatermark = () => {
    setWatermarkEnabled((prev) => {
      const next = !prev
      if (next && hasRealVideo) setViewMode("overlay")
      return next
    })
  }

  const handleToggleOutro = () => {
    setOutroEnabled((prev) => {
      const next = !prev
      if (next && hasRealVideo) setViewMode("overlay")
      return next
    })
  }

  const trimmedHook = hookText.trim()
  const isHookEmptyError = showOverlays && hookEnabled && trimmedHook.length === 0
  const { whitePart, goldPart } = splitHookLines(hookText)
  const showSafeZone = safeZoneEnabled && aspect === "9:16"

  // Bounded responsive preview sizing so switching aspect ratios never jumps page layout
  const frameSizeClasses =
    aspect === "9:16"
      ? "aspect-[9/16] h-[348px] sm:h-[396px] lg:h-[430px] w-auto max-w-full"
      : aspect === "1:1"
        ? "aspect-square w-[280px] sm:w-[332px] lg:w-[356px] max-w-full max-h-[356px]"
        : "aspect-video w-full max-w-[446px]"

  const activeClipMeta =
    locale === "id" ? activeVideoClip.metaId : activeVideoClip.metaEn
  const activeClipLabel =
    locale === "id" ? activeVideoClip.labelId : activeVideoClip.labelEn

  return (
    <div
      className={`overflow-hidden rounded-[18px] bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card-shadow)] ${className}`}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[276px_minmax(0,1fr)_286px]">
        {/* LEFT / TOP INSPECTOR: Aspect, Reframe, Caption Presets */}
        <div className="p-4 sm:p-5">
          {/* Aspect Ratio */}
          <div>
            <p className="font-mono-spec mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--ink-muted)]">
              {t.aspectTitle}
            </p>
            <div
              role="group"
              aria-label={t.aspectGroupAria}
              className="grid grid-cols-3 gap-1.5 rounded-[10px] bg-[var(--surface-2)] p-1"
            >
              {ASPECT_OPTIONS.map((ratio) => {
                const active = aspect === ratio
                return (
                  <button
                    key={ratio}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleAspectChange(ratio)}
                    className={`font-mono-spec min-h-[40px] rounded-[7px] px-2 text-xs font-medium transition-colors ${
                      active
                        ? "bg-[var(--accent-solid)] font-semibold text-[var(--accent-ink)]"
                        : "text-[var(--ink-subtle)] hover:bg-[var(--surface)]/70 hover:text-[var(--ink)]"
                    }`}
                  >
                    {ratio}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Reframe Mode Selector (6 real modes) */}
          <div className="mt-5">
            <p className="font-mono-spec mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--ink-muted)]">
              {t.reframeTitle}
            </p>
            <div
              role="group"
              aria-label={t.reframeGroupAria}
              className="grid grid-cols-2 gap-1.5 lg:grid-cols-1"
            >
              {reframeModes.map((mode) => {
                const isDisabled = isModeDisabledForAspect(mode, aspect)
                const active = !isDisabled && reframe === mode.id
                return (
                  <button
                    key={mode.id}
                    type="button"
                    disabled={isDisabled}
                    aria-disabled={isDisabled || undefined}
                    aria-pressed={active}
                    onClick={() => {
                      if (!isDisabled) setReframe(mode.id)
                    }}
                    className={`relative flex min-h-[44px] flex-col items-start justify-center overflow-hidden rounded-[9px] px-3 py-2 text-left transition-colors ${
                      isDisabled
                        ? "bg-[var(--surface-2)]/60 opacity-50"
                        : active
                          ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                          : "bg-[var(--surface-2)] text-[var(--ink)] hover:bg-[var(--surface-2)]/70"
                    }`}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-[var(--accent-solid)]"
                      />
                    )}
                    <span className="flex w-full items-center justify-between gap-1.5 text-xs font-semibold leading-tight">
                      <span className={`truncate ${active ? "text-[var(--accent)]" : ""}`}>
                        {mode.label}
                      </span>
                      {isDisabled && (
                        <span className="font-mono-spec shrink-0 rounded-[4px] bg-[var(--surface)]/80 px-1.5 py-0.5 text-[9px] font-normal text-[var(--ink-muted)]">
                          {getDisabledAspectBadge(mode)}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-1 text-[11px] text-[var(--ink-muted)]">
                      {mode.shortDesc}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Caption Preset Selector (5 authentic render presets) */}
          <div className="mt-5">
            <p className="font-mono-spec mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--ink-muted)]">
              {t.captionTitle}
            </p>
            <div
              role="group"
              aria-label={t.captionGroupAria}
              className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2"
            >
              {captionPresets.map((preset) => {
                const active = preset.id === activePreset.id && showOverlays
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`relative flex min-h-[44px] flex-col items-start justify-center overflow-hidden rounded-[9px] px-2.5 py-1.5 text-left transition-colors ${
                      active
                        ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                        : "bg-[var(--surface-2)] text-[var(--ink)] hover:bg-[var(--surface-2)]/70"
                    }`}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-[var(--accent-solid)]"
                      />
                    )}
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: preset.highlightColor }}
                        aria-hidden="true"
                      />
                      <span className={active ? "text-[var(--accent)]" : ""}>{preset.label}</span>
                    </span>
                    <span className="font-mono-spec mt-0.5 truncate text-[10px] text-[var(--ink-muted)]">
                      {preset.fontLabel}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* CENTER STAGE: Adaptive studio clip preview */}
        <div className="flex min-w-0 flex-col justify-between bg-[var(--stage)] p-4 text-[var(--stage-ink)] sm:p-5">
          {/* Stage Top Bar: Real Video toggle OR Illustration badge + Playback controls */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {hasRealVideo ? (
              <div
                role="group"
                aria-label={t.stageLabel}
                className="inline-flex rounded-[9px] bg-[var(--stage-surface-2)]/75 p-1"
              >
                <button
                  type="button"
                  aria-pressed={viewMode === "real"}
                  onClick={() => setViewMode("real")}
                  className={`min-h-[40px] rounded-[7px] px-3 text-xs font-medium transition-colors sm:min-h-[32px] ${
                    viewMode === "real"
                      ? "bg-[var(--stage-accent-solid)] font-semibold text-[var(--stage-accent-ink)]"
                      : "text-[var(--stage-subtle)] hover:text-[var(--stage-ink)]"
                  }`}
                >
                  {t.realOutputLabel}
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "overlay"}
                  onClick={() => setViewMode("overlay")}
                  className={`min-h-[40px] rounded-[7px] px-3 text-xs font-medium transition-colors sm:min-h-[32px] ${
                    viewMode === "overlay"
                      ? "bg-[var(--stage-accent-solid)] font-semibold text-[var(--stage-accent-ink)]"
                      : "text-[var(--stage-subtle)] hover:text-[var(--stage-ink)]"
                  }`}
                >
                  {t.overlayPreviewLabel}
                </button>
              </div>
            ) : (
              <div className="inline-flex min-h-[34px] items-center gap-2 rounded-[8px] bg-[var(--stage-surface)] px-3 py-1.5">
                <CropReticleIcon size={13} className="text-[var(--stage-accent)]" />
                <span className="font-mono-spec text-xs font-medium text-[var(--stage-accent)]">
                  {t.illustrationBadge}
                </span>
                <span className="font-mono-spec text-[11px] text-[var(--stage-muted)]">
                  · {aspect}
                </span>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              {/* Mute button shown ONLY when a real <video> is playing */}
              {hasRealVideo && (
                <button
                  type="button"
                  onClick={() => setIsMuted((prev) => !prev)}
                  aria-pressed={!isMuted}
                  aria-label={isMuted ? t.unmuteAria : t.muteAria}
                  title={isMuted ? t.unmuteAria : t.muteAria}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[8px] bg-[var(--stage-surface)] text-[var(--stage-ink)] transition-colors hover:bg-[var(--stage-surface-hover)] sm:min-h-[34px] sm:min-w-[34px]"
                >
                  {isMuted ? (
                    <VolumeOffIcon size={15} className="text-[var(--stage-muted)]" />
                  ) : (
                    <VolumeOnIcon size={15} className="text-[var(--stage-accent)]" />
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsPlaying((prev) => !prev)}
                aria-pressed={isPlaying}
                aria-label={isPlaying ? t.pauseCaptionAria : t.playCaptionAria}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[8px] bg-[var(--stage-surface)] px-3 text-xs font-medium text-[var(--stage-ink)] transition-colors hover:bg-[var(--stage-surface-hover)] sm:min-h-[34px]"
              >
                {isPlaying ? (
                  <>
                    <PauseIcon size={13} className="text-[var(--stage-accent)]" />
                    <span>{t.pauseCaptionLabel}</span>
                  </>
                ) : (
                  <>
                    <PlayIcon size={13} className="text-[var(--stage-accent)]" />
                    <span>{t.playCaptionLabel}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Bounded-height stage container so resizing aspect never shifts page layout */}
          <div className="flex h-[376px] w-full items-center justify-center sm:h-[424px] lg:h-[462px]">
            <div
              key={
                hasRealVideo
                  ? `${activeVideoClip.id}-${viewMode}`
                  : `illus-${aspect}-${reframe}`
              }
              className={`reticle-corners animate-clip-swap relative overflow-hidden rounded-[12px] shadow-[var(--viewport-shadow)] transition-[width,height] duration-300 ${
                hasRealVideo
                  ? "reticle-corners-video bg-[#09090B]"
                  : "bg-[var(--illus-bg)]"
              } ${frameSizeClasses}`}
            >
              {hasRealVideo ? (
                <video
                  ref={videoRef}
                  src={activeVideoClip.videoSrc}
                  poster={activeVideoClip.posterSrc}
                  playsInline
                  loop
                  muted={isMuted}
                  preload="metadata"
                  aria-label={activeClipLabel}
                  className="relative z-10 h-full w-full object-cover"
                />
              ) : (
                <FramingIllustration
                  reframe={reframe}
                  aspect={aspect}
                  isPlaying={isPlaying}
                />
              )}

              {/* Subtle dark scrim over real video in Overlay mode so custom caption stays crisp */}
              {hasRealVideo && showOverlays && !hookEnabled && (
                <div
                  className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-black/72 via-black/18 to-black/28"
                  aria-hidden="true"
                />
              )}

              {/* Bottom caption legibility scrim on light-mode framing illustrations */}
              {!hasRealVideo && showOverlays && !hookEnabled && (
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[40%] bg-gradient-to-t from-[#18181B]/65 via-[#18181B]/24 to-transparent dark:hidden"
                  aria-hidden="true"
                />
              )}

              {/* Watermark (when overlays are active, hidden during Hook Thumbnail intro) */}
              {showOverlays && watermarkEnabled && !hookEnabled && (
                <div
                  className="font-mono-spec pointer-events-none absolute left-2.5 top-2.5 z-20 rounded-[5px] bg-[#050507]/75 px-2 py-0.5 text-[10px] font-medium tracking-tight text-white/95"
                  aria-label="Watermark"
                >
                  {watermarkHandle}
                </div>
              )}

              {/* Live Bundled-Font Caption (active on Overlay mode & all Illustration modes, hidden during Hook Intro) */}
              {showOverlays && !hookEnabled && (
                <div
                  className={`pointer-events-none absolute inset-x-3 z-20 flex justify-center ${
                    aspect === "16:9" ? "bottom-[10%]" : "bottom-[15%]"
                  }`}
                >
                  <div
                    className={`flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center ${
                      activePreset.effect === "box"
                        ? "rounded-[8px] bg-black/80 px-3 py-1.5"
                        : ""
                    }`}
                  >
                    {words.map((word, idx) => {
                      const isCurrent = idx === activeWordIndex
                      const displayWord = activePreset.uppercase
                        ? word.toUpperCase()
                        : word
                      const effectClass =
                        activePreset.effect === "outline"
                          ? "caption-outline"
                          : activePreset.effect === "shadow"
                            ? "caption-shadow"
                            : ""

                      const fontSizePx =
                        activePreset.id === "neon"
                          ? aspect === "16:9"
                            ? 24
                            : 22
                          : activePreset.id === "boxed"
                            ? 15
                            : aspect === "16:9"
                              ? 20
                              : 18

                      return (
                        <span
                          key={`${word}-${idx}-${isCurrent ? "on" : "off"}`}
                          className={`inline-block leading-[1.12] ${effectClass} ${
                            isCurrent && activePreset.animate ? "animate-word-pop" : ""
                          }`}
                          style={{
                            fontFamily: activePreset.fontFamily,
                            fontWeight: 700,
                            fontSize: `${fontSizePx}px`,
                            color: isCurrent
                              ? activePreset.highlightColor
                              : activePreset.primaryColor,
                          }}
                        >
                          {displayWord}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Authentic Hook Thumbnail Intro (0.9s) overlay matching hook_thumbnail.rs */}
              {showOverlays && hookEnabled && (
                <div className="animate-hook-card-in absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-b from-[#09090B]/82 via-[#09090B]/62 to-[#09090B]/90 px-5 text-center">
                  <span className="font-mono-spec absolute right-2.5 top-2.5 rounded-[4px] border border-[#FACC15]/45 bg-[#09090B]/90 px-1.5 py-0.5 text-[9px] font-medium text-[#FACC15]">
                    {t.hookIntroBadge}
                  </span>

                  {isHookEmptyError ? (
                    <div className="max-w-[215px] rounded-[8px] border border-[#FACC15]/60 bg-[#09090B]/92 px-3.5 py-3 text-center">
                      <p className="font-mono-spec text-[10px] font-medium uppercase tracking-wider text-[#FACC15]">
                        {t.hookEmptyBadge}
                      </p>
                      <p className="mt-1 text-xs leading-snug text-[#FAFAFA]">
                        {t.hookEmptyStageNote}
                      </p>
                    </div>
                  ) : (
                    <div className="flex max-w-[92%] flex-col items-center">
                      <span
                        className="mb-3 block h-1.5 w-12 rounded-[2px] bg-[#FACC15]"
                        aria-hidden="true"
                      />
                      <div
                        className="hook-headline-stroke uppercase leading-[1.08] tracking-tight"
                        style={{
                          fontFamily: '"Montserrat", sans-serif',
                          fontWeight: 700,
                          fontSize: aspect === "16:9" ? "24px" : "21px",
                        }}
                      >
                        {whitePart && (
                          <span className="block text-[#FFFFFF]">{whitePart}</span>
                        )}
                        {goldPart && (
                          <span className="mt-0.5 block text-[#FACC15]">{goldPart}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 9:16 Safe Zone Guide Overlay (works on BOTH Real Video & Illustrations!) */}
              {showSafeZone && (
                <div
                  className="pointer-events-none absolute inset-0 z-30"
                  aria-hidden="true"
                >
                  <div className="absolute inset-x-0 top-0 flex h-[12%] items-center justify-center border-b border-dashed border-[#52525B]/80 bg-[#E4E4E7]/16 dark:border-[#E4E4E7]/70 dark:bg-[#E4E4E7]/12">
                    <span className="font-mono-spec rounded-[3px] bg-[#18181B]/80 px-1.5 py-0.5 text-[8px] font-medium tracking-wider text-[#E4E4E7]">
                      {t.safeZoneTopLabel}
                    </span>
                  </div>

                  <div className="absolute bottom-[18%] right-0 top-[44%] flex w-[17%] flex-col items-center justify-center gap-2 border-l border-dashed border-[#52525B]/80 bg-[#E4E4E7]/16 dark:border-[#E4E4E7]/70 dark:bg-[#E4E4E7]/12">
                    <span className="h-3.5 w-3.5 rounded-full border border-[#52525B]/85 dark:border-[#E4E4E7]/75" />
                    <span className="h-3.5 w-3.5 rounded-full border border-[#52525B]/85 dark:border-[#E4E4E7]/75" />
                    <span className="h-3.5 w-3.5 rounded-full border border-[#52525B]/85 dark:border-[#E4E4E7]/75" />
                    <span className="font-mono-spec rounded-[3px] bg-[#18181B]/80 px-1 py-0.5 text-[7px] text-[#E4E4E7]">
                      {t.safeZoneActionLabel}
                    </span>
                  </div>

                  <div className="absolute inset-x-0 bottom-0 flex h-[18%] items-end justify-start border-t border-dashed border-[#52525B]/80 bg-[#E4E4E7]/16 p-2 dark:border-[#E4E4E7]/70 dark:bg-[#E4E4E7]/12">
                    <span className="font-mono-spec rounded-[3px] bg-[#18181B]/80 px-1.5 py-0.5 text-[8px] font-medium tracking-wider text-[#E4E4E7]">
                      {t.safeZoneBottomLabel}
                    </span>
                  </div>

                  <div className="absolute bottom-[18%] left-2 right-[17%] top-[12%] rounded-[4px] border border-dashed border-[#52525B]/85 dark:border-[#E4E4E7]/85" />
                </div>
              )}
            </div>
          </div>

          {/* Stage Footer: Active Clip Metadata OR Illustration Note + Outro Tail */}
          <div className="mt-3 space-y-2.5 pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {showOverlays && hookEnabled && (
                <span className="font-mono-spec shrink-0 rounded-[6px] bg-[var(--stage-hook-bg)] px-2 py-1 text-[10px] font-medium text-[var(--stage-hook-ink)]">
                  0.9s Hook
                </span>
              )}
              <span className="font-mono-spec inline-flex flex-1 items-center gap-1.5 truncate rounded-[6px] bg-[var(--stage-accent-soft)] px-2.5 py-1 text-[10px] font-medium text-[var(--stage-accent)]">
                <CropReticleIcon size={12} className="shrink-0" />
                <span className="truncate">
                  {hasRealVideo
                    ? activeClipMeta
                    : `${aspect} · ${activeReframeSpec.label} · ${activeReframeSpec.shortDesc}`}
                </span>
              </span>
              {showOverlays && outroEnabled && (
                <span className="font-mono-spec shrink-0 rounded-[6px] bg-[var(--stage-surface)] px-2 py-1 text-[10px] font-medium text-[var(--stage-ink)]">
                  {t.outroTailBadge}
                </span>
              )}
            </div>

            <p className="font-mono-spec text-[11px] leading-relaxed text-[var(--stage-muted)]">
              {hasRealVideo ? t.realRenderNote : t.illustrationNote}
            </p>
          </div>
        </div>

        {/* RIGHT / BOTTOM PANEL: Switches, Hook Input Validation, Live Spec Readout */}
        <div className="flex flex-col justify-between p-4 sm:p-5">
          <div className="space-y-3">
            {/* Hook Thumbnail Switch + Live Input + WCAG AA --danger validation */}
            <div className="pb-1">
              <StudioSwitch
                id="studio-hook-switch"
                label={t.hookToggleLabel}
                hint={t.hookToggleHint}
                checked={showOverlays && hookEnabled}
                onToggle={handleToggleHook}
              />

              <div className="mt-2">
                <label
                  htmlFor="studio-hook-input"
                  className="mb-1.5 block text-xs font-medium text-[var(--ink)]"
                >
                  {t.hookInputLabel}
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="studio-hook-input"
                    type="text"
                    value={hookText}
                    onChange={(event) => {
                      setHookText(event.target.value)
                      if (hasRealVideo && hookEnabled && viewMode !== "overlay") {
                        setViewMode("overlay")
                      }
                    }}
                    placeholder={t.hookInputPlaceholder}
                    maxLength={72}
                    aria-invalid={isHookEmptyError || undefined}
                    aria-describedby={isHookEmptyError ? "studio-hook-error" : undefined}
                    className={`min-h-[44px] w-full min-w-0 rounded-[8px] border bg-[var(--surface-2)] px-3 text-xs text-[var(--ink)] placeholder:text-[var(--ink-muted)] transition-colors ${
                      isHookEmptyError
                        ? "border-[var(--danger)]"
                        : "border-[var(--border-strong)] focus:border-[var(--accent)]"
                    }`}
                  />
                  {hookText !== defaultHookText && (
                    <button
                      type="button"
                      onClick={() => setHookText(defaultHookText)}
                      aria-label={t.hookResetLabel}
                      title={t.hookResetLabel}
                      className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-2)] text-[var(--ink-subtle)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                    >
                      <RefreshResetIcon size={15} />
                    </button>
                  )}
                </div>

                {isHookEmptyError && (
                  <div
                    id="studio-hook-error"
                    role="alert"
                    className="mt-2 flex items-center justify-between gap-2 rounded-[8px] bg-[var(--danger-soft)] px-2.5 py-2 text-xs text-[var(--danger)]"
                  >
                    <span className="font-medium">{t.hookEmptyAlert}</span>
                    <button
                      type="button"
                      onClick={() => setHookText(defaultHookText)}
                      className="shrink-0 font-semibold text-[var(--ink)] underline underline-offset-2"
                    >
                      {t.hookResetLabel}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 9:16 Safe Zone Switch */}
            <div>
              <StudioSwitch
                id="studio-safezone-switch"
                label={t.safeZoneLabel}
                hint={t.safeZoneHint}
                checked={safeZoneEnabled}
                disabled={aspect !== "9:16"}
                disabledBadge={t.verticalOnlyNote}
                onToggle={() => setSafeZoneEnabled((prev) => !prev)}
                icon={<ShieldSafeIcon size={14} className="shrink-0 text-[var(--accent)]" />}
              />
            </div>

            {/* Watermark Switch */}
            <div>
              <StudioSwitch
                id="studio-watermark-switch"
                label={t.watermarkLabel}
                hint={t.watermarkHint}
                checked={showOverlays && watermarkEnabled}
                onToggle={handleToggleWatermark}
                icon={<WatermarkIcon size={14} className="shrink-0 text-[var(--accent)]" />}
              />
            </div>

            {/* Outro Switch */}
            <div>
              <StudioSwitch
                id="studio-outro-switch"
                label={t.outroLabel}
                hint={t.outroHint}
                checked={showOverlays && outroEnabled}
                onToggle={handleToggleOutro}
              />
            </div>
          </div>

          {/* Live Render Spec Readout (IBM Plex Mono) */}
          <div className="mt-4 rounded-[12px] bg-[var(--surface-2)] p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="font-mono-spec text-[11px] font-medium uppercase tracking-wider text-[var(--ink-muted)]">
                {t.specsTitle}
              </span>
              <AudioWaveIcon size={14} className="text-[var(--accent)]" />
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 font-mono-spec text-xs">
              <div>
                <dt className="text-[10px] text-[var(--ink-muted)]">{t.specResolution}</dt>
                <dd className="font-medium text-[var(--ink)]">{RESOLUTION_MAP[aspect]}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-[var(--ink-muted)]">{t.specReframe}</dt>
                <dd className="truncate font-medium text-[var(--ink)]">
                  {activeReframeSpec.label}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] text-[var(--ink-muted)]">{t.specFont}</dt>
                <dd className="truncate font-medium text-[var(--ink)]">
                  {showOverlays && hookEnabled ? "Montserrat" : activePreset.fontLabel}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] text-[var(--ink-muted)]">{t.specLoudness}</dt>
                <dd className="font-medium text-[var(--ink)]">{t.specAudioValue}</dd>
              </div>
              <div className="col-span-2 pt-1">
                <dt className="text-[10px] text-[var(--ink-muted)]">{t.specCodec}</dt>
                <dd className="font-medium text-[var(--ink)]">{t.specCodecValue}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
