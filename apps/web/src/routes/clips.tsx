import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, Library, Play, Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { WorkspaceShell } from "@/components/chrome"
import { api, type RecentClip, type User } from "@/lib/api"
import { getCurrentUser } from "@/lib/auth"
import { relativeAge, sourceLabel } from "@/lib/format"
import { useLanguage, useT } from "@/lib/i18n"

export const Route = createFileRoute("/clips")({
  beforeLoad: async () => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: "/login" })
    return { user }
  },
  component: ClipsPage,
})

function ClipsPage() {
  const { user } = Route.useRouteContext() as { user: User }
  const t = useT()
  const locale = useLanguage().language === "id" ? "id" : "en"
  const [search, setSearch] = useState("")
  const [playing, setPlaying] = useState<RecentClip | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const clips = useQuery({ queryKey: ["clips", "recent"], queryFn: () => api<RecentClip[]>("/clips/recent?limit=24") })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const filtered = useMemo(() => clips.data?.filter((clip) => `${clip.title} ${clip.job.url}`.toLowerCase().includes(search.trim().toLowerCase())) ?? [], [clips.data, search])

  return <WorkspaceShell user={user}>
    <div className="mb-7 flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[.18em] text-primary"><Library className="size-3.5"/>{t.library}</p><h2 className="font-display text-3xl font-medium tracking-[-.045em]">{t.clips}</h2><p className="mt-2 text-sm text-muted-foreground">{t.latestFirst}</p></div>
      <div className="relative w-full sm:max-w-xs"><Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><label className="sr-only" htmlFor="clip-search">{t.searchClips}</label><Input ref={searchRef} id="clip-search" type="search" placeholder={t.searchClips} value={search} onChange={(event) => setSearch(event.target.value)} className="h-11 bg-card pl-9 pr-16"/><kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{t.searchShortcut}</kbd></div>
    </div>
    {clips.isPending ? <div role="status" aria-label={t.loading} className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{[0,1,2,3,4,5,6,7].map((item) => <div key={item}><Skeleton className="aspect-[9/16] w-full rounded-lg"/><Skeleton className="mt-3 h-4 w-4/5"/><Skeleton className="mt-2 h-3 w-2/3"/></div>)}</div> : clips.isError ? <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{t.apiError}</span><Button variant="outline" onClick={() => clips.refetch()}>{t.retry}</Button></AlertDescription></Alert> : filtered.length ? <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{filtered.map((clip, index) => {
      const duration = Math.max(0, clip.endSec - clip.startSec)
      return <article key={clip.id} className="min-w-0"><button type="button" onClick={() => setPlaying(clip)} aria-label={`${t.playClip}: ${clip.title || `${t.clip} ${index + 1}`}`} className="group block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="relative block aspect-[9/16] overflow-hidden rounded-lg border border-border bg-black shadow-lg shadow-black/20"><video src={`/api/clips/${clip.id}/stream`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" className="size-full object-contain transition duration-300 group-hover:scale-[1.02] group-hover:opacity-80"/><span className="absolute bottom-2 right-2 rounded bg-black/85 px-1.5 py-1 font-mono text-[11px] tabular-nums text-white">{Math.floor(duration / 60)}:{String(Math.round(duration % 60)).padStart(2, "0")}</span><span className="absolute inset-0 grid place-items-center bg-black/0 text-white transition group-hover:bg-black/20"><span className="grid size-11 place-items-center rounded-full border border-white/60 bg-black/55"><Play className="ml-0.5 size-4 fill-current"/></span></span></span><span className="mt-3 block line-clamp-2 min-h-10 text-sm font-medium leading-5">{clip.title || `${t.clip} ${index + 1}`}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{sourceLabel(clip.job.url)}{relativeAge(clip.createdAt, locale) ? ` · ${relativeAge(clip.createdAt, locale)}` : ""}</span></button><Link to="/jobs/$jobId" params={{ jobId: clip.job.id }} className="mt-2 inline-flex min-h-10 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">{t.openJob}<ArrowUpRight className="size-3.5"/></Link></article>
    })}</div> : <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-card/40 px-5 text-center"><div><p className="font-medium">{clips.data?.length ? t.noSearchResults : t.empty}</p><p className="mt-2 text-sm text-muted-foreground">{clips.data?.length ? t.noSearchResults : t.startNow}</p></div></div>}
    <Dialog open={!!playing} onOpenChange={(open) => { if (!open) setPlaying(null) }}>
      {playing && <DialogContent className="max-w-4xl gap-3 p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><DialogTitle className="truncate font-display text-base">{playing.title || t.clip}</DialogTitle><DialogDescription className="mt-1 truncate">{sourceLabel(playing.job.url)}</DialogDescription></div><DialogClose asChild><Button type="button" variant="outline" className="size-10 shrink-0 px-0" aria-label={t.closePlayer}><X className="size-4"/></Button></DialogClose></div><video key={playing.id} src={`/api/clips/${playing.id}/stream`} controls autoPlay playsInline className="mx-auto max-h-[min(72dvh,760px)] w-full rounded-md bg-black object-contain"/><div className="flex justify-end"><Link to="/jobs/$jobId" params={{ jobId: playing.job.id }} className="inline-flex min-h-11 items-center gap-2 px-3 text-sm text-muted-foreground transition-colors hover:text-foreground">{t.openJob}<ArrowUpRight className="size-4"/></Link></div></DialogContent>}
    </Dialog>
  </WorkspaceShell>
}
