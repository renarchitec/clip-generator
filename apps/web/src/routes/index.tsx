import { createFileRoute, Link, redirect, useNavigate, useSearch } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "@tanstack/react-form"
import { ArrowLeft, ArrowRight, ArrowUpRight, Captions, ListChecks, LoaderCircle, Play, Plus, Users, Video, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { A11y, Keyboard, Navigation, Pagination } from "swiper/modules"
import { Swiper, SwiperSlide } from "swiper/react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type Job, type JobPreview, type JobSnapshot, type RecentClip, type User } from "@/lib/api"
import { WorkspaceShell } from "@/components/chrome"
import { useLanguage, useT } from "@/lib/i18n"
import { getCurrentUser } from "@/lib/auth"
import { clearReviewDraft, loadReviewDraft, saveReviewDraft } from "@/lib/review-draft"
import { LlmStatus } from "@/components/llm-status"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { relativeAge, sourceLabel } from "@/lib/format"

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
type JobInput = { url: string; mode: "auto" | "manual"; reframe: Job["reframe"]; captions: boolean; twoSpeakers: boolean; facecam: boolean; aspectRatio: Job["aspectRatio"]; maxSourceSec?: number | null; clipCount?: number; targetDurationSec: number; description?: string; ranges?: RangePayload[] }

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
    {preview?.status === "done" && <><div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{t.reviewReady}</p><Button type="button" size="sm" variant="outline" onClick={retry} disabled={loading}>{t.reviewAgain}</Button></div>
      <div><p className="mb-2 text-sm font-medium">{t.candidateMoments}</p><div className="space-y-2">{candidates.map((candidate, index) => {
        const checked = selectedCandidates.includes(index)
        const disabled = !checked && selectedCount >= 10
        return <label key={`${candidate.start}-${candidate.end}-${index}`} className="flex cursor-pointer gap-3 rounded-lg border border-border/80 bg-card p-3 has-[:checked]:border-accent has-[:checked]:bg-accent/10">
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
      <Button type="button" className="w-full rounded-md" disabled={selectedCount < 1 || selectedCount > 10 || createPending} onClick={() => renderSelected([...selectedCandidates.flatMap((index) => candidates[index] ? [{ start: candidates[index].start, end: candidates[index].end, title: candidates[index].title, reason: candidates[index].reason }] : []), ...cueRanges])}>{createPending && <LoaderCircle className="mr-2 size-4 animate-spin" />}{t.renderClips.replace("{count}", String(selectedCount))}</Button>
    </>}
  </section>
}

function Dashboard() {
  const { user } = Route.useRouteContext() as { user: User }
  const t = useT()
  const locale = useLanguage().language === "id" ? "id" : "en"
  const client = useQueryClient()
  const navigate = useNavigate()
  const [draft] = useState(loadReviewDraft)
  const [mode, setMode] = useState<"auto" | "manual">(draft?.mode ?? "auto")
  const [reframe, setReframe] = useState<Job["reframe"]>(draft?.reframe ?? "face_tracking")
  const [captions, setCaptions] = useState(draft?.captions ?? true)
  const [twoSpeakers, setTwoSpeakers] = useState(draft?.twoSpeakers ?? false)
  const [facecam, setFacecam] = useState(draft?.facecam ?? false)
  const [aspectRatio, setAspectRatio] = useState<Job["aspectRatio"]>(draft?.aspectRatio ?? "9:16")
  const [maxSourceChoice, setMaxSourceChoice] = useState(draft?.maxSourceSec === null || draft?.maxSourceSec === undefined ? "full" : [600, 1200, 1800, 3600, 5400].includes(draft.maxSourceSec) ? String(draft.maxSourceSec) : "custom")
  const [reviewFirst, setReviewFirst] = useState(draft?.reviewFirst ?? false)
  const [previewId, setPreviewId] = useState<string | null>(draft?.previewId ?? null)
  const [previewExpired, setPreviewExpired] = useState(false)
  const [selectedCandidates, setSelectedCandidates] = useState<number[]>(draft?.selectedCandidates ?? [])
  const [selectedCueStart, setSelectedCueStart] = useState<number | null>(draft?.selectedCueStart ?? null)
  const [selectedCueEnd, setSelectedCueEnd] = useState<number | null>(draft?.selectedCueEnd ?? null)
  const [cueRanges, setCueRanges] = useState<{ start: number; end: number }[]>(draft?.cueRanges ?? [])
  const [description, setDescription] = useState(draft?.description ?? "")
  const [error, setError] = useState("")
  const [playingClip, setPlayingClip] = useState<RecentClip | null>(null)
  const form = useForm({
    defaultValues: { url: draft?.url ?? "", clipCount: draft?.clipCount ?? 3, duration: draft?.duration ?? 45, customMinutes: draft?.maxSourceSec && ![600, 1200, 1800, 3600, 5400].includes(draft.maxSourceSec) ? String(draft.maxSourceSec / 60) : "10", ranges: draft?.ranges ?? [{ start: "", end: "" }] },
    validators: { onSubmit: ({ value }) => {
      if (!value.url.trim()) return t.urlRequired
      if (!/^https?:\/\//i.test(value.url.trim())) return t.urlInvalid
      if (!Number.isInteger(value.clipCount) || value.clipCount < 1 || value.clipCount > 10) return t.clipCountInvalid
      if (!Number.isInteger(value.duration) || value.duration < 15 || value.duration > 180) return t.durationInvalid
      if (mode === "auto" && maxSourceChoice === "custom" && (!/^\d+$/.test(value.customMinutes) || Number(value.customMinutes) < 1 || Number(value.customMinutes) > 600)) return t.customMinutesInvalid
      if (mode === "manual" && (!value.ranges.length || value.ranges.length > 10 || value.ranges.some(({ start, end }) => !start.trim() || !end.trim() || !Number.isFinite(Number(start)) || !Number.isFinite(Number(end)) || Number(start) < 0 || Number(end) <= Number(start)))) return t.rangesInvalid
      return undefined
    } },
    onSubmit: ({ value }) => {
      setError("")
      if (mode === "auto" && reviewFirst) {
        createPreview.mutate({ url: value.url.trim(), clipCount: value.clipCount, targetDurationSec: value.duration, maxSourceSec: maxSourceChoice === "full" ? null : maxSourceChoice === "custom" ? Number(value.customMinutes) * 60 : Number(maxSourceChoice), ...(description.trim() ? { description: description.trim() } : {}) })
        return
      }
      const body: JobInput = { url: value.url.trim(), mode, reframe, captions, twoSpeakers, facecam, aspectRatio, targetDurationSec: value.duration, ...(mode === "auto" ? { maxSourceSec: selectedMaxSourceSec(), clipCount: value.clipCount, ...(description.trim() ? { description: description.trim() } : {}) } : { ranges: value.ranges.map(({ start, end }) => ({ start: Number(start), end: Number(end) })) }) }
      create.mutate(body)
    },
  })
  const formValues = useSyncExternalStore((onChange) => { const subscription = form.store.subscribe(onChange); return () => subscription.unsubscribe() }, () => form.state.values, () => form.state.values)
  const reviewRef = useRef<HTMLDivElement>(null)
  const initializedPreview = useRef<string | null>(draft?.previewId ?? null)
  const { from } = useSearch({ from: "/" })
  const source = useQuery({ queryKey: ["jobs", from], queryFn: () => api<JobSnapshot>(`/jobs/${from}`), enabled: !!from })
  useEffect(() => {
    const job = source.data
    if (!job) return
    form.setFieldValue("url", job.url)
    setMode(job.mode === "manual" ? "manual" : "auto")
    setReframe(job.reframe)
    setAspectRatio(job.aspectRatio ?? "9:16")
    const sourceLimit = job.maxSourceSec ?? null
    setMaxSourceChoice(sourceLimit === null ? "full" : [600, 1200, 1800, 3600, 5400].includes(sourceLimit) ? String(sourceLimit) : "custom")
    form.setFieldValue("customMinutes", sourceLimit !== null && ![600, 1200, 1800, 3600, 5400].includes(sourceLimit) ? String(sourceLimit / 60) : "10")
    setCaptions(job.captions)
    setTwoSpeakers(job.aspectRatio === "9:16" && (job.twoSpeakers ?? false))
    setFacecam(job.aspectRatio === "9:16" && (job.facecam ?? false))
    if (job.clipCount) form.setFieldValue("clipCount", job.clipCount)
    if (job.targetDurationSec) form.setFieldValue("duration", job.targetDurationSec)
    else form.setFieldValue("duration", 45)
    setDescription(job.description ?? "")
    if (job.ranges?.length) form.setFieldValue("ranges", job.ranges.map(({ start, end }) => ({ start: String(start), end: String(end) })))
  }, [source.data, form])
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api<Job[]>("/jobs"), refetchInterval: 5000 })
  const clipsQuery = useQuery({ queryKey: ["clips", "recent"], queryFn: () => api<RecentClip[]>("/clips/recent") })
  const [search, setSearch] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener("keydown", focusSearch)
    return () => window.removeEventListener("keydown", focusSearch)
  }, [])
  const filteredClips = useMemo(() => clipsQuery.data?.filter((clip) => `${clip.title} ${clip.job.url}`.toLowerCase().includes(search.trim().toLowerCase())) ?? [], [clipsQuery.data, search])
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
      url: formValues.url,
      mode,
      reframe,
      captions,
      twoSpeakers,
      facecam,
      aspectRatio,
      maxSourceSec: maxSourceChoice === "full" ? null : maxSourceChoice === "custom" ? Number(formValues.customMinutes) * 60 : Number(maxSourceChoice),
      clipCount: formValues.clipCount,
      duration: formValues.duration,
      description,
      ranges: formValues.ranges,
      reviewFirst,
      previewId,
      selectedCandidates,
      cueRanges,
      selectedCueStart,
      selectedCueEnd,
    })
  }, [formValues.url, formValues.customMinutes, formValues.clipCount, formValues.duration, formValues.ranges, mode, reframe, captions, twoSpeakers, facecam, aspectRatio, maxSourceChoice, description, reviewFirst, previewId, selectedCandidates, cueRanges, selectedCueStart, selectedCueEnd])
  const hasTerminalJob = jobs.data?.some((job) => ["done", "failed", "cancelled"].includes(job.status)) ?? false
  const activeJobs = jobs.data?.filter((job) => ["queued", "running"].includes(job.status)) ?? []
  const failedJobs = jobs.data?.filter((job) => job.status === "failed").slice(0, 2) ?? []
  useEffect(() => { if (hasTerminalJob) { void client.invalidateQueries({ queryKey: ["system", "llm-status"] }); void client.invalidateQueries({ queryKey: ["clips", "recent"] }) } }, [hasTerminalJob, client])
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
  const updateRange = (index: number, field: keyof ClipRange, value: string) => form.setFieldValue("ranges", formValues.ranges.map((item, i) => i === index ? { ...item, [field]: value } : item))
  const changeAspectRatio = (value: string) => {
    const next = value as Job["aspectRatio"]
    setAspectRatio(next)
    if (next !== "9:16") { setTwoSpeakers(false); setFacecam(false) }
  }
  const selectedMaxSourceSec = () => maxSourceChoice === "full" ? null : maxSourceChoice === "custom" ? Number(formValues.customMinutes) * 60 : Number(maxSourceChoice)
  const validCustomMinutes = maxSourceChoice !== "custom" || (/^\d+$/.test(formValues.customMinutes) && Number(formValues.customMinutes) >= 1 && Number(formValues.customMinutes) <= 600)
  const renderSelected = (selectedRanges: RangePayload[]) => {
    if (!selectedRanges.length || selectedRanges.length > 10 || selectedRanges.some(({ start, end }) => !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)) { setError(t.rangesInvalid); return }
    if (!formValues.url.trim()) { setError(t.urlRequired); return }
    if (!Number.isInteger(formValues.duration) || formValues.duration < 15 || formValues.duration > 180) { setError(t.durationInvalid); return }
    create.mutate({ url: formValues.url.trim(), mode: "manual", ranges: selectedRanges, targetDurationSec: formValues.duration, reframe, captions, twoSpeakers, facecam, aspectRatio, ...(description.trim() ? { description: description.trim() } : {}) })
  }
  useEffect(() => {
    if (preview.data?.status === "done" && initializedPreview.current !== preview.data.id) {
      initializedPreview.current = preview.data.id
      setSelectedCandidates((current) => current.length ? current : (preview.data?.candidates ?? []).slice(0, formValues.clipCount).map((_, i) => i))
      reviewRef.current?.focus()
    }
  }, [preview.data, formValues.clipCount])
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    void form.handleSubmit()
  }

  return <WorkspaceShell user={user}>
    <div className="mb-6 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="font-display text-xl font-medium tracking-[-.025em]">{t.dashboard}</h2>
      <div className="relative w-full sm:max-w-xs"><label className="sr-only" htmlFor="job-search">{t.searchClips}</label><Input ref={searchRef} id="job-search" type="search" placeholder={t.searchClips} value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 bg-card pr-16"/><kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{t.searchShortcut}</kbd></div>
    </div>
    <div className="grid gap-9 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] xl:items-start">
      <Card className="w-full overflow-hidden rounded-[11px] border-border bg-card shadow-none">
        <CardHeader className="border-b border-border px-4 py-4 sm:px-6"><div><CardTitle className="font-display text-lg font-medium tracking-[-.02em]">{t.sourceStatement}</CardTitle><CardDescription className="mt-1">{t.sourceDetail}</CardDescription></div></CardHeader>
        <CardContent className="px-4 py-5 sm:px-6"><form noValidate className="space-y-6" onSubmit={submit}>
          <Field><FieldLabel htmlFor="source-url">{t.sourceUrl}</FieldLabel><div className="relative"><Play className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><form.Field name="url" validators={{ onChange: ({ value }) => value.trim() ? undefined : t.urlRequired }}>{(field) => <><Input id="source-url" name="url" type="url" inputMode="url" autoComplete="url" placeholder={t.sourcePlaceholder} value={field.state.value} aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} required className="h-14 rounded-md pl-10 text-base" />{field.state.meta.isTouched && field.state.meta.errors.length > 0 && <FieldDescription className="text-destructive">{field.state.meta.errors[0]}</FieldDescription>}</>}</form.Field></div><FieldDescription>{t.sourceHint}</FieldDescription></Field>
          <Field><FieldLabel>{t.creationMode}</FieldLabel><div className="grid grid-cols-2 gap-1 rounded-md bg-secondary p-1" role="group" aria-label={t.creationMode}><Button type="button" variant="ghost" className={`h-10 rounded-sm ${mode === "auto" ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""}`} aria-pressed={mode === "auto"} onClick={() => setMode("auto")}>{t.autoMode}</Button><Button type="button" variant="ghost" className={`h-10 rounded-sm ${mode === "manual" ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""}`} aria-pressed={mode === "manual"} onClick={() => setMode("manual")}>{t.manualMode}</Button></div></Field>
          {mode === "auto" && <Field><FieldLabel htmlFor="source-duration-select">{t.videoDurationScan}</FieldLabel><Select value={maxSourceChoice} onValueChange={setMaxSourceChoice}><SelectTrigger id="source-duration-select" className="h-11 w-full rounded-md"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="full">{t.fullVideo}</SelectItem><SelectItem value="600">{t.tenMinutes}</SelectItem><SelectItem value="1200">{t.twentyMinutes}</SelectItem><SelectItem value="1800">{t.thirtyMinutes}</SelectItem><SelectItem value="3600">{t.sixtyMinutes}</SelectItem><SelectItem value="5400">{t.ninetyMinutes}</SelectItem><SelectItem value="custom">{t.customDuration}</SelectItem></SelectContent></Select><FieldDescription>{t.scanDurationHint}</FieldDescription>{maxSourceChoice === "custom" && <Field className="mt-3"><FieldLabel htmlFor="custom-source-minutes">{t.customMinutesLabel}</FieldLabel><Input id="custom-source-minutes" type="number" min={1} max={600} step={1} inputMode="numeric" value={formValues.customMinutes} aria-invalid={!validCustomMinutes} onChange={(event) => form.setFieldValue("customMinutes", event.target.value)} required className="h-11 rounded-md tabular-nums" />{!validCustomMinutes && <FieldDescription className="text-destructive">{t.customMinutesInvalid}</FieldDescription>}</Field>}</Field>}
           <Field><FieldLabel id="aspect-ratio-label">{t.outputFormat}</FieldLabel><RadioGroup aria-labelledby="aspect-ratio-label" value={aspectRatio} onValueChange={changeAspectRatio} className="grid gap-2 sm:grid-cols-3">{([{ value: "9:16", subtitle: t.aspectPortrait, shape: "h-8 w-5" }, { value: "1:1", subtitle: t.aspectSquare, shape: "size-6" }, { value: "16:9", subtitle: t.aspectLandscape, shape: "h-5 w-9" }] as const).map(({ value, subtitle, shape }) => <label key={value} htmlFor={`aspect-${value}`} className="group flex cursor-pointer items-center gap-3 rounded-md px-3 py-3 transition-colors has-[:checked]:bg-accent/10 hover:bg-secondary/50"><RadioGroupItem id={`aspect-${value}`} value={value} className="shrink-0" /><span aria-hidden="true" className="grid shrink-0 place-items-center text-muted-foreground transition-colors group-has-[:checked]:text-accent"><span className={`block ${shape} rounded-[3px] border-2 border-current`} /></span><span className="min-w-0"><span className="block font-mono text-sm font-semibold tabular-nums">{value}</span><span className="mt-1 block text-xs leading-snug text-muted-foreground">{subtitle}</span></span></label>)}</RadioGroup></Field>
           <Field className={twoSpeakers || facecam || aspectRatio === "16:9" ? "opacity-50" : undefined}>
             <FieldLabel id="reframe-label">{t.portraitReframe}</FieldLabel><RadioGroup disabled={twoSpeakers || facecam || aspectRatio === "16:9"} aria-labelledby="reframe-label" value={reframe} onValueChange={(value) => { if (!twoSpeakers && !facecam && aspectRatio !== "16:9") setReframe(value as Job["reframe"]) }} className="grid gap-2 sm:grid-cols-3">{([{ value: "face_tracking", label: t.faceTracking, hint: t.faceTrackingHint }, { value: "blurred_fill", label: t.blurredFill, hint: t.blurredFillHint }, { value: "black_bars", label: t.blackBars, hint: t.blackBarsHint }] as const).map((option) => <label key={option.value} htmlFor={`reframe-${option.value}`} className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-3 transition-colors has-[:checked]:bg-accent/10 hover:bg-secondary/50"><RadioGroupItem id={`reframe-${option.value}`} value={option.value} className="mt-0.5" /><span><span className="block text-sm font-medium">{option.label}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{option.hint}</span></span></label>)}</RadioGroup>{twoSpeakers || facecam ? <FieldDescription>{t.reframeIgnored}</FieldDescription> : aspectRatio === "16:9" ? <FieldDescription>{t.reframeUnavailable}</FieldDescription> : null}</Field>
            <Field><FieldLabel>{t.options}</FieldLabel><div className="divide-y divide-border border-y border-border">{[{ key: "two-speakers", icon: Users, label: t.twoSpeakers, hint: aspectRatio === "9:16" ? t.twoSpeakersHint : t.twoSpeakersUnavailable, checked: twoSpeakers, unavailable: aspectRatio !== "9:16", toggle: () => { setTwoSpeakers(!twoSpeakers); if (!twoSpeakers) setFacecam(false) } }, { key: "facecam", icon: Video, label: t.facecam, hint: aspectRatio === "9:16" ? t.facecamHint : t.facecamUnavailable, checked: facecam, unavailable: aspectRatio !== "9:16", toggle: () => { setFacecam(!facecam); if (!facecam) setTwoSpeakers(false) } }, { key: "burn-captions", icon: Captions, label: t.burnCaptions, hint: t.burnCaptionsHint, checked: captions, unavailable: false, toggle: () => setCaptions(!captions) }, ...(mode === "auto" ? [{ key: "review-first", icon: ListChecks, label: t.reviewMoments, hint: t.reviewMomentsHint, checked: reviewFirst, unavailable: false, toggle: () => { setReviewFirst(!reviewFirst); if (reviewFirst) { setPreviewId(null); setPreviewExpired(false); initializedPreview.current = null; clearReviewDraft() } } }] : [])].map(({ key, icon: Icon, label, hint, checked, unavailable, toggle }) => <button key={key} type="button" aria-pressed={checked} disabled={unavailable} onClick={toggle} className="flex min-h-12 w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-secondary/40 disabled:cursor-not-allowed disabled:opacity-50"><Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}</span><span className="block text-xs leading-relaxed text-muted-foreground">{hint}</span></span><span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-muted-foreground/40"}`}><span className={`absolute top-0.5 size-4 rounded-full bg-background transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} /></span></button>)}</div></Field>
           {mode === "auto" ? <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="clip-count">{t.clipCount}</FieldLabel><Input id="clip-count" type="number" min={1} max={10} step={1} required value={Number.isNaN(formValues.clipCount) ? "" : formValues.clipCount} onChange={(e) => form.setFieldValue("clipCount", e.target.value === "" ? Number.NaN : Number(e.target.value))} className="h-11 rounded-md tabular-nums" /></Field><Field><FieldLabel htmlFor="target-duration">{t.duration}</FieldLabel><div className="relative"><Input id="target-duration" type="number" min={15} max={180} step={1} required value={Number.isNaN(formValues.duration) ? "" : formValues.duration} onChange={(e) => form.setFieldValue("duration", e.target.value === "" ? Number.NaN : Number(e.target.value))} className="h-11 rounded-md pr-14 tabular-nums" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{t.seconds}</span></div></Field><Field className="sm:col-span-2"><div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="clip-description">{t.description}</FieldLabel><span className="text-xs tabular-nums text-muted-foreground">{description.length}/500</span></div><textarea id="clip-description" maxLength={500} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t.descriptionHint} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" /></Field></div> : <div className="space-y-3 rounded-lg border border-border/80 bg-secondary/25 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">{t.manualRanges}</p><p className="mt-1 text-xs text-muted-foreground">{t.rangeHint}</p></div><Badge variant="secondary" className="rounded-full font-normal">{formValues.ranges.length}/10</Badge></div><div className="space-y-2">{formValues.ranges.map((_, index) => <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 rounded-lg border border-border/70 bg-card p-3 max-[380px]:grid-cols-[auto_minmax(0,1fr)_auto]"><span className="pb-3 text-xs font-medium tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><Field className="max-[380px]:col-start-2"><FieldLabel htmlFor={`range-start-${index}`}>{t.startSec}</FieldLabel><Input id={`range-start-${index}`} type="number" min="0" step="any" required aria-label={`${t.startSec} ${index + 1}`} placeholder="0" value={formValues.ranges[index]?.start ?? ""} onChange={(e) => updateRange(index, "start", e.target.value)} className="h-10 rounded-lg" /></Field><Field className="max-[380px]:col-start-2"><FieldLabel htmlFor={`range-end-${index}`}>{t.endSec}</FieldLabel><Input id={`range-end-${index}`} type="number" min="0" step="any" required aria-label={`${t.endSec} ${index + 1}`} placeholder="30" value={formValues.ranges[index]?.end ?? ""} onChange={(e) => updateRange(index, "end", e.target.value)} className="h-10 rounded-lg" /></Field><Button type="button" variant="ghost" size="icon" aria-label={`${t.removeRange} ${index + 1}`} disabled={formValues.ranges.length === 1} onClick={() => form.setFieldValue("ranges", formValues.ranges.filter((_, i) => i !== index))} className="mb-0.5 text-muted-foreground hover:text-destructive max-[380px]:row-span-2"><X className="size-4" /></Button></div>)}</div><Button type="button" variant="outline" size="sm" disabled={formValues.ranges.length >= 10} onClick={() => form.setFieldValue("ranges", [...formValues.ranges, { start: "", end: "" }])} className="rounded-lg"><Plus className="size-4" />{t.addRange}</Button></div>}
          {reviewFirst && mode === "auto" && <ReviewPanel preview={preview.data} loading={createPreview.isPending || (!!previewId && preview.isPending) || preview.data?.status === "queued" || preview.data?.status === "running"} error={previewExpired ? t.previewExpired : createPreview.isError || preview.isError || preview.data?.status === "failed" ? preview.data?.error || t.previewFailed : ""} t={t} selectedCandidates={selectedCandidates} setSelectedCandidates={setSelectedCandidates} selectedCueStart={selectedCueStart} setSelectedCueStart={setSelectedCueStart} selectedCueEnd={selectedCueEnd} setSelectedCueEnd={setSelectedCueEnd} cueRanges={cueRanges} setCueRanges={setCueRanges} createPending={create.isPending} renderSelected={renderSelected} retry={() => { setError(""); if (!formValues.url.trim()) { setError(t.urlRequired); return } if (!/^https?:\/\//i.test(formValues.url.trim())) { setError(t.urlInvalid); return } if (!Number.isInteger(formValues.clipCount) || formValues.clipCount < 1 || formValues.clipCount > 10) { setError(t.clipCountInvalid); return } if (!Number.isInteger(formValues.duration) || formValues.duration < 15 || formValues.duration > 180) { setError(t.durationInvalid); return } if (!validCustomMinutes) { setError(t.customMinutesInvalid); return } createPreview.mutate({ url: formValues.url.trim(), clipCount: formValues.clipCount, targetDurationSec: formValues.duration, maxSourceSec: selectedMaxSourceSec(), ...(description.trim() ? { description: description.trim() } : {}) }) }} reviewRef={reviewRef} />}
          {mode === "manual" && <Field><FieldLabel htmlFor="target-duration-manual">{t.duration}</FieldLabel><div className="relative"><Input id="target-duration-manual" type="number" min={15} max={180} step={1} required value={Number.isNaN(formValues.duration) ? "" : formValues.duration} onChange={(e) => form.setFieldValue("duration", e.target.value === "" ? Number.NaN : Number(e.target.value))} className="h-11 rounded-md pr-14 tabular-nums" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{t.seconds}</span></div></Field>}
          {form.state.errors.length > 0 && <Alert variant="destructive"><AlertDescription>{String(form.state.errors[0])}</AlertDescription></Alert>}{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 space-y-1"><p className="text-xs leading-relaxed text-muted-foreground">{mode === "auto" ? t.autoSummary.replace("{count}", String(formValues.clipCount)).replace("{duration}", String(formValues.duration)) : t.manualSummary.replace("{count}", String(formValues.ranges.length))}</p>{reviewFirst && !!previewId && <p className="text-xs text-muted-foreground">{t.previewPendingReason}</p>}{mode === "auto" && <LlmStatus compact prominent jobStatus={jobs.data?.find((job) => ["done", "failed", "cancelled"].includes(job.status))?.status} />}</div><Button type="submit" className="h-11 w-full shrink-0 rounded-md px-5 sm:w-auto" disabled={create.isPending || createPreview.isPending || (!!reviewFirst && !!previewId)}>{create.isPending || createPreview.isPending ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <ArrowUpRight className="mr-2 size-4" />}{reviewFirst && mode === "auto" ? t.startReview : mode === "auto" ? t.generateClips.replace("{count}", String(formValues.clipCount)) : t.generateManualClips.replace("{count}", String(formValues.ranges.length))}</Button></div>
        </form></CardContent>
      </Card>
    </div>
    {(activeJobs.length > 0 || failedJobs.length > 0) && <section aria-labelledby="in-progress-heading" className="mb-10 mt-8 border-b border-border pb-7">
      <div className="mb-4 flex items-baseline justify-between gap-3"><h2 id="in-progress-heading" className="font-display text-lg font-medium tracking-[-.02em]">{activeJobs.length > 0 ? t.active : t.activity}</h2>{activeJobs.length > 0 && <span className="font-mono text-xs tabular-nums text-muted-foreground">{activeJobs.length}</span>}</div>
      {activeJobs.length > 0 && <div className="divide-y divide-border border-y border-border">{activeJobs.map((job) => <Link key={job.id} to="/jobs/$jobId" params={{ jobId: job.id }} className="group grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto]">
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{sourceLabel(job.url)}</span><span className="mt-0.5 block text-xs text-muted-foreground">{job.status === "queued" ? t.status.queued : job.stage ? t.stages[job.stage] : t.status.running}</span></span>
        <span className="row-span-2 text-right font-mono text-xs tabular-nums text-muted-foreground">{Math.max(0, Math.min(100, job.progress))}%</span>
        <span className="col-span-1 h-1 overflow-hidden rounded-full bg-secondary sm:col-span-1"><span className="block h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></span>
      </Link>)}</div>
      }
      {failedJobs.length > 0 && <div className="mt-3 flex flex-col divide-y divide-border">{failedJobs.map((job) => <Link key={job.id} to="/jobs/$jobId" params={{ jobId: job.id }} className="flex min-h-11 min-w-0 items-center gap-2 py-2 text-xs hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="shrink-0 font-medium text-destructive">{sourceLabel(job.url)} · {t.status.failed}</span><span className="min-w-0 truncate text-muted-foreground">{job.error || t.jobFailedFallback}</span></Link>)}</div>}
    </section>}
    <section className="mt-8 border-t border-border pt-7"><div className="mb-5 flex items-end justify-between gap-3"><div><h2 className="font-display text-xl font-medium tracking-[-.025em]">{t.recent}</h2><span className="mt-1 block text-xs text-muted-foreground">{t.latestFirst}</span></div><div className="flex gap-2"><Button type="button" variant="outline" size="icon" className="size-10 recent-clips-prev" aria-label={t.previousClips}><ArrowLeft className="size-4"/></Button><Button type="button" variant="outline" size="icon" className="size-10 recent-clips-next" aria-label={t.nextClips}><ArrowRight className="size-4"/></Button></div></div>
      {clipsQuery.isPending ? <div role="status" aria-label={t.loading} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i}><Skeleton className="aspect-[9/16] w-full rounded-md"/><Skeleton className="mt-2 h-4 w-4/5"/><Skeleton className="mt-2 h-3 w-2/3"/></div>)}</div> : clipsQuery.isError ? <Alert variant="destructive"><AlertDescription>{t.apiError} <Button size="sm" variant="ghost" onClick={() => clipsQuery.refetch()}>{t.retry}</Button></AlertDescription></Alert> : clipsQuery.data?.length && filteredClips.length ? <><Swiper modules={[Navigation, Pagination, Keyboard, A11y]} navigation={{ prevEl: ".recent-clips-prev", nextEl: ".recent-clips-next" }} pagination={{ el: ".recent-clips-pagination", clickable: true }} keyboard={{ enabled: true }} a11y={{ enabled: true }} spaceBetween={12} slidesPerView={2} breakpoints={{ 520: { slidesPerView: 3, spaceBetween: 14 }, 760: { slidesPerView: 4, spaceBetween: 16 }, 1100: { slidesPerView: 5, spaceBetween: 18 }, 1400: { slidesPerView: 6, spaceBetween: 20 } }} className="recent-clips-swiper !pb-8">{filteredClips.map((clip, index) => {
        const duration = Math.max(0, clip.endSec - clip.startSec)
        const title = clip.title || `${t.clip} ${index + 1}`
        const age = relativeAge(clip.createdAt, locale)
        return <SwiperSlide key={clip.id} className="min-w-0"><article><button type="button" onClick={() => setPlayingClip(clip)} aria-label={`${t.playClip}: ${title}`} className="group block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="relative block aspect-[9/16] w-full overflow-hidden rounded-md bg-black"><video src={`/api/clips/${clip.id}/stream`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" className="size-full object-contain transition-opacity group-hover:opacity-80"/><span className="absolute bottom-2 right-2 rounded-sm bg-black/85 px-1.5 py-1 font-mono text-[11px] tabular-nums text-white">{formatMomentTime(duration)}</span><span className="absolute inset-0 grid place-items-center bg-black/0 text-white transition group-hover:bg-black/20"><span className="grid size-10 place-items-center rounded-full border border-white/60 bg-black/55"><Play className="ml-0.5 size-4 fill-current"/></span></span></span><span className="mt-2 block h-10 overflow-hidden text-sm font-medium leading-5 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{title}</span><span className="mt-1 block h-4 truncate text-xs text-muted-foreground">{sourceLabel(clip.job.url)}{age ? ` · ${age}` : ""}</span></button></article></SwiperSlide>
      })}</Swiper><div className="recent-clips-pagination" aria-label={t.recentClipsPages}/></> : clipsQuery.data?.length ? <p className="py-6 text-sm text-muted-foreground">{t.noSearchResults}</p> : <div className="py-8"><p className="text-sm font-medium">{t.empty}</p><p className="mt-1 text-sm text-muted-foreground">{t.startNow}</p></div>}
    </section>
    <Dialog open={!!playingClip} onOpenChange={(open) => { if (!open) setPlayingClip(null) }}>
      {playingClip && <DialogContent className="max-w-4xl gap-3 p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><DialogTitle className="truncate font-display text-base">{playingClip.title || t.clip}</DialogTitle><DialogDescription className="mt-1 truncate">{sourceLabel(playingClip.job.url)}</DialogDescription></div><DialogClose asChild><Button type="button" variant="outline" className="size-10 shrink-0 px-0" aria-label={t.closePlayer}><X className="size-4"/></Button></DialogClose></div><video key={playingClip.id} src={`/api/clips/${playingClip.id}/stream`} controls autoPlay playsInline className="mx-auto max-h-[min(72dvh,760px)] w-full rounded-md bg-black object-contain"/><div className="flex justify-end"><Link to="/jobs/$jobId" params={{ jobId: playingClip.job.id }} className="inline-flex min-h-11 items-center gap-2 px-3 text-sm text-muted-foreground transition-colors hover:text-foreground">{t.openJob}<ArrowUpRight className="size-4"/></Link></div></DialogContent>}
    </Dialog>
  </WorkspaceShell>
}
