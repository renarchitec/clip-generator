import { SITE_CONFIG } from "../data/site-config.ts"
import type { DownloadPlatform } from "../data/site-config.ts"
import type { LandingCopy } from "../data/translations.ts"
import {
  AppleIcon,
  CheckIcon,
  CoffeeCupIcon,
  ExternalLinkIcon,
  ServerIcon,
  WindowsIcon,
} from "./Icons.tsx"
import { Reveal } from "./Reveal.tsx"

export interface DownloadDonateSectionProps {
  download: LandingCopy["download"]
  donate: LandingCopy["donate"]
  onDownload: (platform: DownloadPlatform) => void
  onOpenDonate: () => void
}

export function DownloadDonateSection({
  download,
  donate,
  onDownload,
  onOpenDonate,
}: DownloadDonateSectionProps) {
  return (
    <section
      id="download"
      aria-labelledby="download-heading"
      className="scroll-mt-16 py-20 sm:py-24"
    >
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        {/* Section Header + Honest Free Note */}
        <Reveal>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end lg:gap-10">
            <div className="lg:col-span-7">
              <p className="font-mono-spec text-xs font-medium uppercase tracking-widest text-[var(--accent)]">
                {download.kicker}
              </p>
              <h2
                id="download-heading"
                className="font-display mt-3 text-3xl font-semibold leading-[1.12] text-[var(--ink)] sm:text-4xl"
              >
                {download.heading}
              </h2>
              <p className="mt-3 max-w-xl text-base leading-relaxed text-[var(--ink-muted)]">
                {download.subheading}
              </p>
            </div>

            <div className="lg:col-span-5">
              <div className="flex items-start gap-2.5 rounded-[12px] bg-[var(--accent-soft)] px-4 py-3.5 text-sm leading-relaxed text-[var(--ink-subtle)]">
                <CheckIcon size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                <span>{download.freeNote}</span>
              </div>
            </div>
          </div>
        </Reveal>

        {/* 3-Card Distribution Grid: macOS + Windows + Self-hosted */}
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 lg:items-stretch">
          {/* macOS Card */}
          <Reveal delayMs={40} className="h-full">
            <div className="flex h-full flex-col justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)] sm:p-6">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--surface-2)] text-[var(--ink)]">
                    <AppleIcon size={20} />
                  </span>
                  <span className="font-mono-spec rounded-[6px] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--ink-muted)]">
                    {SITE_CONFIG.version}
                  </span>
                </div>

                <h3 className="font-display mt-4 text-xl font-semibold text-[var(--ink)]">
                  {download.macosCard.title}
                </h3>
                <p className="font-mono-spec mt-1 text-xs text-[var(--ink-muted)]">
                  {SITE_CONFIG.downloads.macos.arch}
                </p>
                <p className="mt-2.5 text-sm leading-relaxed text-[var(--ink-muted)]">
                  {download.macosCard.description}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onDownload("macos")}
                data-umami-event="cta_download_macos"
                className="mt-6 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--accent-solid)] px-4 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-hover)]"
              >
                <AppleIcon size={16} />
                <span>{download.macosCard.cta}</span>
              </button>
            </div>
          </Reveal>

          {/* Windows Card */}
          <Reveal delayMs={90} className="h-full">
            <div className="flex h-full flex-col justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)] sm:p-6">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--surface-2)] text-[var(--ink)]">
                    <WindowsIcon size={18} />
                  </span>
                  <span className="font-mono-spec rounded-[6px] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--ink-muted)]">
                    {SITE_CONFIG.version}
                  </span>
                </div>

                <h3 className="font-display mt-4 text-xl font-semibold text-[var(--ink)]">
                  {download.windowsCard.title}
                </h3>
                <p className="font-mono-spec mt-1 text-xs text-[var(--ink-muted)]">
                  {SITE_CONFIG.downloads.windows.arch}
                </p>
                <p className="mt-2.5 text-sm leading-relaxed text-[var(--ink-muted)]">
                  {download.windowsCard.description}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onDownload("windows")}
                data-umami-event="cta_download_windows"
                className="mt-6 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--surface-2)] px-4 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              >
                <WindowsIcon size={15} />
                <span>{download.windowsCard.cta}</span>
              </button>
            </div>
          </Reveal>

          {/* Self-hosted Card */}
          <Reveal delayMs={140} className="h-full md:col-span-2 lg:col-span-1">
            <div className="flex h-full flex-col justify-between rounded-[14px] border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)] sm:p-6">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--surface-2)] text-[var(--ink)]">
                    <ServerIcon size={19} />
                  </span>
                  <span className="font-mono-spec rounded-[6px] bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink-subtle)]">
                    {download.selfHostedCard.badge}
                  </span>
                </div>

                <h3 className="font-display mt-4 text-xl font-semibold text-[var(--ink)]">
                  {download.selfHostedCard.title}
                </h3>
                <p className="font-mono-spec mt-1 text-xs text-[var(--ink-muted)]">
                  {download.selfHostedCard.arch}
                </p>
                <p className="mt-2.5 text-sm leading-relaxed text-[var(--ink-muted)]">
                  {download.selfHostedCard.description}
                </p>
              </div>

              <a
                href={SITE_CONFIG.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-umami-event="cta_self_host_github"
                className="mt-6 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-2)]/70 px-4 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <span>{download.selfHostedCard.cta}</span>
                <ExternalLinkIcon size={14} />
              </a>
            </div>
          </Reveal>
        </div>

        {/* Jump link to dedicated Desktop System Requirements section */}
        <Reveal delayMs={160}>
          <div className="mt-4 flex justify-end">
            <a
              href="#requirements"
              className="font-mono-spec inline-flex min-h-[36px] items-center gap-1.5 text-xs text-[var(--ink-muted)] underline-offset-4 transition-colors hover:text-[var(--ink)] hover:underline"
            >
              <span>{download.requirementsJumpLabel}</span>
              <span aria-hidden="true">↓</span>
            </a>
          </div>
        </Reveal>

        {/* Interactive Buy Me a Coffee Strip */}
        <Reveal delayMs={180}>
          <div
            id="donate"
            className="coffee-trigger group mt-4 flex flex-col items-start justify-between gap-4 rounded-[14px] bg-[var(--surface-2)]/85 px-5 py-4 transition-colors hover:bg-[var(--surface-2)] sm:flex-row sm:items-center sm:px-6"
          >
            <div className="flex items-start gap-3.5 sm:items-center">
              <span
                aria-hidden="true"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card-shadow)] transition-colors duration-200 group-hover:bg-[var(--accent-solid)] group-hover:text-[var(--accent-ink)] group-focus-within:bg-[var(--accent-solid)] group-focus-within:text-[var(--accent-ink)]"
              >
                <CoffeeCupIcon size={22} />
              </span>
              <div className="max-w-2xl">
                <p className="font-display text-base font-semibold leading-snug text-[var(--ink)]">
                  {donate.heading}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-[var(--ink-muted)]">
                  {donate.inlineNote}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenDonate}
              data-umami-event="cta_donate_open"
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-[10px] bg-[var(--surface)] px-4 text-xs font-semibold text-[var(--ink)] shadow-[var(--card-shadow)] transition-colors hover:bg-[var(--accent-solid)] hover:text-[var(--accent-ink)]"
            >
              <CoffeeCupIcon size={16} />
              <span>{donate.triggerLabel}</span>
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
