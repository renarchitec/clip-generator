import { createFileRoute, Link, redirect, useNavigate, useSearch } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "@tanstack/react-form"
import { ArrowDown, ArrowUp, ArrowUpRight, AudioLines, CalendarClock, Captions, CircleAlert, Flame, Image as ImageIcon, ListChecks, LoaderCircle, PanelTop, Play, Plus, Scan, Sparkles, Users, Video, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, CAPTION_LANGUAGES, CUSTOM_HASHTAGS_MAX, formatCustomHashtagsInput, isCaptionLanguage, parseCustomHashtags, type CaptionLanguage, type Job, type JobPreview, type JobSnapshot, type User } from "@/lib/api"
import { DEFAULT_CAPTION_STYLE, detectCaptionPreset, normalizeCaptionStyle, type CaptionStyle } from "@/lib/caption-style"
import { CaptionStyleEditor } from "@/components/caption-style-editor"
import { WorkspaceShell } from "@/components/chrome"
import { useT } from "@/lib/i18n"
import { getCurrentUser } from "@/lib/auth"
import { clearReviewDraft, loadReviewDraft, saveReviewDraft } from "@/lib/review-draft"
import { LlmStatus } from "@/components/llm-status"
import { sourceLabel } from "@/lib/format"
import { getVideoEmbed } from "@/lib/embed"
import { JobAssembly } from "@/components/job-assembly"
import { BatchScheduleDialog } from "@/components/batch-schedule-dialog"
import { useSaveWatermarkDefault, useWatermarkDefault, WatermarkManager, watermarkKey } from "@/components/watermark-manager"
import { WatermarkMedia } from "@/components/watermark-media"
import { WatermarkOverlay } from "@/components/watermark-overlay"
import { BriefHistoryMenu, briefHistoryKey } from "@/components/brief-history-menu"
import { OutroPreview, useOutroDefault, useOutroLibrary } from "@/components/outro-manager"
import { formatOutroDuration } from "@/lib/outro"
import {
  clamp,
  clampChromaKey,
  clampWatermark,
  DEFAULT_CHROMA_KEY,
  defaultWatermarkSettings,
  isVideoWatermark,
  normalizeJobWatermarks,
  serializeWatermarkList,
  staggerWatermarkPosition,
  stripLayerId,
  toWatermarkLayer,
  WATERMARK_CHROMA_BLEND_MAX,
  WATERMARK_CHROMA_BLEND_MIN,
  WATERMARK_CHROMA_SIMILARITY_MAX,
  WATERMARK_CHROMA_SIMILARITY_MIN,
  WATERMARK_MAX_PER_JOB,
  WATERMARK_SCALE_MAX,
  WATERMARK_SCALE_MIN,
  WATERMARK_STAGGER_POSITIONS,
  type Watermark,
  type WatermarkChromaKey,
  type WatermarkDefaultValue,
  type WatermarkLayer,
  type WatermarkSettings,
} from "@/lib/watermark"
import { formatFrameTime, FRAME_DEFAULT_SEC, useFramePreview, type FrameErrorKind } from "@/lib/frame-preview"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export const Route = createFileRoute("/")({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: "/login", search: { redirect: location.href } })
    return { user }
  },
  validateSearch: (search: Record<string, unknown>): { from?: string; job?: string } => ({ ...(typeof search.from === "string" ? { from: search.from } : {}), ...(typeof search.job === "string" ? { job: search.job } : {}) }),
  component: Dashboard,
})

type ClipRange = { start: string; end: string; title?: string; reason?: string; hookText?: string }
type RangePayload = { start: number; end: number; title?: string; reason?: string; hookText?: string }
type JobInput = { url: string; mode: "auto" | "manual"; reframe: Job["reframe"]; captions: boolean; hookBanner: boolean; normalizeAudio: boolean; twoSpeakers: boolean; facecam: boolean; aspectRatio: Job["aspectRatio"]; captionLanguage: CaptionLanguage; captionStyle?: CaptionStyle | null; customHashtags?: string[]; maxSourceSec?: number | null; clipCount?: number; targetDurationSec: number; description?: string; ranges?: RangePayload[]; watermark?: WatermarkDefaultValue; outro: { outroId: string } | null }

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

  return <section ref={reviewRef} tabIndex={-1} aria-labelledby="review-heading" className="space-y-4 rounded-xl border border-border/80 bg-secondary/20 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div className="flex items-start gap-3"><span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent"><ListChecks className="size-4" /></span><div className="min-w-0"><h2 id="review-heading" className="font-display text-lg font-medium leading-9">{t.reviewMoments}</h2>{!loading && !error && preview?.status !== "done" && <p className="-mt-1 text-sm leading-relaxed text-muted-foreground">{t.reviewMomentsHint}</p>}</div></div>
    {loading && <div role="status" className="flex items-center gap-3 rounded-lg bg-card p-4 text-sm"><LoaderCircle className="size-4 animate-spin text-primary" />{t.scanningMoments}</div>}
    {error && <Alert variant="destructive"><AlertDescription>{error} <Button type="button" size="sm" variant="ghost" onClick={retry}>{t.retry}</Button></AlertDescription></Alert>}
    {preview?.status === "done" && <><div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{t.reviewReady}</p><Button type="button" size="sm" variant="outline" onClick={retry} disabled={loading}>{t.reviewAgain}</Button></div>
      <div><p className="mb-2 text-sm font-medium">{t.candidateMoments}</p><div className="space-y-2">{candidates.map((candidate, index) => {
        const checked = selectedCandidates.includes(index)
        const disabled = !checked && selectedCount >= 10
        const score = typeof candidate.viralScore === "number" && Number.isFinite(candidate.viralScore)
          ? Math.max(0, Math.min(100, Math.round(candidate.viralScore)))
          : null
        const scoreTone = score === null
          ? ""
          : score >= 80
            ? "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
            : score >= 60
              ? "border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-300"
              : "border-zinc-500/30 bg-zinc-500/12 text-zinc-700 dark:text-zinc-300"
        const scoreTooltip = score !== null ? t.viralScoreTooltip.replace("{score}", String(score)) : undefined
        return <label key={`${candidate.start}-${candidate.end}-${index}`} className="flex cursor-pointer gap-3 rounded-lg border border-border/80 bg-card p-3 has-[:checked]:border-accent has-[:checked]:bg-accent/10">
          <input type="checkbox" className="mt-1 size-4 accent-primary" checked={checked} disabled={disabled} onChange={(event) => setSelectedCandidates((current) => event.target.checked ? [...current, index] : current.filter((item) => item !== index))} aria-label={`${candidate.title}, ${formatMomentTime(candidate.start)}–${formatMomentTime(candidate.end)}`} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{candidate.title}</span>
              <span className="inline-flex shrink-0 items-center gap-1.5">
                {score !== null && (
                  <span
                    title={scoreTooltip}
                    aria-label={scoreTooltip}
                    className={`inline-flex h-5 items-center gap-0.5 rounded-full border px-1.5 font-mono text-[10px] font-semibold tabular-nums ${scoreTone}`}
                  >
                    <Flame aria-hidden="true" className="size-3 shrink-0" />
                    <span>{score}</span>
                  </span>
                )}
                <span className="text-xs tabular-nums text-muted-foreground">{formatMomentTime(candidate.start)}–{formatMomentTime(candidate.end)}</span>
              </span>
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{candidate.reason}</span>
          </span>
        </label>
      })}</div></div>
      <div><p className="mb-2 text-sm font-medium">{t.transcript}</p><p className="mb-2 text-xs text-muted-foreground">{t.selectCueRange}</p><div role="group" aria-label={t.transcript} className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border/80 bg-card p-2">{cues.map((cue, index) => {
        const isStart = selectedCueStart === index
        const isEnd = selectedCueEnd === index
        return <button key={`${cue.start}-${index}`} type="button" aria-pressed={isStart || isEnd} onClick={() => { if (selectedCueStart === null || selectedCueEnd !== null) { setSelectedCueStart(index); setSelectedCueEnd(null) } else setSelectedCueEnd(index) }} className={`flex w-full gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isStart || isEnd ? "bg-primary/10 ring-1 ring-primary" : ""}`}><span className="shrink-0 font-mono text-xs text-muted-foreground">{formatMomentTime(cue.start)}{isStart ? ` · ${t.startSec}` : isEnd ? ` · ${t.endSec}` : ""}</span><span>{cue.text}</span></button>
      })}</div><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={selectedCueStart === null || selectedCueEnd === null || selectedCount >= 10 || cues[selectedCueStart]?.start === cues[selectedCueEnd]?.end} onClick={addCueRange}>{t.addRange}</Button><span aria-live="polite" className="text-xs text-muted-foreground">{selectedCueStart === null ? t.chooseStartCue : selectedCueEnd === null ? t.chooseEndCue : `${t.selectedMoments}: ${formatMomentTime(cues[selectedCueStart]?.start ?? 0)}–${formatMomentTime(cues[selectedCueEnd]?.end ?? 0)}`}</span></div></div>
      <div className="space-y-2"><p className="text-sm font-medium">{t.selectedMoments} ({selectedCount}/10)</p>{selectedCandidates.map((index) => { const candidate = candidates[index]; return candidate ? <div key={`candidate-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-3 py-2 text-sm"><span className="min-w-0 truncate">{candidate.title} <span className="text-xs text-muted-foreground">{formatMomentTime(candidate.start)}–{formatMomentTime(candidate.end)}</span></span><Button type="button" variant="ghost" size="sm" onClick={() => setSelectedCandidates((current) => current.filter((item) => item !== index))}>{t.removeRange}</Button></div> : null })}{cueRanges.map((range, index) => <div key={`cue-range-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-3 py-2 text-sm"><span>{formatMomentTime(range.start)}–{formatMomentTime(range.end)}</span><Button type="button" variant="ghost" size="sm" onClick={() => setCueRanges((current) => current.filter((_, item) => item !== index))}>{t.removeRange}</Button></div>)}</div>
      <Button type="button" className="w-full rounded-md" disabled={selectedCount < 1 || selectedCount > 10 || createPending} onClick={() => renderSelected([...selectedCandidates.flatMap((index) => candidates[index] ? [{ start: candidates[index].start, end: candidates[index].end, title: candidates[index].title, reason: candidates[index].reason, ...(candidates[index].hookText ? { hookText: candidates[index].hookText } : {}) }] : []), ...cueRanges])}>{createPending && <LoaderCircle className="mr-2 size-4 animate-spin" />}{t.renderClips.replace("{count}", String(selectedCount))}</Button>
    </>}
  </section>
}

function Dashboard() {
  const { user } = Route.useRouteContext() as { user: User }
  const t = useT()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [draft] = useState(loadReviewDraft)
  const [mode, setMode] = useState<"auto" | "manual">(draft?.mode ?? "auto")
  const [reframe, setReframe] = useState<Job["reframe"]>(draft?.reframe ?? "face_tracking")
  const [captions, setCaptions] = useState(draft?.captions ?? true)
  const [hookBanner, setHookBanner] = useState(draft?.hookBanner ?? true)
  const [normalizeAudio, setNormalizeAudio] = useState(draft?.normalizeAudio ?? true)
  const [twoSpeakers, setTwoSpeakers] = useState(draft?.twoSpeakers ?? false)
  const [facecam, setFacecam] = useState(draft?.facecam ?? false)
  const [aspectRatio, setAspectRatio] = useState<Job["aspectRatio"]>(draft?.aspectRatio ?? "9:16")
  const [maxSourceChoice, setMaxSourceChoice] = useState(draft?.maxSourceSec === null || draft?.maxSourceSec === undefined ? "full" : [600, 1200, 1800, 3600, 5400].includes(draft.maxSourceSec) ? String(draft.maxSourceSec) : "custom")
  const [reviewFirst, setReviewFirst] = useState(draft?.reviewFirst ?? true)
  const [previewId, setPreviewId] = useState<string | null>(draft?.previewId ?? null)
  const [previewExpired, setPreviewExpired] = useState(false)
  const [selectedCandidates, setSelectedCandidates] = useState<number[]>(draft?.selectedCandidates ?? [])
  const [selectedCueStart, setSelectedCueStart] = useState<number | null>(draft?.selectedCueStart ?? null)
  const [selectedCueEnd, setSelectedCueEnd] = useState<number | null>(draft?.selectedCueEnd ?? null)
  const [cueRanges, setCueRanges] = useState<{ start: number; end: number }[]>(draft?.cueRanges ?? [])
  const [description, setDescription] = useState(draft?.description ?? "")
  const [previousBrief, setPreviousBrief] = useState<string | null>(null)
  const [enhanceError, setEnhanceError] = useState("")
  const [captionLanguage, setCaptionLanguage] = useState<CaptionLanguage>(draft?.captionLanguage ?? "auto")
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(() => normalizeCaptionStyle(draft?.captionStyle))
  const [customHashtagsInput, setCustomHashtagsInput] = useState(() => draft?.customHashtags ?? "")
  const parsedCustomHashtags = parseCustomHashtags(customHashtagsInput)
  const [watermarkLayers, setWatermarkLayers] = useState<WatermarkLayer[]>([])
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null)
  const [watermarkError, setWatermarkError] = useState("")
  const [outroId, setOutroId] = useState<string | null>(null)
  const [monitorView, setMonitorView] = useState<"video" | "frame">("video")
  const [showSafeZone, setShowSafeZone] = useState(false)
  const [error, setError] = useState("")
  /** True while a new job must not be started (see `blockingJob` below). Read inside submit handlers. */
  const generationLocked = useRef(false)
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
      if (generationLocked.current) return
      setError("")
      if (mode === "auto" && reviewFirst) {
        createPreview.mutate({ url: value.url.trim(), clipCount: value.clipCount, targetDurationSec: value.duration, maxSourceSec: maxSourceChoice === "full" ? null : maxSourceChoice === "custom" ? Number(value.customMinutes) * 60 : Number(maxSourceChoice), ...(description.trim() ? { description: description.trim() } : {}) })
        return
      }
      const body: JobInput = { url: value.url.trim(), mode, reframe, captions, hookBanner, normalizeAudio, twoSpeakers, facecam, aspectRatio, captionLanguage, captionStyle: captions ? captionStyle : null, customHashtags: parsedCustomHashtags, targetDurationSec: value.duration, watermark: watermarkRef.current, outro: outroRef.current, ...(mode === "auto" ? { maxSourceSec: selectedMaxSourceSec(), clipCount: value.clipCount, ...(description.trim() ? { description: description.trim() } : {}) } : { ranges: value.ranges.map(({ start, end, title, reason, hookText }) => ({ start: Number(start), end: Number(end), ...(title ? { title } : {}), ...(reason ? { reason } : {}), ...(hookText ? { hookText } : {}) })) }) }
      create.mutate(body)
    },
  })
  const formValues = useSyncExternalStore((onChange) => { const subscription = form.store.subscribe(onChange); return () => subscription.unsubscribe() }, () => form.state.values, () => form.state.values)
  const reviewRef = useRef<HTMLDivElement>(null)
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
  const firstReviewedStart = (preview.data?.candidates ?? []).reduce<number | null>((first, candidate) => first === null ? candidate.start : Math.min(first, candidate.start), null)
  const firstManualStart = formValues.ranges.map(({ start }) => Number(start)).find((start) => Number.isFinite(start) && start >= 0)
  const suggestedFrameSec = firstReviewedStart ?? (mode === "manual" ? firstManualStart : null) ?? FRAME_DEFAULT_SEC
  const framePreview = useFramePreview({ url: formValues.url, aspectRatio, reframe, twoSpeakers, facecam }, suggestedFrameSec)
  const initializedPreview = useRef<string | null>(draft?.previewId ?? null)
  const { from, job: selectedJobId } = useSearch({ from: "/" })
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
    setHookBanner(Boolean(job.hookBanner))
    setNormalizeAudio(job.normalizeAudio ?? true)
    setTwoSpeakers(job.aspectRatio === "9:16" && (job.twoSpeakers ?? false))
    setFacecam(job.aspectRatio === "9:16" && (job.facecam ?? false))
    if (job.clipCount) form.setFieldValue("clipCount", job.clipCount)
    if (job.targetDurationSec) form.setFieldValue("duration", job.targetDurationSec)
    else form.setFieldValue("duration", 45)
    setDescription(job.description ?? "")
    setPreviousBrief(null)
    setEnhanceError("")
    setCaptionLanguage(isCaptionLanguage(job.captionLanguage) ? job.captionLanguage : "auto")
    setCaptionStyle(job.captionStyle ? normalizeCaptionStyle(job.captionStyle) : { ...DEFAULT_CAPTION_STYLE })
    setCustomHashtagsInput(formatCustomHashtagsInput(job.customHashtags))
    watermarkPrefilled.current = true
    const restoredWatermarks = normalizeJobWatermarks(job.watermark).map((wm) =>
      toWatermarkLayer({
        watermarkId: wm.watermarkId,
        x: wm.x,
        y: wm.y,
        scale: wm.scale,
        opacity: wm.opacity,
        ...(wm.chromaKey ? { chromaKey: wm.chromaKey } : {}),
      }),
    )
    setWatermarkLayers(restoredWatermarks)
    setSelectedLayerId(restoredWatermarks[0]?.layerId ?? null)
    outroPrefilled.current = true
    setOutroId(job.outro?.outroId ?? null)
    if (job.ranges?.length) form.setFieldValue("ranges", job.ranges.map(({ start, end, title, reason, hookText }) => ({ start: String(start), end: String(end), ...(title ? { title } : {}), ...(reason ? { reason } : {}), ...(hookText ? { hookText } : {}) })))
  }, [source.data, form])
  const outroDefaults = useOutroDefault()
  const outros = useOutroLibrary()
  const chosenOutro = outros.data?.find((item) => item.id === outroId)
  const outroRef = useRef<{ outroId: string } | null>(null)
  outroRef.current = chosenOutro ? { outroId: chosenOutro.id } : null
  const outroPrefilled = useRef(false)
  useEffect(() => {
    if (outroPrefilled.current || !outroDefaults.isSuccess || !outros.isSuccess) return
    outroPrefilled.current = true
    const saved = outroDefaults.data.default
    if (!saved || !outros.data.some((item) => item.id === saved.outroId)) return
    setOutroId((current) => current ?? saved.outroId)
  }, [outroDefaults.isSuccess, outroDefaults.data, outros.isSuccess, outros.data])
  useEffect(() => {
    if (outroId && outros.isSuccess && !outros.data.some((item) => item.id === outroId)) setOutroId(outros.data[0]?.id ?? null)
  }, [outroId, outros.isSuccess, outros.data])
  const watermarkDefaults = useWatermarkDefault()
  const watermarks = useQuery({ queryKey: watermarkKey, queryFn: () => api<Watermark[]>("/watermarks") })
  const watermarkMap = useMemo(() => new Map((watermarks.data ?? []).map((item) => [item.id, item])), [watermarks.data])
  const watermarkEnabled = watermarkLayers.length > 0
  const activeSelectedLayer = watermarkLayers.find((layer) => layer.layerId === selectedLayerId) ?? watermarkLayers[0] ?? null
  const activeSelectedLayerIndex = activeSelectedLayer ? watermarkLayers.findIndex((layer) => layer.layerId === activeSelectedLayer.layerId) : -1
  const selectedWatermark = activeSelectedLayer ? watermarkMap.get(activeSelectedLayer.watermarkId) : undefined
  const selectedWatermarkIsVideo = isVideoWatermark(selectedWatermark)
  const appliedWatermarkLayers = useMemo(
    () =>
      watermarkLayers.flatMap((layer) => {
        const watermark = watermarkMap.get(layer.watermarkId)
        if (!watermark) return []
        const normalized = isVideoWatermark(watermark)
          ? clampWatermark(layer)
          : clampWatermark({
              watermarkId: layer.watermarkId,
              x: layer.x,
              y: layer.y,
              scale: layer.scale,
              opacity: layer.opacity,
            })
        return [{ layer: { ...normalized, layerId: layer.layerId }, watermark }]
      }),
    [watermarkLayers, watermarkMap],
  )
  const serializedWatermark = useMemo(
    () => serializeWatermarkList(appliedWatermarkLayers.map(({ layer }) => stripLayerId(layer))),
    [appliedWatermarkLayers],
  )
  const hasSavedWatermarkDefault = (watermarkDefaults.data?.defaults.length ?? 0) > 0
  const activeChromaKey: WatermarkChromaKey = activeSelectedLayer?.chromaKey ? clampChromaKey(activeSelectedLayer.chromaKey) : DEFAULT_CHROMA_KEY
  const updateWatermarkLayer = (layerId: string, updater: (layer: WatermarkLayer) => WatermarkSettings) => {
    setWatermarkLayers((current) =>
      current.map((layer) => (layer.layerId === layerId ? { ...clampWatermark(updater(layer)), layerId: layer.layerId } : layer)),
    )
  }
  const updateChromaKey = (patch: Partial<WatermarkChromaKey>) => {
    if (!activeSelectedLayer) return
    updateWatermarkLayer(activeSelectedLayer.layerId, (layer) => {
      const base = layer.chromaKey ? clampChromaKey(layer.chromaKey) : DEFAULT_CHROMA_KEY
      return { ...stripLayerId(layer), chromaKey: clampChromaKey({ ...base, ...patch }) }
    })
  }
  const toggleWatermarkEnabled = (checked: boolean) => {
    setWatermarkError("")
    if (!checked) {
      setWatermarkLayers([])
      setSelectedLayerId(null)
      return
    }
    const validDefaults = (watermarkDefaults.data?.defaults ?? []).filter((settings) => watermarkMap.has(settings.watermarkId))
    if (validDefaults.length > 0) {
      const restored = validDefaults.map((settings) => toWatermarkLayer(settings))
      setWatermarkLayers(restored)
      setSelectedLayerId(restored[0]?.layerId ?? null)
      return
    }
    const initial = toWatermarkLayer(defaultWatermarkSettings(watermarks.data?.[0]?.id ?? "", 0))
    setWatermarkLayers([initial])
    setSelectedLayerId(initial.layerId)
  }
  const addWatermarkLayer = () => {
    const library = watermarks.data ?? []
    if (watermarkLayers.length >= WATERMARK_MAX_PER_JOB || library.length === 0) return
    const usedIds = new Set(watermarkLayers.map((layer) => layer.watermarkId))
    const nextAsset = library.find((item) => !usedIds.has(item.id)) ?? library[0]
    const nextPos =
      WATERMARK_STAGGER_POSITIONS.find(
        (pos) => !watermarkLayers.some((layer) => Math.hypot(layer.x - pos.x, layer.y - pos.y) < 0.08),
      ) ?? staggerWatermarkPosition(watermarkLayers.length)
    const created = toWatermarkLayer({ ...defaultWatermarkSettings(nextAsset.id), x: nextPos.x, y: nextPos.y })
    setWatermarkLayers((current) => (current.length >= WATERMARK_MAX_PER_JOB ? current : [...current, created]))
    setSelectedLayerId(created.layerId)
  }
  const moveWatermarkLayer = (layerId: string, direction: -1 | 1) => {
    setWatermarkLayers((current) => {
      const index = current.findIndex((layer) => layer.layerId === layerId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }
  const removeWatermarkLayer = (layerId: string) => {
    setWatermarkLayers((current) => {
      const index = current.findIndex((layer) => layer.layerId === layerId)
      if (index < 0) return current
      const next = current.filter((layer) => layer.layerId !== layerId)
      setSelectedLayerId((prev) => {
        if (prev && prev !== layerId && next.some((layer) => layer.layerId === prev)) return prev
        return next[Math.min(index, next.length - 1)]?.layerId ?? null
      })
      return next
    })
  }
  const handleWatermarkAssetDeleted = (deletedId: string) => {
    const fallbackAsset = watermarks.data?.find((item) => item.id !== deletedId)
    setWatermarkLayers((current) => {
      if (current.length === 1 && current[0].watermarkId === deletedId && fallbackAsset) {
        const only = current[0]
        const swapped: WatermarkLayer = {
          ...clampWatermark({
            ...stripLayerId(only),
            watermarkId: fallbackAsset.id,
            ...(isVideoWatermark(fallbackAsset) ? {} : { chromaKey: undefined }),
          }),
          layerId: only.layerId,
        }
        return [swapped]
      }
      const next = current.filter((layer) => layer.watermarkId !== deletedId)
      if (next.length !== current.length) {
        setSelectedLayerId((prev) => (prev && next.some((layer) => layer.layerId === prev) ? prev : (next[0]?.layerId ?? null)))
      }
      return next
    })
  }
  const watermarkRef = useRef<WatermarkDefaultValue>(serializedWatermark)
  watermarkRef.current = serializedWatermark
  const watermarkPrefilled = useRef(false)
  useEffect(() => {
    if (watermarkPrefilled.current || !watermarkDefaults.isSuccess || !watermarks.isSuccess) return
    watermarkPrefilled.current = true
    const validDefaults = watermarkDefaults.data.defaults.filter((settings) =>
      watermarks.data.some((item) => item.id === settings.watermarkId),
    )
    if (validDefaults.length === 0) return
    setWatermarkLayers((current) => {
      if (current.length > 0) return current
      const restored = validDefaults.map((settings) => toWatermarkLayer(settings))
      setSelectedLayerId(restored[0]?.layerId ?? null)
      return restored
    })
  }, [watermarkDefaults.isSuccess, watermarkDefaults.data, watermarks.isSuccess, watermarks.data])
  useEffect(() => {
    if (!watermarks.isSuccess) return
    const library = watermarks.data
    const libraryIds = new Set(library.map((item) => item.id))
    const fallbackAsset = library[0]
    setWatermarkLayers((current) => {
      if (current.length === 0) return current
      // Bind empty placeholder layer once an asset is available in the library.
      if (current.length === 1 && current[0].watermarkId === "") {
        if (!fallbackAsset) return current
        return [{ ...current[0], watermarkId: fallbackAsset.id }]
      }
      const hasMissing = current.some((layer) => layer.watermarkId !== "" && !libraryIds.has(layer.watermarkId))
      if (!hasMissing) return current
      if (current.length === 1 && fallbackAsset) {
        const only = current[0]
        return [
          {
            ...clampWatermark({
              ...stripLayerId(only),
              watermarkId: fallbackAsset.id,
              ...(isVideoWatermark(fallbackAsset) ? {} : { chromaKey: undefined }),
            }),
            layerId: only.layerId,
          },
        ]
      }
      const next = current.filter((layer) => layer.watermarkId === "" || libraryIds.has(layer.watermarkId))
      setSelectedLayerId((prev) => (prev && next.some((layer) => layer.layerId === prev) ? prev : (next[0]?.layerId ?? null)))
      return next
    })
  }, [watermarks.isSuccess, watermarks.data])
  const saveWatermarkDefault = useSaveWatermarkDefault()
  const persistWatermarkDefault = (payload: WatermarkDefaultValue) => {
    saveWatermarkDefault.mutate(payload, {
      onSuccess: () => setWatermarkError(""),
      onError: () => setWatermarkError(t.watermarkSaveFailed),
    })
  }
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api<Job[]>("/jobs"), refetchInterval: 5000 })
  const selectedJob = useQuery({ queryKey: ["jobs", selectedJobId], queryFn: () => api<JobSnapshot>(`/jobs/${selectedJobId}`), enabled: !!selectedJobId, refetchInterval: (query) => query.state.data && ["done", "failed", "cancelled"].includes(query.state.data.status) ? false : 3000 })
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
      hookBanner,
      normalizeAudio,
      twoSpeakers,
      facecam,
      aspectRatio,
      maxSourceSec: maxSourceChoice === "full" ? null : maxSourceChoice === "custom" ? Number(formValues.customMinutes) * 60 : Number(maxSourceChoice),
      clipCount: formValues.clipCount,
      duration: formValues.duration,
      description,
      captionLanguage,
      captionStyle,
      customHashtags: customHashtagsInput,
      ranges: formValues.ranges,
      reviewFirst,
      previewId,
      selectedCandidates,
      cueRanges,
      selectedCueStart,
      selectedCueEnd,
    })
  }, [formValues.url, formValues.customMinutes, formValues.clipCount, formValues.duration, formValues.ranges, mode, reframe, captions, hookBanner, normalizeAudio, twoSpeakers, facecam, aspectRatio, maxSourceChoice, description, captionLanguage, captionStyle, customHashtagsInput, reviewFirst, previewId, selectedCandidates, cueRanges, selectedCueStart, selectedCueEnd])
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
      void client.invalidateQueries({ queryKey: briefHistoryKey })
      void navigate({ to: "/", search: (previous) => ({ ...previous, job: job.id }) })
    },
    onError: (e: Error) => setError((e as Error & { status?: number }).status === 401 ? t.error : t.apiError),
  })
  const updateRange = (index: number, field: keyof ClipRange, value: string) => form.setFieldValue("ranges", formValues.ranges.map((item, i) => i === index ? { start: item.start, end: item.end, [field]: value } : item))
  const changeAspectRatio = (value: string) => {
    const next = value as Job["aspectRatio"]
    setAspectRatio(next)
    if (next !== "9:16") { setTwoSpeakers(false); setFacecam(false) }
  }
  const selectedMaxSourceSec = () => maxSourceChoice === "full" ? null : maxSourceChoice === "custom" ? Number(formValues.customMinutes) * 60 : Number(maxSourceChoice)
  const validCustomMinutes = maxSourceChoice !== "custom" || (/^\d+$/.test(formValues.customMinutes) && Number(formValues.customMinutes) >= 1 && Number(formValues.customMinutes) <= 600)
  const renderSelected = (selectedRanges: RangePayload[]) => {
    if (generationLocked.current) return
    if (!selectedRanges.length || selectedRanges.length > 10 || selectedRanges.some(({ start, end }) => !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)) { setError(t.rangesInvalid); return }
    if (!formValues.url.trim()) { setError(t.urlRequired); return }
    if (!Number.isInteger(formValues.duration) || formValues.duration < 15 || formValues.duration > 180) { setError(t.durationInvalid); return }
    create.mutate({ url: formValues.url.trim(), mode: "manual", ranges: selectedRanges, targetDurationSec: formValues.duration, reframe, captions, hookBanner, normalizeAudio, twoSpeakers, facecam, aspectRatio, captionLanguage, captionStyle: captions ? captionStyle : null, customHashtags: parsedCustomHashtags, watermark: watermarkRef.current, outro: outroRef.current, ...(description.trim() ? { description: description.trim() } : {}) })
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
    if (generationLocked.current) return
    setError("")
    // Error validator level-form (mis. jumlah klip > 10) tidak punya field
    // sendiri, jadi tampilkan di alert supaya tombol tidak terlihat diam.
    void form.handleSubmit().then(() => {
      const formError = form.state.errors.find(Boolean)
      if (formError) setError(String(formError))
    })
  }

  // Blocking rule: no new job while the selected job OR any of this user's jobs is queued/running,
  // and never while a create/preview request is in flight. Selected-job data polls faster (3s), so prefer it for the hint.
  const isActive = (job?: { status: Job["status"] } | null) => !!job && (job.status === "queued" || job.status === "running")
  const blockingJob = isActive(selectedJob.data) ? selectedJob.data : activeJobs[0]
  const submitting = create.isPending || createPreview.isPending
  const locked = submitting || !!blockingJob
  generationLocked.current = locked
  const blockingProgress = Math.max(0, Math.min(100, Math.round(blockingJob?.progress ?? 0)))
  const blockingHint = blockingJob ? blockingJob.status === "queued" ? t.jobQueuedHint : t.jobRunningHint.replace("{stage}", blockingJob.stage ? t.stages[blockingJob.stage] : t.status.running).replace("{progress}", String(blockingProgress)) : ""
  const frameErrorMessages: Record<FrameErrorKind, string> = {
    busy: t.frameBusy,
    invalid: t.frameInvalid,
    failed: framePreview.errorDetail || t.frameFailed,
    network: t.frameNetwork,
    expired: t.frameExpired,
  }
  const frameError = framePreview.errorKind ? frameErrorMessages[framePreview.errorKind] : ""
  const activeFrame = framePreview.frame
  const embed = getVideoEmbed(formValues.url)
  useEffect(() => {
    setMonitorView(activeFrame ? "frame" : "video")
  }, [activeFrame?.id ?? null])
  const retryJob = useMutation({ mutationFn: () => api<JobSnapshot>(`/jobs/${selectedJobId}/retry`, { method: "POST" }), onSuccess: (next) => { void client.invalidateQueries({ queryKey: ["jobs"] }); void navigate({ to: "/", search: (previous) => ({ ...previous, job: next.id }) }) } })
  const enhanceBrief = useMutation({
    mutationFn: (brief: string) => api<{ brief: string }>("/briefs/expand", { method: "POST", body: JSON.stringify({ brief }) }),
    onSuccess: (result) => { setPreviousBrief(description); setDescription(result.brief); setEnhanceError("") },
    onError: () => setEnhanceError(t.enhanceBriefError),
  })
  const resultJob = selectedJob.data
  const [batchScheduleOpen, setBatchScheduleOpen] = useState(false)
  const resultActiveClips = useMemo(() => resultJob?.clips.filter((clip) => !clip.deletedAt) ?? [], [resultJob])
  const resultBatchClips = useMemo(
    () => (resultJob ? resultActiveClips.map((clip) => ({ ...clip, job: { id: resultJob.id, url: resultJob.url, aspectRatio: resultJob.aspectRatio } })) : []),
    [resultJob, resultActiveClips],
  )
  const chromaPresets = [
    { key: "green" as const, hex: "#00FF00" },
    { key: "blue" as const, hex: "#0000FF" },
    { key: "black" as const, hex: "#000000" },
    { key: "white" as const, hex: "#FFFFFF" },
  ]
  return <WorkspaceShell user={user}>
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,400px)] lg:grid-rows-[minmax(560px,calc(100vh-120px))_auto]">
    <form noValidate onSubmit={submit} className="contents">
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:col-start-1 lg:row-start-1 lg:h-full" aria-label={t.sourceMonitor}>
        <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-4 text-sm text-muted-foreground">
          <span className="min-w-0 truncate">{formValues.url.trim() ? sourceLabel(formValues.url.trim()) : t.noSource}</span>
          <div className="flex shrink-0 items-center gap-2">
            {aspectRatio === "9:16" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={showSafeZone ? "secondary" : "outline"}
                    size="sm"
                    aria-pressed={showSafeZone}
                    onClick={() => setShowSafeZone((value) => !value)}
                    className={`h-8 gap-1.5 px-2.5 text-xs ${showSafeZone ? "border-rose-400/50 bg-rose-500/12 text-rose-600 hover:bg-rose-500/18 dark:text-rose-300" : ""}`}
                  >
                    <Scan aria-hidden="true" className="size-3.5" />
                    {t.safeZone}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t.safeZoneTooltip}</TooltipContent>
              </Tooltip>
            )}
            {activeFrame && <ToggleGroup type="single" aria-label={t.frameViewLabel} size="sm" value={monitorView} onValueChange={(value) => { if (value) setMonitorView(value as "video" | "frame") }} className="shrink-0 rounded-md border border-border bg-secondary/40 p-0.5">
              <ToggleGroupItem value="video" className="gap-1.5 px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs"><Play className="size-3.5"/>{t.frameViewVideo}</ToggleGroupItem>
              <ToggleGroupItem value="frame" className="gap-1.5 px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs"><ImageIcon className="size-3.5"/>{t.frameViewFrame}</ToggleGroupItem>
            </ToggleGroup>}
          </div>
        </div>
        <div className="shrink-0 border-b border-border bg-secondary/20 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="frame-time" className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground">
              <ImageIcon aria-hidden="true" className="size-3.5 text-muted-foreground"/>
              <span>{t.framePreview}</span>
            </label>
            <Input
              id="frame-time"
              type="text"
              inputMode="numeric"
              placeholder={t.frameTimeHint}
              aria-label={t.frameTime}
              aria-invalid={framePreview.parsedSec === null}
              value={framePreview.timeText}
              onChange={(event) => framePreview.setTimeText(event.target.value)}
              className="h-8 w-24 shrink-0 rounded-md bg-background font-mono text-xs tabular-nums"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-2.5 text-xs"
              disabled={!framePreview.hasUrl || framePreview.parsedSec === null || framePreview.running}
              onClick={() => framePreview.render()}
            >
              {framePreview.running ? <LoaderCircle aria-hidden="true" className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none"/> : <ImageIcon aria-hidden="true" className="mr-1.5 size-3.5"/>}
              {t.framePreview}
            </Button>
            {framePreview.lastAtSec !== null && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 px-2.5 text-xs"
                disabled={!framePreview.hasUrl || framePreview.running}
                onClick={() => framePreview.renderAnother()}
              >
                {t.frameAnother}
              </Button>
            )}
            <div className="ml-auto flex min-w-0 items-center gap-2">
              {framePreview.stale && !framePreview.running ? (
                <span role="status" className="truncate text-[11px] font-medium text-accent">{t.frameStale}</span>
              ) : activeFrame && !framePreview.running ? (
                <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">{t.frameViewFrame} · {formatFrameTime(activeFrame.atSec)}</Badge>
              ) : !framePreview.hasUrl ? (
                <span className="truncate text-[11px] text-muted-foreground">{t.frameNeedUrl}</span>
              ) : !framePreview.running ? (
                <span className="hidden truncate text-[11px] text-muted-foreground xl:inline">{t.framePreviewHint}</span>
              ) : null}
            </div>
          </div>
          {framePreview.parsedSec === null && <p className="mt-1.5 text-[11px] text-destructive">{t.frameTimeInvalid}</p>}
          {framePreview.running && (
            <div role="status" className="mt-2 flex items-center gap-2.5 rounded-md border border-border/70 bg-background px-2.5 py-1.5">
              <Skeleton className="size-6 shrink-0 rounded-sm"/>
              <div className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <LoaderCircle aria-hidden="true" className="size-3 animate-spin text-accent motion-reduce:animate-none"/>
                  {framePreview.queued ? t.frameQueued : t.frameRendering}
                </span>
                <span className="block text-[11px] text-muted-foreground">{t.frameRenderingHint}</span>
              </div>
            </div>
          )}
          {frameError && <Alert variant="destructive" className="mt-2 px-2.5 py-1.5"><AlertDescription className="text-xs">{frameError}</AlertDescription></Alert>}
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted p-4">
          <div className={`relative aspect-video w-full max-w-full overflow-hidden shadow-xl ${embed && monitorView === "video" ? "bg-black" : "border border-border bg-[radial-gradient(ellipse_at_center,var(--monitor-empty-center),var(--monitor-empty-edge))]"}`}>
            {monitorView === "frame" && activeFrame ? <>
              <WatermarkOverlay
                aspectRatio={aspectRatio}
                layers={appliedWatermarkLayers}
                selectedLayerId={activeSelectedLayer?.layerId ?? null}
                onSelectLayer={setSelectedLayerId}
                onChangeLayer={(layerId, next) => updateWatermarkLayer(layerId, () => next)}
                captions={captions}
                captionStyle={captionStyle}
                twoSpeakers={twoSpeakers}
                onCaptionStyleChange={setCaptionStyle}
                showSafeZone={showSafeZone && aspectRatio === "9:16"}
                frame={{ imageUrl: activeFrame.imageUrl, width: activeFrame.width, height: activeFrame.height, alt: t.frameImageAlt.replace("{time}", formatFrameTime(activeFrame.atSec)), caption: `${activeFrame.width}×${activeFrame.height} · ${formatFrameTime(activeFrame.atSec)}`, busy: framePreview.running, onImageError: () => framePreview.markImageBroken(activeFrame.id) }}
              />
            </> : <>
              {embed ? <iframe key={embed.src} src={embed.src} title={embed.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="absolute inset-0 size-full border-0"/> : <div className="absolute inset-0 grid place-items-center"><div className="max-w-xs px-5 text-center"><span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl border border-border bg-card text-primary shadow-sm"><Play className="ml-1 size-5"/></span><p className="font-display text-lg text-foreground">{t.sourceStatement}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.pasteToPreview}</p></div></div>}
              {(appliedWatermarkLayers.length > 0 || (captions && embed) || (showSafeZone && aspectRatio === "9:16")) && (
                <WatermarkOverlay
                  aspectRatio={aspectRatio}
                  layers={appliedWatermarkLayers}
                  selectedLayerId={activeSelectedLayer?.layerId ?? null}
                  onSelectLayer={setSelectedLayerId}
                  onChangeLayer={(layerId, next) => updateWatermarkLayer(layerId, () => next)}
                  captions={captions}
                  captionStyle={captionStyle}
                  twoSpeakers={twoSpeakers}
                  onCaptionStyleChange={setCaptionStyle}
                  showSafeZone={showSafeZone && aspectRatio === "9:16"}
                />
              )}
            </>}
          </div>
        </div>
        <div className="shrink-0 border-t border-border bg-card p-4"><Field><FieldLabel htmlFor="source-url" className="text-sm font-medium text-foreground">{t.sourceUrl}</FieldLabel><div className="relative mt-2"><Play className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><form.Field name="url" validators={{ onChange: ({ value }) => value.trim() ? undefined : t.urlRequired }}>{(field) => <><Input id="source-url" name="url" type="url" inputMode="url" autoComplete="url" placeholder={t.sourcePlaceholder} value={field.state.value} aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} required className="h-14 rounded-md pl-10 text-base" />{field.state.meta.isTouched && field.state.meta.errors.length > 0 && <FieldDescription className="text-destructive">{field.state.meta.errors[0]}</FieldDescription>}</>}</form.Field></div><FieldDescription className="mt-2 text-muted-foreground">{t.sourceHint}</FieldDescription></Field></div>
      </section>
      <aside className="relative min-h-0 min-w-0 overflow-hidden rounded-xl border border-border bg-card lg:col-start-2 lg:row-start-1 lg:flex lg:h-full lg:max-h-full lg:flex-col"><div className="shrink-0 border-b border-border px-4 py-3"><h3 className="font-display text-lg font-medium">{t.settings}</h3></div><div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4"><div className="relative space-y-4">
          <Field><FieldLabel>{t.creationMode}</FieldLabel><div className="grid grid-cols-2 gap-1 rounded-md bg-secondary p-1" role="group" aria-label={t.creationMode}><button type="button" className={`inline-flex h-10 items-center justify-center rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === "auto" ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-background/60"}`} aria-pressed={mode === "auto"} onClick={() => setMode("auto")}>{t.autoMode}</button><button type="button" className={`inline-flex h-10 items-center justify-center rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === "manual" ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-background/60"}`} aria-pressed={mode === "manual"} onClick={() => setMode("manual")}>{t.manualMode}</button></div></Field>
          {mode === "auto" && <Field><FieldLabel htmlFor="source-duration-select">{t.videoDurationScan}</FieldLabel><Select value={maxSourceChoice} onValueChange={setMaxSourceChoice}><SelectTrigger id="source-duration-select" className="h-11 w-full rounded-md"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="full">{t.fullVideo}</SelectItem><SelectItem value="600">{t.tenMinutes}</SelectItem><SelectItem value="1200">{t.twentyMinutes}</SelectItem><SelectItem value="1800">{t.thirtyMinutes}</SelectItem><SelectItem value="3600">{t.sixtyMinutes}</SelectItem><SelectItem value="5400">{t.ninetyMinutes}</SelectItem><SelectItem value="custom">{t.customDuration}</SelectItem></SelectContent></Select><FieldDescription>{t.scanDurationHint}</FieldDescription>{maxSourceChoice === "custom" && <Field className="mt-3"><FieldLabel htmlFor="custom-source-minutes">{t.customMinutesLabel}</FieldLabel><Input id="custom-source-minutes" type="number" min={1} max={600} step={1} inputMode="numeric" value={formValues.customMinutes} aria-invalid={!validCustomMinutes} onChange={(event) => form.setFieldValue("customMinutes", event.target.value)} required className="h-11 rounded-md tabular-nums" />{!validCustomMinutes && <FieldDescription className="text-destructive">{t.customMinutesInvalid}</FieldDescription>}</Field>}</Field>}
           <Field><FieldLabel id="aspect-ratio-label">{t.outputFormat}</FieldLabel><RadioGroup aria-labelledby="aspect-ratio-label" value={aspectRatio} onValueChange={changeAspectRatio} className="grid grid-cols-3 gap-1.5 rounded-lg bg-secondary p-1">{([{ value: "9:16", shape: "h-5 w-3" }, { value: "1:1", shape: "size-4" }, { value: "16:9", shape: "w-6 h-3.5" }] as const).map(({ value, shape }) => <label key={value} htmlFor={`aspect-${value}`} className="group relative flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-transparent px-1 py-2.5 !transition-none has-[:checked]:border-accent/50 has-[:checked]:bg-accent/15 has-[:checked]:shadow-sm hover:bg-card/60"><RadioGroupItem id={`aspect-${value}`} value={value} className="sr-only"/><span aria-hidden="true" className={`block ${shape} rounded-[3px] border-2 border-muted-foreground group-has-[:checked]:border-accent`}/><span className="font-mono text-xs font-semibold tabular-nums text-foreground">{value}</span></label>)}</RadioGroup><p className="mt-2 truncate text-xs text-muted-foreground">{{ "9:16": t.aspectPortrait, "1:1": t.aspectSquare, "16:9": t.aspectLandscape }[aspectRatio]}</p></Field>
           <Field className={twoSpeakers || facecam || aspectRatio === "16:9" ? "opacity-50" : undefined}>
               <FieldLabel id="reframe-label">{t.portraitReframe}</FieldLabel><RadioGroup disabled={twoSpeakers || facecam || aspectRatio === "16:9"} aria-labelledby="reframe-label" value={reframe} onValueChange={(value) => { if (!twoSpeakers && !facecam && aspectRatio !== "16:9") setReframe(value as Job["reframe"]) }} className="mt-2 grid min-w-0 gap-1.5">{([{ value: "face_tracking", label: t.faceTracking, hint: t.faceTrackingHint }, { value: "blurred_fill", label: t.blurredFill, hint: t.blurredFillHint }, { value: "black_bars", label: t.blackBars, hint: t.blackBarsHint }] as const).map((option) => <label key={option.value} htmlFor={`reframe-${option.value}`} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-2 transition-colors has-[:checked]:bg-accent/15 has-[:checked]:ring-1 has-[:checked]:ring-accent/40 hover:bg-secondary/50"><RadioGroupItem id={`reframe-${option.value}`} value={option.value} className="mt-0.5 shrink-0"/><span className="min-w-0"><span className="block text-sm font-medium leading-5 text-foreground">{option.label}</span><span className="block whitespace-normal text-xs leading-4 text-muted-foreground">{option.hint}</span></span></label>)}</RadioGroup>{twoSpeakers || facecam ? <FieldDescription>{t.reframeIgnored}</FieldDescription> : aspectRatio === "16:9" ? <FieldDescription>{t.reframeUnavailable}</FieldDescription> : null}</Field>
            <Field>
              <FieldLabel>{t.processingOptions}</FieldLabel>
              <div className="divide-y divide-border border-y border-border">
                {[
                  {
                    key: "two-speakers",
                    icon: Users,
                    label: t.twoSpeakers,
                    hint: aspectRatio === "9:16" ? t.twoSpeakersHint : t.twoSpeakersUnavailable,
                    checked: twoSpeakers,
                    unavailable: aspectRatio !== "9:16",
                    onChange: (checked: boolean) => {
                      setTwoSpeakers(checked)
                      if (checked) setFacecam(false)
                    },
                  },
                  {
                    key: "facecam",
                    icon: Video,
                    label: t.facecam,
                    hint: aspectRatio === "9:16" ? t.facecamHint : t.facecamUnavailable,
                    checked: facecam,
                    unavailable: aspectRatio !== "9:16",
                    onChange: (checked: boolean) => {
                      setFacecam(checked)
                      if (checked) setTwoSpeakers(false)
                    },
                  },
                  {
                    key: "burn-captions",
                    icon: Captions,
                    label: t.burnCaptions,
                    hint: t.burnCaptionsHint,
                    checked: captions,
                    unavailable: false,
                    onChange: setCaptions,
                  },
                  {
                    key: "hook-banner",
                    icon: PanelTop,
                    label: t.hookBanner,
                    hint: t.hookBannerHint,
                    checked: hookBanner,
                    unavailable: false,
                    onChange: setHookBanner,
                  },
                  {
                    key: "normalize-audio",
                    icon: AudioLines,
                    label: t.normalizeAudio,
                    hint: t.normalizeAudioHint,
                    checked: normalizeAudio,
                    unavailable: false,
                    onChange: setNormalizeAudio,
                  },
                  ...(mode === "auto"
                    ? [{
                        key: "review-first",
                        icon: ListChecks,
                        label: t.reviewMoments,
                        hint: t.reviewMomentsHint,
                        checked: reviewFirst,
                        unavailable: false,
                        onChange: (checked: boolean) => {
                          setReviewFirst(checked)
                          if (!checked) {
                            setPreviewId(null)
                            setPreviewExpired(false)
                            initializedPreview.current = null
                            clearReviewDraft()
                          }
                        },
                      }]
                    : []),
                ].map(({ key, icon: Icon, label, hint, checked, unavailable, onChange }) => (
                  <label
                    key={key}
                    htmlFor={`opt-${key}`}
                    className={`relative flex min-h-12 w-full items-center gap-3 py-2.5 text-left transition-colors ${unavailable ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-secondary/40"}`}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs leading-relaxed text-muted-foreground">{hint}</span>
                    </span>
                    <Switch
                      id={`opt-${key}`}
                      aria-label={label}
                      checked={checked}
                      disabled={unavailable}
                      onCheckedChange={onChange}
                    />
                  </label>
                ))}
              </div>
            </Field>
           {captions && <Field className="rounded-lg border border-border/80 bg-secondary/20 p-3">
             <div className="flex items-center justify-between gap-2"><FieldLabel>{t.captionStyle}</FieldLabel><div className="flex items-center gap-1.5"><Badge variant="secondary" className="text-[10px]">{t.captionPresetNames[detectCaptionPreset(captionStyle)]}</Badge>{detectCaptionPreset(captionStyle) !== "hook" && <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => setCaptionStyle({ ...DEFAULT_CAPTION_STYLE })}>{t.captionReset}</Button>}</div></div>
             <FieldDescription className="mb-3 text-xs">{t.captionStyleHint}</FieldDescription>
             <CaptionStyleEditor value={captionStyle} onChange={setCaptionStyle} twoSpeakers={twoSpeakers} />
           </Field>}
           <Field className="relative rounded-lg border border-border/80 bg-secondary/20 p-3">
             <div className="relative flex items-center justify-between gap-2">
               <div className="flex min-w-0 items-center gap-2">
                 <FieldLabel htmlFor="watermark-enabled">{t.watermark}</FieldLabel>
                 {watermarkEnabled && (
                   <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[10px] tabular-nums">
                     {watermarkLayers.length} / {WATERMARK_MAX_PER_JOB}
                   </Badge>
                 )}
               </div>
               <Switch id="watermark-enabled" aria-label={t.watermark} checked={watermarkEnabled} onCheckedChange={toggleWatermarkEnabled}/>
             </div>
             <FieldDescription>{t.watermarkHint}</FieldDescription>
             {watermarkEnabled && activeSelectedLayer && <div className="mt-3 space-y-3">
               <div className="space-y-1.5">
                 <div className="space-y-1" role="list" aria-label={t.watermark}>
                   {watermarkLayers.map((layer, index) => {
                     const wm = watermarkMap.get(layer.watermarkId)
                     const isSelected = layer.layerId === activeSelectedLayer.layerId
                     const isVideo = isVideoWatermark(wm)
                     const hasCk = isVideo && Boolean(layer.chromaKey?.enabled)
                     const layerNum = index + 1
                     return (
                       <div
                         key={layer.layerId}
                         role="listitem"
                         className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors ${
                           isSelected
                             ? "border-accent bg-accent/10 shadow-2xs"
                             : "border-border/70 bg-card/70 hover:border-accent/40 hover:bg-card"
                         }`}
                       >
                         <button
                           type="button"
                           aria-current={isSelected ? "true" : undefined}
                           onClick={() => setSelectedLayerId(layer.layerId)}
                           className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                         >
                           <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-md border border-border/80 bg-[linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%),linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%)] bg-[length:8px_8px] bg-[position:0_0,4px_4px] text-[10px] text-muted-foreground">
                             {wm ? <WatermarkMedia watermark={wm} chromaKey={layer.chromaKey} compact className="size-full"/> : "—"}
                           </span>
                           <span className="min-w-0 flex-1">
                             <span className="flex items-center gap-1.5">
                               <span className={`shrink-0 font-mono text-[10px] font-semibold tabular-nums ${isSelected ? "text-accent" : "text-muted-foreground"}`}>#{layerNum}</span>
                               <span className="min-w-0 truncate text-xs font-medium text-foreground">{wm?.name ?? t.watermarkSelectAsset}</span>
                             </span>
                             {(isVideo || hasCk) && (
                               <span className="mt-0.5 flex items-center gap-1">
                                 {isVideo && <Badge variant="secondary" className="h-3.5 rounded-sm px-1 text-[9px] leading-none">{t.watermarkVideoBadge}</Badge>}
                                 {hasCk && (
                                   <Badge variant="secondary" className="h-3.5 gap-0.5 rounded-sm px-1 font-mono text-[9px] leading-none">
                                     <span aria-hidden="true" className="size-1.5 rounded-full border border-black/20" style={{ backgroundColor: layer.chromaKey?.color ?? DEFAULT_CHROMA_KEY.color }}/>
                                     {t.watermarkChromaKeyShort}
                                   </Badge>
                                 )}
                               </span>
                             )}
                           </span>
                         </button>
                         <div className="flex shrink-0 items-center gap-0.5">
                           {watermarkLayers.length > 1 && (
                             <>
                               <Button
                                 type="button"
                                 variant="ghost"
                                 size="icon-xs"
                                 disabled={index === 0}
                                 aria-label={t.watermarkMoveUp.replace("{index}", String(layerNum))}
                                 title={t.watermarkMoveUp.replace("{index}", String(layerNum))}
                                 onClick={() => moveWatermarkLayer(layer.layerId, -1)}
                               >
                                 <ArrowUp aria-hidden="true"/>
                               </Button>
                               <Button
                                 type="button"
                                 variant="ghost"
                                 size="icon-xs"
                                 disabled={index === watermarkLayers.length - 1}
                                 aria-label={t.watermarkMoveDown.replace("{index}", String(layerNum))}
                                 title={t.watermarkMoveDown.replace("{index}", String(layerNum))}
                                 onClick={() => moveWatermarkLayer(layer.layerId, 1)}
                               >
                                 <ArrowDown aria-hidden="true"/>
                               </Button>
                             </>
                           )}
                           <Button
                             type="button"
                             variant="ghost"
                             size="icon-xs"
                             aria-label={t.watermarkRemoveLayer.replace("{index}", String(layerNum))}
                             title={t.watermarkRemoveLayer.replace("{index}", String(layerNum))}
                             className="text-muted-foreground hover:text-destructive"
                             onClick={() => removeWatermarkLayer(layer.layerId)}
                           >
                             <X aria-hidden="true"/>
                           </Button>
                         </div>
                       </div>
                     )
                   })}
                 </div>
                 {watermarkLayers.length > 1 && (
                   <p className="text-[11px] text-muted-foreground">
                     {t.watermarkStackHint.replace("{count}", String(watermarkLayers.length))}
                   </p>
                 )}
                 <Button
                   type="button"
                   variant="outline"
                   size="sm"
                   className="h-8 w-full justify-center gap-1.5 rounded-md border-dashed text-xs"
                   disabled={watermarkLayers.length >= WATERMARK_MAX_PER_JOB || !(watermarks.data?.length)}
                   onClick={addWatermarkLayer}
                 >
                   <Plus aria-hidden="true" className="size-3.5"/>
                   {watermarkLayers.length >= WATERMARK_MAX_PER_JOB ? t.watermarkLimitReached : t.watermarkAddLayer}
                 </Button>
               </div>

               {watermarkLayers.length > 1 && (
                 <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                   <span className="min-w-0 truncate text-xs font-medium text-foreground">
                     {t.watermarkLayerLabel.replace("{index}", String(activeSelectedLayerIndex + 1))}
                     {selectedWatermark ? ` · ${selectedWatermark.name}` : ""}
                   </span>
                   <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                     {Math.round(activeSelectedLayer.x * 100)}%, {Math.round(activeSelectedLayer.y * 100)}%
                   </span>
                 </div>
               )}

               <WatermarkManager
                 compact
                 selectedId={activeSelectedLayer.watermarkId}
                 onDeleted={handleWatermarkAssetDeleted}
                 onSelect={(watermark) => {
                   if (!watermark.id) return
                   updateWatermarkLayer(activeSelectedLayer.layerId, (layer) => ({
                     ...stripLayerId(layer),
                     watermarkId: watermark.id,
                     ...(isVideoWatermark(watermark) ? {} : { chromaKey: undefined }),
                   }))
                 }}
               />
               <div className="space-y-2"><div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="watermark-size" className="text-xs font-normal text-muted-foreground">{t.watermarkSize}</FieldLabel><span className="font-mono text-xs tabular-nums text-foreground">{Math.round(activeSelectedLayer.scale * 100)}%</span></div><input id="watermark-size" type="range" min={WATERMARK_SCALE_MIN} max={WATERMARK_SCALE_MAX} step={0.01} value={activeSelectedLayer.scale} onChange={(event) => updateWatermarkLayer(activeSelectedLayer.layerId, (layer) => ({ ...stripLayerId(layer), scale: clamp(Number(event.target.value), WATERMARK_SCALE_MIN, WATERMARK_SCALE_MAX) }))} className="h-5 w-full cursor-pointer accent-accent"/></div>
               <div className="space-y-2"><div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="watermark-opacity" className="text-xs font-normal text-muted-foreground">{t.watermarkOpacity}</FieldLabel><span className="font-mono text-xs tabular-nums text-foreground">{Math.round(activeSelectedLayer.opacity * 100)}%</span></div><input id="watermark-opacity" type="range" min={0.1} max={1} step={0.05} value={activeSelectedLayer.opacity} onChange={(event) => updateWatermarkLayer(activeSelectedLayer.layerId, (layer) => ({ ...stripLayerId(layer), opacity: clamp(Number(event.target.value), 0.1, 1) }))} className="h-5 w-full cursor-pointer accent-accent"/></div>
               <p className="text-xs leading-relaxed text-muted-foreground">{t.watermarkPositionHint}</p>
               {selectedWatermarkIsVideo && (
                 <Field className="relative space-y-2.5 rounded-lg border border-border/70 bg-card/60 p-2.5">
                   <div className="relative flex items-center justify-between gap-2">
                     <FieldLabel htmlFor="watermark-chroma-enabled" className="text-xs font-medium text-foreground">{t.watermarkChromaKey}</FieldLabel>
                     <Switch
                       id="watermark-chroma-enabled"
                       aria-label={t.watermarkChromaKey}
                       checked={activeChromaKey.enabled}
                       onCheckedChange={(enabled) => updateChromaKey({ enabled })}
                     />
                   </div>
                   <FieldDescription className="text-[11px] leading-relaxed">{t.watermarkChromaKeyHint}</FieldDescription>
                   {activeChromaKey.enabled && (
                     <div className="space-y-3 border-t border-border/60 pt-2.5">
                       <div className="flex items-center justify-between gap-2">
                         <label htmlFor="watermark-chroma-color" className="text-xs text-muted-foreground">{t.watermarkChromaColor}</label>
                         <div className="flex items-center gap-1.5">
                           {chromaPresets.map((preset) => {
                             const selected = activeChromaKey.color.toUpperCase() === preset.hex
                             return (
                               <button
                                 key={preset.key}
                                 type="button"
                                 aria-label={`${t.watermarkChromaColor}: ${t.watermarkChromaPresets[preset.key]}`}
                                 title={t.watermarkChromaPresets[preset.key]}
                                 aria-pressed={selected}
                                 onClick={() => updateChromaKey({ color: preset.hex })}
                                 className={`size-5 rounded-full border border-black/20 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-ring dark:border-white/20 ${selected ? "ring-2 ring-accent ring-offset-1 ring-offset-background" : ""}`}
                                 style={{ backgroundColor: preset.hex }}
                               />
                             )
                           })}
                           <input
                             id="watermark-chroma-color"
                             type="color"
                             value={activeChromaKey.color}
                             onChange={(event) => updateChromaKey({ color: event.target.value.toUpperCase() })}
                             aria-label={t.watermarkChromaColor}
                             className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
                           />
                           <span className="font-mono text-[11px] tabular-nums text-foreground">{activeChromaKey.color}</span>
                         </div>
                       </div>
                       <div className="space-y-1.5">
                         <div className="flex items-center justify-between gap-2">
                           <FieldLabel htmlFor="watermark-chroma-similarity" className="text-xs font-normal text-muted-foreground">{t.watermarkChromaSimilarity}</FieldLabel>
                           <span className="font-mono text-xs tabular-nums text-foreground">{Math.round(activeChromaKey.similarity * 100)}%</span>
                         </div>
                         <input
                           id="watermark-chroma-similarity"
                           type="range"
                           min={WATERMARK_CHROMA_SIMILARITY_MIN}
                           max={WATERMARK_CHROMA_SIMILARITY_MAX}
                           step={0.01}
                           value={activeChromaKey.similarity}
                           onChange={(event) => updateChromaKey({ similarity: Number(event.target.value) })}
                           className="h-5 w-full cursor-pointer accent-accent"
                         />
                       </div>
                       <div className="space-y-1.5">
                         <div className="flex items-center justify-between gap-2">
                           <FieldLabel htmlFor="watermark-chroma-blend" className="text-xs font-normal text-muted-foreground">{t.watermarkChromaBlend}</FieldLabel>
                           <span className="font-mono text-xs tabular-nums text-foreground">{Math.round(activeChromaKey.blend * 100)}%</span>
                         </div>
                         <input
                           id="watermark-chroma-blend"
                           type="range"
                           min={WATERMARK_CHROMA_BLEND_MIN}
                           max={WATERMARK_CHROMA_BLEND_MAX}
                           step={0.01}
                           value={activeChromaKey.blend}
                           onChange={(event) => updateChromaKey({ blend: Number(event.target.value) })}
                           className="h-5 w-full cursor-pointer accent-accent"
                         />
                       </div>
                     </div>
                   )}
                   <p className="text-[11px] leading-relaxed text-muted-foreground">{t.watermarkVideoLoopNote}</p>
                 </Field>
               )}
               <div className="flex items-center gap-2">
                 <Button
                   type="button"
                   variant="outline"
                   size="sm"
                   className="flex-1 rounded-md"
                   disabled={saveWatermarkDefault.isPending || !serializedWatermark}
                   onClick={() => persistWatermarkDefault(serializedWatermark)}
                 >
                   {saveWatermarkDefault.isPending && <LoaderCircle aria-hidden="true" className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none"/>}
                   {t.watermarkSaveDefault}
                 </Button>
                 {hasSavedWatermarkDefault && (
                   <Button
                     type="button"
                     variant="ghost"
                     size="sm"
                     className="shrink-0 rounded-md text-xs text-muted-foreground hover:text-foreground"
                     disabled={saveWatermarkDefault.isPending}
                     onClick={() => persistWatermarkDefault(null)}
                   >
                     {t.watermarkClearDefault}
                   </Button>
                 )}
               </div>
             </div>}
             {!watermarkEnabled && hasSavedWatermarkDefault && (
               <div className="mt-2 flex justify-end">
                 <Button
                   type="button"
                   variant="ghost"
                   size="sm"
                   className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
                   disabled={saveWatermarkDefault.isPending}
                   onClick={() => persistWatermarkDefault(null)}
                 >
                   {t.watermarkClearDefault}
                 </Button>
               </div>
             )}
             {watermarkError && <p role="alert" className="mt-2 text-xs text-destructive">{watermarkError}</p>}
           </Field>
           <Field className="rounded-lg border border-border/80 bg-secondary/20 p-3">
             <div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="outro-enabled">{t.outro}</FieldLabel><Switch id="outro-enabled" aria-label={t.outro} checked={!!outroId} disabled={outros.isPending || !outros.data?.length} onCheckedChange={(checked) => { const saved = outroDefaults.data?.default?.outroId; setOutroId(checked ? (outros.data?.find((item) => item.id === saved)?.id ?? outros.data?.[0]?.id ?? null) : null) }}/></div>
             <FieldDescription>{t.outroEnableHint}</FieldDescription>
             {outros.isSuccess && outros.data.length === 0 && <p className="mt-2 text-xs text-muted-foreground">{t.outroEmpty} <Link to="/settings" search={{}} className="font-medium text-accent underline-offset-2 hover:underline">{t.outroLibraryLink}</Link></p>}
             {outros.isError && <p role="alert" className="mt-2 text-xs text-destructive">{t.outroLibraryFailed}</p>}
             {outroId && chosenOutro && <div className="mt-3 flex items-start gap-3">
               <OutroPreview outro={chosenOutro} className="h-16 w-24"/>
               <div className="min-w-0 flex-1 space-y-2">
                 <Select value={chosenOutro.id} onValueChange={setOutroId}><SelectTrigger aria-label={t.outroSelectLabel} className="h-9 w-full rounded-md"><SelectValue placeholder={t.outroNone}/></SelectTrigger><SelectContent>{outros.data?.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {formatOutroDuration(item.durationSec)}</SelectItem>)}</SelectContent></Select>
                 <p className="text-xs leading-relaxed text-muted-foreground">{t.outroDurationHint.replace("{duration}", String(Number(chosenOutro.durationSec.toFixed(1))))}</p>
               </div>
             </div>}
           </Field>
           <Field><FieldLabel htmlFor="caption-language-select">{t.captionLanguage}</FieldLabel><Select value={captionLanguage} onValueChange={(value) => { if (isCaptionLanguage(value)) setCaptionLanguage(value) }}><SelectTrigger id="caption-language-select" className="h-11 w-full rounded-md" aria-describedby="caption-language-hint"><SelectValue /></SelectTrigger><SelectContent>{CAPTION_LANGUAGES.map((option) => <SelectItem key={option} value={option}>{t.captionLanguageOptions[option]}</SelectItem>)}</SelectContent></Select><FieldDescription id="caption-language-hint">{t.captionLanguageHint}</FieldDescription></Field>
           <Field>
             <div className="flex items-center justify-between gap-2">
               <FieldLabel htmlFor="custom-hashtags-input">{t.customHashtags}</FieldLabel>
               {parsedCustomHashtags.length > 0 && (
                 <div className="flex items-center gap-1.5">
                   <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
                     {parsedCustomHashtags.length}/{CUSTOM_HASHTAGS_MAX}
                   </Badge>
                   <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setCustomHashtagsInput("")}>
                     {t.customHashtagsClear}
                   </Button>
                 </div>
               )}
             </div>
             <Input id="custom-hashtags-input" type="text" maxLength={500} placeholder={t.customHashtagsPlaceholder} value={customHashtagsInput} onChange={(event) => setCustomHashtagsInput(event.target.value)} aria-describedby="custom-hashtags-hint" className="h-11 rounded-md" />
             {parsedCustomHashtags.length > 0 && (
               <div className="flex flex-wrap gap-1.5 pt-0.5">
                 {parsedCustomHashtags.map((tag) => (
                   <Badge key={tag} variant="secondary" asChild>
                     <button
                       type="button"
                       aria-label={`${t.customHashtagsClear}: #${tag}`}
                       onClick={() => setCustomHashtagsInput(formatCustomHashtagsInput(parsedCustomHashtags.filter((item) => item !== tag)))}
                       className="cursor-pointer font-mono text-xs font-normal hover:bg-secondary/80"
                     >
                       <span>#{tag}</span>
                       <X aria-hidden="true" className="opacity-65 transition-opacity group-hover/badge:opacity-100" />
                     </button>
                   </Badge>
                 ))}
               </div>
             )}
             <FieldDescription id="custom-hashtags-hint">{parsedCustomHashtags.length > 0 ? t.customHashtagsActiveHint.replace("{count}", String(parsedCustomHashtags.length)) : t.customHashtagsHint}</FieldDescription>
           </Field>
           {mode === "auto" ? <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="clip-count">{t.clipCount}</FieldLabel><Input id="clip-count" type="number" min={1} max={10} step={1} required value={Number.isNaN(formValues.clipCount) ? "" : formValues.clipCount} onChange={(e) => form.setFieldValue("clipCount", e.target.value === "" ? Number.NaN : Number(e.target.value))} className="h-11 rounded-md tabular-nums" /></Field><Field><FieldLabel htmlFor="target-duration">{t.duration}</FieldLabel><div className="relative"><Input id="target-duration" type="number" min={15} max={180} step={1} required value={Number.isNaN(formValues.duration) ? "" : formValues.duration} onChange={(e) => form.setFieldValue("duration", e.target.value === "" ? Number.NaN : Number(e.target.value))} className="h-11 rounded-md pr-14 tabular-nums" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{t.seconds}</span></div></Field><Field className="sm:col-span-2"><div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="clip-description">{t.description}</FieldLabel><div className="flex items-center gap-1.5 sm:gap-2"><span className="text-xs tabular-nums text-muted-foreground">{description.length}/500</span><BriefHistoryMenu brief={description} disabled={locked} onPick={(text) => { setDescription(text.slice(0, 500)); setPreviousBrief(null); setEnhanceError("") }}/><Button type="button" variant="outline" size="sm" className="h-7 gap-1 rounded-md px-2 text-xs" aria-label={t.enhanceBrief} disabled={description.trim().length < 2 || enhanceBrief.isPending || locked} onClick={() => { setEnhanceError(""); setPreviousBrief(null); enhanceBrief.mutate(description.trim()) }}>{enhanceBrief.isPending ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" /> : <Sparkles aria-hidden="true" className="size-3" />}{enhanceBrief.isPending ? t.enhancingBrief : t.enhanceBrief}</Button></div></div><textarea id="clip-description" maxLength={500} rows={3} value={description} onChange={(e) => { setDescription(e.target.value); setPreviousBrief(null); setEnhanceError("") }} readOnly={enhanceBrief.isPending} placeholder={t.descriptionHint} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none transition read-only:opacity-70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />{previousBrief !== null && <div className="mt-1 flex justify-end"><Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => { setDescription(previousBrief); setPreviousBrief(null) }}>{t.undoEnhance}</Button></div>}{enhanceError && <FieldDescription role="alert" className="text-destructive">{enhanceError}</FieldDescription>}</Field></div> : <div className="space-y-3 rounded-lg border border-border/80 bg-secondary/25 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">{t.manualRanges}</p><p className="mt-1 text-xs text-muted-foreground">{t.rangeHint}</p></div><Badge variant="secondary" className="rounded-full font-normal">{formValues.ranges.length}/10</Badge></div><div className="space-y-2">{formValues.ranges.map((_, index) => <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 rounded-lg border border-border/70 bg-card p-3 max-[380px]:grid-cols-[auto_minmax(0,1fr)_auto]"><span className="pb-3 text-xs font-medium tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><Field className="max-[380px]:col-start-2"><FieldLabel htmlFor={`range-start-${index}`}>{t.startSec}</FieldLabel><Input id={`range-start-${index}`} type="number" min="0" step="any" required aria-label={`${t.startSec} ${index + 1}`} placeholder="0" value={formValues.ranges[index]?.start ?? ""} onChange={(e) => updateRange(index, "start", e.target.value)} className="h-10 rounded-lg" /></Field><Field className="max-[380px]:col-start-2"><FieldLabel htmlFor={`range-end-${index}`}>{t.endSec}</FieldLabel><Input id={`range-end-${index}`} type="number" min="0" step="any" required aria-label={`${t.endSec} ${index + 1}`} placeholder="30" value={formValues.ranges[index]?.end ?? ""} onChange={(e) => updateRange(index, "end", e.target.value)} className="h-10 rounded-lg" /></Field><Button type="button" variant="ghost" size="icon" aria-label={`${t.removeRange} ${index + 1}`} disabled={formValues.ranges.length === 1} onClick={() => form.setFieldValue("ranges", formValues.ranges.filter((_, i) => i !== index))} className="mb-0.5 text-muted-foreground hover:text-destructive max-[380px]:row-span-2"><X className="size-4" /></Button></div>)}</div><Button type="button" variant="outline" size="sm" disabled={formValues.ranges.length >= 10} onClick={() => form.setFieldValue("ranges", [...formValues.ranges, { start: "", end: "" }])} className="rounded-lg"><Plus className="size-4" />{t.addRange}</Button></div>}

          {mode === "manual" && <Field><FieldLabel htmlFor="target-duration-manual">{t.duration}</FieldLabel><div className="relative"><Input id="target-duration-manual" type="number" min={15} max={180} step={1} required value={Number.isNaN(formValues.duration) ? "" : formValues.duration} onChange={(e) => form.setFieldValue("duration", e.target.value === "" ? Number.NaN : Number(e.target.value))} className="h-11 rounded-md pr-14 tabular-nums" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{t.seconds}</span></div></Field>}
      </div></div>
        <div className="sticky bottom-0 border-t border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">{error && <Alert variant="destructive" className="mb-3"><AlertDescription>{error}</AlertDescription></Alert>}<div className="flex flex-col items-stretch gap-3"><div className="min-w-0"><p className="text-xs leading-5 text-muted-foreground">{mode === "auto" ? t.autoSummary.replace("{count}", String(formValues.clipCount)).replace("{duration}", String(formValues.duration)) : t.manualSummary.replace("{count}", String(formValues.ranges.length))}</p>{mode === "auto" && <LlmStatus compact prominent jobStatus={jobs.data?.find((job) => ["done", "failed", "cancelled"].includes(job.status))?.status}/>}</div>{blockingJob && <div role="status" className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs leading-5 text-foreground"><LoaderCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"/><span className="min-w-0">{blockingHint}{blockingJob.id !== selectedJobId && <> <Link to="/" search={(previous) => ({ ...previous, job: blockingJob.id })} className="font-medium text-accent underline-offset-2 hover:underline">{t.viewProgress}</Link></>}</span></div>}<Button type="submit" className="h-11 w-full shrink-0 rounded-md px-4" aria-busy={locked} disabled={locked}>{locked ? <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin motion-reduce:animate-none"/> : <ArrowUpRight className="mr-2 size-4"/>}{create.isPending || blockingJob ? t.generatingClips : reviewFirst && mode === "auto" ? t.startReview : mode === "auto" ? t.generateClips.replace("{count}", String(formValues.clipCount)) : t.generateManualClips.replace("{count}", String(formValues.ranges.length))}</Button></div></div>
      </aside>
    </form>
    <section aria-labelledby="results-heading" className="mt-0 min-w-0 overflow-hidden rounded-xl border border-border bg-card lg:col-span-2 lg:row-start-2"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><div><h3 id="results-heading" className="font-display text-lg font-medium">{t.results}</h3></div>{resultJob && <div className="flex flex-wrap items-center gap-2">{resultActiveClips.length > 0 && <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setBatchScheduleOpen(true)}><CalendarClock aria-hidden="true" className="size-3.5" />{t.scheduleBatch}</Button>}<Link to="/jobs/$jobId" params={{ jobId: resultJob.id }} className="inline-flex min-h-10 items-center gap-2 text-xs text-muted-foreground hover:text-foreground">{t.openFullJob}<ArrowUpRight className="size-4"/></Link></div>}</div><div className="space-y-4 p-4">
      {reviewFirst && mode === "auto" && <ReviewPanel preview={preview.data} loading={createPreview.isPending || (!!previewId && preview.isPending) || preview.data?.status === "queued" || preview.data?.status === "running"} error={previewExpired ? t.previewExpired : createPreview.isError || preview.isError || preview.data?.status === "failed" ? preview.data?.error || t.previewFailed : ""} t={t} selectedCandidates={selectedCandidates} setSelectedCandidates={setSelectedCandidates} selectedCueStart={selectedCueStart} setSelectedCueStart={setSelectedCueStart} selectedCueEnd={selectedCueEnd} setSelectedCueEnd={setSelectedCueEnd} cueRanges={cueRanges} setCueRanges={setCueRanges} createPending={locked} renderSelected={renderSelected} retry={() => { setError(""); if (!formValues.url.trim()) { setError(t.urlRequired); return } if (!/^https?:\/\//i.test(formValues.url.trim())) { setError(t.urlInvalid); return } if (!Number.isInteger(formValues.clipCount) || formValues.clipCount < 1 || formValues.clipCount > 10) { setError(t.clipCountInvalid); return } if (!Number.isInteger(formValues.duration) || formValues.duration < 15 || formValues.duration > 180) { setError(t.durationInvalid); return } if (!validCustomMinutes) { setError(t.customMinutesInvalid); return } createPreview.mutate({ url: formValues.url.trim(), clipCount: formValues.clipCount, targetDurationSec: formValues.duration, maxSourceSec: selectedMaxSourceSec(), ...(description.trim() ? { description: description.trim() } : {}) }) }} reviewRef={reviewRef} />}
      {selectedJobId && selectedJob.isPending ? <div role="status" className="flex items-center gap-3 py-5 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin text-primary"/>{t.loading}</div> : selectedJob.isError ? <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{t.apiError}</span><Button variant="outline" onClick={() => selectedJob.refetch()}>{t.retry}</Button></AlertDescription></Alert> : resultJob ? resultJob.status === "failed" || resultJob.status === "cancelled" ? <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-destructive/25 bg-destructive/5 p-4"><div className="flex min-w-0 gap-3"><CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive"/><div><p className="font-medium">{t.status[resultJob.status]}</p><p className="mt-1 break-words text-sm text-muted-foreground">{resultJob.error || t.jobFailedFallback}</p></div></div><Button className="min-h-11" disabled={retryJob.isPending} onClick={() => retryJob.mutate()}>{retryJob.isPending && <LoaderCircle className="mr-2 size-4 animate-spin"/>}{t.retryJobInline}</Button></div> : <JobAssembly job={resultJob} t={t} layout="carousel"/>
      : activeJobs.length || failedJobs.length ? <div className="grid gap-3 md:grid-cols-2">{[...activeJobs, ...failedJobs].map((job) => <Link key={job.id} to="/" search={(previous) => ({ ...previous, job: job.id })} className="min-w-0 rounded-lg border border-border p-3 transition-colors hover:bg-secondary/40"><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{sourceLabel(job.url)}</span><span className="text-xs text-muted-foreground">{job.status === "running" && job.stage ? t.stages[job.stage] : t.status[job.status]}</span></div><div className="mt-3 h-1 overflow-hidden rounded-full bg-secondary"><span className="block h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}/></div></Link>)}</div> : <div className="grid min-h-28 place-items-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">{t.generatedAppear}</div>}
      </div></section>
    </div>
    {resultJob && resultActiveClips.length > 0 && (
      <BatchScheduleDialog
        jobId={resultJob.id}
        clips={resultBatchClips}
        open={batchScheduleOpen}
        onOpenChange={setBatchScheduleOpen}
      />
    )}
  </WorkspaceShell>
}
