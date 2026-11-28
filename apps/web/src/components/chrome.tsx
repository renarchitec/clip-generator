import { useId, useMemo } from "react"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUpRight, Film, Globe, Library, ListVideo, LogOut, Settings, Shield } from "lucide-react"
import { api, trackUserEvent, type MeResponse, type User } from "@/lib/api"
import { DESKTOP_DOWNLOAD_URL, WorkspaceUserContext } from "@/lib/demo-context"
import { useLanguage, useT } from "@/lib/i18n"
import { ThemeSelect } from "@/lib/theme"
import { Badge } from "@/components/ui/badge"
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
      <mask id={maskId} maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">
        <rect x="-8" y="-8" width="80" height="80" fill="#fff" />
        <path d="M 5.5,17.5 L 38.5,32 L 5.5,46.5 Z" fill="#000" stroke="#000" strokeWidth="6.4" strokeLinejoin="round" />
      </mask>
    </defs>
    <g mask={`url(#${maskId})`}>
      <circle cx="33.75" cy="32" r="22.5" stroke="currentColor" strokeWidth="5" />
      <circle cx="33.75" cy="32" r="11.5" stroke="currentColor" strokeWidth="5" />
    </g>
    <path d="M 5.5,17.5 L 38.5,32 L 5.5,46.5 Z" fill="currentColor" />
  </svg>
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className="group inline-flex min-h-11 items-center gap-2 font-display md:min-h-10 text-lg font-semibold tracking-[-0.06em]" aria-label="DartClip home"><span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground"><BrandMark className="size-5" /></span>{!compact && <span>DartClip</span>}</Link>
}

export function Preferences() {
  const t = useT()
  const { language, setLanguage } = useLanguage()
  return <div className="flex items-center gap-1"><DropdownMenu><DropdownMenuTrigger aria-label={t.language} title={t.language} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2 md:min-h-10 md:px-2.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Globe className="size-[18px]" aria-hidden="true"/><span aria-hidden="true" className="font-mono text-xs font-semibold leading-none tracking-wide">{language.toUpperCase()}</span><span className="sr-only">{t.language}: {language.toUpperCase()}</span></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-40"><DropdownMenuLabel>{t.language}</DropdownMenuLabel><DropdownMenuSeparator/><DropdownMenuItem onSelect={() => setLanguage("en")}><span className="w-6 font-mono text-[10px]">EN</span>English{language === "en" && <span className="ml-auto">✓</span>}</DropdownMenuItem><DropdownMenuItem onSelect={() => setLanguage("id")}><span className="w-6 font-mono text-[10px]">ID</span>Bahasa Indonesia{language === "id" && <span className="ml-auto">✓</span>}</DropdownMenuItem></DropdownMenuContent></DropdownMenu><ThemeSelect /></div>
}

function AccountMenu({ user }: { user: User }) {
  const t = useT()
  const navigate = useNavigate()
  const client = useQueryClient()
  const name = user.name || user.email
  const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "U"
  const signOut = async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); client.clear(); await navigate({ to: "/login" }) }
  return <DropdownMenu><DropdownMenuTrigger aria-label={`${t.accountMenu}: ${name}`} title={name} className="inline-flex size-11 items-center justify-center rounded-full md:size-10 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full object-cover ring-1 ring-border"/> : <span className="grid size-8 place-items-center rounded-full bg-accent/10 font-display text-xs font-semibold tracking-wide text-accent">{initials}</span>}<span className="sr-only">{t.accountMenu}</span></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-[min(16rem,calc(100vw-1.5rem))]"><DropdownMenuLabel className="px-2 py-2"><span className="flex items-center gap-3">{user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-9 shrink-0 rounded-lg object-cover ring-1 ring-border"/> : <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/10 font-display text-sm font-semibold text-accent">{initials}</span>}<span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{user.name || t.account}</span><span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{user.email}</span></span></span></DropdownMenuLabel><DropdownMenuSeparator/>{user.role === "admin" && <DropdownMenuItem asChild className="min-h-10"><Link to="/admin"><Shield className="size-4"/>{t.admin}</Link></DropdownMenuItem>}<DropdownMenuItem asChild className="min-h-10"><Link to="/settings"><Settings className="size-4"/>{t.settings}</Link></DropdownMenuItem><DropdownMenuItem onSelect={() => void signOut()} className="min-h-10 text-destructive focus:bg-destructive/10 focus:text-destructive"><LogOut className="size-4"/>{t.signOut}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
}

export function Topbar({ user }: { user?: User }) {
  const t = useT()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const isAdmin = user?.role === "admin"
  const pageTitle = pathname === "/jobs/" || pathname === "/jobs" ? t.jobs : pathname.startsWith("/jobs/") ? t.jobDetails : pathname === "/clips" ? t.clips : pathname === "/settings" ? t.settings : pathname === "/admin" ? t.admin : t.dashboard
  return <header className="sticky top-0 z-20 border-b border-border bg-background pt-[env(safe-area-inset-top)]">
    <div className="px-4 sm:px-7">
      <div className="flex min-h-14 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-4"><span className="md:hidden"><Brand/></span><h1 className="hidden truncate font-display text-sm font-medium tracking-[-.01em] text-muted-foreground md:block">{pageTitle}</h1></div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2"><Preferences />{user && <AccountMenu user={user}/>}</div>
      </div>
      <nav aria-label={t.mainNavigation} className={`grid gap-1 pb-2 md:hidden ${isAdmin ? "grid-cols-4" : "grid-cols-3"}`}>
        {navItems.map(({ to, exact, icon: Icon, key }) => <Link key={to} to={to} activeOptions={{ exact }} className="group relative flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-md px-1 text-center text-xs leading-tight transition-colors sm:gap-2 sm:px-3" inactiveProps={{ className: "text-muted-foreground hover:bg-secondary hover:text-foreground" }} activeProps={{ className: "bg-accent/10 font-medium text-foreground before:absolute before:inset-x-3 before:bottom-0 before:h-0.5 before:rounded-full before:bg-accent dark:bg-accent/15" }}><Icon className="size-4 shrink-0 group-data-[status=active]:text-accent" aria-hidden="true"/><span className="min-w-0">{t[key]}</span></Link>)}
        {isAdmin && <Link to="/admin" activeOptions={{ exact: false }} className="group relative flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-md px-1 text-center text-xs leading-tight transition-colors sm:gap-2 sm:px-3" inactiveProps={{ className: "text-muted-foreground hover:bg-secondary hover:text-foreground" }} activeProps={{ className: "bg-accent/10 font-medium text-foreground before:absolute before:inset-x-3 before:bottom-0 before:h-0.5 before:rounded-full before:bg-accent dark:bg-accent/15" }}><Shield className="size-4 shrink-0 group-data-[status=active]:text-accent" aria-hidden="true"/><span className="min-w-0">{t.admin}</span></Link>}
      </nav>
    </div>
  </header>
}

export function WorkspaceShell({ children, user }: { children: React.ReactNode; user: User }) {
  const t = useT()
  const client = useQueryClient()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const editorWorkspace = pathname === "/"
  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api<MeResponse>("/auth/me"),
    staleTime: 30_000,
  })
  const resolvedUser = meQuery.data?.user ?? user
  const isDemo = resolvedUser.role === "demo"
  const isAdmin = resolvedUser.role === "admin"
  const quota = meQuery.data?.demoQuota ?? null

  const contextValue = useMemo(() => ({
    user: resolvedUser,
    isDemo,
    isAdmin,
    quota,
    refreshQuota: () => { void client.invalidateQueries({ queryKey: ["auth", "me"] }) },
  }), [resolvedUser, isDemo, isAdmin, quota, client])

  return <WorkspaceUserContext.Provider value={contextValue}>
    <div className="min-h-screen bg-background md:grid md:grid-cols-[184px_minmax(0,1fr)]">
      <aside className="hidden border-r border-sidebar-border bg-sidebar px-3 py-5 md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:self-start md:overflow-y-auto">
        <div>
          <Brand/>
          <nav aria-label={t.mainNavigation} className="mt-8 space-y-1">
            {navItems.map(({ to, exact, icon: Icon, key }) => <Link key={to} to={to} activeOptions={{ exact }} className="group relative flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors" inactiveProps={{ className: "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" }} activeProps={{ className: "bg-accent/10 font-medium text-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-accent dark:bg-accent/15" }}><Icon className="size-4 group-data-[status=active]:text-accent" aria-hidden="true"/>{t[key]}</Link>)}
            {isAdmin && <Link to="/admin" activeOptions={{ exact: false }} className="group relative flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors" inactiveProps={{ className: "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" }} activeProps={{ className: "bg-accent/10 font-medium text-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-accent dark:bg-accent/15" }}><Shield className="size-4 group-data-[status=active]:text-accent" aria-hidden="true"/>{t.admin}</Link>}
          </nav>
        </div>
      </aside>
      <div className="flex min-h-screen min-w-0 flex-col">
        <Topbar user={resolvedUser}/>
        {isDemo && (
          <div role="status" className="border-b border-border bg-accent/10 px-4 py-2 text-xs sm:px-7">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-foreground">
                <Badge variant="secondary" className="border border-accent/30 bg-background font-mono text-[10px] font-semibold uppercase tracking-wide text-accent">
                  {t.demoModeBadge}
                </Badge>
                <span className="tabular-nums text-muted-foreground">
                  {quota
                    ? t.demoQuotaLine
                        .replace("{clipsUsed}", String(quota.clipsUsed))
                        .replace("{clipsLimit}", String(quota.clipsLimit))
                        .replace("{jobsUsed}", String(quota.jobsUsed))
                        .replace("{jobsLimit}", String(quota.jobsLimit))
                        .replace("{previewsUsed}", String(quota.previewsUsed))
                        .replace("{previewsLimit}", String(quota.previewsLimit))
                    : t.demoSignupIntro}
                </span>
              </div>
              <a
                href={DESKTOP_DOWNLOAD_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackUserEvent("desktop_cta_clicked", { source: "demo_banner" })}
                className="inline-flex items-center gap-1 font-medium text-accent underline-offset-4 hover:underline"
              >
                {t.demoDesktopCta}
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        )}
        <main id="main-content" className={`mx-auto w-full flex-1 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 ${editorWorkspace ? "max-w-none lg:px-5" : "max-w-[1600px]"}`}>
          <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-3 focus:text-foreground focus:ring-2 focus:ring-ring">{t.skipToContent}</a>
          {children}
          <footer className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-border pt-5 text-xs text-muted-foreground sm:flex-row"><span>© DartClip</span><span>{t.appDesc}</span></footer>
        </main>
      </div>
    </div>
  </WorkspaceUserContext.Provider>
}
