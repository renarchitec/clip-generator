import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { SITE_CONFIG } from "../data/site-config.ts"
import type { DownloadPlatform } from "../data/site-config.ts"
import type { LandingCopy, Locale } from "../data/translations.ts"
import {
  AppleIcon,
  CheckIcon,
  CloseIcon,
  CoffeeCupIcon,
  CopyIcon,
  ExternalLinkIcon,
  GithubIcon,
  WindowsIcon,
} from "./Icons.tsx"

const CLONE_COMMAND = `git clone ${SITE_CONFIG.repoUrl}.git`

async function copyTextSafely(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fallback below
  }

  try {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

interface ModalFrameProps {
  open: boolean
  titleId: string
  closeLabel: string
  onClose: () => void
  children: ReactNode
}

function ModalFrame({
  open,
  titleId,
  closeLabel,
  onClose,
  children,
}: ModalFrameProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return

    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    closeBtnRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4 backdrop-blur-[2px] dark:backdrop-blur-none"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-dialog-in relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[16px] bg-[var(--surface)] p-5 text-[var(--ink)] shadow-[var(--modal-shadow)] sm:p-6"
      >
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute right-4 top-4 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[8px] bg-[var(--surface-2)] text-[var(--ink-subtle)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
        >
          <CloseIcon size={17} />
        </button>

        {children}
      </div>
    </div>
  )
}

export interface DownloadDialogProps {
  platform: DownloadPlatform | null
  copy: LandingCopy["download"]
  onClose: () => void
}

export function DownloadDialog({
  platform,
  copy,
  onClose,
}: DownloadDialogProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setCopied(false)
  }, [platform])

  const config = platform ? SITE_CONFIG.downloads[platform] : null
  const isReady = Boolean(config?.url)
  const platformTitle = platform === "windows" ? copy.windowsCard.title : copy.macosCard.title

  const handleCopyCommand = async () => {
    const ok = await copyTextSafely(CLONE_COMMAND)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2400)
    }
  }

  return (
    <ModalFrame
      open={platform !== null}
      titleId="download-dialog-title"
      closeLabel={copy.dialog.closeLabel}
      onClose={onClose}
    >
      {platform && config && (
        <div className="pr-10">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent)]">
              {platform === "macos" ? <AppleIcon size={18} /> : <WindowsIcon size={17} />}
            </span>
            <div>
              <h2
                id="download-dialog-title"
                className="font-display text-xl font-semibold leading-tight text-[var(--ink)]"
              >
                {copy.dialog.title}: {platformTitle}
              </h2>
              <p className="font-mono-spec text-xs text-[var(--ink-muted)]">
                {SITE_CONFIG.version} · {config.arch}
              </p>
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-[var(--ink-muted)]">
            {isReady ? copy.dialog.subtitleReady : copy.dialog.subtitleNotReady}
          </p>

          {/* Release file telemetry box */}
          <div className="mt-4 rounded-[12px] bg-[var(--surface-2)] p-3.5 font-mono-spec text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[var(--ink-muted)]">Target</span>
              <span className="font-medium text-[var(--ink)]">{config.filename}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2">
              <span className="text-[var(--ink-muted)]">Arch</span>
              <span className="text-[var(--ink)]">{config.arch}</span>
            </div>
          </div>

          {isReady && config.url ? (
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <a
                href={config.url}
                download={config.filename}
                data-umami-event={platform === "macos" ? "download_file_macos" : "download_file_windows"}
                className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-[10px] bg-[var(--accent-solid)] px-4 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-hover)]"
              >
                <span>
                  {platform === "macos" ? copy.macosCard.cta : copy.windowsCard.cta}
                </span>
              </a>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {/* Clone command readout */}
              <div className="rounded-[10px] bg-[var(--bg)] p-3">
                <code className="font-mono-spec block overflow-x-auto text-xs text-[var(--ink)]">
                  {CLONE_COMMAND}
                </code>
              </div>

              <div className="flex flex-col gap-2.5 sm:flex-row">
                <a
                  href={SITE_CONFIG.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-[10px] bg-[var(--accent-solid)] px-4 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-hover)]"
                >
                  <GithubIcon size={16} />
                  <span>{copy.dialog.repoCta}</span>
                  <ExternalLinkIcon size={14} />
                </a>

                <button
                  type="button"
                  onClick={handleCopyCommand}
                  className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[10px] bg-[var(--surface-2)] px-4 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                >
                  {copied ? (
                    <>
                      <CheckIcon size={15} className="text-[var(--accent)]" />
                      <span>{copy.dialog.copiedLabel}</span>
                    </>
                  ) : (
                    <>
                      <CopyIcon size={15} />
                      <span>{copy.dialog.copyCommandLabel}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </ModalFrame>
  )
}

export interface DonateDialogProps {
  open: boolean
  locale: Locale
  copy: LandingCopy["donate"]
  onClose: () => void
}

export function DonateDialog({
  open,
  locale,
  copy,
  onClose,
}: DonateDialogProps) {
  const hasActiveChannel =
    Boolean(SITE_CONFIG.donate.primaryUrl) ||
    SITE_CONFIG.donate.channels.some((channel) => Boolean(channel.url))
  const qrChannels = SITE_CONFIG.donate.channels.filter(
    (channel) => Boolean(channel.url) && Boolean(channel.qrSrc),
  )
  const listChannels = SITE_CONFIG.donate.channels.filter(
    (channel) => !(Boolean(channel.url) && Boolean(channel.qrSrc)),
  )

  return (
    <ModalFrame
      open={open}
      titleId="donate-dialog-title"
      closeLabel={copy.dialog.closeLabel}
      onClose={onClose}
    >
      <div className="pr-10">
        <div className="coffee-trigger flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent)]">
            <CoffeeCupIcon size={19} steaming />
          </span>
          <h2
            id="donate-dialog-title"
            className="font-display text-xl font-semibold leading-tight text-[var(--ink)]"
          >
            {copy.dialog.title}
          </h2>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">
          {hasActiveChannel ? copy.dialog.subtitleReady : copy.dialog.subtitleNotReady}
        </p>
      </div>

      {/* QR Code Card for active channels with QR image */}
      {qrChannels.map((channel) => {
        const note = locale === "id" ? channel.noteId : channel.noteEn
        const displayUrl = channel.url?.replace(/^https?:\/\//, "") ?? ""
        return (
          <div
            key={channel.id}
            className="mt-4 flex flex-col items-center rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-5 text-center"
          >
            <div className="inline-flex rounded-[12px] bg-white p-3 shadow-sm">
              <img
                src={channel.qrSrc}
                alt={copy.dialog.qrAlt}
                width={196}
                height={196}
                className="h-[196px] w-[196px] rounded-[4px] object-contain"
              />
            </div>
            <p className="mt-3.5 text-sm font-semibold text-[var(--ink)]">
              {channel.name}
            </p>
            {displayUrl && (
              <p className="font-mono-spec mt-0.5 text-xs text-[var(--ink-muted)]">
                {displayUrl}
              </p>
            )}
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-muted)]">
              {copy.dialog.qrHint}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]/85">
              {note}
            </p>
          </div>
        )
      })}

      {/* Primary Donation Link when configured */}
      {SITE_CONFIG.donate.primaryUrl && (
        <a
          href={SITE_CONFIG.donate.primaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-umami-event="cta_donate_saweria"
          className="coffee-trigger mt-4 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--accent-solid)] px-4 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-hover)]"
        >
          <CoffeeCupIcon size={16} />
          <span>{copy.dialog.openChannelCta}</span>
          <ExternalLinkIcon size={15} />
        </a>
      )}

      {/* Additional Donation Channels List */}
      {listChannels.length > 0 && (
        <ul className="mt-4 space-y-2">
          {listChannels.map((channel) => {
            const note = locale === "id" ? channel.noteId : channel.noteEn
            if (channel.url) {
              return (
                <li key={channel.id}>
                  <a
                    href={channel.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-[56px] items-center justify-between gap-3 rounded-[10px] bg-[var(--surface-2)] px-4 py-3 transition-colors hover:bg-[var(--accent-soft)]"
                  >
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink)]">
                        {channel.name}
                      </p>
                      <p className="text-xs text-[var(--ink-muted)]">{note}</p>
                    </div>
                    <ExternalLinkIcon size={16} className="shrink-0 text-[var(--accent)]" />
                  </a>
                </li>
              )
            }

            return (
              <li
                key={channel.id}
                aria-disabled="true"
                className="flex min-h-[56px] items-center justify-between gap-3 rounded-[10px] bg-[var(--surface-2)]/70 px-4 py-3 opacity-75"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--ink)]">{channel.name}</p>
                  <p className="text-xs text-[var(--ink-muted)]">{note}</p>
                </div>
                <span className="font-mono-spec shrink-0 rounded-[6px] bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]">
                  {copy.dialog.channelNotReadyBadge}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {/* Plain GitHub link footer */}
      <div className="mt-3">
        <a
          href={SITE_CONFIG.repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--surface-2)] px-4 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
        >
          <GithubIcon size={16} />
          <span>{copy.dialog.repoCta}</span>
          <ExternalLinkIcon size={14} />
        </a>
      </div>
    </ModalFrame>
  )
}
