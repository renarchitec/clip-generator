import { Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import type { ReactNode } from "react"
import { Brand, Preferences } from "@/components/chrome"
import { useT } from "@/lib/i18n"

const TOKEN = /(https?:\/\/[^\s)]+|[\w.+-]+@[\w-]+\.[\w.]+)/g

function linkify(text: string): ReactNode[] {
  return text.split(TOKEN).map((part, index) => {
    if (index % 2 === 0) return part
    const email = !part.startsWith("http")
    const clean = part.replace(/[.,]$/, "")
    const tail = part.slice(clean.length)
    return <span key={index}><a href={email ? `mailto:${clean}` : clean} {...(email ? {} : { target: "_blank", rel: "noreferrer" })} className="break-words font-medium text-foreground underline decoration-accent/60 decoration-2 underline-offset-[3px] transition-colors hover:decoration-accent">{email ? clean : clean.replace(/^https?:\/\/(www\.)?/, "")}</a>{tail}</span>
  })
}

export function LegalFooterLinks({ className = "" }: { className?: string }) {
  const t = useT()
  return <nav aria-label={`${t.privacyPolicy} · ${t.termsOfService}`} className={`flex items-center justify-center gap-4 ${className}`}>
    <Link to="/privacy" className="inline-flex min-h-8 items-center underline-offset-4 transition-colors hover:text-foreground hover:underline">{t.privacyPolicy}</Link>
    <Link to="/terms" className="inline-flex min-h-8 items-center underline-offset-4 transition-colors hover:text-foreground hover:underline">{t.termsOfService}</Link>
  </nav>
}

export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const t = useT()
  const doc = t.legal[kind]
  const other = kind === "privacy" ? { to: "/terms" as const, label: t.legal.terms.title } : { to: "/privacy" as const, label: t.legal.privacy.title }
  return <div className="flex min-h-screen flex-col bg-background">
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-8 sm:py-6"><Brand/><Preferences/></header>
    <main className="mx-auto w-full max-w-[68ch] flex-1 px-5 pb-16 pt-6 sm:pt-12">
      <Link to="/" className="-ml-2 inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft aria-hidden="true" className="size-4"/>{t.legalBack}</Link>
      <h1 className="mt-6 font-display text-4xl font-medium tracking-[-.045em] text-balance sm:text-5xl">{doc.title}</h1>
      <p className="mt-3 font-mono text-xs uppercase tracking-[.08em] text-muted-foreground">{t.legalEffective}</p>
      <p className="mt-8 text-lg leading-8 text-pretty">{linkify(doc.intro)}</p>
      <div className="mt-10 space-y-10 border-t border-border pt-10">
        {doc.sections.map((section, index) => <section key={section.heading} aria-labelledby={`legal-${index}`} className="grid gap-3 sm:grid-cols-[2.5rem_1fr]">
          <span aria-hidden="true" className="font-mono text-xs leading-7 tabular-nums text-accent">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <h2 id={`legal-${index}`} className="font-display text-xl font-medium tracking-[-.02em]">{section.heading}</h2>
            {section.body.length > 1
              ? <ul className="mt-3 space-y-2.5 text-[15px] leading-7 text-muted-foreground">{section.body.map((line) => <li key={line} className="relative pl-4 text-pretty before:absolute before:left-0 before:top-[.8em] before:size-1 before:rounded-full before:bg-muted-foreground/50">{linkify(line)}</li>)}</ul>
              : <p className="mt-3 text-[15px] leading-7 text-pretty text-muted-foreground">{linkify(section.body[0])}</p>}
          </div>
        </section>)}
      </div>
      <p className="mt-14 border-t border-border pt-6 text-sm text-muted-foreground"><Link to={other.to} className="font-medium text-foreground underline-offset-4 hover:underline">{other.label} →</Link></p>
    </main>
    <footer className="px-4 pb-5 text-center text-xs text-muted-foreground"><LegalFooterLinks className="mb-1"/>© Clipper · rencraft.site</footer>
  </div>
}
