import { useEffect, useMemo, useState } from "react"
import { SITE_CONFIG } from "./data/site-config.ts"
import type { DownloadPlatform } from "./data/site-config.ts"
import {
  CAPTION_PRESETS,
  CLEAN_FACECAM_CLIP,
  MARQUEE_CLIPS,
  REFRAME_MODES,
  SAMPLE_LINES,
  SHOWCASE_CLIPS,
  SHOWCASE_CLIPS_BY_MODE,
} from "./data/studio-presets.ts"
import { TRANSLATIONS } from "./data/translations.ts"
import type { Locale } from "./data/translations.ts"
import { DonateDialog, DownloadDialog } from "./components/ActionDialogs.tsx"
import { ArchitectureSection } from "./components/ArchitectureSection.tsx"
import { ClipStudio } from "./components/ClipStudio.tsx"
import type {
  CaptionPresetSpec,
  ClipStudioLabels,
  ReframeModeSpec,
} from "./components/ClipStudio.tsx"
import { DownloadDonateSection } from "./components/DownloadDonateSection.tsx"
import { FaqSection } from "./components/FaqSection.tsx"
import { Footer } from "./components/Footer.tsx"
import { HeroMonitor } from "./components/HeroMonitor.tsx"
import type { HeroMonitorLabels } from "./components/HeroMonitor.tsx"
import { ExternalLinkIcon, GlobeIcon, PlayIcon } from "./components/Icons.tsx"
import { MarqueeShowcaseSection } from "./components/MarqueeShowcaseSection.tsx"
import { Navbar } from "./components/Navbar.tsx"
import type { ThemeMode } from "./components/Navbar.tsx"
import { Reveal } from "./components/Reveal.tsx"
import { DemoSection } from "./components/DemoSection.tsx"
import { SystemRequirementsSection } from "./components/SystemRequirementsSection.tsx"
import { WebDemoCtaSection } from "./components/WebDemoCtaSection.tsx"

const THEME_STORAGE_KEY = "dartclip-landing-theme"
const LOCALE_STORAGE_KEY = "dartclip-landing-locale"

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark"
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === "light" || saved === "dark") return saved
  } catch {
    // Ignore storage access errors
  }
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

function getInitialLocale(): Locale {
  if (typeof window === "undefined") return "id"
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved === "id" || saved === "en") return saved
  } catch {
    // Ignore storage access errors
  }
  return "id"
}

export function App() {
  const [locale, setLocale] = useState<Locale>(getInitialLocale)
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const [downloadPlatform, setDownloadPlatform] = useState<DownloadPlatform | null>(null)
  const [donateOpen, setDonateOpen] = useState<boolean>(false)

  const copy = TRANSLATIONS[locale]

  // Sync theme to document root and storage
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Ignore storage access errors
    }
  }, [theme])

  // Sync locale to document lang, title, meta description, and storage
  useEffect(() => {
    document.documentElement.lang = locale
    document.title = copy.meta.title
    const metaDesc = document.querySelector('meta[name="description"]')
    if (metaDesc) {
      metaDesc.setAttribute("content", copy.meta.description)
    }
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    } catch {
      // Ignore storage access errors
    }
  }, [locale, copy.meta.title, copy.meta.description])

  const heroMonitorLabels = useMemo<Partial<HeroMonitorLabels>>(
    () => ({
      realRenderBadge: copy.hero.monitorLabels.realRenderBadge,
      playLabel: locale === "id" ? "Putar" : "Play",
      pauseLabel: locale === "id" ? "Jeda" : "Pause",
      playAria: copy.hero.monitorLabels.play,
      pauseAria: copy.hero.monitorLabels.pause,
      muteAria: copy.hero.monitorLabels.mute,
      unmuteAria: copy.hero.monitorLabels.unmute,
      clipSwitcherAria: copy.hero.monitorLabels.scene,
      platformViewLabel: copy.hero.monitorLabels.platformView,
      platformSwitcherAria: copy.hero.monitorLabels.platformSwitcherAria,
    }),
    [copy.hero.monitorLabels, locale],
  )

  const studioReframeModes = useMemo<readonly ReframeModeSpec[]>(
    () =>
      REFRAME_MODES.map((mode) => ({
        id: mode.id,
        label: locale === "id" ? mode.labelId : mode.labelEn,
        shortDesc: locale === "id" ? mode.descriptionId : mode.descriptionEn,
        verticalOnly: mode.aspectRatios.length === 1 && mode.aspectRatios[0] === "9:16",
        aspectRatios: mode.aspectRatios,
      })),
    [locale],
  )

  const studioCaptionPresets = useMemo<readonly CaptionPresetSpec[]>(
    () =>
      CAPTION_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        fontFamily: `"${preset.fontFamily}", sans-serif`,
        fontLabel: preset.fontFamily,
        primaryColor: preset.textColor,
        highlightColor: preset.highlightColor,
        outlineColor: preset.outlineColor,
        effect: preset.effect,
        uppercase: preset.uppercase,
        animate: preset.animate,
      })),
    [],
  )

  const studioLabels = useMemo<Partial<ClipStudioLabels>>(
    () => ({
      aspectTitle: copy.studio.aspectRatio,
      aspectGroupAria: copy.studio.aspectRatio,
      reframeTitle: copy.studio.reframeMode,
      reframeGroupAria: copy.studio.reframeMode,
      verticalOnlyNote: locale === "id" ? "Khusus 9:16" : "9:16 only",
      captionTitle: copy.studio.captionPreset,
      captionGroupAria: copy.studio.captionPreset,
      stageLabel: locale === "id" ? "Mode pratinjau studio" : "Studio preview mode",
      realOutputLabel: copy.studio.realOutputLabel,
      overlayPreviewLabel: copy.studio.overlayPreviewLabel,
      realRenderNote: copy.studio.realRenderNote,
      illustrationBadge: copy.studio.illustrationBadge,
      illustrationNote: copy.studio.illustrationNote,
      playCaptionLabel: locale === "id" ? "Putar" : "Play",
      pauseCaptionLabel: locale === "id" ? "Jeda" : "Pause",
      playCaptionAria: copy.studio.playbackToggle,
      pauseCaptionAria: copy.studio.playbackToggle,
      muteAria: copy.studio.muteLabel,
      unmuteAria: copy.studio.unmuteLabel,
      hookToggleLabel: copy.studio.hookToggle,
      hookToggleHint:
        locale === "id"
          ? "Kartu 0,9 detik Montserrat Bold dua warna dengan aksen kuning"
          : "0.9s two-tone Montserrat Bold intro card with yellow accent",
      hookInputLabel: copy.studio.hookInputLabel,
      hookInputPlaceholder: copy.studio.hookInputPlaceholder,
      hookEmptyAlert: copy.studio.hookEmptyError,
      hookEmptyBadge: locale === "id" ? "TEKS KOSONG" : "EMPTY HOOK",
      hookEmptyStageNote: copy.studio.hookEmptyError,
      hookResetLabel: copy.studio.resetLabel,
      hookIntroBadge: locale === "id" ? "0.0d - 0.9d KARTU PEMBUKA" : "0.0s - 0.9s HOOK INTRO",
      safeZoneLabel: copy.studio.safeZoneToggle,
      safeZoneHint:
        locale === "id"
          ? "Batas aman antarmuka TikTok, Reels, dan Shorts"
          : "TikTok, Reels, and Shorts UI overlap boundary guide",
      safeZoneTopLabel: "STATUS / NAV",
      safeZoneActionLabel: locale === "id" ? "AKSI" : "ACTIONS",
      safeZoneBottomLabel: locale === "id" ? "DESKRIPSI & AUDIO" : "CAPTION & AUDIO",
      watermarkLabel: copy.studio.watermarkToggle,
      watermarkHint:
        locale === "id"
          ? "Label identitas di sudut kiri atas klip"
          : "Channel handle badge anchored top-left",
      outroLabel: copy.studio.outroToggle,
      outroHint:
        locale === "id"
          ? "Sambungkan klip penutup 3 detik di akhir video"
          : "Append a 3-second closing clip tail on render",
      outroTailBadge: locale === "id" ? "+ Outro 3.0d" : "+ Outro 3.0s",
      clipTimelineBadge: locale === "id" ? "Klip Utama 10.0d" : "Main Clip 10.0s",
      specsTitle: locale === "id" ? "Spesifikasi Render" : "Render Specs",
      specResolution: copy.studio.specs.aspectRatio,
      specReframe: copy.studio.specs.reframeMode,
      specFont: copy.studio.specs.captionPreset,
      specLoudness: copy.studio.specs.audio,
      specAudioValue: locale === "id" ? "Audio seimbang" : "Balanced audio",
      specCodec: "Format",
      specCodecValue: locale === "id" ? "MP4 · Siap unggah" : "MP4 · Ready to post",
    }),
    [copy.studio, locale],
  )

  const defaultHookText =
    locale === "id"
      ? "MOMEN INI BIKIN SATU STREAM KAGET"
      : "THIS ONE MOMENT FLIPPED THE MATCH"

  return (
    <div id="top" className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <Navbar
        copy={copy}
        locale={locale}
        theme={theme}
        onToggleLocale={() => setLocale((prev) => (prev === "id" ? "en" : "id"))}
        onToggleTheme={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
      />

      <main id="main-content">
        {/* HERO SECTION: Asymmetric 12-col split, staggered entrance, real rendered clips */}
        <section className="py-12 sm:py-16 lg:py-20">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-10">
              {/* Left 5 cols: Editorial Headline + CTAs */}
              <div className="lg:col-span-5">
                <h1 className="hero-stagger-1 font-display text-[clamp(2.25rem,4.4vw,3.75rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-[var(--ink)]">
                  {copy.hero.headlineBefore}{" "}
                  <em className="font-editorial font-normal italic text-[var(--accent)]">
                    {copy.hero.headlineAccent}
                  </em>{" "}
                  {copy.hero.headlineAfter}
                </h1>

                <p className="hero-stagger-2 mt-5 max-w-lg text-base leading-relaxed text-[var(--ink-muted)] sm:text-[17px]">
                  {copy.hero.subheadline}
                </p>

                <div className="hero-stagger-3 mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <a
                    href="#download"
                    data-umami-event="cta_download_hero"
                    className="inline-flex min-h-[46px] items-center justify-center rounded-[10px] bg-[var(--accent-solid)] px-6 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-hover)]"
                  >
                    {copy.hero.primaryCta}
                  </a>

                  <a
                    href={SITE_CONFIG.webDemoHeroUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-umami-event="cta_web_demo_hero"
                    className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface)] px-5 text-sm font-semibold text-[var(--ink)] shadow-[var(--card-shadow)] transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <GlobeIcon size={15} className="text-[var(--accent)]" />
                    <span>{copy.hero.secondaryCta}</span>
                    <ExternalLinkIcon size={13} className="text-[var(--ink-muted)]" />
                  </a>
                </div>

                <div className="hero-stagger-4 mt-3.5">
                  <a
                    href="#demo"
                    data-umami-event="cta_watch_demo_hero"
                    className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-medium text-[var(--ink-subtle)] underline-offset-4 transition-colors hover:text-[var(--ink)] hover:underline sm:min-h-[32px]"
                  >
                    <PlayIcon size={12} className="text-[var(--accent)]" />
                    <span>{copy.hero.watchDemoCta}</span>
                  </a>
                </div>

                <p className="hero-stagger-4 font-mono-spec mt-3 text-xs text-[var(--ink-muted)]">
                  {copy.hero.metaLine}
                </p>
              </div>

              {/* Right 7 cols: Real DartClip Rendered Vertical Clips */}
              <div className="hero-stagger-4 lg:col-span-7">
                <HeroMonitor
                  clips={SHOWCASE_CLIPS}
                  locale={locale}
                  labels={heroMonitorLabels}
                />
              </div>
            </div>
          </div>
        </section>

        {/* LIGHTWEIGHT NON-CLICKABLE GENERATED CLIPS MARQUEE */}
        <MarqueeShowcaseSection
          copy={copy.marquee}
          clips={MARQUEE_CLIPS}
          locale={locale}
        />

        {/* INTERACTIVE CLIP STUDIO SECTION */}
        <section
          id="studio"
          aria-labelledby="studio-heading"
          className="scroll-mt-16 py-20 sm:py-24"
        >
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
            <Reveal>
              <div className="max-w-2xl">
                <p className="font-mono-spec text-xs font-medium uppercase tracking-widest text-[var(--accent)]">
                  {copy.studio.kicker}
                </p>
                <h2
                  id="studio-heading"
                  className="font-display mt-3 text-3xl font-semibold leading-[1.12] text-[var(--ink)] sm:text-4xl"
                >
                  {copy.studio.heading}
                </h2>
                <p className="mt-3 text-base leading-relaxed text-[var(--ink-muted)]">
                  {copy.studio.subheading}
                </p>
              </div>
            </Reveal>

            <Reveal delayMs={80} className="mt-8">
              <ClipStudio
                locale={locale}
                facecamClip={SHOWCASE_CLIPS_BY_MODE.facecam ?? CLEAN_FACECAM_CLIP}
                cleanFacecamClip={CLEAN_FACECAM_CLIP}
                reframeModes={studioReframeModes}
                captionPresets={studioCaptionPresets}
                sampleWords={SAMPLE_LINES[locale]}
                defaultHookText={defaultHookText}
                watermarkHandle="@dartclip"
                labels={studioLabels}
              />
            </Reveal>
          </div>
        </section>

        {/* PLATFORM DEMO VIDEO WITH 4 CLICKABLE CHAPTERS */}
        <DemoSection demo={copy.demo} />

        {/* WEB PLATFORM DEMO CTA BAND */}
        <WebDemoCtaSection webDemo={copy.webDemo} />

        {/* 5-COLUMN ACCESS-MODEL COMPARISON */}
        <ArchitectureSection architecture={copy.architecture} />

        {/* FOCUSED FREE DOWNLOAD + SELF-HOSTED + CALM OPTIONAL DONATE STRIP */}
        <DownloadDonateSection
          download={copy.download}
          donate={copy.donate}
          onDownload={(platform) => setDownloadPlatform(platform)}
          onOpenDonate={() => setDonateOpen(true)}
        />

        {/* DESKTOP SYSTEM REQUIREMENTS SECTION */}
        <SystemRequirementsSection requirements={copy.systemRequirements} />

        {/* NUMBERED FAQ ACCORDION */}
        <FaqSection faq={copy.faq} />
      </main>

      {/* CLOSING ACTION BAND + COMPACT 2-GROUP FOOTER */}
      <Footer
        copy={copy}
        theme={theme}
        onOpenDonate={() => setDonateOpen(true)}
      />

      {/* ACCESSIBLE ACTION DIALOGS */}
      <DownloadDialog
        platform={downloadPlatform}
        copy={copy.download}
        onClose={() => setDownloadPlatform(null)}
      />

      <DonateDialog
        open={donateOpen}
        locale={locale}
        copy={copy.donate}
        onClose={() => setDonateOpen(false)}
      />
    </div>
  )
}

export default App
