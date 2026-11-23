import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Check, CircleAlert, LoaderCircle, RotateCcw, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type JobSnapshot, type User } from "@/lib/api"
import { WorkspaceShell } from "@/components/chrome"
import { useT } from "@/lib/i18n"
import { getCurrentUser } from "@/lib/auth"
import { LlmStatus } from "@/components/llm-status"
import { JobAssembly } from "@/components/job-assembly"
import { ClipCard, ClipCardGrid } from "@/components/clip-card"

export const Route = createFileRoute("/jobs/$jobId")({
  beforeLoad: async () => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: "/login" })
    return { user }
  },
  component: JobDetail,
})

const orderedStages = ["download", "transcribe", "select", "render", "save"] as const

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  return `${String(minutes).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`
}

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function JobDetail() {
  const { jobId } = Route.useParams()
  const { user } = Route.useRouteContext() as { user: User }
  const t = useT()
  const client = useQueryClient()
  const navigate = useNavigate()
  const queryKey = useMemo(() => ["jobs", jobId], [jobId])
  const job = useQuery({
    queryKey,
    queryFn: () => api<JobSnapshot>(`/jobs/${jobId}`),
    refetchInterval: (query) => query.state.data && ["done", "failed", "cancelled"].includes(query.state.data.status) ? false : 3000,
  })
  const cancel = useMutation({ mutationFn: () => api(`/jobs/${jobId}/cancel`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey }) })
  const retryJob = useMutation({
    mutationFn: () => api<JobSnapshot>(`/jobs/${jobId}/retry`, { method: "POST" }),
    onSuccess: (next) => {
      void client.invalidateQueries({ queryKey: ["jobs"] })
      toast.success(t.retryStarted)
      void navigate({ to: "/jobs/$jobId", params: { jobId: next.id } })
    },
    onError: () => toast.error(t.retryFailed),
  })
  const [deletingClip, setDeletingClip] = useState<string | null>(null)
  const [deleteJobOpen, setDeleteJobOpen] = useState(false)
  const deleteJob = useMutation({
    mutationFn: () => api<void>(`/jobs/${jobId}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["jobs"] })
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      toast.success(t.jobDeleted)
      void navigate({ to: "/" })
    },
    onError: () => toast.error(t.jobDeleteFailed),
    onSettled: () => setDeleteJobOpen(false),
  })
  const deleteClip = useMutation({
    mutationFn: (clipId: string) => api(`/clips/${clipId}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey })
      void client.invalidateQueries({ queryKey: ["jobs"] })
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      toast.success(t.clipDeleted)
    },
    onError: () => toast.error(t.clipDeleteFailed),
    onSettled: () => setDeletingClip(null),
  })
  const terminal = !!job.data && ["done", "failed", "cancelled"].includes(job.data.status)

  useEffect(() => {
    if (terminal) return
    const source = new EventSource(`/api/jobs/${jobId}/events`)
    source.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as JobSnapshot
        client.setQueryData(queryKey, snapshot)
        if (snapshot.status === "done") void client.invalidateQueries({ queryKey: ["clips", "recent"] })
        if (["done", "failed", "cancelled"].includes(snapshot.status)) source.close()
      } catch {
        // Ignore malformed event payloads and keep the query as the source of truth.
      }
    }
    source.onerror = () => source.close()
    return () => source.close()
  }, [jobId, terminal, client, queryKey])

  const stage = useMemo(() => job.data?.stage ? t.stages[job.data.stage] : t.status.queued, [job.data?.stage, t])

  return (
    <WorkspaceShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to="/jobs" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft aria-hidden="true" className="size-4" />{t.back}
        </Link>
        {job.data && <LlmStatus jobStatus={job.data.status} />}
      </div>

      {job.isPending ? (
        <div className="space-y-4" aria-label={t.loading}>
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>
      ) : job.isError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t.apiError}</span>
            <Button variant="outline" onClick={() => job.refetch()}>{t.retry}</Button>
          </AlertDescription>
        </Alert>
      ) : job.data && (
        <>
          <section className="mb-8 border-b border-border pb-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={job.data.status === "failed" ? "destructive" : job.data.status === "done" ? "secondary" : "outline"} className="rounded-md font-normal">
                    {t.status[job.data.status]}
                  </Badge>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground"># {job.data.id}</span>
                </div>
                <h1 className="truncate font-display text-2xl font-medium tracking-[-.04em] sm:text-3xl">{sourceHost(job.data.url)}</h1>
                <a href={job.data.url} target="_blank" rel="noreferrer" className="mt-1 block max-w-full break-all text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{job.data.url}</a>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                  <span>{job.data.mode === "manual" ? t.manualMode : t.autoMode}</span>
                  <span>{job.data.aspectRatio}</span>
                  <span>{t.reframeLabel}: {{ face_tracking: t.faceTracking, blurred_fill: t.blurredFill, black_bars: t.blackBars }[job.data.reframe]}</span>
                  <span>{t.captionsStatus}: {job.data.captions ? t.captionsOn : t.captionsOff}</span>
                  {(job.data.clipCount ?? job.data.ranges?.length) && <span>{job.data.clipCount ?? job.data.ranges?.length} {t.clipsRequested}</span>}
                  {job.data.targetDurationSec && <span>{job.data.targetDurationSec} {t.seconds}</span>}
                  <span>{t.speakersLabel}: {job.data.facecam ? t.layoutFacecam : job.data.twoSpeakers ? t.layoutTwoSpeakers : t.layoutSingle}</span>
                  {job.data.maxSourceSec && <span>{t.scannedFirst.replace("{count}", String(job.data.maxSourceSec / 60))}</span>}
                </div>
                {job.data.description && (
                  <p className="mt-4 max-w-3xl whitespace-pre-wrap border-l border-border pl-3 text-sm leading-relaxed text-muted-foreground">{job.data.description}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <Button variant="outline" asChild><Link to="/" search={{ from: jobId }}>{t.regenerate}</Link></Button>
                <AlertDialog open={deleteJobOpen} onOpenChange={setDeleteJobOpen}>
                  <AlertDialogTrigger asChild><Button variant="outline" className="text-destructive hover:text-destructive" aria-label={`${t.deleteJob}: ${job.data.url}`}><Trash2 aria-hidden="true" className="mr-2 size-4" />{t.deleteJob}</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>{t.deleteJob}?</AlertDialogTitle><AlertDialogDescription>{t.deleteJobWarning}</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deleteJob.isPending}>{t.cancel}</AlertDialogCancel>
                      <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteJob.isPending} onClick={(event) => { event.preventDefault(); deleteJob.mutate() }}>
                        {deleteJob.isPending && <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />}{t.deleteJob}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </section>

          <section aria-label={t.processing} className="mb-10 rounded-lg border border-border bg-card p-4 sm:p-6">
            {job.data.status === "failed" || job.data.status === "cancelled" ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
                  <div>
                    <h2 className="font-medium">{t.status[job.data.status]}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{job.data.error || (job.data.status === "failed" ? t.jobFailedFallback : t.jobCancelledFallback)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <Button disabled={retryJob.isPending} onClick={() => retryJob.mutate()}>
                    {retryJob.isPending ? <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" /> : <RotateCcw aria-hidden="true" className="mr-2 size-4" />}{t.retryJob}
                  </Button>
                  <Button variant="outline" asChild><Link to="/">{t.newSource}</Link></Button>
                </div>
              </div>
            ) : (
              <>
                {job.data.status === "queued" || job.data.status === "running" ? <JobAssembly job={job.data} t={t} /> : <>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-medium">{job.data.status === "done" ? `${job.data.clips.filter((clip) => !clip.deletedAt).length} ${t.clipsReady}` : stage}</h2>
                    <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">{job.data.status === "done" ? t.complete : job.data.message || stage}</p>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-muted-foreground">{job.data.status === "done" ? "100%" : `${Math.max(0, Math.min(100, job.data.progress ?? 0))}%`}</span>
                </div>
                <div role="progressbar" aria-label={t.processing} aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.data.status === "done" ? 100 : Math.max(0, Math.min(100, job.data.progress ?? 0))} className="mb-6 h-1 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${job.data.status === "done" ? 100 : Math.max(0, Math.min(100, job.data.progress ?? 0))}%` }} />
                </div>
                <ol className="grid gap-3 sm:grid-cols-5">
                  {orderedStages.map((key, index) => {
                    const currentIndex = orderedStages.indexOf(job.data.stage ?? "download")
                    const done = job.data.status === "done" || (job.data.status !== "queued" && index < currentIndex)
                    const current = job.data.status !== "done" && index === currentIndex
                    return <li key={key} className={`min-w-0 border-l-2 pl-3 ${current ? "border-primary text-foreground" : done ? "border-primary/50 text-muted-foreground" : "border-border text-muted-foreground"}`}>
                      <div className="flex items-center gap-2 text-xs">
                        {done ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary" /> : current ? <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-primary" /> : <span aria-hidden="true" className="size-3.5 shrink-0 rounded-full border border-border" />}
                        <span className="truncate">{t.stages[key]}</span>
                      </div>
                      {current && <p className="mt-1 pl-[22px] text-xs text-muted-foreground">{job.data.message ? `${job.data.message} · ${job.data.progress ?? 0}%` : `${job.data.progress ?? 0}%`}</p>}
                    </li>
                  })}
                </ol>
                </>}
                {(job.data.status === "queued" || job.data.status === "running") && <div className="mt-5 flex justify-end border-t border-border pt-4">
                  <Button variant="outline" className="min-h-11" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                    {cancel.isPending && <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />}{t.cancel}
                  </Button>
                </div>}
              </>
            )}
          </section>

          {job.data.clips.some((clip) => !clip.deletedAt) && (
            <section>
              <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-border pb-3">
                <h2 className="font-display text-xl font-medium tracking-[-.03em]">{t.readyClips}</h2>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{job.data.clips.filter((clip) => !clip.deletedAt).length}</span>
              </div>
              <ClipCardGrid aspectRatio={job.data.aspectRatio}>
                {job.data.clips.filter((clip) => !clip.deletedAt).map((clip, index) => (
                  <ClipCard key={clip.id} clip={{ ...clip, job: { id: job.data.id, url: job.data.url, aspectRatio: job.data.aspectRatio } }} index={index} meta={`${formatTime(clip.startSec)}–${formatTime(clip.endSec)}`} downloaded={!!clip.downloadedAt} deleteAction={<AlertDialog open={deletingClip === clip.id} onOpenChange={(open) => setDeletingClip(open ? clip.id : null)}>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-10 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`${t.deleteClip}: ${clip.title || `#${index + 1}`}`} disabled={deleteClip.isPending}>
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader><AlertDialogTitle>{t.deleteClipTitle}</AlertDialogTitle><AlertDialogDescription>{t.deleteClipDescription}</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteClip.isPending} onClick={(event) => { event.preventDefault(); deleteClip.mutate(clip.id) }}>
                          {deleteClip.isPending && deletingClip === clip.id && <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />}{t.confirmDelete}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>} />
                ))}
              </ClipCardGrid>
            </section>
          )}
        </>
      )}
    </WorkspaceShell>
  )
}
