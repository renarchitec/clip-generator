import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Captions, CircleAlert, LoaderCircle, Play, Trash2, Users, Video } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { api, apiUrl, type Job, type JobSnapshot, type User } from "@/lib/api"
import { DEFAULT_CAPTION_STYLE, detectCaptionPreset, normalizeCaptionStyle } from "@/lib/caption-style"
import { WorkspaceShell } from "@/components/chrome"
import { useT } from "@/lib/i18n"
import { getCurrentUser } from "@/lib/auth"
import { sourceLabel } from "@/lib/format"
import { getVideoEmbed } from "@/lib/embed"
import { LlmStatus } from "@/components/llm-status"
import { JobAssembly } from "@/components/job-assembly"
import { ClipCard, ClipCardGrid } from "@/components/clip-card"
import { useWatermarkLibrary } from "@/components/watermark-manager"
import { useOutroLibrary } from "@/components/outro-manager"
import { formatOutroDuration } from "@/lib/outro"

export const Route = createFileRoute("/jobs/$jobId")({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: "/login", search: { redirect: location.href } })
    return { user }
  },
  component: JobDetail,
})

type Copy = ReturnType<typeof useT>

const aspectShapes = { "9:16": "h-5 w-3", "1:1": "size-4", "16:9": "w-6 h-3.5" } as const

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  return `${String(minutes).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`
}

function scanDurationLabel(maxSourceSec: Job["maxSourceSec"], t: Copy) {
  if (maxSourceSec === null || maxSourceSec === undefined) return t.fullVideo
  const presets: Record<number, string> = {
    600: t.tenMinutes,
    1200: t.twentyMinutes,
    1800: t.thirtyMinutes,
    3600: t.sixtyMinutes,
    5400: t.ninetyMinutes,
  }
  return presets[maxSourceSec] ?? t.scannedFirst.replace("{count}", String(Math.round(maxSourceSec / 60)))
}

function aspectDescription(aspectRatio: Job["aspectRatio"], t: Copy) {
  return { "9:16": t.aspectPortrait, "1:1": t.aspectSquare, "16:9": t.aspectLandscape }[aspectRatio]
}

function JobDetail() {
  const { jobId } = Route.useParams()
  const { user } = Route.useRouteContext() as { user: User }
  const t = useT()
  const client = useQueryClient()
  const navigate = useNavigate()
  const queryKey = useMemo(() => ["jobs", jobId], [jobId])
  const watermarks = useWatermarkLibrary()
  const outros = useOutroLibrary()
  const job = useQuery({
    queryKey,
    queryFn: () => api<JobSnapshot>(`/jobs/${jobId}`),
    retry: (failureCount, err) => {
      if ((err as Error & { status?: number }).status === 404) return false
      return failureCount < 3
    },
    refetchInterval: (query) => {
      if ((query.state.error as (Error & { status?: number }) | null)?.status === 404) return false
      return query.state.data && ["done", "failed", "cancelled"].includes(query.state.data.status) ? false : 3000
    },
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
  const [deleteJobOpen, setDeleteJobOpen] = useState(false)
  const deleteJob = useMutation({
    mutationFn: () => api<void>(`/jobs/${jobId}`, { method: "DELETE" }),
    onSuccess: () => {
      client.removeQueries({ queryKey })
      void client.invalidateQueries({ queryKey: ["jobs"] })
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      toast.success(t.jobDeleted)
      void navigate({ to: "/jobs" })
    },
    onError: () => toast.error(t.jobDeleteFailed),
    onSettled: () => setDeleteJobOpen(false),
  })
  const terminal = (job.error as (Error & { status?: number }) | null)?.status === 404 || (!!job.data && ["done", "failed", "cancelled"].includes(job.data.status))

  useEffect(() => {
    if (terminal) return
    const source = new EventSource(apiUrl(`/jobs/${jobId}/events`))
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

  const snapshot = job.data
  const embed = snapshot ? getVideoEmbed(snapshot.url) : null
  const activeClips = snapshot?.clips.filter((clip) => !clip.deletedAt) ?? []
  const clipCount = snapshot?.clipCount ?? snapshot?.ranges?.length ?? 0
  const running = snapshot?.status === "queued" || snapshot?.status === "running"
  const failed = snapshot?.status === "failed" || snapshot?.status === "cancelled"

  return (
    <WorkspaceShell user={user}>
      <h1 className="sr-only">{t.jobDetails}</h1>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to="/jobs" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft aria-hidden="true" className="size-4" />{t.back}
        </Link>
        {snapshot && <LlmStatus jobStatus={snapshot.status} />}
      </div>

      {job.isPending ? (
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,400px)] lg:grid-rows-[minmax(560px,calc(100vh-120px))_auto]" aria-label={t.loading}>
          <Skeleton className="h-96 w-full rounded-xl lg:col-start-1 lg:row-start-1 lg:h-full" />
          <Skeleton className="h-96 w-full rounded-xl lg:col-start-2 lg:row-start-1 lg:h-full" />
          <Skeleton className="h-40 w-full rounded-xl lg:col-span-2 lg:row-start-2" />
        </div>
      ) : job.isError ? (
        (job.error as Error & { status?: number }).status === 404 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
            <p className="font-medium">{t.jobNotFound}</p>
            <Button variant="outline" asChild className="mt-4 min-h-11"><Link to="/jobs">{t.back}</Link></Button>
          </div>
        ) : (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{t.apiError}</span>
              <Button variant="outline" onClick={() => job.refetch()}>{t.retry}</Button>
            </AlertDescription>
          </Alert>
        )
      ) : snapshot ? (
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,400px)] lg:grid-rows-[minmax(560px,calc(100vh-120px))_auto]">
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:col-start-1 lg:row-start-1 lg:h-full" aria-label={t.sourceMonitor}>
            <div className="flex min-h-11 items-center border-b border-border px-4 text-sm text-muted-foreground">{sourceLabel(snapshot.url)}</div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted p-4">
              <div className={`relative aspect-video w-full max-w-full overflow-hidden shadow-xl ${embed ? "bg-black" : "border border-border bg-[radial-gradient(ellipse_at_center,var(--monitor-empty-center),var(--monitor-empty-edge))]"}`}>
                {embed ? <iframe key={embed.src} src={embed.src} title={embed.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="absolute inset-0 size-full border-0" /> : <div className="absolute inset-0 grid place-items-center"><div className="max-w-xs px-5 text-center"><span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl border border-border bg-card text-primary shadow-sm"><Play aria-hidden="true" className="ml-1 size-5" /></span><p className="font-display text-lg text-foreground">{sourceLabel(snapshot.url)}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.sourceUrl}</p></div></div>}
              </div>
            </div>
            <div className="shrink-0 border-t border-border bg-card p-4">
              <Field>
                <FieldTitle className="text-sm font-medium text-foreground">{t.sourceUrl}</FieldTitle>
                <div className="mt-2 flex min-h-14 items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
                  <Play aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 break-all">{snapshot.url}</span>
                </div>
              </Field>
            </div>
          </section>

          <aside className="relative min-h-0 min-w-0 overflow-hidden rounded-xl border border-border bg-card lg:col-start-2 lg:row-start-1 lg:flex lg:h-full lg:max-h-full lg:flex-col">
            <div className="shrink-0 border-b border-border px-4 py-3"><h2 className="font-display text-lg font-medium">{t.settings}</h2></div>
            <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="space-y-4">
                <Field>
                  <FieldTitle>{t.creationMode}</FieldTitle>
                  <div className="mt-2 rounded-md bg-secondary p-1" role="group" aria-label={t.creationMode}>
                    <div className="flex h-10 items-center justify-center rounded-sm bg-accent text-sm font-medium text-accent-foreground">{snapshot.mode === "manual" ? t.manualMode : t.autoMode}</div>
                  </div>
                </Field>

                {snapshot.mode !== "manual" && <Field>
                  <FieldTitle>{t.videoDurationScan}</FieldTitle>
                  <div className="mt-2 flex min-h-11 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-foreground">{scanDurationLabel(snapshot.maxSourceSec, t)}</div>
                  <FieldDescription>{t.scanDurationHint}</FieldDescription>
                </Field>}

                <Field>
                  <FieldTitle>{t.outputFormat}</FieldTitle>
                  <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-lg bg-secondary p-1">
                    <div className="flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-md border border-accent/50 bg-accent/15 px-1 py-2.5 shadow-sm">
                      <span aria-hidden="true" className={`block ${aspectShapes[snapshot.aspectRatio]} rounded-[3px] border-2 border-accent`} />
                      <span className="font-mono text-xs font-semibold tabular-nums text-foreground">{snapshot.aspectRatio}</span>
                    </div>
                  </div>
                  <p className="mt-2 truncate text-xs text-muted-foreground">{aspectDescription(snapshot.aspectRatio, t)}</p>
                </Field>

                {snapshot.aspectRatio !== "16:9" && !snapshot.twoSpeakers && !snapshot.facecam && <Field>
                  <FieldTitle>{t.portraitReframe}</FieldTitle>
                  <div className="mt-2 flex min-w-0 items-start gap-2 rounded-md bg-accent/15 px-2 py-2 ring-1 ring-accent/40">
                    <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-accent bg-accent"><span className="size-1.5 rounded-full bg-accent-foreground" /></span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-5 text-foreground">{{ face_tracking: t.faceTracking, blurred_fill: t.blurredFill, black_bars: t.blackBars }[snapshot.reframe]}</span>
                      <span className="block whitespace-normal text-xs leading-4 text-muted-foreground">{{ face_tracking: t.faceTrackingHint, blurred_fill: t.blurredFillHint, black_bars: t.blackBarsHint }[snapshot.reframe]}</span>
                    </span>
                  </div>
                </Field>}

                {(snapshot.twoSpeakers || snapshot.facecam || snapshot.captions) && <Field>
                  <FieldTitle>{t.processingOptions}</FieldTitle>
                  <div className="mt-2 divide-y divide-border border-y border-border">
                    {[
                      ...(snapshot.twoSpeakers ? [{ key: "two-speakers", icon: Users, label: t.twoSpeakers, hint: t.twoSpeakersHint }] : []),
                      ...(snapshot.facecam ? [{ key: "facecam", icon: Video, label: t.facecam, hint: t.facecamHint }] : []),
                      ...(snapshot.captions ? [{ key: "burn-captions", icon: Captions, label: t.burnCaptions, hint: t.burnCaptionsHint }] : []),
                    ].map(({ key, icon: Icon, label, hint }) => (
                      <div key={key} className="flex min-h-12 items-center gap-3 py-2.5">
                        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}</span><span className="block text-xs leading-relaxed text-muted-foreground">{hint}</span></span>
                      </div>
                    ))}
                  </div>
                </Field>}

                {snapshot.captions && (() => {
                  const captionStyle = normalizeCaptionStyle(snapshot.captionStyle ?? DEFAULT_CAPTION_STYLE)
                  return <Field>
                    <FieldTitle>{t.captionStyle}</FieldTitle>
                    <div className="mt-2 rounded-md border border-border bg-muted/40 p-3">
                      <div className="flex items-center justify-between gap-2"><Badge variant="secondary" className="text-[10px]">{t.captionPresetNames[detectCaptionPreset(captionStyle)]}</Badge><span className="font-mono text-xs tabular-nums text-foreground">{captionStyle.fontFamily} · {captionStyle.fontSize}px</span></div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{t.captionEffect}: {t.captionEffectNames[captionStyle.effect]}</span><span>{t.captionPosition}: {t.captionPositionNames[captionStyle.position]}</span></div>
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-3.5 rounded-full border border-black/15" style={{ backgroundColor: captionStyle.primaryColor }} />{t.captionPrimaryColor}</span><span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-3.5 rounded-full border border-black/15" style={{ backgroundColor: captionStyle.highlightColor }} />{t.captionHighlightColor}</span></div>
                    </div>
                  </Field>
                })()}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldTitle>{t.clipCount}</FieldTitle>
                    <div className="mt-2 flex min-h-11 items-center rounded-md border border-border bg-muted/40 px-3 font-mono text-sm tabular-nums text-foreground">{clipCount}</div>
                  </Field>
                  <Field>
                    <FieldTitle>{t.duration}</FieldTitle>
                    <div className="mt-2 flex min-h-11 items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 font-mono text-sm tabular-nums text-foreground">
                      <span>{snapshot.targetDurationSec ?? "—"}</span><span className="text-xs text-muted-foreground">{t.seconds}</span>
                    </div>
                  </Field>
                </div>

                <Field>
                  <FieldTitle>{t.captionLanguage}</FieldTitle>
                  <div className="mt-2 flex min-h-11 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-foreground">{t.captionLanguageOptions[snapshot.captionLanguage ?? "auto"] ?? t.captionLanguageOptions.auto}</div>
                  <FieldDescription>{t.captionLanguageHint}</FieldDescription>
                </Field>

                {snapshot.customHashtags && snapshot.customHashtags.length > 0 && <Field>
                  <FieldTitle>{t.customHashtags}</FieldTitle>
                  <div className="mt-2 flex flex-wrap gap-1.5 rounded-md border border-border bg-muted/40 p-2.5">
                    {snapshot.customHashtags.map((tag) => <Badge key={tag} variant="secondary" className="font-mono text-xs font-normal">#{tag}</Badge>)}
                  </div>
                  <FieldDescription>{t.customHashtagsHint}</FieldDescription>
                </Field>}

                {snapshot.watermark && <Field>
                   <FieldTitle>{t.watermark}</FieldTitle>
                   <div className="mt-2 flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3">
                     <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-background text-xs text-muted-foreground">{watermarks.data?.find((item) => item.id === snapshot.watermark?.watermarkId) ? <img src={apiUrl(watermarks.data.find((item) => item.id === snapshot.watermark?.watermarkId)?.url ?? "")} alt="" className="size-full object-contain"/> : "—"}</span>
                     <div className="min-w-0 flex-1 font-mono text-xs tabular-nums text-foreground">
                       <p>{t.watermarkPosition}: {Math.round(snapshot.watermark.x * 100)}%, {Math.round(snapshot.watermark.y * 100)}%</p>
                       <p>{t.watermarkSize}: {Math.round(snapshot.watermark.scale * 100)}% · {t.watermarkOpacity}: {Math.round(snapshot.watermark.opacity * 100)}%</p>
                       {snapshot.watermark.filePath && <p className="mt-0.5 truncate text-muted-foreground" title={snapshot.watermark.filePath}>{snapshot.watermark.filePath}</p>}
                     </div>
                   </div>
                 </Field>}

                 {snapshot.outro && <Field>
                   <FieldTitle>{t.outro}</FieldTitle>
                   <div className="mt-2 flex min-h-11 items-center gap-3 rounded-md border border-border bg-muted/40 px-3 text-sm text-foreground">
                     <span className="min-w-0 flex-1 truncate">{outros.data?.find((item) => item.id === snapshot.outro?.outroId)?.name ?? t.outro}</span>
                     <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">+{formatOutroDuration(snapshot.outro.durationSec)}</span>
                   </div>
                 </Field>}

                 {snapshot.description && <Field>
                  <FieldTitle>{t.description}</FieldTitle>
                  <p className="mt-2 whitespace-pre-wrap rounded-md border border-border/80 bg-secondary/25 p-3 text-sm leading-relaxed text-muted-foreground">{snapshot.description}</p>
                </Field>}

                {snapshot.mode === "manual" && !!snapshot.ranges?.length && <Field>
                  <FieldTitle>{t.manualRanges}</FieldTitle>
                  <ul className="mt-2 space-y-2">
                    {snapshot.ranges.map((range, index) => <li key={`${range.start}-${range.end}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-3 py-2 text-sm"><span className="font-mono tabular-nums">{formatTime(range.start)}–{formatTime(range.end)}</span><Badge variant="secondary" className="rounded-full font-normal">{index + 1}</Badge></li>)}
                  </ul>
                </Field>}
              </div>
            </div>
            <div className="sticky bottom-0 border-t border-border bg-card/95 px-4 py-3">
              <div className="flex flex-col gap-3">
                <p className="text-xs leading-5 text-muted-foreground">
                  {snapshot.mode === "manual" ? t.manualSummary.replace("{count}", String(snapshot.ranges?.length ?? clipCount)) : t.autoSummary.replace("{count}", String(clipCount)).replace("{duration}", String(snapshot.targetDurationSec ?? ""))}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" asChild className="h-11 min-w-0 rounded-md px-2"><Link to="/" search={{ from: snapshot.id }}>{t.regenerate}</Link></Button>
                  <AlertDialog open={deleteJobOpen} onOpenChange={setDeleteJobOpen}>
                    <AlertDialogTrigger asChild><Button variant="outline" className="h-11 min-w-0 rounded-md px-2 text-destructive hover:text-destructive" aria-label={`${t.deleteJob}: ${snapshot.url}`}><Trash2 aria-hidden="true" className="mr-2 size-4 shrink-0" />{t.deleteJob}</Button></AlertDialogTrigger>
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
                {running && <Button variant="outline" className="h-11 w-full rounded-md" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                  {cancel.isPending && <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />}{t.cancel}
                </Button>}
              </div>
            </div>
          </aside>

          <section aria-labelledby="results-heading" className="mt-0 min-w-0 overflow-hidden rounded-xl border border-border bg-card lg:col-span-2 lg:row-start-2">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h2 id="results-heading" className="font-display text-lg font-medium">{t.results}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={snapshot.status === "failed" ? "destructive" : snapshot.status === "done" ? "secondary" : "outline"} className="rounded-md font-normal">{t.status[snapshot.status]}</Badge>
                <span className="font-mono text-xs tabular-nums text-muted-foreground"># {snapshot.id}</span>
              </div>
            </div>
            <div className="p-4">
              {failed ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
                      <div>
                        <p className="font-medium">{t.status[snapshot.status]}</p>
                        <p className="mt-1 break-words text-sm text-muted-foreground">{snapshot.error || (snapshot.status === "failed" ? t.jobFailedFallback : t.jobCancelledFallback)}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:shrink-0">
                      <Button className="min-h-11" disabled={retryJob.isPending} onClick={() => retryJob.mutate()}>
                        {retryJob.isPending && <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />}{t.retryJobInline}
                      </Button>
                      <Button variant="outline" asChild className="min-h-11"><Link to="/">{t.newSource}</Link></Button>
                    </div>
                  </div>
                  {activeClips.length > 0 && (
                    <>
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
                        <p className="font-medium">{activeClips.length} {t.clipsReady}</p>
                      </div>
                      <ClipCardGrid aspectRatio={snapshot.aspectRatio} aria-label={t.readyClips}>
                        {activeClips.map((clip, index) => <ClipCard key={clip.id} clip={{ ...clip, job: { id: snapshot.id, url: snapshot.url, aspectRatio: snapshot.aspectRatio } }} index={index} meta={`${formatTime(clip.startSec)}–${formatTime(clip.endSec)}`} downloaded={!!clip.downloadedAt} />)}
                      </ClipCardGrid>
                    </>
                  )}
                </div>
              ) : running ? (
                <JobAssembly job={snapshot} t={t} />
              ) : snapshot.status === "done" && activeClips.length > 0 ? (
                <>
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{activeClips.length} {t.clipsReady}</p>
                      <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">{t.complete}</p>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-muted-foreground">100%</span>
                  </div>
                  <ClipCardGrid aspectRatio={snapshot.aspectRatio} aria-label={t.readyClips}>
                    {activeClips.map((clip, index) => <ClipCard key={clip.id} clip={{ ...clip, job: { id: snapshot.id, url: snapshot.url, aspectRatio: snapshot.aspectRatio } }} index={index} meta={`${formatTime(clip.startSec)}–${formatTime(clip.endSec)}`} downloaded={!!clip.downloadedAt} />)}
                  </ClipCardGrid>
                </>
              ) : (
                <div className="grid min-h-28 place-items-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">{t.generatedAppear}</div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </WorkspaceShell>
  )
}
