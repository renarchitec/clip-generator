import { useState } from "react"
import type { LandingCopy } from "../data/translations.ts"
import { ChevronDownIcon } from "./Icons.tsx"
import { Reveal } from "./Reveal.tsx"

export interface FaqSectionProps {
  faq: LandingCopy["faq"]
}

export function FaqSection({ faq }: FaqSectionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="scroll-mt-16 py-20 sm:py-24"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <p className="font-mono-spec text-xs font-medium uppercase tracking-widest text-[var(--accent)]">
            {faq.kicker}
          </p>
          <h2
            id="faq-heading"
            className="font-display mt-3 text-3xl font-semibold leading-[1.12] text-[var(--ink)] sm:text-4xl"
          >
            {faq.heading}
          </h2>
        </Reveal>

        <Reveal delayMs={70}>
          <div className="mt-8 divide-y divide-[var(--border)]">
            {faq.items.map((item, idx) => {
              const isOpen = openIndex === idx
              const numberLabel = String(idx + 1).padStart(2, "0")
              const buttonId = `faq-trigger-${numberLabel}`
              const panelId = `faq-panel-${numberLabel}`

              return (
                <div key={item.question}>
                  <h3>
                    <button
                      id={buttonId}
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpenIndex(isOpen ? null : idx)}
                      className="flex min-h-[56px] w-full items-center justify-between gap-4 py-4 text-left transition-colors hover:text-[var(--accent)]"
                    >
                      <span className="flex items-baseline gap-3.5 sm:gap-4">
                        <span className="font-mono-spec shrink-0 text-xs font-medium text-[var(--accent)]">
                          {numberLabel}
                        </span>
                        <span className="font-display text-base font-semibold leading-snug text-[var(--ink)] sm:text-lg">
                          {item.question}
                        </span>
                      </span>
                      <ChevronDownIcon
                        size={18}
                        className={`shrink-0 text-[var(--ink-muted)] transition-transform duration-200 ${
                          isOpen ? "rotate-180 text-[var(--accent)]" : ""
                        }`}
                      />
                    </button>
                  </h3>

                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    aria-hidden={!isOpen}
                    data-open={isOpen ? "true" : "false"}
                    className="accordion-panel"
                  >
                    <div>
                      <div className="pb-5 pl-8 pr-2 sm:pl-9 sm:pr-6">
                        <p className="text-sm leading-relaxed text-[var(--ink-muted)] sm:text-[15px]">
                          {item.answer}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
