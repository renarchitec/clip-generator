import { createFileRoute, Link, redirect, useNavigate, useSearch } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDownRight, ArrowUpRight, Check, Clock3, LoaderCircle, Play, Plus, Scissors, Sparkles, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type Job, type JobPreview, type JobSnapshot, type User } from "@/lib/api"
import { WorkspaceShell } from "@/components/chrome"
import { useT } from "@/lib/i18n"
import { getCurrentUser } from "@/lib/auth"
import { clearReviewDraft, loadReviewDraft, saveReviewDraft } from "@/lib/review-draft"
import { LlmStatus } from "@/components/llm-status"

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: "/login" })
    return { user }
  },
  validateSearch: (search: Record<string, unknown>): { from?: string } => (typeof search.from === "string" ? { from: search.from } : {}),
  component: Dashboard,
})

type ClipRange = { start: string; end: string }
type RangePayload = { start: number; end: number; title?: string; reason?: string }
type JobInput = { url: string; mode: "auto" | "manual"; reframe: Job["reframe"]; captions: boolean; twoSpeakers: boolean; aspectRatio: Job["aspectRatio"]; maxSourceSec?: number | null; clipCount?: number; targetDurationSec: number; description?: string; ranges?: RangePayload[] }

function formatMomentTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

type ReviewPanelProps = {
  preview?: JobPreview | undefined
  loading: boolean
  error: string
  t: ReturnType<typeof useT>
  selectedCandidates: number[]
  setSelectedCandidates: React.Dispatch<React.SetStateAction<number[]>>
  selectedCueStart: number | null
  setSelectedCueStart: React.Dispatch<React.SetStateAction<number | null>>
  selectedCueEnd: number | null
  setSelectedCueEnd: React.Dispatch<React.SetStateAction<number | null>>
  cueRanges: { start: number; end: number }[]
  setCueRanges: React.Dispatch<React.SetStateAction<{ start: number; end: number }[]>>
  createPending: boolean
  renderSelected: (ranges: RangePayload[]) => void
  retry: () => void
  reviewRef: React.RefObject<HTMLDivElement | null>
}

function ReviewPanel({ preview, loading, error, t, selectedCandidates, setSelectedCandidates, selectedCueStart, setSelectedCueStart, selectedCueEnd, setSelectedCueEnd, cueRanges, setCueRanges, createPending, renderSelected, retry, reviewRef }: ReviewPanelProps) {
  const candidates = preview?.candidates ?? []
  const cues = preview?.cues ?? []
  const selectedCount = selectedCandidates.length + cueRanges.length
  const addCueRange = () => {
    if (selectedCueStart === null || selectedCueEnd === null) return
    const first = cues[selectedCueStart]
    const last = cues[selectedCueEnd]
    if (!first || !last) return
    const range = { start: Math.min(first.start, last.start), end: Math.max(first.end, last.end) }
    if (range.start >= range.end) return
    setCueRanges((ranges) => [...ranges, range])
    setSelectedCueStart(null)
    setSelectedCueEnd(null)
  }

  return <section ref={reviewRef} tabIndex={-1} aria-labelledby="review-heading" className="space-y-5 rounded-xl border border-border/80 bg-secondary/20 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <h2 id="review-heading" className="font-display text-xl font-medium">{t.reviewMoments}</h2>
    {loading && <div role="status" className="flex items-center gap-3 rounded-lg bg-card p-4 text-sm"><LoaderCircle className="size-4 animate-spin text-primary" />{t.scanningMoments}</div>}
    {error && <Alert variant="destructive"><AlertDescription>{error} <Button type="button" size="sm" variant="ghost" onClick={retry}>{t.retry}</Button></AlertDescription></Alert>}
    {preview?.status === "done" && <>
      <div><p className="mb-2 text-sm font-medium">{t.candidateMoments}</p><div className="space-y-2">{candidates.map((candidate, index) => {
        const checked = selectedCandidates.includes(index)
        const disabled = !checked && selectedCount >= 10
        return <label key={`${candidate.start}-${candidate.end}-${index}`} className="flex cursor-pointer gap-3 rounded-lg border border-border/80 bg-card p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input type="checkbox" className="mt-1 size-4 accent-primary" checked={checked} disabled={disabled} onChange={(event) => setSelectedCandidates((current) => event.target.checked ? [...current, index] : current.filter((item) => item !== index))} aria-label={`${candidate.title}, ${formatMomentTime(candidate.start)}–${formatMomentTime(candidate.end)}`} />
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-start justify-between gap-2"><span className="text-sm font-medium">{candidate.title}</span><span className="text-xs tabular-nums text-muted-foreground">{formatMomentTime(candidate.start)}–{formatMomentTime(candidate.end)}</span></span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{candidate.reason}</span></span>
        </label>
      })}</div></div>
      <div><p className="mb-2 text-sm font-medium">{t.transcript}</p><p className="mb-2 text-xs text-muted-foreground">{t.selectCueRange}</p><div role="group" aria-label={t.transcript} className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border/80 bg-card p-2">{cues.map((cue, index) => {
        const isStart = selectedCueStart === index
        const isEnd = selectedCueEnd === index
        return <button key={`${cue.start}-${index}`} type="button" aria-pressed={isStart || isEnd} onClick={() => { if (selectedCueStart === null || selectedCueEnd !== null) { setSelectedCueStart(index); setSelectedCueEnd(null) } else setSelectedCueEnd(index) }} className={`flex w-full gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isStart || isEnd ? "bg-primary/10 ring-1 ring-primary" : ""}`}><span className="shrink-0 font-mono text-xs text-muted-foreground">{formatMomentTime(cue.start)}{isStart ? ` · ${t.startSec}` : isEnd ? ` · ${t.endSec}` : ""}</span><span>{cue.text}</span></button>
      })}</div><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={selectedCueStart === null || selectedCueEnd === null || selectedCount >= 10 || cues[selectedCueStart]?.start === cues[selectedCueEnd]?.end} onClick={addCueRange}>{t.addRange}</Button><span aria-live="polite" className="text-xs text-muted-foreground">{selectedCueStart === null ? t.chooseStartCue : selectedCueEnd === null ? t.chooseEndCue : `${t.selectedMoments}: ${formatMomentTime(cues[selectedCueStart]?.start ?? 0)}–${formatMomentTime(cues[selectedCueEnd]?.end ?? 0)}`}</span></div></div>
      <div className="space-y-2"><p className="text-sm font-medium">{t.selectedMoments} ({selectedCount}/10)</p>{selectedCandidates.map((index) => { const candidate = candidates[index]; return candidate ? <div key={`candidate-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-3 py-2 text-sm"><span className="min-w-0 truncate">{candidate.title} <span className="text-xs text-muted-foreground">{formatMomentTime(candidate.start)}–{formatMomentTime(candidate.end)}</span></span><Button type="button" variant="ghost" size="sm" onClick={() => setSelectedCandidates((current) => current.filter((item) => item !== index))}>{t.removeRange}</Button></div> : null })}{cueRanges.map((range, index) => <div key={`cue-range-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-3 py-2 text-sm"><span>{formatMomentTime(range.start)}–{formatMomentTime(range.end)}</span><Button type="button" variant="ghost" size="sm" onClick={() => setCueRanges((current) => current.filter((_, item) => item !== index))}>{t.removeRange}</Button></div>)}</div>
      <Button type="button" className="w-full rounded-xl" disabled={selectedCount < 1 || selectedCount > 10 || createPending} onClick={() => renderSelected([...selectedCandidates.flatMap((index) => candidates[index] ? [{ start: candidates[index].start, end: candidates[index].end, title: candidates[index].title, reason: candidates[index].reason }] : []), ...cueRanges])}>{createPending && <LoaderCircle className="mr-2 size-4 animate-spin" />}{t.renderClips.replace("{count}", String(selectedCount))}</Button>
    </>}
  </section>
}

function Dashboard() {
  const { user } = Route.useRouteContext() as { user: User }
  const t = useT()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [draft] = useState(loadReviewDraft)
  const [url, setUrl] = useState(draft?.url ?? "")
  const [mode, setMode] = useState<"auto" | "manual">(draft?.mode ?? "auto")
  const [reframe, setReframe] = useState<Job["reframe"]>(draft?.reframe ?? "face_tracking")
  const [captions, setCaptions] = useState(draft?.captions ?? true)
  const [twoSpeakers, setTwoSpeakers] = useState(draft?.twoSpeakers ?? false)
  const [aspectRatio, setAspectRatio] = useState<Job["aspectRatio"]>(draft?.aspectRatio ?? "9:16")
  const [maxSourceChoice, setMaxSourceChoice] = useState(draft?.maxSourceSec === null || draft?.maxSourceSec === undefined ? "full" : [600, 1200, 1800, 3600, 5400].includes(draft.maxSourceSec) ? String(draft.maxSourceSec) : "custom")
  const [customMinutes, setCustomMinutes] = useState(draft?.maxSourceSec && ![600, 1200, 1800, 3600, 5400].includes(draft.maxSourceSec) ? String(draft.maxSourceSec / 60) : "10")
  const [reviewFirst, setReviewFirst] = useState(draft?.reviewFirst ?? false)
  const [previewId, setPreviewId] = useState<string | null>(draft?.previewId ?? null)
  const [previewExpired, setPreviewExpired] = useState(false)
  const [selectedCandidates, setSelectedCandidates] = useState<number[]>(draft?.selectedCandidates ?? [])
  const [selectedCueStart, setSelectedCueStart] = useState<number | null>(draft?.selectedCueStart ?? null)
  const [selectedCueEnd, setSelectedCueEnd] = useState<number | null>(draft?.selectedCueEnd ?? null)
  const [cueRanges, setCueRanges] = useState<{ start: number; end: number }[]>(draft?.cueRanges ?? [])
  const [clipCount, setClipCount] = useState(draft?.clipCount ?? 3)
  const [duration, setDuration] = useState(draft?.duration ?? 45)
  const [description, setDescription] = useState(draft?.description ?? "")
  const [ranges, setRanges] = useState<ClipRange[]>(draft?.ranges ?? [{ start: "", end: "" }])
  const [error, setError] = useState("")
  const reviewRef = useRef<HTMLDivElement>(null)
  const initializedPreview = useRef<string | null>(draft?.previewId ?? null)
  const { from } = useSearch({ from: "/" })
  const source = useQuery({ queryKey: ["jobs", from], queryFn: () => api<JobSnapshot>(`/jobs/${from}`), enabled: !!from })
  useEffect(() => {
    const job = source.data
    if (!job) return
    setUrl(job.url)
    setMode(job.mode === "manual" ? "manual" : "auto")
    setReframe(job.reframe)
    setAspectRatio(job.aspectRatio ?? "9:16")
    const sourceLimit = job.maxSourceSec ?? null
    setMaxSourceChoice(sourceLimit === null ? "full" : [600, 1200, 1800, 3600, 5400].includes(sourceLimit) ? String(sourceLimit) : "custom")
    if (sourceLimit !== null && ![600, 1200, 1800, 3600, 5400].includes(sourceLimit)) setCustomMinutes(String(sourceLimit / 60))
    setCaptions(job.captions)
    setTwoSpeakers(job.aspectRatio === "9:16" && (job.twoSpeakers ?? false))
    if (job.clipCount) setClipCount(job.clipCount)
    if (job.targetDurationSec) setDuration(job.targetDurationSec)
    setDescription(job.description ?? "")
    if (job.ranges?.length) setRanges(job.ranges.map(({ start, end }) => ({ start: String(start), end: String(end) })))
  }, [source.data])
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api<Job[]>("/jobs"), refetchInterval: 5000 })
  const preview = useQuery({
    queryKey: ["previews", previewId],
    queryFn: () => api<JobPreview>(`/previews/${previewId}`),
    enabled: !!previewId,
    refetchInterval: (query) => query.state.error || ["done", "failed"].includes(query.state.data?.status ?? "") ? false : 2000,
    retry: (failureCount, err) => {
      if ((err as Error & { status?: number }).status === 404) return false
      return failureCount < 3
    },
  })
  useEffect(() => {
    if (preview.error && (preview.error as Error & { status?: number }).status === 404) {
      setPreviewExpired(true)
      setPreviewId(null)
    }
  }, [preview.error])
  useEffect(() => {
    if (!reviewFirst) return
    saveReviewDraft({
      url,
      mode,
      reframe,
      captions,
      twoSpeakers,
      aspectRatio,
      maxSourceSec: maxSourceChoice === "full" ? null : maxSourceChoice === "custom" ? Number(customMinutes) * 60 : Number(maxSourceChoice),
      clipCount,
      duration,
      description,
      ranges,
      reviewFirst,
      previewId,
      selectedCandidates,
      cueRanges,
      selectedCueStart,
      selectedCueEnd,
    })
  }, [url, mode, reframe, captions, twoSpeakers, aspectRatio, maxSourceChoice, customMinutes, clipCount, duration, description, ranges, reviewFirst, previewId, selectedCandidates, cueRanges, selectedCueStart, selectedCueEnd])
  const hasTerminalJob = jobs.data?.some((job) => ["done", "failed", "cancelled"].includes(job.status)) ?? false
  useEffect(() => { if (hasTerminalJob) void client.invalidateQueries({ queryKey: ["system", "llm-status"] }) }, [hasTerminalJob, client])
  const createPreview = useMutation({
    mutationFn: (body: { url: string; description?: string; clipCount?: number; targetDurationSec?: number; maxSourceSec?: number | null }) => api<{ id: string }>("/previews", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: ({ id }) => { setPreviewExpired(false); setSelectedCandidates([]); setCueRanges([]); setSelectedCueStart(null); setSelectedCueEnd(null); initializedPreview.current = null; setPreviewId(id) },
    onError: () => { setPreviewId(null); setError(t.apiError) },
  })
  const create = useMutation({
    mutationFn: (body: JobInput) => api<Job>("/jobs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (job) => {
      clearReviewDraft()
      void client.invalidateQueries({ queryKey: ["jobs"] })
      void navigate({ to: "/jobs/$jobId", params: { jobId: job.id } })
    },
    onError: (e: Error) => setError((e as Error & { status?: number }).status === 401 ? t.error : t.apiError),
  })
  const updateRange = (index: number, field: keyof ClipRange, value: string) => setRanges((items) => items.map((item, i) => i === index ? { ...item, [field]: value } : item))
  const changeAspectRatio = (value: string) => {
    const next = value as Job["aspectRatio"]
    setAspectRatio(next)
    if (next !== "9:16") setTwoSpeakers(false)
  }
  const selectedMaxSourceSec = () => maxSourceChoice === "full" ? null : maxSourceChoice === "custom" ? Number(customMinutes) * 60 : Number(maxSourceChoice)
  const validCustomMinutes = maxSourceChoice !== "custom" || (Number.isInteger(Number(customMinutes)) && Number(customMinutes) >= 1 && Number(customMinutes) <= 600)
  const renderSelected = (selectedRanges: RangePayload[]) => {
    if (!selectedRanges.length || selectedRanges.length > 10 || selectedRanges.some(({ start, end }) => !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)) { setError(t.rangesInvalid); return }
    create.mutate({ url: url.trim(), mode: "manual", ranges: selectedRanges, targetDurationSec: duration, reframe, captions, twoSpeakers, aspectRatio, ...(description.trim() ? { description: description.trim() } : {}) })
  }
  useEffect(() => {
    if (preview.data?.status === "done" && initializedPreview.current !== preview.data.id) {
      initializedPreview.current = preview.data.id
      setSelectedCandidates((current) => current.length ? current : (preview.data?.candidates ?? []).slice(0, clipCount).map((_, i) => i))
      reviewRef.current?.focus()
    }
  }, [preview.data, clipCount])
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    if (!url.trim()) { setError(t.urlRequired); return }
    if (mode === "auto" && !validCustomMinutes) { setError(t.customMinutesInvalid); return }
    if (mode === "auto" && reviewFirst) {
      setError("")
      createPreview.mutate({ url: url.trim(), clipCount, targetDurationSec: duration, maxSourceSec: selectedMaxSourceSec(), ...(description.trim() ? { description: description.trim() } : {}) })
      return
    }
    const body: JobInput = { url: url.trim(), mode, reframe, captions, twoSpeakers, aspectRatio, targetDurationSec: duration, ...(mode === "auto" ? { maxSourceSec: selectedMaxSourceSec() } : {}) }
    if (mode === "auto") {
      body.clipCount = clipCount
      if (description.trim()) body.description = description.trim()
    } else {
      const parsed = ranges.map(({ start, end }) => ({ start: Number(start), end: Number(end) }))
      if (ranges.length < 1 || ranges.length > 10 || ranges.some(({ start, end }) => !start.trim() || !end.trim()) || parsed.some(({ start, end }) => !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)) { setError(t.rangesInvalid); return }
      body.ranges = parsed
    }
    create.mutate(body)
  }

  return <WorkspaceShell user={user}>
    <div className="mb-11 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="mb-3 flex items-center gap-2 text-sm font-medium text-primary"><Sparkles className="size-4" />{t.welcome}</p><h1 className="font-display text-4xl font-medium tracking-[-.065em] sm:text-[3.35rem]">{t.dashboard}<span className="text-primary">.</span></h1><p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">{t.pageIntro}</p></div>
      <Badge variant="outline" className="h-8 w-fit gap-2 rounded-full px-3 text-xs font-normal"><span className="size-1.5 rounded-full bg-primary" />{mode === "auto" ? t.autoMode : t.manualMode}</Badge>
    </div>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,.8fr)]">
      <Card className="overflow-hidden rounded-2xl border-border/80 shadow-[0_16px_55px_-38px_rgba(20,32,26,.3)]">
        <CardHeader className="pb-5"><div className="flex items-center gap-2 text-primary"><Scissors className="size-4" /><span className="text-xs font-semibold uppercase tracking-[.16em]">01 / {t.sourceVideo}</span></div><CardTitle className="font-display text-2xl font-medium tracking-[-.045em]">{t.sourceStatement}</CardTitle><CardDescription>{t.sourceDetail}</CardDescription><div className="pt-2"><LlmStatus jobStatus={jobs.data?.find((job) => ["done", "failed", "cancelled"].includes(job.status))?.status} /></div></CardHeader>
        <CardContent><form className="space-y-5" onSubmit={submit}>
          <Field><FieldLabel htmlFor="source-url">{t.sourceUrl}</FieldLabel><div className="relative"><Play className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="source-url" type="url" inputMode="url" autoComplete="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} required className="h-12 rounded-xl pl-10" /></div><FieldDescription>{t.sourceHint}</FieldDescription><FieldDescription className="mt-1">{t.captionsNote}</FieldDescription></Field>
          <Field><FieldLabel>{t.creationMode}</FieldLabel><div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary/70 p-1.5" role="group" aria-label={t.creationMode}><Button type="button" variant={mode === "auto" ? "default" : "ghost"} className="h-10 rounded-lg" aria-pressed={mode === "auto"} onClick={() => setMode("auto")}>{t.autoMode}</Button><Button type="button" variant={mode === "manual" ? "default" : "ghost"} className="h-10 rounded-lg" aria-pressed={mode === "manual"} onClick={() => setMode("manual")}>{t.manualMode}</Button></div></Field>
          {mode === "auto" && <Field><FieldLabel htmlFor="source-duration-select">{t.videoDurationScan}</FieldLabel><Select value={maxSourceChoice} onValueChange={setMaxSourceChoice}><SelectTrigger id="source-duration-select" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="full">{t.fullVideo}</SelectItem><SelectItem value="600">{t.tenMinutes}</SelectItem><SelectItem value="1200">{t.twentyMinutes}</SelectItem><SelectItem value="1800">{t.thirtyMinutes}</SelectItem><SelectItem value="3600">{t.sixtyMinutes}</SelectItem><SelectItem value="5400">{t.ninetyMinutes}</SelectItem><SelectItem value="custom">{t.customDuration}</SelectItem></SelectContent></Select><FieldDescription>{t.scanDurationHint}</FieldDescription>{maxSourceChoice === "custom" && <Field className="mt-3"><FieldLabel htmlFor="custom-source-minutes">{t.customMinutesLabel}</FieldLabel><Input id="custom-source-minutes" type="number" min={1} max={600} step={1} inputMode="numeric" value={customMinutes} aria-invalid={!validCustomMinutes} onChange={(event) => setCustomMinutes(event.target.value)} required className="h-11 rounded-xl" />{!validCustomMinutes && <FieldDescription className="text-destructive">{t.customMinutesInvalid}</FieldDescription>}</Field>}</Field>}
           <Field><FieldLabel id="aspect-ratio-label">{t.outputFormat}</FieldLabel><RadioGroup aria-labelledby="aspect-ratio-label" value={aspectRatio} onValueChange={changeAspectRatio} className="grid gap-2 sm:grid-cols-3">{([{ value: "9:16", subtitle: t.aspectPortrait, shape: "h-8 w-5" }, { value: "1:1", subtitle: t.aspectSquare, shape: "size-6" }, { value: "16:9", subtitle: t.aspectLandscape, shape: "h-5 w-9" }] as const).map(({ value, subtitle, shape }) => <label key={value} htmlFor={`aspect-${value}`} className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border/80 bg-card px-3 py-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 hover:bg-secondary/50"><RadioGroupItem id={`aspect-${value}`} value={value} className="shrink-0" /><span aria-hidden="true" className="grid shrink-0 place-items-center text-muted-foreground transition-colors group-has-[:checked]:text-primary"><span className={`block ${shape} rounded-[3px] border-2 border-current`} /></span><span className="min-w-0"><span className="block font-mono text-sm font-semibold">{value}</span><span className="mt-1 block text-xs leading-snug text-muted-foreground">{subtitle}</span></span></label>)}</RadioGroup></Field>
           <Field className={twoSpeakers || aspectRatio === "16:9" ? "opacity-50" : undefined}>
             <FieldLabel id="reframe-label">{t.portraitReframe}</FieldLabel><RadioGroup disabled={twoSpeakers || aspectRatio === "16:9"} aria-labelledby="reframe-label" value={reframe} onValueChange={(value) => { if (!twoSpeakers && aspectRatio !== "16:9") setReframe(value as Job["reframe"]) }} className="grid gap-2 sm:grid-cols-3">{([{ value: "face_tracking", label: t.faceTracking, hint: t.faceTrackingHint }, { value: "blurred_fill", label: t.blurredFill, hint: t.blurredFillHint }, { value: "black_bars", label: t.blackBars, hint: t.blackBarsHint }] as const).map((option) => <label key={option.value} htmlFor={`reframe-${option.value}`} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/80 bg-card px-3 py-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 hover:bg-secondary/50"><RadioGroupItem id={`reframe-${option.value}`} value={option.value} className="mt-0.5" /><span><span className="block text-sm font-medium">{option.label}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{option.hint}</span></span></label>)}</RadioGroup>{twoSpeakers ? <FieldDescription>{t.reframeIgnored}</FieldDescription> : aspectRatio === "16:9" ? <FieldDescription>{t.reframeUnavailable}</FieldDescription> : null}</Field>
           <Field className={`flex flex-row items-center justify-between rounded-xl border border-border/80 bg-card px-4 py-3 ${aspectRatio !== "9:16" ? "opacity-50" : ""}`}><div><FieldLabel htmlFor="two-speakers">{t.twoSpeakers}</FieldLabel><FieldDescription>{aspectRatio === "9:16" ? t.twoSpeakersHint : t.twoSpeakersUnavailable}</FieldDescription></div><Switch id="two-speakers" checked={twoSpeakers} disabled={aspectRatio !== "9:16"} onCheckedChange={setTwoSpeakers} /></Field>
           <Field className="flex flex-row items-center justify-between rounded-xl border border-border/80 bg-card px-4 py-3"><div><FieldLabel htmlFor="burn-captions">{t.burnCaptions}</FieldLabel></div><Switch id="burn-captions" checked={captions} onCheckedChange={setCaptions} /></Field>
           {mode === "auto" ? <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="clip-count">{t.clipCount}</FieldLabel><Input id="clip-count" type="number" min={1} max={10} step={1} required value={clipCount} onChange={(e) => setClipCount(Number(e.target.value))} className="h-11 rounded-xl" /></Field><Field><FieldLabel htmlFor="target-duration">{t.duration}</FieldLabel><div className="relative"><Input id="target-duration" type="number" min={15} max={180} step={1} required value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="h-11 rounded-xl pr-14" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{t.seconds}</span></div></Field><Field className="sm:col-span-2"><div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="clip-description">{t.description}</FieldLabel><span className="text-xs tabular-nums text-muted-foreground">{description.length}/500</span></div><textarea id="clip-description" maxLength={500} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t.descriptionHint} className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" /></Field></div> : <div className="space-y-3 rounded-xl border border-border/80 bg-secondary/25 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">{t.manualRanges}</p><p className="mt-1 text-xs text-muted-foreground">{t.rangeHint}</p></div><Badge variant="secondary" className="rounded-full font-normal">{ranges.length}/10</Badge></div><div className="space-y-2">{ranges.map((range, index) => <div key={index} className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-2 rounded-lg border border-border/70 bg-card p-3"><span className="pb-3 text-xs font-medium tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><Field><FieldLabel htmlFor={`range-start-${index}`}>{t.startSec}</FieldLabel><Input id={`range-start-${index}`} type="number" min="0" step="any" required aria-label={`${t.startSec} ${index + 1}`} placeholder="0" value={range.start} onChange={(e) => updateRange(index, "start", e.target.value)} className="h-10 rounded-lg" /></Field><Field><FieldLabel htmlFor={`range-end-${index}`}>{t.endSec}</FieldLabel><Input id={`range-end-${index}`} type="number" min="0" step="any" required aria-label={`${t.endSec} ${index + 1}`} placeholder="30" value={range.end} onChange={(e) => updateRange(index, "end", e.target.value)} className="h-10 rounded-lg" /></Field><Button type="button" variant="ghost" size="icon" aria-label={`${t.removeRange} ${index + 1}`} disabled={ranges.length === 1} onClick={() => setRanges((items) => items.filter((_, i) => i !== index))} className="mb-0.5 text-muted-foreground hover:text-destructive"><X className="size-4" /></Button></div>)}</div><Button type="button" variant="outline" size="sm" disabled={ranges.length >= 10} onClick={() => setRanges((items) => [...items, { start: "", end: "" }])} className="rounded-lg"><Plus className="size-4" />{t.addRange}</Button></div>}
          {mode === "auto" && <Field className="flex flex-row items-center justify-between rounded-xl border border-border/80 bg-card px-4 py-3"><div><FieldLabel htmlFor="review-first">{t.reviewMoments}</FieldLabel><FieldDescription>{t.reviewMomentsHint}</FieldDescription></div><Switch id="review-first" checked={reviewFirst} onCheckedChange={(checked) => { setReviewFirst(checked); if (!checked) { setPreviewId(null); setPreviewExpired(false); initializedPreview.current = null; clearReviewDraft() } }} /></Field>}
          {reviewFirst && mode === "auto" && <ReviewPanel preview={preview.data} loading={createPreview.isPending || (!!previewId && preview.isPending) || preview.data?.status === "queued" || preview.data?.status === "running"} error={previewExpired ? t.previewExpired : createPreview.isError || preview.isError || preview.data?.status === "failed" ? preview.data?.error || t.previewFailed : ""} t={t} selectedCandidates={selectedCandidates} setSelectedCandidates={setSelectedCandidates} selectedCueStart={selectedCueStart} setSelectedCueStart={setSelectedCueStart} selectedCueEnd={selectedCueEnd} setSelectedCueEnd={setSelectedCueEnd} cueRanges={cueRanges} setCueRanges={setCueRanges} createPending={create.isPending} renderSelected={renderSelected} retry={() => { setError(""); createPreview.mutate({ url: url.trim(), clipCount, targetDurationSec: duration, maxSourceSec: selectedMaxSourceSec(), ...(description.trim() ? { description: description.trim() } : {}) }) }} reviewRef={reviewRef} />}
          {mode === "manual" && <Field><FieldLabel htmlFor="target-duration-manual">{t.duration}</FieldLabel><div className="relative"><Input id="target-duration-manual" type="number" min={15} max={180} step={1} required value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="h-11 rounded-xl pr-14" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{t.seconds}</span></div></Field>}
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between"><p className="max-w-xs text-xs leading-relaxed text-muted-foreground"><Check className="mr-1 inline size-3.5 text-primary" />{mode === "auto" ? t.autoSummary.replace("{count}", String(clipCount)).replace("{duration}", String(duration)) : t.manualSummary.replace("{count}", String(ranges.length))}</p><Button type="submit" className="h-11 shrink-0 rounded-xl px-5" disabled={create.isPending || createPreview.isPending || (!!reviewFirst && !!previewId)}>{create.isPending || createPreview.isPending ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <ArrowUpRight className="mr-2 size-4" />}{reviewFirst && mode === "auto" ? t.startReview : t.makeClips}</Button></div>
        </form></CardContent>
      </Card>
      <Card className="relative overflow-hidden rounded-2xl border-border/80 bg-secondary/45 shadow-none"><div className="absolute -right-10 -top-10 size-44 rounded-full border border-primary/10" /><div className="absolute -right-1 -top-1 size-24 rounded-full border border-primary/10" /><CardHeader className="relative"><div className="flex items-center gap-2 text-primary"><Clock3 className="size-4" /><span className="text-xs font-semibold uppercase tracking-[.16em]">02 / {t.processing}</span></div><CardTitle className="font-display text-2xl font-medium tracking-[-.045em]">{t.processTitle}</CardTitle><CardDescription>{t.processDetail}</CardDescription></CardHeader><CardContent className="relative"><div className="flex items-center gap-3 border-t border-border/70 pt-4 text-sm"><span className="grid size-8 place-items-center rounded-lg bg-background text-primary"><Play className="size-3.5 fill-current" /></span><span className="text-muted-foreground">{t.sourceVideo}</span><ArrowDownRight className="ml-auto size-4 text-primary" /></div><div className="flex items-center gap-3 border-t border-border/70 py-4 text-sm"><span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><Scissors className="size-3.5" /></span><span className="text-muted-foreground">{t.readyClips}</span><Check className="ml-auto size-4 text-primary" /></div></CardContent></Card>
    </div>
    <section className="mt-14"><div className="mb-5 flex items-end justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[.17em] text-muted-foreground">{t.activity}</p><h2 className="font-display text-2xl font-medium tracking-[-.045em]">{t.recent}</h2></div>{jobs.data?.length ? <span className="text-xs tabular-nums text-muted-foreground">{jobs.data.length} {jobs.data.length === 1 ? t.job : t.jobs}</span> : null}</div>{jobs.isPending ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px] w-full rounded-xl" />)}</div> : jobs.isError ? <Alert variant="destructive"><AlertDescription>{t.apiError} <Button size="sm" variant="ghost" onClick={() => jobs.refetch()}>{t.retry}</Button></AlertDescription></Alert> : jobs.data?.length ? <div className="overflow-hidden rounded-2xl border border-border/80 bg-card">{jobs.data.map((job, i) => <Link key={job.id} to="/jobs/$jobId" params={{ jobId: job.id }} className={`group flex items-center gap-3 px-4 py-4 transition-colors hover:bg-secondary/50 sm:gap-5 sm:px-5 ${i ? "border-t border-border/70" : ""}`}><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"><Scissors className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{job.url}</p><p className="mt-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(job.createdAt))}{job.status === "done" && job.clipsCount ? ` · ${job.clipsCount} ${t.clipsReady}` : ""}</p></div><Badge variant={job.status === "failed" ? "destructive" : job.status === "done" ? "secondary" : "outline"} className="rounded-full font-normal">{t.status[job.status]}</Badge><ArrowUpRight className="hidden size-4 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 sm:block" /></Link>)}</div> : <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center"><div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Scissors className="size-5" /></div><h3 className="font-display text-xl tracking-[-.035em]">{t.empty}</h3><p className="mt-2 text-sm text-muted-foreground">{t.emptyHint}</p><p className="mt-1 text-xs text-muted-foreground">{t.startNow}</p></div>}</section>
  </WorkspaceShell>
}
