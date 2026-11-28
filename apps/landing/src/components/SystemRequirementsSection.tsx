import { useState } from "react"
import type { DownloadPlatform } from "../data/site-config.ts"
import type { LandingCopy } from "../data/translations.ts"
import { AppleIcon, WindowsIcon } from "./Icons.tsx"
import { Reveal } from "./Reveal.tsx"

export interface SystemRequirementsSectionProps {
  requirements: LandingCopy["systemRequirements"]
}

export function SystemRequirementsSection({
  requirements,
}: SystemRequirementsSectionProps) {
  const [activeOs, setActiveOs] = useState<DownloadPlatform>("macos")
  const spec = requirements.platforms[activeOs]

  return (
    <section
      id="requirements"
      aria-labelledby="requirements-heading"
      className="scroll-mt-16 py-16 sm:py-20"
    >
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <Reveal>
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <p className="font-mono-spec text-xs font-medium uppercase tracking-widest text-[var(--accent)]">
                {requirements.kicker}
              </p>
              <h2
                id="requirements-heading"
                className="font-display mt-3 text-3xl font-semibold leading-[1.12] text-[var(--ink)] sm:text-4xl"
              >
                {requirements.heading}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-[var(--ink-muted)]">
                {requirements.subheading}
              </p>
            </div>

            <div
              role="tablist"
              aria-label={requirements.tablistLabel}
              className="inline-flex w-fit rounded-[10px] bg-[var(--surface-2)] p-1"
            >
              {(["macos", "windows"] as const).map((os) => {
                const selected = activeOs === os
                return (
                  <button
                    key={os}
                    id={`sysreq-tab-${os}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`sysreq-panel-${os}`}
                    onClick={() => setActiveOs(os)}
                    className={`inline-flex min-h-[44px] items-center gap-2 rounded-[8px] px-4 text-sm font-medium transition-colors sm:min-h-[38px] ${
                      selected
                        ? "bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-xs"
                        : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {os === "macos" ? (
                      <AppleIcon size={15} />
                    ) : (
                      <WindowsIcon size={14} />
                    )}
                    <span>{requirements.tabs[os]}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </Reveal>

        <Reveal delayMs={70}>
          <div
            id={`sysreq-panel-${activeOs}`}
            role="tabpanel"
            aria-labelledby={`sysreq-tab-${activeOs}`}
            className="mt-8"
          >
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Minimum */}
              <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)] sm:p-6">
                <div className="flex items-center justify-between gap-3 pb-4">
                  <h3 className="font-display text-lg font-semibold text-[var(--ink)]">
                    {requirements.minimumTitle}
                  </h3>
                  <span className="font-mono-spec rounded-[6px] bg-[var(--surface-2)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-muted)]">
                    {requirements.minimumTag}
                  </span>
                </div>

                <dl className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                  {spec.minimum.map((row) => (
                    <div
                      key={row.label}
                      className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-12 sm:gap-4"
                    >
                      <dt className="font-mono-spec text-xs uppercase tracking-wider text-[var(--ink-muted)] sm:col-span-4 sm:pt-0.5">
                        {row.label}
                      </dt>
                      <dd className="text-sm leading-relaxed text-[var(--ink)] sm:col-span-8">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Recommended */}
              <div className="rounded-[14px] border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)] sm:p-6">
                <div className="flex items-center justify-between gap-3 pb-4">
                  <h3 className="font-display text-lg font-semibold text-[var(--ink)]">
                    {requirements.recommendedTitle}
                  </h3>
                  <span className="font-mono-spec rounded-[6px] bg-[var(--accent-solid)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent-ink)]">
                    {requirements.recommendedTag}
                  </span>
                </div>

                <dl className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                  {spec.recommended.map((row) => (
                    <div
                      key={row.label}
                      className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-12 sm:gap-4"
                    >
                      <dt className="font-mono-spec text-xs uppercase tracking-wider text-[var(--ink-muted)] sm:col-span-4 sm:pt-0.5">
                        {row.label}
                      </dt>
                      <dd className="text-sm leading-relaxed text-[var(--ink)] sm:col-span-8">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            <p className="font-mono-spec mt-4 text-xs text-[var(--ink-muted)]">
              {spec.note}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
