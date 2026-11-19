import { Link, useNavigate } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Film, Languages, LogOut, Scissors, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type User } from "@/lib/api"
import { useLanguage } from "@/lib/i18n"
import { ThemeSelect } from "@/lib/theme"
import { useT } from "@/lib/i18n"

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className="group inline-flex items-center gap-2.5 font-display text-[1.25rem] font-semibold tracking-[-0.06em]" aria-label="Clipper home"><span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform group-hover:-rotate-6"><Scissors className="size-[18px]" strokeWidth={2.3} /></span>{!compact && <span>clipper<span className="text-primary">.</span></span>}</Link>
}

export function Preferences() {
  const t = useT()
  const { language, setLanguage } = useLanguage()
  return <div className="flex items-center gap-1.5"><Select value={language} onValueChange={(v) => setLanguage(v as "en" | "id")}><SelectTrigger aria-label={t.language} className="w-[108px] border-0 bg-transparent shadow-none"><Languages className="size-4 text-muted-foreground"/><SelectValue /></SelectTrigger><SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="id">Bahasa Indonesia</SelectItem></SelectContent></Select><ThemeSelect /></div>
}

export function Topbar({ user }: { user?: User }) {
  const t = useT()
  const navigate = useNavigate()
  const client = useQueryClient()
  return <header className="sticky top-0 z-20 border-b border-border/70 bg-background/90 backdrop-blur-xl"><div className="mx-auto flex h-[68px] max-w-[1240px] items-center justify-between px-5 sm:px-8"><Brand/><div className="flex items-center gap-2 sm:gap-5"><Preferences/>{user && <><Separator orientation="vertical" className="hidden h-7 sm:block"/><span className="hidden max-w-40 truncate text-sm text-muted-foreground sm:block">{user.name || user.email}</span><Tooltip><TooltipTrigger asChild><Button aria-label={t.signOut} variant="ghost" size="icon" onClick={async()=>{await api("/auth/logout",{method:"POST"}).catch(()=>{});client.clear();await navigate({to:"/login"})}}><LogOut className="size-4"/></Button></TooltipTrigger><TooltipContent>{t.signOut}</TooltipContent></Tooltip></>}</div></div></header>
}

export function WorkspaceShell({ children, user }: { children: React.ReactNode; user: User }) {
  const t = useT()
  const config = useQuery({ queryKey: ["auth", "config"], queryFn: () => api<{ registrationOpen: boolean }>("/auth/config") })
  return <div className="min-h-screen bg-[radial-gradient(ellipse_at_60%_-20%,color-mix(in_oklab,var(--primary)_7%,transparent),transparent_50%)]"><Topbar user={user}/><main className="mx-auto max-w-[1120px] px-5 pb-24 pt-12 sm:px-8 sm:pt-16">{children}<footer className="mt-20 flex items-center justify-between border-t border-border/70 pt-6 text-xs text-muted-foreground"><div className="flex items-center gap-2"><Film className="size-3.5"/><span>{t.appDesc}</span></div>{config.data?.registrationOpen && <span className="flex items-center gap-1"><Sparkles className="size-3.5"/> {t.signUp}</span>}</footer></main></div>
}
