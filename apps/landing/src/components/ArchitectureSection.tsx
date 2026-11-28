import type { LandingCopy } from "../data/translations.ts"
import { Reveal } from "./Reveal.tsx"

export interface ArchitectureSectionProps {
  architecture: LandingCopy["architecture"]
}

export function ArchitectureSection({ architecture }: ArchitectureSectionProps) {
  return (
    <section
      id="comparison"
      aria-labelledby="comparison-heading"
      className="scroll-mt-16 py-20 sm:py-24"
    >
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        {/* Asymmetric split header */}
        <Reveal>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-end lg:gap-12">
            <div className="lg:col-span-6">
              <p className="font-mono-spec text-xs font-medium uppercase tracking-widest text-[var(--accent)]">
                {architecture.kicker}
              </p>
              <h2
                id="comparison-heading"
                className="font-display mt-3 text-3xl font-semibold leading-[1.1] text-[var(--ink)] sm:text-4xl"
              >
                {architecture.heading}
              </h2>
            </div>

            <p className="text-base leading-relaxed text-[var(--ink-muted)] lg:col-span-6">
              {architecture.subheading}
            </p>
          </div>
        </Reveal>

        {/* Desktop / Tablet 5-column semantic comparison table */}
        <Reveal delayMs={80}>
          <div className="mt-10 hidden overflow-hidden rounded-[14px] bg-[var(--surface)] shadow-[var(--card-shadow)] md:block">
            <table
              aria-label={architecture.tableLabel}
              className="w-full table-fixed border-collapse text-left"
            >
              <thead>
                <tr className="bg-[var(--surface-2)]/70">
                  <th
                    scope="col"
                    className="font-mono-spec w-[17%] px-4 py-4 text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)] lg:px-5"
                  >
                    {architecture.columnHeaders.feature}
                  </th>
                  <th
                    scope="col"
                    className="w-[25%] bg-[var(--accent-soft)] px-4 py-4 lg:px-5"
                  >
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="font-display text-sm font-semibold text-[var(--ink)]">
                        {architecture.columnHeaders.dartclip}
                      </span>
                      <span className="font-mono-spec rounded-[5px] bg-[var(--accent-solid)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-[var(--accent-ink)]">
                        {architecture.dartclipBadge}
                      </span>
                    </span>
                  </th>
                  <th
                    scope="col"
                    className="font-mono-spec w-[20%] px-4 py-4 text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)] lg:px-5"
                  >
                    {architecture.columnHeaders.socialVisuals}
                  </th>
                  <th
                    scope="col"
                    className="font-mono-spec w-[19%] px-4 py-4 text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)] lg:px-5"
                  >
                    {architecture.columnHeaders.opusClip}
                  </th>
                  <th
                    scope="col"
                    className="font-mono-spec w-[19%] px-4 py-4 text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)] lg:px-5"
                  >
                    {architecture.columnHeaders.submagic}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {architecture.rows.map((row) => (
                  <tr
                    key={row.feature}
                    className="align-middle transition-colors hover:bg-[var(--surface-2)]/40"
                  >
                    <th
                      scope="row"
                      className="px-4 py-4 text-sm font-medium text-[var(--ink-muted)] lg:px-5"
                    >
                      {row.feature}
                    </th>
                    <td className="bg-[var(--accent-soft)] px-4 py-4 text-sm font-semibold text-[var(--ink)] lg:px-5">
                      {row.dartclip}
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--ink-muted)] lg:px-5">
                      {row.socialVisuals}
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--ink-muted)] lg:px-5">
                      {row.opusClip}
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--ink-muted)] lg:px-5">
                      {row.submagic}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        {/* Mobile stacked comparison cards (zero horizontal overflow at 360px/375px) */}
        <div className="mt-8 space-y-3 md:hidden">
          {architecture.rows.map((row, idx) => (
            <Reveal key={row.feature} delayMs={idx * 45}>
              <div className="rounded-[14px] bg-[var(--surface)] p-4 shadow-[var(--card-shadow)]">
                <h3 className="font-display text-base font-semibold text-[var(--ink)]">
                  {row.feature}
                </h3>

                <dl className="mt-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--accent-soft)] px-3 py-2.5">
                    <dt className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                      <span>{architecture.columnHeaders.dartclip}</span>
                      <span className="font-mono-spec rounded-[4px] bg-[var(--accent-solid)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--accent-ink)]">
                        {architecture.dartclipBadge}
                      </span>
                    </dt>
                    <dd className="min-w-0 text-right text-sm font-semibold text-[var(--ink)]">
                      {row.dartclip}
                    </dd>
                  </div>

                  <div className="divide-y divide-[var(--border)] rounded-[10px] bg-[var(--surface-2)]">
                    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                      <dt className="font-mono-spec shrink-0 text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
                        {architecture.columnHeaders.socialVisuals}
                      </dt>
                      <dd className="min-w-0 text-right text-xs text-[var(--ink-subtle)]">
                        {row.socialVisuals}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                      <dt className="font-mono-spec shrink-0 text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
                        {architecture.columnHeaders.opusClip}
                      </dt>
                      <dd className="min-w-0 text-right text-xs text-[var(--ink-subtle)]">
                        {row.opusClip}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                      <dt className="font-mono-spec shrink-0 text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
                        {architecture.columnHeaders.submagic}
                      </dt>
                      <dd className="min-w-0 text-right text-xs text-[var(--ink-subtle)]">
                        {row.submagic}
                      </dd>
                    </div>
                  </div>
                </dl>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Honest footnote */}
        <p className="mt-5 max-w-3xl text-xs leading-relaxed text-[var(--ink-muted)]">
          {architecture.footnote}
        </p>
      </div>
    </section>
  )
}
