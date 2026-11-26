import { createFileRoute, redirect } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw, Search } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { WorkspaceShell } from "@/components/chrome"
import { api, refreshBulkPublicationMetrics, type RecentClip, type User } from "@/lib/api"
import { getCurrentUser } from "@/lib/auth"
import { relativeAge, sourceLabel } from "@/lib/format"
import { useLanguage, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { ClipCard, ClipCardGrid, type ClipCardData } from "@/components/clip-card"

export const Route = createFileRoute("/clips")({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: "/login", search: { redirect: location.href } })
    return { user }
  },
  component: ClipsPage,
})

function ClipsPage() {
  const { user } = Route.useRouteContext() as { user: User }
  const t = useT()
  const locale = useLanguage().language === "id" ? "id" : "en"
  const client = useQueryClient()
  const [search, setSearch] = useState("")
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
  const publishedClipIds = useMemo(() => (clips.data ?? []).filter((clip) => clip.publications?.some((pub) => pub.status === "published")).map((clip) => clip.id), [clips.data])
  const refreshStats = useMutation({
    mutationFn: (clipIds: string[]) => refreshBulkPublicationMetrics(clipIds),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      void client.invalidateQueries({ queryKey: ["jobs"] })
      if (result.refreshed > 0) {
        toast.success(result.refreshed === 1 ? t.statsRefreshedOne : t.statsRefreshed.replace("{count}", String(result.refreshed)))
      } else {
        toast.info(t.statsUpToDate)
      }
    },
    onError: () => toast.error(t.statsRefreshFailed),
  })

  return <WorkspaceShell user={user}>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4 sm:mb-7 sm:gap-5 sm:pb-6">
      <div><h2 className="font-display text-3xl font-medium tracking-[-.045em]">{t.clips}</h2><p className="mt-2 text-sm text-muted-foreground">{t.latestFirst}</p></div>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2.5 sm:w-auto">
        {publishedClipIds.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full min-h-10 gap-1.5 px-3 sm:w-auto sm:min-h-9"
            disabled={refreshStats.isPending}
            onClick={() => refreshStats.mutate(publishedClipIds)}
          >
            <RefreshCw aria-hidden="true" className={cn("size-3.5", refreshStats.isPending && "animate-spin")}/>
            {refreshStats.isPending ? t.refreshingStats : t.refreshStats}
          </Button>
        )}
        <div className="relative w-full sm:w-72"><Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><label className="sr-only" htmlFor="clip-search">{t.searchClips}</label><Input ref={searchRef} id="clip-search" type="search" placeholder={t.searchClips} value={search} onChange={(event) => setSearch(event.target.value)} className="h-11 bg-card pl-9 pr-3 sm:pr-16 [@media(hover:none)]:pr-3"/><kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-flex [@media(hover:none)]:hidden">{t.searchShortcut}</kbd></div>
      </div>
    </div>
    {clips.isPending ? <div role="status" aria-label={t.loading} className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">{[0,1,2,3,4,5,6,7].map((item) => <div key={item}><Skeleton className="aspect-[9/16] w-full rounded-lg"/><Skeleton className="mt-3 h-4 w-4/5"/><Skeleton className="mt-2 h-3 w-2/3"/></div>)}</div> : clips.isError ? <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{t.apiError}</span><Button variant="outline" onClick={() => clips.refetch()}>{t.retry}</Button></AlertDescription></Alert> : filtered.length ? <ClipCardGrid aspectRatio="9:16">{filtered.map((clip, index) => <ClipCard key={clip.id} frame="uniform" clip={clip as ClipCardData} index={index} meta={`${sourceLabel(clip.job.url)} · ${relativeAge(clip.createdAt, locale)}`}/>)}</ClipCardGrid> : <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-card/40 px-5 text-center"><div><p className="font-medium">{clips.data?.length ? t.noSearchResults : t.empty}</p><p className="mt-2 text-sm text-muted-foreground">{clips.data?.length ? t.noSearchResults : t.startNow}</p></div></div>}
  </WorkspaceShell>
}
