import { useEffect, useState } from "react"
import type { LandingCopy, Locale } from "../data/translations.ts"
import { CloseIcon, MenuIcon, MoonIcon, SunIcon } from "./Icons.tsx"

export type ThemeMode = "dark" | "light"

export interface NavbarProps {
  copy: LandingCopy
  locale: Locale
  theme: ThemeMode
  onToggleLocale: () => void
  onToggleTheme: () => void
}

const NAV_ITEMS: readonly { key: keyof LandingCopy["nav"]["links"]; href: string }[] = [
  { key: "studio", href: "#studio" },
  { key: "demo", href: "#demo" },
  { key: "comparison", href: "#comparison" },
  { key: "download", href: "#download" },
  { key: "faq", href: "#faq" },
]

export function Navbar({
  copy,
  locale,
  theme,
  onToggleLocale,
  onToggleTheme,
}: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [mobileOpen])

  const skipLabel = locale === "id" ? "Lewati ke konten utama" : "Skip to main content"
  const themeAriaLabel =
    theme === "dark" ? copy.nav.themeLightLabel : copy.nav.themeDarkLabel

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-[6px] focus:bg-[var(--accent-solid)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--accent-ink)]"
      >
        {skipLabel}
      </a>

      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/88 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          {/* Brand Logo */}
          <a
            href="#top"
            onClick={() => setMobileOpen(false)}
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-[6px]"
            aria-label={copy.nav.brandLabel}
          >
            <img
              src={theme === "dark" ? "/logo-horizontal-dark.svg" : "/logo-horizontal.svg"}
              alt="DartClip"
              width={124}
              height={34}
              className="h-[30px] w-auto sm:h-[34px]"
            />
          </a>

          {/* Desktop Primary Navigation */}
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.key}
                href={item.href}
                className="rounded-[8px] px-3 py-2 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                {copy.nav.links[item.key]}
              </a>
            ))}
          </nav>

          {/* Desktop Utilities + CTA */}
          <div className="hidden items-center gap-1.5 md:flex">
            <button
              type="button"
              onClick={onToggleLocale}
              aria-label={copy.nav.langToggleLabel}
              className="font-mono-spec inline-flex h-9 items-center gap-1 rounded-[8px] px-2.5 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              <span
                className={
                  locale === "id" ? "font-semibold text-[var(--accent)]" : ""
                }
              >
                ID
              </span>
              <span aria-hidden="true">/</span>
              <span
                className={
                  locale === "en" ? "font-semibold text-[var(--accent)]" : ""
                }
              >
                EN
              </span>
            </button>

            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={themeAriaLabel}
              title={themeAriaLabel}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--ink-subtle)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              {theme === "dark" ? <SunIcon size={17} /> : <MoonIcon size={17} />}
            </button>

            <a
              href="#download"
              className="ml-1 inline-flex h-9 items-center justify-center rounded-[10px] bg-[var(--accent-solid)] px-4 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-hover)]"
            >
              {copy.nav.downloadCta}
            </a>
          </div>

          {/* Mobile Controls: Labeled Menu Button */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={themeAriaLabel}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[8px] bg-[var(--surface-2)] text-[var(--ink)] transition-colors hover:bg-[var(--surface)]"
            >
              {theme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
            </button>

            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-drawer"
              aria-label={mobileOpen ? copy.nav.closeMenuLabel : copy.nav.menuLabel}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-[8px] bg-[var(--surface-2)] px-3.5 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--surface)]"
            >
              {mobileOpen ? <CloseIcon size={17} /> : <MenuIcon size={17} />}
              <span>{copy.nav.menuLabel}</span>
            </button>
          </div>
        </div>

        {/* Mobile Solid Surface Navigation Drawer */}
        {mobileOpen && (
          <div
            id="mobile-nav-drawer"
            className="bg-[var(--surface)] px-4 pb-5 pt-3 shadow-[var(--card-shadow)] md:hidden"
          >
            <nav aria-label="Mobile" className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <a
                  key={item.key}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex min-h-[44px] items-center rounded-[8px] px-3 text-base font-medium text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)]"
                >
                  {copy.nav.links[item.key]}
                </a>
              ))}
            </nav>

            <div className="mt-4 flex flex-col gap-2.5 pt-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onToggleLocale}
                  aria-label={copy.nav.langToggleLabel}
                  className="font-mono-spec flex min-h-[44px] items-center justify-center gap-1.5 rounded-[8px] bg-[var(--surface-2)] px-3 text-xs font-medium text-[var(--ink)]"
                >
                  <span className={locale === "id" ? "text-[var(--accent)] font-semibold" : "text-[var(--ink-muted)]"}>
                    ID
                  </span>
                  <span aria-hidden="true">/</span>
                  <span className={locale === "en" ? "text-[var(--accent)] font-semibold" : "text-[var(--ink-muted)]"}>
                    EN
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onToggleTheme}
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-[8px] bg-[var(--surface-2)] px-3 text-xs font-medium text-[var(--ink)]"
                >
                  {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
                  <span>
                    {theme === "dark"
                      ? locale === "id"
                        ? "Terang"
                        : "Light"
                      : locale === "id"
                        ? "Gelap"
                        : "Dark"}
                  </span>
                </button>
              </div>

              <a
                href="#download"
                onClick={() => setMobileOpen(false)}
                className="flex min-h-[46px] w-full items-center justify-center rounded-[10px] bg-[var(--accent-solid)] px-4 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-hover)]"
              >
                {copy.nav.downloadCta}
              </a>
            </div>
          </div>
        )}
      </header>
    </>
  )
}
