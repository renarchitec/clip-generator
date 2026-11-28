import { SITE_CONFIG } from "../data/site-config.ts"
import type { LandingCopy } from "../data/translations.ts"
import { CheckIcon, ExternalLinkIcon, GlobeIcon } from "./Icons.tsx"
import { Reveal } from "./Reveal.tsx"

export interface WebDemoCtaSectionProps {
  webDemo: LandingCopy["webDemo"]
}

const WEB_DEMO_HOST = new URL(SITE_CONFIG.webAppUrl).host

export function WebDemoCtaSection({ webDemo }: WebDemoCtaSectionProps) {
  return (
    <section
      id="web-demo"
      aria-labelledby="web-demo-heading"
      className="scroll-mt-16 py-12 sm:py-16"
    >
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <Reveal>
          <div className="overflow-hidden rounded-[16px] border border-[var(--border-strong)] bg-[var(--surface)] p-6 shadow-[var(--card-shadow)] sm:p-8 lg:p-10">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center lg:gap-10">
              {/* Left 7 cols: Value prop + transparent demo limits */}
              <div className="lg:col-span-7">
                <div className="flex flex-wrap items-center gap-2.5">
                  <p className="font-mono-spec text-xs font-medium uppercase tracking-widest text-[var(--accent)]">
                    {webDemo.kicker}
                  </p>
                  <span className="font-mono-spec rounded-[6px] bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-subtle)]">
                    {webDemo.badge}
                  </span>
                </div>

                <h2
                  id="web-demo-heading"
                  className="font-display mt-3 text-2xl font-semibold leading-[1.14] text-[var(--ink)] sm:text-3xl"
                >
                  {webDemo.heading}
                </h2>

                <p className="mt-3 max-w-2xl text-base leading-relaxed text-[var(--ink-muted)]">
                  {webDemo.subheading}
                </p>

                <ul className="mt-5 space-y-2.5">
                  {webDemo.highlights.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2.5 text-sm leading-relaxed text-[var(--ink-subtle)]"
                    >
                      <CheckIcon
                        size={15}
                        className="mt-1 shrink-0 text-[var(--accent)]"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Right 5 cols: Focused Launch Card */}
              <div className="lg:col-span-5">
                <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)]/75 p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card-shadow)]">
                        <GlobeIcon size={18} />
                      </span>
                      <div>
                        <p className="font-display text-sm font-semibold text-[var(--ink)]">
                          {webDemo.panelTitle}
                        </p>
                        <p className="font-mono-spec text-xs text-[var(--ink-muted)]">
                          {WEB_DEMO_HOST}
                        </p>
                      </div>
                    </div>
                  </div>

                  <dl className="mt-4 divide-y divide-[var(--border)] border-t border-[var(--border)]">
                    {webDemo.metaRows.map((row) => (
                      <div
                        key={row.label}
                        className="flex items-baseline justify-between gap-4 py-2.5 text-xs"
                      >
                        <dt className="font-mono-spec uppercase tracking-wider text-[var(--ink-muted)]">
                          {row.label}
                        </dt>
                        <dd className="text-right font-medium text-[var(--ink)]">
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <a
                    href={SITE_CONFIG.webDemoRegisterUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-umami-event="cta_web_demo_section"
                    className="mt-5 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--accent-solid)] px-4 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-hover)]"
                  >
                    <span>{webDemo.primaryCta}</span>
                    <ExternalLinkIcon size={15} />
                  </a>

                  <a
                    href="#download"
                    data-umami-event="cta_web_demo_to_download"
                    className="mt-2.5 inline-flex min-h-[40px] w-full items-center justify-center text-xs font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
                  >
                    {webDemo.secondaryCta}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
