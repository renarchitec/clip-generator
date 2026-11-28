import { SITE_CONFIG } from "../data/site-config.ts"
import type { LandingCopy } from "../data/translations.ts"
import { CoffeeCupIcon, ExternalLinkIcon, GithubIcon } from "./Icons.tsx"
import type { ThemeMode } from "./Navbar.tsx"
import { Reveal } from "./Reveal.tsx"

export interface FooterProps {
  copy: LandingCopy
  theme: ThemeMode
  onOpenDonate: () => void
}

export function Footer({ copy, theme, onOpenDonate }: FooterProps) {
  const { closing, footer, nav } = copy

  return (
    <>
      {/* Closing Action Band: Download + GitHub (no Donate push) */}
      <section
        aria-labelledby="closing-heading"
        className="bg-[var(--surface)] py-16 sm:py-20"
      >
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div className="max-w-2xl">
                <h2
                  id="closing-heading"
                  className="font-display text-3xl font-semibold leading-[1.08] text-[var(--ink)] sm:text-4xl lg:text-[42px]"
                >
                  {closing.headingBefore}{" "}
                  <em className="font-editorial font-normal italic text-[var(--accent)]">
                    {closing.headingAccent}
                  </em>
                </h2>
                <p className="mt-3.5 text-base leading-relaxed text-[var(--ink-muted)]">
                  {closing.subheading}
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href="#download"
                  className="inline-flex min-h-[46px] items-center justify-center rounded-[10px] bg-[var(--accent-solid)] px-6 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-hover)]"
                >
                  {closing.downloadCta}
                </a>

                <a
                  href={SITE_CONFIG.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[10px] bg-[var(--surface-2)] px-5 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                >
                  <GithubIcon size={16} />
                  <span>{closing.repoCta}</span>
                  <ExternalLinkIcon size={14} />
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Compact 2-Group Footer */}
      <footer className="bg-[var(--bg)] py-12">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
            {/* Left: Brand Identity */}
            <div className="md:col-span-5">
              <a
                href="#top"
                className="inline-flex min-h-[44px] items-center rounded-[6px]"
                aria-label={nav.brandLabel}
              >
                <img
                  src={theme === "dark" ? "/logo-horizontal-dark.svg" : "/logo-horizontal.svg"}
                  alt="DartClip"
                  width={124}
                  height={34}
                  className="h-[32px] w-auto"
                />
              </a>
              <p className="mt-2.5 max-w-xs text-sm leading-relaxed text-[var(--ink-muted)]">
                {footer.tagline}
              </p>
            </div>

            {/* Right: Strictly 2 Link Groups */}
            <div className="grid grid-cols-2 gap-8 md:col-span-7 md:justify-items-end">
              <div>
                <h3 className="font-mono-spec text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">
                  {footer.productLinksHeading}
                </h3>
                <ul className="mt-3 space-y-1 text-sm">
                  <li>
                    <a
                      href="#studio"
                      className="inline-flex min-h-[44px] items-center text-[var(--ink-subtle)] transition-colors hover:text-[var(--ink)] md:min-h-[36px]"
                    >
                      {nav.links.studio}
                    </a>
                  </li>
                  <li>
                    <a
                      href="#demo"
                      className="inline-flex min-h-[44px] items-center text-[var(--ink-subtle)] transition-colors hover:text-[var(--ink)] md:min-h-[36px]"
                    >
                      {nav.links.demo}
                    </a>
                  </li>
                  <li>
                    <a
                      href="#comparison"
                      className="inline-flex min-h-[44px] items-center text-[var(--ink-subtle)] transition-colors hover:text-[var(--ink)] md:min-h-[36px]"
                    >
                      {nav.links.comparison}
                    </a>
                  </li>
                  <li>
                    <a
                      href="#download"
                      className="inline-flex min-h-[44px] items-center text-[var(--ink-subtle)] transition-colors hover:text-[var(--ink)] md:min-h-[36px]"
                    >
                      {nav.links.download}
                    </a>
                  </li>
                  <li>
                    <a
                      href="#faq"
                      className="inline-flex min-h-[44px] items-center text-[var(--ink-subtle)] transition-colors hover:text-[var(--ink)] md:min-h-[36px]"
                    >
                      {nav.links.faq}
                    </a>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-mono-spec text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">
                  {footer.projectLinksHeading}
                </h3>
                <ul className="mt-3 space-y-1 text-sm">
                  <li>
                    <a
                      href={SITE_CONFIG.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-1.5 text-[var(--ink-subtle)] transition-colors hover:text-[var(--ink)] md:min-h-[36px]"
                    >
                      <span>GitHub</span>
                      <ExternalLinkIcon size={12} />
                    </a>
                  </li>
                  <li>
                    <a
                      href={SITE_CONFIG.webAppUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-1.5 text-[var(--ink-subtle)] transition-colors hover:text-[var(--ink)] md:min-h-[36px]"
                    >
                      <span>{footer.webDemoLabel}</span>
                      <ExternalLinkIcon size={12} />
                    </a>
                  </li>
                  <li>
                    <a
                      href={SITE_CONFIG.privacyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center text-[var(--ink-subtle)] transition-colors hover:text-[var(--ink)] md:min-h-[36px]"
                    >
                      {footer.privacyLabel}
                    </a>
                  </li>
                  <li>
                    <a
                      href={SITE_CONFIG.termsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center text-[var(--ink-subtle)] transition-colors hover:text-[var(--ink)] md:min-h-[36px]"
                    >
                      {footer.termsLabel}
                    </a>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={onOpenDonate}
                      className="coffee-trigger inline-flex min-h-[44px] items-center gap-1.5 text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)] md:min-h-[36px]"
                    >
                      <CoffeeCupIcon size={14} />
                      <span>{footer.donateLabel}</span>
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-6 font-mono-spec text-xs text-[var(--ink-muted)]">
            <p>© 2026 DartClip · rencraft.site</p>
            <p>{SITE_CONFIG.version}</p>
          </div>
        </div>
      </footer>
    </>
  )
}
