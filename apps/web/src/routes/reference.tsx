import { createFileRoute, redirect, useNavigate, useSearch } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  CircleAlert,
  Copy,
  Download,
  Film,
  Link2,
  LoaderCircle,
  Music2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { WorkspaceShell } from "@/components/chrome"
import { api, apiUrl, type AspectRatio, type Reframe, type User } from "@/lib/api"
import { getCurrentUser } from "@/lib/auth"
import { getVideoEmbed } from "@/lib/embed"
import { relativeAge, sourceLabel } from "@/lib/format"
import { useLanguage, useT } from "@/lib/i18n"

const REFERENCE_MAX_FOOTAGE_FILES = 12
const REFERENCE_MAX_FILE_BYTES = 100 * 1024 * 1024

type ReferenceStage = "analyze_reference" | "analyze_footage" | "plan_edit" | "render" | "save"
type ReferenceJobStatus = "queued" | "running" | "done" | "failed" | "cancelled"

interface ReferenceFootageItem {
  id: string
  name: string
  filePath: string
  mimeType: string
  sizeBytes: number
  durationSec: number
  width: number
  height: number
}

interface ReferenceTemplateSlot {
  index: number
  startSec: number
  endSec: number
  durationSec: number
  shotType: string
  description: string
  overlayText?: string | null
  zoom?: "none" | "in" | "out"
  beatSync?: boolean
}

interface ReferencePlanSlot {
  slotIndex: number
  footageId: string
  footageName: string
  sourceStartSec: number
  sourceEndSec: number
  targetDurationSec: number
  shotType: string
  reason: string
  overlayText?: string | null
  zoom?: "none" | "in" | "out"
}

interface ReferenceJobResponse {
  id: string
  title: string
  brief: string | null
  aspectRatio: AspectRatio
  reframe: Reframe
  captions: boolean
  beatSync: boolean
  referenceUrl: string | null
  referenceFilePath: string | null
  referenceDurationSec: number | null
  footage: ReferenceFootageItem[]
  status: ReferenceJobStatus
  stage: ReferenceStage | null
  progress: number
  message: string | null
  error: string | null
  templateSlots: ReferenceTemplateSlot[] | null
  planSlots: ReferencePlanSlot[] | null
  outputFilePath: string | null
  outputDurationSec: number | null
  caption: string | null
  hashtags: string[]
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

type PendingUpload = {
  tempId: string
  name: string
  sizeBytes: number
  status: "uploading" | "error"
  error?: string
}

export const Route = createFileRoute("/reference")({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: "/login", search: { redirect: location.href } })
    return { user }
  },
  validateSearch: (search: Record<string, unknown>): { job?: string } => ({
    ...(typeof search.job === "string" && search.job.trim() ? { job: search.job } : {}),
  }),
  component: ReferenceEditPage,
})

function formatDurationTenth(seconds: number | null | undefined) {
  const safe = Math.max(0, Number.isFinite(seconds) ? Number(seconds) : 0)
  const mins = Math.floor(safe / 60)
  const rem = safe - mins * 60
  const secText = rem < 10 ? `0${rem.toFixed(1)}` : rem.toFixed(1)
  return `${String(mins).padStart(2, "0")}:${secText}`
}

function formatSizeMb(bytes: number) {
  const mb = bytes / (1024 * 1024)
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`
}

function isAllowedVideoFile(file: File) {
  const mime = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  return mime === "video/mp4" || mime === "video/quicktime" || name.endsWith(".mp4") || name.endsWith(".mov")
}

async function uploadReferenceVideo(file: File): Promise<ReferenceFootageItem> {
  const formData = new FormData()
  formData.append("file", file)
  const response = await fetch(apiUrl("/reference-jobs/upload"), {
    method: "POST",
    body: formData,
  })
  if (!response.ok) {
    let message = response.statusText || "Upload failed"
    try {
      const payload = (await response.json()) as { error?: string; message?: string }
      if (payload.error || payload.message) message = payload.error || payload.message || message
    } catch {
      // keep status text
    }
    const err = new Error(message) as Error & { status?: number }
    err.status = response.status
    throw err
  }
  return response.json() as Promise<ReferenceFootageItem>
}

function aspectMonitorClass(aspectRatio: AspectRatio) {
  if (aspectRatio === "9:16") return "aspect-[9/16] max-w-[300px]"
  if (aspectRatio === "1:1") return "aspect-square max-w-[380px]"
  return "aspect-video max-w-[640px]"
}

function statusBadgeVariant(status: ReferenceJobStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed") return "destructive"
  if (status === "done") return "secondary"
  return "outline"
}

function ReferenceEditPage() {
  const { user } = Route.useRouteContext() as { user: User }
  const { job: searchJobId } = useSearch({ from: "/reference" })
  const navigate = useNavigate()
  const client = useQueryClient()
  const t = useT()
  const { language } = useLanguage()
  const refInputId = useId()
  const footageInputId = useId()
  const refFileInputRef = useRef<HTMLInputElement | null>(null)
  const footageFileInputRef = useRef<HTMLInputElement | null>(null)

  const [referenceMode, setReferenceMode] = useState<"upload" | "url">("upload")
  const [referenceUrl, setReferenceUrl] = useState("")
  const [referenceFile, setReferenceFile] = useState<ReferenceFootageItem | null>(null)
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null)
  const [referenceUploading, setReferenceUploading] = useState(false)
  const [referenceError, setReferenceError] = useState("")

  const [footage, setFootage] = useState<ReferenceFootageItem[]>([])
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [footageError, setFootageError] = useState("")

  const [title, setTitle] = useState("")
  const [brief, setBrief] = useState("")
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16")
  const [reframe, setReframe] = useState<Reframe>("face_tracking")
  const [beatSync, setBeatSync] = useState(true)
  const [captions, setCaptions] = useState(true)
  const [submitError, setSubmitError] = useState("")
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [copiedKey, setCopiedKey] = useState<"caption" | "hashtags" | null>(null)

  useEffect(() => {
    return () => {
      if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl)
    }
  }, [referencePreviewUrl])

  const jobsQuery = useQuery({
    queryKey: ["reference-jobs"],
    queryFn: () => api<ReferenceJobResponse[]>("/reference-jobs"),
    refetchInterval: (query) => {
      const list = query.state.data ?? []
      return list.some((item) => item.status === "queued" || item.status === "running") ? 5000 : false
    },
  })

  const jobsList = jobsQuery.data ?? []
  const selectedJobId = searchJobId ?? jobsList[0]?.id ?? null

  const activeJobQuery = useQuery({
    queryKey: ["reference-jobs", selectedJobId],
    queryFn: () => api<ReferenceJobResponse>(`/reference-jobs/${selectedJobId}`),
    enabled: !!selectedJobId,
    retry: (failureCount, err) => ((err as Error & { status?: number }).status === 404 ? false : failureCount < 2),
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      return data.status === "queued" || data.status === "running" ? 4000 : false
    },
  })

  const activeJob = activeJobQuery.data ?? jobsList.find((item) => item.id === selectedJobId) ?? null
  const isTerminal = !activeJob || ["done", "failed", "cancelled"].includes(activeJob.status)

  useEffect(() => {
    if (!selectedJobId || isTerminal) return
    const source = new EventSource(apiUrl(`/reference-jobs/${selectedJobId}/events`))
    source.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as ReferenceJobResponse
        client.setQueryData(["reference-jobs", selectedJobId], snapshot)
        client.setQueryData<ReferenceJobResponse[]>(["reference-jobs"], (previous) => {
          if (!previous) return [snapshot]
          const exists = previous.some((item) => item.id === snapshot.id)
          return exists ? previous.map((item) => (item.id === snapshot.id ? snapshot : item)) : [snapshot, ...previous]
        })
        if (["done", "failed", "cancelled"].includes(snapshot.status)) {
          source.close()
        }
      } catch {
        // ignore malformed SSE messages
      }
    }
    source.onerror = () => source.close()
    return () => source.close()
  }, [selectedJobId, isTerminal, client])

  const createJob = useMutation({
    mutationFn: () => {
      const cleanUrl = referenceMode === "url" ? referenceUrl.trim() : null
      const cleanFile = referenceMode === "upload" ? referenceFile : null
      return api<ReferenceJobResponse>("/reference-jobs", {
        method: "POST",
        body: JSON.stringify({
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(brief.trim() ? { brief: brief.trim() } : {}),
          aspectRatio,
          reframe,
          captions,
          beatSync,
          referenceUrl: cleanUrl,
          referenceFile: cleanFile,
          footage,
        }),
      })
    },
    onSuccess: (created) => {
      setSubmitError("")
      client.setQueryData(["reference-jobs", created.id], created)
      client.setQueryData<ReferenceJobResponse[]>(["reference-jobs"], (previous) =>
        previous ? [created, ...previous.filter((item) => item.id !== created.id)] : [created],
      )
      toast.success(t.reference.jobCreated)
      void navigate({ to: "/reference", search: { job: created.id } })
    },
    onError: () => {
      setSubmitError(t.reference.createError)
      toast.error(t.reference.createError)
    },
  })

  const cancelJob = useMutation({
    mutationFn: (jobId: string) => api<ReferenceJobResponse>(`/reference-jobs/${jobId}/cancel`, { method: "POST" }),
    onSuccess: (updated) => {
      client.setQueryData(["reference-jobs", updated.id], updated)
      void client.invalidateQueries({ queryKey: ["reference-jobs"] })
    },
    onError: () => toast.error(t.reference.cancelFailed),
  })

  const deleteJob = useMutation({
    mutationFn: (jobId: string) => api<void>(`/reference-jobs/${jobId}`, { method: "DELETE" }),
    onSuccess: (_res, jobId) => {
      client.removeQueries({ queryKey: ["reference-jobs", jobId] })
      const remaining = jobsList.filter((item) => item.id !== jobId)
      client.setQueryData<ReferenceJobResponse[]>(["reference-jobs"], remaining)
      toast.success(t.reference.jobDeleted)
      setDeleteDialogOpen(false)
      void navigate({ to: "/reference", search: remaining[0] ? { job: remaining[0].id } : {} })
    },
    onError: () => toast.error(t.reference.deleteFailed),
  })

  const handleReferenceFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setReferenceError("")
    if (!isAllowedVideoFile(file)) {
      setReferenceError(t.reference.badFileType)
      return
    }
    if (file.size > REFERENCE_MAX_FILE_BYTES) {
      setReferenceError(t.reference.fileTooLarge)
      return
    }
    const localUrl = URL.createObjectURL(file)
    setReferenceUploading(true)
    try {
      const uploaded = await uploadReferenceVideo(file)
      setReferenceFile(uploaded)
      setReferencePreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return localUrl
      })
    } catch {
      URL.revokeObjectURL(localUrl)
      setReferenceError(t.reference.uploadFailed)
    } finally {
      setReferenceUploading(false)
    }
  }

  const clearReferenceFile = () => {
    setReferenceFile(null)
    setReferenceError("")
    setReferencePreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return null
    })
  }

  const handleFootageFilesChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (!selected.length) return
    setFootageError("")

    const availableSlots = REFERENCE_MAX_FOOTAGE_FILES - footage.length
    if (availableSlots <= 0) {
      setFootageError(t.reference.footageLimit)
      return
    }

    const toProcess = selected.slice(0, availableSlots)
    if (selected.length > availableSlots) {
      setFootageError(t.reference.footageLimit)
    }

    const validFiles: File[] = []
    for (const file of toProcess) {
      if (!isAllowedVideoFile(file)) {
        setFootageError(t.reference.badFileType)
        continue
      }
      if (file.size > REFERENCE_MAX_FILE_BYTES) {
        setFootageError(t.reference.fileTooLarge)
        continue
      }
      validFiles.push(file)
    }
    if (!validFiles.length) return

    const batch = validFiles.map((file, index) => ({
      file,
      tempId: `${Date.now()}-${index}-${file.name}`,
    }))
    setPendingUploads((current) => [
      ...current,
      ...batch.map(({ file, tempId }) => ({
        tempId,
        name: file.name,
        sizeBytes: file.size,
        status: "uploading" as const,
      })),
    ])

    await Promise.all(
      batch.map(async ({ file, tempId }) => {
        try {
          const uploaded = await uploadReferenceVideo(file)
          setFootage((current) =>
            current.length >= REFERENCE_MAX_FOOTAGE_FILES ? current : [...current, uploaded],
          )
          setPendingUploads((current) => current.filter((item) => item.tempId !== tempId))
        } catch {
          setPendingUploads((current) =>
            current.map((item) =>
              item.tempId === tempId ? { ...item, status: "error", error: t.reference.uploadFailed } : item,
            ),
          )
        }
      }),
    )
  }

  const removeFootageItem = (id: string) => {
    setFootage((current) => current.filter((item) => item.id !== id))
    setFootageError("")
  }

  const dismissPendingUpload = (tempId: string) => {
    setPendingUploads((current) => current.filter((item) => item.tempId !== tempId))
  }

  const trimmedRefUrl = referenceUrl.trim()
  const refUrlValid = trimmedRefUrl.length > 0 && /^https?:\/\//i.test(trimmedRefUrl)
  const hasReference = referenceMode === "upload" ? !!referenceFile : refUrlValid
  const anyUploading = referenceUploading || pendingUploads.some((item) => item.status === "uploading")
  const canSubmit = hasReference && footage.length > 0 && !anyUploading && !createJob.isPending

  const referenceEmbed = referenceMode === "url" && refUrlValid ? getVideoEmbed(trimmedRefUrl) : null

  const timelineRows = useMemo(() => {
    const template = activeJob?.templateSlots ?? []
    const plan = activeJob?.planSlots ?? []
    const byIndex = new Map<number, { template?: ReferenceTemplateSlot; plan?: ReferencePlanSlot }>()
    for (const slot of template) {
      byIndex.set(slot.index, { template: slot })
    }
    for (const slot of plan) {
      const existing = byIndex.get(slot.slotIndex)
      byIndex.set(slot.slotIndex, { ...existing, plan: slot })
    }
    return Array.from(byIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([index, value]) => ({ index, ...value }))
  }, [activeJob?.templateSlots, activeJob?.planSlots])

  const copyText = async (value: string, key: "caption" | "hashtags") => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      toast.success(t.reference.copied)
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1800)
    } catch {
      toast.error(t.reference.copyFailed)
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitError("")
    if (referenceMode === "url" && trimmedRefUrl && !refUrlValid) {
      setSubmitError(t.reference.urlInvalid)
      return
    }
    if (!canSubmit) {
      setSubmitError(t.reference.submitHint)
      return
    }
    createJob.mutate()
  }

  const stageLabel = activeJob
    ? activeJob.stage
      ? t.stages[activeJob.stage]
      : activeJob.status === "queued"
        ? t.reference.queuedStage
        : t.status[activeJob.status]
    : ""

  const progressValue = activeJob ? Math.max(0, Math.min(100, Math.round(activeJob.progress))) : 0

  return (
    <WorkspaceShell user={user}>
      <h1 className="sr-only">{t.referenceEdit}</h1>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Card className="gap-0 border border-border py-0 ring-0">
            <CardHeader className="border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="font-display text-base font-medium text-foreground">
                    {t.reference.referenceInput}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {referenceMode === "upload" ? t.reference.referenceHint : t.reference.referenceUrlHint}
                  </CardDescription>
                </div>
                <ToggleGroup
                  type="single"
                  value={referenceMode}
                  onValueChange={(value) => {
                    if (value === "upload" || value === "url") {
                      setReferenceMode(value)
                      setReferenceError("")
                    }
                  }}
                  aria-label={t.reference.referenceInput}
                  size="sm"
                  className="shrink-0 rounded-md border border-border bg-secondary/50 p-0.5"
                >
                  <ToggleGroupItem
                    value="upload"
                    className="h-9 gap-1.5 px-3 text-xs data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs"
                  >
                    <Upload aria-hidden="true" className="size-3.5" />
                    {t.reference.uploadReference}
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="url"
                    className="h-9 gap-1.5 px-3 text-xs data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs"
                  >
                    <Link2 aria-hidden="true" className="size-3.5" />
                    {t.reference.referenceUrl}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 p-4">
              {referenceMode === "upload" ? (
                <>
                  <input
                    ref={refFileInputRef}
                    id={refInputId}
                    type="file"
                    accept="video/mp4,video/quicktime"
                    className="sr-only"
                    onChange={(event) => void handleReferenceFileChange(event)}
                  />

                  {referenceFile ? (
                    <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
                      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
                        {referencePreviewUrl ? (
                          <video
                            src={referencePreviewUrl}
                            controls
                            playsInline
                            preload="metadata"
                            className="size-full object-contain"
                          />
                        ) : (
                          <div className="grid size-full place-items-center text-xs text-muted-foreground">
                            <Film aria-hidden="true" className="size-6" />
                          </div>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-col justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="rounded-md font-normal text-accent">
                              {t.reference.referenceReady}
                            </Badge>
                            <Badge variant="outline" className="rounded-md font-mono text-xs tabular-nums">
                              {formatDurationTenth(referenceFile.durationSec)}
                            </Badge>
                            <Badge variant="outline" className="rounded-md font-mono text-xs tabular-nums">
                              {referenceFile.width}×{referenceFile.height}
                            </Badge>
                            <Badge variant="outline" className="rounded-md font-mono text-xs tabular-nums">
                              {formatSizeMb(referenceFile.sizeBytes)}
                            </Badge>
                          </div>
                          <p className="truncate font-medium text-foreground" title={referenceFile.name}>
                            {referenceFile.name}
                          </p>
                          <p className="text-xs text-muted-foreground">{t.reference.referenceHint}</p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11"
                            disabled={referenceUploading}
                            onClick={() => refFileInputRef.current?.click()}
                          >
                            {referenceUploading ? (
                              <LoaderCircle aria-hidden="true" className="mr-1.5 size-4 animate-spin motion-reduce:animate-none" />
                            ) : (
                              <RefreshCw aria-hidden="true" className="mr-1.5 size-4" />
                            )}
                            {t.reference.replaceReference}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-11 text-destructive hover:text-destructive"
                            disabled={referenceUploading}
                            onClick={clearReferenceFile}
                          >
                            <X aria-hidden="true" className="mr-1.5 size-4" />
                            {t.reference.removeReference}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-8 text-center">
                      <span className="grid size-11 place-items-center rounded-lg border border-border bg-card text-accent">
                        {referenceUploading ? (
                          <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <Upload aria-hidden="true" className="size-5" />
                        )}
                      </span>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {referenceUploading ? `${t.reference.uploading}...` : t.reference.noReference}
                        </p>
                        <p className="text-xs text-muted-foreground">{t.reference.referenceHint}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        disabled={referenceUploading}
                        onClick={() => refFileInputRef.current?.click()}
                      >
                        <Upload aria-hidden="true" className="mr-1.5 size-4" />
                        {t.reference.uploadReference}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <Field>
                    <FieldLabel htmlFor="reference-url-input">{t.reference.referenceUrlLabel}</FieldLabel>
                    <div className="relative">
                      <Link2 aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="reference-url-input"
                        type="url"
                        inputMode="url"
                        placeholder={t.reference.referenceUrlPlaceholder}
                        value={referenceUrl}
                        aria-invalid={trimmedRefUrl.length > 0 && !refUrlValid}
                        onChange={(event) => {
                          setReferenceUrl(event.target.value)
                          setReferenceError("")
                        }}
                        className="h-11 rounded-md pl-9"
                      />
                    </div>
                    <FieldDescription>
                      {trimmedRefUrl.length > 0 && !refUrlValid ? (
                        <span className="text-destructive">{t.reference.urlInvalid}</span>
                      ) : (
                        t.reference.referenceUrlHint
                      )}
                    </FieldDescription>
                  </Field>

                  {referenceEmbed && (
                    <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-lg border border-border bg-black">
                      <iframe
                        key={referenceEmbed.src}
                        src={referenceEmbed.src}
                        title={referenceEmbed.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                        className="absolute inset-0 size-full border-0"
                      />
                    </div>
                  )}
                </div>
              )}

              {referenceError && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription>{referenceError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card className="gap-0 border border-border py-0 ring-0">
            <CardHeader className="border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CardTitle className="font-display text-base font-medium text-foreground">
                      {t.reference.footagePool}
                    </CardTitle>
                    <Badge variant="secondary" className="rounded-md font-mono text-xs tabular-nums">
                      {t.reference.footageCount.replace("{count}", String(footage.length))}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">{t.reference.footageHint}</CardDescription>
                </div>

                <input
                  ref={footageFileInputRef}
                  id={footageInputId}
                  type="file"
                  accept="video/mp4,video/quicktime"
                  multiple
                  className="sr-only"
                  onChange={(event) => void handleFootageFilesChange(event)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0"
                  disabled={footage.length >= REFERENCE_MAX_FOOTAGE_FILES}
                  onClick={() => footageFileInputRef.current?.click()}
                >
                  <Plus aria-hidden="true" className="mr-1.5 size-4" />
                  {t.reference.addFootage}
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-3 p-4">
              {footageError && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription>{footageError}</AlertDescription>
                </Alert>
              )}

              {footage.length === 0 && pendingUploads.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/25 px-5 py-8 text-center">
                  <Film aria-hidden="true" className="size-5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t.reference.footageEmpty}</p>
                </div>
              ) : (
                <ul className="grid gap-2.5 sm:grid-cols-2">
                  {footage.map((item, idx) => (
                    <li
                      key={item.id}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline" className="shrink-0 rounded-md font-mono text-[11px] tabular-nums">
                            #{idx + 1}
                          </Badge>
                          <span className="truncate text-sm font-medium text-foreground" title={item.name}>
                            {item.name}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tabular-nums text-muted-foreground">
                          <span>{formatDurationTenth(item.durationSec)}</span>
                          <span>
                            {item.width}×{item.height}
                          </span>
                          <span>{formatSizeMb(item.sizeBytes)}</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-10 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`${t.reference.removeFootage}: ${item.name}`}
                        onClick={() => removeFootageItem(item.id)}
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    </li>
                  ))}

                  {pendingUploads.map((item) => (
                    <li
                      key={item.tempId}
                      className={`flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
                        item.status === "error"
                          ? "border-destructive/40 bg-destructive/5"
                          : "border-border bg-muted/30"
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          {item.status === "uploading" ? (
                            <LoaderCircle
                              aria-hidden="true"
                              className="size-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
                            />
                          ) : (
                            <CircleAlert aria-hidden="true" className="size-3.5 shrink-0 text-destructive" />
                          )}
                          <span className="truncate text-sm font-medium text-foreground" title={item.name}>
                            {item.name}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {item.status === "uploading"
                            ? `${t.reference.uploading}... · ${formatSizeMb(item.sizeBytes)}`
                            : item.error || t.reference.uploadFailed}
                        </p>
                      </div>
                      {item.status === "error" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-10 shrink-0"
                          aria-label={t.reference.close}
                          onClick={() => dismissPendingUpload(item.tempId)}
                        >
                          <X aria-hidden="true" className="size-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="gap-0 border border-border py-0 ring-0">
            <CardHeader className="border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="font-display text-base font-medium text-foreground">
                    {t.reference.activeJob}
                  </CardTitle>
                  <CardDescription className="text-xs">{t.reference.jobSwitcher}</CardDescription>
                </div>

                {jobsList.length > 0 && (
                  <div className="w-full sm:w-64">
                    <Select
                      value={selectedJobId ?? ""}
                      onValueChange={(value) => {
                        void navigate({ to: "/reference", search: value ? { job: value } : {} })
                      }}
                    >
                      <SelectTrigger aria-label={t.reference.selectJob} className="h-10 w-full rounded-md">
                        <SelectValue placeholder={t.reference.selectJob} />
                      </SelectTrigger>
                      <SelectContent>
                        {jobsList.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            <span className="truncate">{item.title || t.reference.jobTitlePlaceholder}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-4 p-4">
              {jobsQuery.isPending ? (
                <div className="space-y-3" role="status" aria-label={t.reference.jobsLoading}>
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-32 w-full rounded-lg" />
                </div>
              ) : jobsQuery.isError ? (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                    <span>{t.reference.jobsError}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => void jobsQuery.refetch()}>
                      {t.retry}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : !activeJob ? (
                <div className="grid min-h-32 place-items-center rounded-lg border border-dashed border-border px-5 py-8 text-center">
                  <p className="text-sm text-muted-foreground">{t.reference.jobEmpty}</p>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-secondary/20 p-3.5">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate font-display text-base font-medium text-foreground">
                          {activeJob.title || t.reference.jobTitlePlaceholder}
                        </h2>
                        <Badge variant={statusBadgeVariant(activeJob.status)} className="rounded-md font-normal">
                          {t.status[activeJob.status]}
                        </Badge>
                        {activeJob.stage && (
                          <Badge variant="outline" className="rounded-md font-normal">
                            {stageLabel}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-mono tabular-nums">{activeJob.aspectRatio}</span>
                        <span>{activeJob.footage.length} clips</span>
                        {activeJob.referenceUrl && (
                          <span className="truncate">{sourceLabel(activeJob.referenceUrl)}</span>
                        )}
                        <span>{relativeAge(activeJob.createdAt, language)}</span>
                      </div>
                      {activeJob.message && (
                        <p className="text-xs text-muted-foreground">{activeJob.message}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {(activeJob.status === "queued" || activeJob.status === "running") && (
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11"
                          disabled={cancelJob.isPending}
                          onClick={() => cancelJob.mutate(activeJob.id)}
                        >
                          {cancelJob.isPending && (
                            <LoaderCircle aria-hidden="true" className="mr-1.5 size-4 animate-spin motion-reduce:animate-none" />
                          )}
                          {t.reference.cancelJob}
                        </Button>
                      )}

                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 text-destructive hover:text-destructive"
                        onClick={() => setDeleteDialogOpen(true)}
                      >
                        <Trash2 aria-hidden="true" className="mr-1.5 size-4" />
                        {t.reference.deleteJob}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-foreground">{stageLabel}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">{progressValue}%</span>
                    </div>
                    <Progress value={progressValue} className="h-2" />
                  </div>

                  {activeJob.status === "failed" && (
                    <Alert variant="destructive">
                      <CircleAlert aria-hidden="true" />
                      <AlertTitle>{t.status.failed}</AlertTitle>
                      <AlertDescription>{activeJob.error || t.reference.jobError}</AlertDescription>
                    </Alert>
                  )}

                  {activeJob.status === "cancelled" && (
                    <Alert>
                      <CircleAlert aria-hidden="true" />
                      <AlertDescription>{t.reference.cancelHint}</AlertDescription>
                    </Alert>
                  )}

                  {activeJob.status === "done" && activeJob.outputFilePath && (
                    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-display text-sm font-medium text-foreground">{t.reference.result}</h3>
                          <p className="text-xs text-muted-foreground">
                            {t.reference.resultHint}
                            {activeJob.outputDurationSec != null && (
                              <span className="ml-2 font-mono tabular-nums">
                                ({formatDurationTenth(activeJob.outputDurationSec)})
                              </span>
                            )}
                          </p>
                        </div>
                        <Button asChild className="min-h-11">
                          <a href={apiUrl(`/reference-jobs/${activeJob.id}/download`)} download>
                            <Download aria-hidden="true" className="mr-1.5 size-4" />
                            {t.reference.downloadResult}
                          </a>
                        </Button>
                      </div>

                      <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
                        <div
                          className={`relative mx-auto w-full overflow-hidden rounded-lg border border-border bg-black ${aspectMonitorClass(activeJob.aspectRatio)}`}
                        >
                          <video
                            key={activeJob.id}
                            src={apiUrl(`/reference-jobs/${activeJob.id}/stream`)}
                            controls
                            playsInline
                            preload="metadata"
                            className="size-full object-contain"
                          />
                        </div>

                        {(activeJob.caption || activeJob.hashtags.length > 0) && (
                          <div className="min-w-0 space-y-3">
                            {activeJob.caption && (
                              <div className="space-y-1.5 rounded-lg border border-border bg-card p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-foreground">{t.reference.caption}</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 gap-1.5 px-2.5 text-xs"
                                    onClick={() => void copyText(activeJob.caption ?? "", "caption")}
                                  >
                                    {copiedKey === "caption" ? (
                                      <Check aria-hidden="true" className="size-3.5 text-accent" />
                                    ) : (
                                      <Copy aria-hidden="true" className="size-3.5" />
                                    )}
                                    {copiedKey === "caption" ? t.reference.copied : t.reference.copy}
                                  </Button>
                                </div>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                                  {activeJob.caption}
                                </p>
                              </div>
                            )}

                            {activeJob.hashtags.length > 0 && (
                              <div className="space-y-2 rounded-lg border border-border bg-card p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-foreground">{t.reference.hashtags}</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 gap-1.5 px-2.5 text-xs"
                                    onClick={() =>
                                      void copyText(
                                        activeJob.hashtags
                                          .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
                                          .join(" "),
                                        "hashtags",
                                      )
                                    }
                                  >
                                    {copiedKey === "hashtags" ? (
                                      <Check aria-hidden="true" className="size-3.5 text-accent" />
                                    ) : (
                                      <Copy aria-hidden="true" className="size-3.5" />
                                    )}
                                    {copiedKey === "hashtags" ? t.reference.copied : t.reference.copy}
                                  </Button>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {activeJob.hashtags.map((tag) => (
                                    <Badge key={tag} variant="secondary" className="rounded-md font-mono text-xs font-normal">
                                      {tag.startsWith("#") ? tag : `#${tag}`}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <Separator />

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-display text-sm font-medium text-foreground">
                        {t.reference.recipe} / {t.reference.plan}
                      </h3>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {timelineRows.length} slots
                      </span>
                    </div>

                    {timelineRows.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
                        {activeJob.templateSlots === null ? t.reference.recipeEmpty : t.reference.planEmpty}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {timelineRows.map(({ index, template, plan }) => {
                          const shotType = plan?.shotType ?? template?.shotType ?? ""
                          const zoom = plan?.zoom ?? template?.zoom
                          const overlayText = plan?.overlayText ?? template?.overlayText
                          const isBeatSynced = template?.beatSync ?? activeJob.beatSync
                          return (
                            <div
                              key={index}
                              className="grid gap-3 rounded-lg border border-border bg-background/60 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]"
                            >
                              <div className="min-w-0 space-y-1.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Badge variant="outline" className="rounded-md font-mono text-xs tabular-nums">
                                    #{index + 1}
                                  </Badge>
                                  {template && (
                                    <span className="font-mono text-xs tabular-nums text-foreground">
                                      {formatDurationTenth(template.startSec)} to {formatDurationTenth(template.endSec)}
                                    </span>
                                  )}
                                  {shotType && (
                                    <Badge variant="secondary" className="rounded-md text-xs font-normal">
                                      {shotType}
                                    </Badge>
                                  )}
                                  {zoom && zoom !== "none" && (
                                    <Badge variant="outline" className="rounded-md text-xs font-normal">
                                      {t.reference.zoom.replace("{zoom}", zoom)}
                                    </Badge>
                                  )}
                                  {isBeatSynced && (
                                    <Badge variant="outline" className="gap-1 rounded-md text-xs font-normal text-accent">
                                      <Music2 aria-hidden="true" className="size-3" />
                                      {t.reference.beatSync}
                                    </Badge>
                                  )}
                                </div>
                                {template?.description && (
                                  <p className="text-xs leading-relaxed text-muted-foreground">{template.description}</p>
                                )}
                                {overlayText && (
                                  <p className="rounded-md border border-border/80 bg-secondary/40 px-2.5 py-1 text-xs text-foreground">
                                    <span className="mr-1.5 font-medium text-muted-foreground">{t.reference.overlay}:</span>
                                    {overlayText}
                                  </p>
                                )}
                              </div>

                              <div className="min-w-0 space-y-1.5 border-t border-border/70 pt-2.5 md:border-l md:border-t-0 md:pl-3 md:pt-0">
                                {plan ? (
                                  <>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                                        <Play aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
                                        <span className="truncate" title={plan.footageName}>
                                          {plan.footageName}
                                        </span>
                                      </span>
                                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                                        {formatDurationTenth(plan.sourceStartSec)} to {formatDurationTenth(plan.sourceEndSec)}
                                      </span>
                                    </div>
                                    <p className="text-xs leading-relaxed text-muted-foreground">{plan.reason}</p>
                                  </>
                                ) : (
                                  <p className="text-xs text-muted-foreground">{t.reference.planEmpty}</p>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-18">
          <form onSubmit={handleSubmit} noValidate>
            <Card className="gap-0 border border-border py-0 ring-0">
              <CardHeader className="border-b border-border px-4 py-3">
                <CardTitle className="font-display text-base font-medium text-foreground">
                  {t.reference.inspectorTitle}
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-4 p-4">
                <Field>
                  <FieldLabel htmlFor="ref-job-title">{t.reference.jobTitle}</FieldLabel>
                  <Input
                    id="ref-job-title"
                    type="text"
                    maxLength={120}
                    placeholder={t.reference.jobTitlePlaceholder}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="h-11 rounded-md"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="ref-job-brief">{t.reference.brief}</FieldLabel>
                  <textarea
                    id="ref-job-brief"
                    rows={3}
                    maxLength={600}
                    placeholder={t.reference.briefPlaceholder}
                    value={brief}
                    onChange={(event) => setBrief(event.target.value)}
                    className="w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="ref-aspect-select">{t.reference.aspectRatio}</FieldLabel>
                  <Select value={aspectRatio} onValueChange={(value) => setAspectRatio(value as AspectRatio)}>
                    <SelectTrigger id="ref-aspect-select" className="h-11 w-full rounded-md">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="9:16">9:16 ({t.aspectPortrait})</SelectItem>
                      <SelectItem value="1:1">1:1 ({t.aspectSquare})</SelectItem>
                      <SelectItem value="16:9">16:9 ({t.aspectLandscape})</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="ref-reframe-select">{t.reference.reframe}</FieldLabel>
                  <Select value={reframe} onValueChange={(value) => setReframe(value as Reframe)}>
                    <SelectTrigger id="ref-reframe-select" className="h-11 w-full rounded-md">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="face_tracking">{t.faceTracking}</SelectItem>
                      <SelectItem value="blurred_fill">{t.blurredFill}</SelectItem>
                      <SelectItem value="black_bars">{t.blackBars}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Separator />

                <div className="space-y-3">
                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <Label htmlFor="ref-beat-sync" className="cursor-pointer text-sm font-normal text-foreground">
                      {t.reference.beatSyncLabel}
                    </Label>
                    <Switch id="ref-beat-sync" checked={beatSync} onCheckedChange={setBeatSync} />
                  </div>

                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <Label htmlFor="ref-captions" className="cursor-pointer text-sm font-normal text-foreground">
                      {t.reference.captionsLabel}
                    </Label>
                    <Switch id="ref-captions" checked={captions} onCheckedChange={setCaptions} />
                  </div>
                </div>

                {submitError && (
                  <Alert variant="destructive">
                    <CircleAlert aria-hidden="true" />
                    <AlertDescription>{submitError}</AlertDescription>
                  </Alert>
                )}

                {!canSubmit && !submitError && (
                  <p className="text-xs leading-relaxed text-muted-foreground">{t.reference.submitHint}</p>
                )}

                <Button type="submit" className="h-11 w-full rounded-md" disabled={!canSubmit} aria-busy={createJob.isPending}>
                  {createJob.isPending ? (
                    <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <WandSparkles aria-hidden="true" className="mr-2 size-4" />
                  )}
                  {createJob.isPending ? t.reference.generating : t.reference.submit}
                </Button>
              </CardContent>
            </Card>
          </form>
        </aside>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t.reference.deleteTitle}</DialogTitle>
          <DialogDescription>{t.reference.deleteBody}</DialogDescription>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="min-h-11" disabled={deleteJob.isPending}>
                {t.cancelAction}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              disabled={deleteJob.isPending || !activeJob}
              onClick={() => {
                if (activeJob) deleteJob.mutate(activeJob.id)
              }}
            >
              {deleteJob.isPending && (
                <LoaderCircle aria-hidden="true" className="mr-1.5 size-4 animate-spin motion-reduce:animate-none" />
              )}
              {t.reference.confirmDelete}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </WorkspaceShell>
  )
}
