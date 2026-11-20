import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Film, Languages, LogOut, Scissors } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, type User } from "@/lib/api"
import { useLanguage, useT } from "@/lib/i18n"
import { ThemeSelect } from "@/lib/theme"

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className="group inline-flex min-h-11 items-center gap-2.5 font-display text-[1.25rem] font-semibold tracking-[-0.06em]" aria-label="Clipper home"><span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground transition-transform group-hover:-rotate-6"><Scissors className="size-[18px]" strokeWidth={2.3} /></span>{!compact && <span>clipper<span className="text-primary">.</span></span>}</Link>
}

export function Preferences() {
  const t = useT()
  const { language, setLanguage } = useLanguage()
  return <div className="flex items-center gap-1"><Select value={language} onValueChange={(v) => setLanguage(v as "en" | "id")}><SelectTrigger aria-label={t.language} className="h-11 w-[108px] border-0 bg-transparent shadow-none"><Languages className="size-4 text-muted-foreground"/><SelectValue /></SelectTrigger><SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="id">Bahasa Indonesia</SelectItem></SelectContent></Select><ThemeSelect /></div>
}

function SignOut() {
  const t = useT()
  const navigate = useNavigate()
  const client = useQueryClient()
  return <Button type="button" variant="ghost" className="h-11 gap-2 px-3" aria-label={t.signOut} title={t.signOut} onClick={async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); client.clear(); await navigate({ to: "/login" }) }}><LogOut className="size-4"/><span className="sr-only">{t.signOut}</span></Button>
}

export function Topbar({ user }: { user?: User }) {
  const t = useT()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const pageTitle = pathname.startsWith("/jobs/") ? t.jobDetails : t.dashboard
  return <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur-sm">
    <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-7">
      <h1 className="min-w-0 truncate font-display text-xl font-medium tracking-[-.035em]">{pageTitle}</h1>
      <div className="flex shrink-0 items-center gap-2 sm:gap-4"><Preferences />{user && <><span className="hidden max-w-44 truncate rounded-lg bg-secondary px-3 py-2 text-sm font-medium sm:block">{user.name || user.email}</span><SignOut/></>}</div>
    </div>
  </header>
}

export function WorkspaceShell({ children, user }: { children: React.ReactNode; user: User }) {
  const t = useT()
  const config = useQuery({ queryKey: ["auth", "config"], queryFn: () => api<{ registrationOpen: boolean }>("/auth/config") })
  return <div className="min-h-screen bg-background md:grid md:grid-cols-[220px_minmax(0,1fr)]">
    <aside className="hidden border-r border-sidebar-border bg-sidebar px-4 py-5 md:flex md:min-h-screen md:flex-col md:justify-between">
      <div><Brand/><nav aria-label={t.mainNavigation} className="mt-10 space-y-1"><p className="mb-2 px-3 text-xs font-semibold text-muted-foreground">{t.workspace}</p><Link to="/" activeOptions={{ exact: true }} activeProps={{ className: "bg-sidebar-accent font-medium text-sidebar-accent-foreground" }} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><Film className="size-4"/>{t.dashboard}</Link></nav></div>
      <div className="space-y-4"><div className="rounded-xl border border-sidebar-border bg-card p-3"><p className="text-sm font-medium">{t.appDesc}</p>{config.data?.registrationOpen && <p className="mt-1 text-xs text-muted-foreground">{t.registrationOpen}</p>}</div><div className="border-t border-sidebar-border pt-3"><span className="block max-w-40 truncate text-xs text-muted-foreground">{user.name || user.email}</span></div></div>
    </aside>
    <div className="flex min-h-screen min-w-0 flex-col">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2 md:hidden"><Brand/><span className="max-w-28 truncate text-xs text-muted-foreground">{user.name || user.email}</span></div>
      <Topbar user={user}/>
      <main id="main-content" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-7 sm:py-8 lg:px-10"><a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-3 focus:text-foreground focus:ring-2 focus:ring-ring">{t.skipToContent}</a>{children}
        <footer className="mt-12 flex flex-col items-center justify-between gap-2 border-t border-border pt-5 text-xs text-muted-foreground sm:flex-row"><span>© Clipper</span><span>{t.appDesc}</span></footer>
      </main>
    </div>
  </div>
}
