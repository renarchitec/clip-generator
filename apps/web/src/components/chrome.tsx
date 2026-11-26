import { useRuntime } from "@/lib/use-runtime"
import { useId } from "react"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { Film, Globe, Library, ListVideo, LogOut, Settings } from "lucide-react"
import { isDesktopBuild } from "@/lib/desktop"
import { api, type User } from "@/lib/api"
import { useLanguage, useT } from "@/lib/i18n"
import { ThemeSelect } from "@/lib/theme"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

// "/" must match exactly; "/jobs" stays active on /jobs/<id>.
const navItems = [
  { to: "/", exact: true, icon: Film, key: "dashboard" },
  { to: "/jobs", exact: false, icon: ListVideo, key: "jobs" },
  { to: "/clips", exact: false, icon: Library, key: "clips" },
] as const

export function BrandMark({ className }: { className?: string }) {
  const maskId = useId()
  return <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
    <defs>
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
        <rect width="64" height="64" fill="#fff" />
        <g transform="translate(26 38) rotate(42)"><path d="M0 0L-3.2 -10.5L-8.4 -16.5V-39.5L0 -33.2L8.4 -39.5V-16.5L3.2 -10.5Z" fill="#000" stroke="#000" strokeWidth="6.5" strokeLinejoin="round" /></g>
      </mask>
    </defs>
    <g mask={`url(#${maskId})`}>
      <circle cx="26" cy="38" r="22.5" stroke="currentColor" strokeWidth="5" />
      <circle cx="26" cy="38" r="11.5" stroke="currentColor" strokeWidth="5" />
    </g>
    <g transform="translate(26 38) rotate(42)"><path d="M0 0L-3.2 -10.5L-8.4 -16.5V-39.5L0 -33.2L8.4 -39.5V-16.5L3.2 -10.5Z" className="fill-[#5ce1c4] stroke-[#5ce1c4] dark:fill-[#087f68] dark:stroke-[#087f68]" strokeWidth="1.2" strokeLinejoin="round" /></g>
  </svg>
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className="group inline-flex min-h-10 items-center gap-2 font-display text-lg font-semibold tracking-[-0.06em]" aria-label="DartClip home"><span className="grid size-8 place-items-center rounded-md bg-[#18181b] text-white dark:bg-primary dark:text-primary-foreground"><BrandMark className="size-5" /></span>{!compact && <span>DartClip</span>}</Link>
}

export function Preferences() {
  const t = useT()
  const { language, setLanguage } = useLanguage()
  return <div className="flex items-center gap-1"><DropdownMenu><DropdownMenuTrigger aria-label={t.language} title={t.language} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md px-2.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Globe className="size-[18px]" aria-hidden="true"/><span aria-hidden="true" className="font-mono text-xs font-semibold leading-none tracking-wide">{language.toUpperCase()}</span><span className="sr-only">{t.language}: {language.toUpperCase()}</span></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-40"><DropdownMenuLabel>{t.language}</DropdownMenuLabel><DropdownMenuSeparator/><DropdownMenuItem onSelect={() => setLanguage("en")}><span className="w-6 font-mono text-[10px]">EN</span>English{language === "en" && <span className="ml-auto text-primary">✓</span>}</DropdownMenuItem><DropdownMenuItem onSelect={() => setLanguage("id")}><span className="w-6 font-mono text-[10px]">ID</span>Bahasa Indonesia{language === "id" && <span className="ml-auto text-primary">✓</span>}</DropdownMenuItem></DropdownMenuContent></DropdownMenu><ThemeSelect /></div>
}

function AccountMenu({ user }: { user: User }) {
  const t = useT()
  const { publishEnabled } = useRuntime()
  const navigate = useNavigate()
  const client = useQueryClient()
  const name = user.name || user.email
  const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "U"
  const signOut = async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); client.clear(); await navigate({ to: "/login" }) }
  return <DropdownMenu><DropdownMenuTrigger aria-label={`${t.accountMenu}: ${name}`} title={name} className="inline-flex size-10 items-center justify-center rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="grid size-8 place-items-center rounded-full border border-accent/30 bg-accent/15 font-display text-xs font-semibold tracking-wide text-accent">{initials}</span><span className="sr-only">{t.accountMenu}</span></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64"><DropdownMenuLabel className="px-2 py-2"><span className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent/15 font-display text-sm font-semibold text-accent">{initials}</span><span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{user.name || t.account}</span><span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{user.email}</span></span></span></DropdownMenuLabel><DropdownMenuSeparator/><DropdownMenuItem asChild className="min-h-10"><Link to="/settings"><Settings className="size-4"/>{t.settings}</Link></DropdownMenuItem>{publishEnabled && <DropdownMenuItem onSelect={() => void signOut()} className="min-h-10 text-destructive focus:bg-destructive/10 focus:text-destructive"><LogOut className="size-4"/>{t.signOut}</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
}

export function Topbar({ user }: { user?: User }) {
  const t = useT()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const pageTitle = pathname === "/jobs/" || pathname === "/jobs" ? t.jobs : pathname.startsWith("/jobs/") ? t.jobDetails : pathname === "/clips" ? t.clips : pathname === "/settings" ? t.settings : t.dashboard
  return <header className="sticky top-0 z-20 border-b border-border bg-background">
    <div className="px-4 sm:px-7">
      <div className="flex min-h-14 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-4"><span className="md:hidden"><Brand/></span><h1 className="hidden truncate font-display text-sm font-medium tracking-[-.01em] text-muted-foreground md:block">{pageTitle}</h1></div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2"><Preferences />{user && <AccountMenu user={user}/>}</div>
      </div>
      <nav aria-label={t.mainNavigation} className="flex gap-1 pb-2 md:hidden">{navItems.map(({ to, exact, icon: Icon, key }) => <Link key={to} to={to} activeOptions={{ exact }} className="group relative inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-xs transition-colors" inactiveProps={{ className: "text-muted-foreground hover:bg-secondary hover:text-foreground" }} activeProps={{ className: "bg-accent/10 font-medium text-foreground before:absolute before:inset-x-3 before:bottom-0 before:h-0.5 before:rounded-full before:bg-accent dark:bg-accent/15" }}><Icon className="size-4 group-data-[status=active]:text-accent" aria-hidden="true"/><span>{t[key]}</span></Link>)}</nav>
    </div>
  </header>
}

export function WorkspaceShell({ children, user }: { children: React.ReactNode; user: User }) {
  const t = useT()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const editorWorkspace = pathname === "/"
  return <div className="min-h-screen bg-background md:grid md:grid-cols-[184px_minmax(0,1fr)]">
    <aside className="hidden border-r border-sidebar-border bg-sidebar px-3 py-5 md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:self-start md:overflow-y-auto">
      <div><Brand/><nav aria-label={t.mainNavigation} className="mt-8 space-y-1">{navItems.map(({ to, exact, icon: Icon, key }) => <Link key={to} to={to} activeOptions={{ exact }} className="group relative flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors" inactiveProps={{ className: "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" }} activeProps={{ className: "bg-accent/10 font-medium text-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-accent dark:bg-accent/15" }}><Icon className="size-4 group-data-[status=active]:text-accent" aria-hidden="true"/>{t[key]}</Link>)}</nav></div>
    </aside>
    <div className="flex min-h-screen min-w-0 flex-col">
      <Topbar user={user}/>
      <main id="main-content" tabIndex={-1} className={`mx-auto w-full flex-1 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 ${editorWorkspace ? "max-w-none lg:px-5" : "max-w-[1600px]"}`}><a href="#main-content" onClick={(event) => {
          if (!isDesktopBuild()) return
          // The desktop URL fragment belongs to the router, not the skip link.
          event.preventDefault()
          document.getElementById("main-content")?.focus()
        }} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-3 focus:text-foreground focus:ring-2 focus:ring-ring">{t.skipToContent}</a>{children}
        <footer className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-border pt-5 text-xs text-muted-foreground sm:flex-row"><span>© DartClip</span><span>{t.appDesc}</span></footer>
      </main>
    </div>
  </div>
}
