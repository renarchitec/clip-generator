import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  CalendarClock,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock,
  Flame,
  Info,
  LoaderCircle,
  Send,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { AccountAvatar, publicationsKey, type Privacy } from "@/components/publish-dialog"
import { TikTokMark, YouTubeMark, type SocialAccount } from "@/components/social-accounts"
import type { ClipCardData } from "@/components/clip-card"
import {
  api,
  type BatchSchedulePublishRequest,
  type BatchSchedulePublishResponse,
  type PublishMode,
  type TikTokCreatorInfo,
} from "@/lib/api"
import { formatScheduledDateTime, formatScheduleSlot, toDatetimeLocalValue } from "@/lib/format"
import { useLanguage, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const MAX_ACCOUNTS = 5
const MAX_CLIPS = 20
const MIN_INTERVAL_HOURS = 0.5
const MAX_INTERVAL_HOURS = 168
const SCHEDULE_MAX_DAYS = 90
const INTERVAL_PRESETS = [3, 6, 12, 24] as const
const PRIVACY: Privacy[] = ["public", "unlisted", "private"]
const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]

function roundUpFiveMinutes(date: Date): Date {
  const next = new Date(date.getTime())
  next.setSeconds(0, 0)
  const rem = next.getMinutes() % 5
  if (rem !== 0) next.setMinutes(next.getMinutes() + (5 - rem))
  return next
}

function presetPlusHours(hours: number): Date {
  return roundUpFiveMinutes(new Date(Date.now() + hours * 3_600_000))
}

function presetTonight19(): Date {
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0, 0, 0)
  if (target.getTime() <= now.getTime() + 5 * 60_000) {
    target.setDate(target.getDate() + 1)
  }
  return target
}

function presetTomorrow09(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0)
}

function sortClipsForBatch(clips: ClipCardData[]): ClipCardData[] {
  return clips
    .map((clip, originalIndex) => ({ clip, originalIndex }))
    .sort((a, b) => {
      const scoreA = typeof a.clip.viralScore === "number" && Number.isFinite(a.clip.viralScore) ? a.clip.viralScore : -Infinity
      const scoreB = typeof b.clip.viralScore === "number" && Number.isFinite(b.clip.viralScore) ? b.clip.viralScore : -Infinity
      if (scoreB !== scoreA) return scoreB - scoreA
      return a.originalIndex - b.originalIndex
    })
    .map((entry) => entry.clip)
}

export function BatchScheduleDialog({
  jobId,
  clips,
  open,
  onOpenChange,
}: {
  jobId: string
  clips: ClipCardData[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl gap-0 p-0 sm:p-0"
        onInteractOutside={(event) => {
          if ((event.target as Element | null)?.closest?.("[data-sonner-toaster]")) event.preventDefault()
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-600 dark:border-sky-400/30 dark:bg-sky-400/15 dark:text-sky-300"
            >
              <CalendarClock className="size-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="font-display text-lg font-medium tracking-[-.02em]">{t.batchScheduleTitle}</DialogTitle>
              <DialogDescription className="mt-0.5">{t.batchScheduleDescription}</DialogDescription>
            </div>
          </div>
          <DialogClose asChild>
            <Button type="button" variant="ghost" className="size-10 shrink-0 px-0" aria-label={t.closePlayer}>
              <X className="size-4" />
            </Button>
          </DialogClose>
        </div>
        {open && <BatchScheduleBody key={jobId} jobId={jobId} clips={clips} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function BatchScheduleBody({
  jobId,
  clips,
  onClose,
}: {
  jobId: string
  clips: ClipCardData[]
  onClose: () => void
}) {
  const t = useT()
  const { language } = useLanguage()
  const locale = language === "id" ? "id-ID" : "en-US"
  const client = useQueryClient()

  const sortedClips = useMemo(() => sortClipsForBatch(clips), [clips])
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>(() => sortedClips.slice(0, MAX_CLIPS).map((clip) => clip.id))
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])

  // Timing state
  const [startMode, setStartMode] = useState<"now" | "custom">("now")
  const [startLocal, setStartLocal] = useState(() => toDatetimeLocalValue(presetPlusHours(1)))
  const [intervalInput, setIntervalInput] = useState("6")

  // Platform options
  const [privacy, setPrivacy] = useState<Privacy>("public")
  const [madeForKids, setMadeForKids] = useState(false)
  const [tiktokMode, setTiktokMode] = useState<PublishMode>("inbox")
  const [privacyLevel, setPrivacyLevel] = useState("")
  const [allowComment, setAllowComment] = useState(false)
  const [allowDuet, setAllowDuet] = useState(false)
  const [allowStitch, setAllowStitch] = useState(false)
  const [disclose, setDisclose] = useState(false)
  const [brandOrganic, setBrandOrganic] = useState(false)
  const [brandContent, setBrandContent] = useState(false)

  const [submitError, setSubmitError] = useState("")
  const [result, setResult] = useState<BatchSchedulePublishResponse | null>(null)

  const accounts = useQuery({
    queryKey: ["social", "accounts"],
    queryFn: () => api<SocialAccount[]>("/social/accounts"),
  })

  const available = accounts.data ?? []
  const usable = available.filter((account) => !account.needsReconnect)
  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || !usable.length) return
    prefilled.current = true
    setSelectedAccountIds([usable[0].id])
  }, [usable])

  const selectedAccounts = available.filter((item) => selectedAccountIds.includes(item.id))
  const selectedYouTube = selectedAccounts.filter((item) => item.platform === "youtube")
  const selectedTikTok = selectedAccounts.filter((item) => item.platform === "tiktok")
  const tiktokAccount = selectedTikTok[0]

  const creatorQuery = useQuery({
    queryKey: ["social", "accounts", tiktokAccount?.id, "tiktok", "creator-info"],
    queryFn: () => api<TikTokCreatorInfo>(`/social/accounts/${tiktokAccount!.id}/tiktok/creator-info`),
    enabled: !!tiktokAccount && tiktokMode === "direct",
    staleTime: 0,
    refetchOnMount: "always",
  })

  useEffect(() => {
    setPrivacyLevel("")
    setAllowComment(false)
    setAllowDuet(false)
    setAllowStitch(false)
    setBrandOrganic(false)
    setBrandContent(false)
    setDisclose(false)
  }, [tiktokAccount?.id])

  // Keep clip selection synced if clips change while dialog is open
  const orderedSelectedClips = useMemo(
    () => sortedClips.filter((clip) => selectedClipIds.includes(clip.id)),
    [sortedClips, selectedClipIds],
  )

  const intervalHours = Number(intervalInput)
  const intervalValid = Number.isFinite(intervalHours) && intervalHours >= MIN_INTERVAL_HOURS && intervalHours <= MAX_INTERVAL_HOURS

  const nowMs = Date.now()
  const minLocal = toDatetimeLocalValue(new Date(nowMs + 60_000))
  const maxLocal = toDatetimeLocalValue(new Date(nowMs + SCHEDULE_MAX_DAYS * 86_400_000))
  const parsedStart = startMode === "custom" && startLocal ? new Date(startLocal) : null
  const startDateInvalid =
    startMode === "custom" &&
    (!parsedStart || Number.isNaN(parsedStart.getTime()) || parsedStart.getTime() <= nowMs + 60_000)
  const effectiveBaseMs = startMode === "custom" && parsedStart && !Number.isNaN(parsedStart.getTime()) ? parsedStart.getTime() : nowMs
  const lastSlotMs =
    orderedSelectedClips.length > 0 && intervalValid
      ? effectiveBaseMs + Math.round((orderedSelectedClips.length - 1) * intervalHours * 3_600_000)
      : effectiveBaseMs
  const scheduleTooFar = lastSlotMs > nowMs + SCHEDULE_MAX_DAYS * 86_400_000

  const brandedCantPrivate = brandContent && privacyLevel === "SELF_ONLY"
  const disclosureInvalid = disclose && !brandOrganic && !brandContent
  const tiktokDirectBlocked =
    selectedTikTok.length > 0 &&
    tiktokMode === "direct" &&
    (!privacyLevel ||
      brandedCantPrivate ||
      disclosureInvalid ||
      creatorQuery.isPending ||
      creatorQuery.isError ||
      !creatorQuery.data?.privacyLevelOptions.includes(privacyLevel))

  const totalPublications = orderedSelectedClips.length * selectedAccountIds.length

  const scheduleBatch = useMutation({
    mutationFn: (payload: BatchSchedulePublishRequest) =>
      api<BatchSchedulePublishResponse>(`/jobs/${jobId}/schedule-publish`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (response) => {
      setSubmitError("")
      setResult(response)
      void client.invalidateQueries({ queryKey: ["jobs", jobId] })
      void client.invalidateQueries({ queryKey: ["jobs"] })
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      for (const pub of response.scheduled) {
        void client.invalidateQueries({ queryKey: publicationsKey(pub.clipId) })
      }
      const scheduledCount = response.scheduled.length
      if (scheduledCount > 0) {
        toast.success(
          scheduledCount === 1
            ? t.batchResultScheduledOne
            : t.batchResultScheduled.replace("{count}", String(scheduledCount)),
        )
      } else {
        toast.info(t.batchResultNone)
      }
    },
    onError: () => {
      setSubmitError(t.batchErrorGeneric)
    },
  })

  if (accounts.isPending) {
    return (
      <div role="status" aria-label={t.loading} className="space-y-4 px-5 py-5 sm:px-6">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-36 w-full rounded-lg" />
      </div>
    )
  }

  if (accounts.isError) {
    return (
      <div className="px-5 py-5 sm:px-6">
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t.socialLoadError}</span>
            <Button variant="outline" onClick={() => void accounts.refetch()}>
              {t.retry}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!available.length) {
    return (
      <div className="px-5 py-8 text-center sm:px-6">
        <span className="mx-auto grid size-12 place-items-center rounded-xl border border-border bg-background">
          <Send aria-hidden="true" className="size-5 text-muted-foreground" />
        </span>
        <p className="mt-4 font-medium">{t.publishNoAccounts}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t.publishNoAccountsBody}</p>
        <Button asChild className="mt-5 h-10 px-4">
          <Link to="/settings" onClick={onClose}>
            {t.publishGoToSettings}
          </Link>
        </Button>
      </div>
    )
  }

  if (result) {
    const scheduledCount = result.scheduled.length
    const skippedCount = result.skipped.length
    return (
      <div className="space-y-5 px-5 py-5 sm:px-6">
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/8 p-4 dark:border-sky-400/30 dark:bg-sky-400/10">
          <div className="flex items-start gap-3">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-sky-600 dark:text-sky-400" />
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-foreground">
                {scheduledCount === 0
                  ? t.batchResultNone
                  : scheduledCount === 1
                    ? t.batchResultScheduledOne
                    : t.batchResultScheduled.replace("{count}", String(scheduledCount))}
              </p>
              {skippedCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t.batchResultSkipped.replace("{count}", String(skippedCount))}
                </p>
              )}
            </div>
          </div>
        </div>

        {result.scheduled.length > 0 && (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-background">
            {result.scheduled.map((pub) => {
              const clipMatch = clips.find((c) => c.id === pub.clipId)
              return (
                <li key={pub.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{clipMatch?.title || pub.title || t.clip}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {pub.accountName} · {t.socialPlatforms[pub.platform]}
                    </p>
                  </div>
                  {pub.status === "scheduled" && pub.scheduledAt ? (
                    <Badge
                      variant="outline"
                      className="shrink-0 gap-1 border-sky-500/35 bg-sky-500/12 font-mono text-[11px] font-medium tabular-nums text-sky-700 dark:border-sky-400/35 dark:bg-sky-400/15 dark:text-sky-300"
                    >
                      <Clock aria-hidden="true" className="size-3" />
                      {formatScheduledDateTime(pub.scheduledAt, locale)}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0 text-[11px]">
                      {t.batchSlotImmediate}
                    </Badge>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex justify-end border-t border-border pt-4">
          <Button type="button" className="h-10 px-5" onClick={onClose}>
            {t.publishDone}
          </Button>
        </div>
      </div>
    )
  }

  function toggleAccount(account: SocialAccount) {
    const checked = selectedAccountIds.includes(account.id)
    if (checked) {
      setSelectedAccountIds((prev) => prev.filter((id) => id !== account.id))
      return
    }
    if (selectedAccountIds.length >= MAX_ACCOUNTS) return
    setSelectedAccountIds((prev) => [...prev, account.id])
  }

  function toggleClip(clipId: string) {
    setSelectedClipIds((prev) => {
      if (prev.includes(clipId)) return prev.filter((id) => id !== clipId)
      if (prev.length >= MAX_CLIPS) return prev
      return [...prev, clipId]
    })
  }

  const allSelected = orderedSelectedClips.length === Math.min(sortedClips.length, MAX_CLIPS) && orderedSelectedClips.length > 0
  const submitBlocked =
    selectedAccountIds.length === 0 ||
    orderedSelectedClips.length === 0 ||
    !intervalValid ||
    startDateInvalid ||
    scheduleTooFar ||
    tiktokDirectBlocked

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitBlocked) return
    setSubmitError("")
    const payload: BatchSchedulePublishRequest = {
      clipIds: orderedSelectedClips.map((clip) => clip.id),
      accountIds: selectedAccountIds,
      ...(startMode === "custom" && parsedStart ? { startAt: parsedStart.toISOString() } : {}),
      intervalHours,
      ...(selectedYouTube.length > 0 ? { privacy, madeForKids } : {}),
      ...(selectedTikTok.length > 0
        ? tiktokMode === "direct"
          ? {
              tiktokMode: "direct",
              tiktok: {
                privacyLevel,
                disableComment: !allowComment,
                disableDuet: !allowDuet,
                disableStitch: !allowStitch,
                brandContent,
                brandOrganic,
              },
            }
          : { tiktokMode: "inbox" }
        : {}),
    }
    scheduleBatch.mutate(payload)
  }

  const startPresets = [
    { key: "1h", label: "+1h", date: () => presetPlusHours(1) },
    { key: "tonight19", label: t.schedulePresetTonight19, date: () => presetTonight19() },
    { key: "tmrw09", label: t.schedulePresetTomorrow09, date: () => presetTomorrow09() },
  ]

  const slotIndexByClipId = new Map<string, number>()
  orderedSelectedClips.forEach((clip, idx) => slotIndexByClipId.set(clip.id, idx))

  return (
    <form noValidate onSubmit={handleSubmit}>
      <div className="space-y-5 px-5 py-5 sm:px-6">
        <FieldGroup className="gap-5">
          {/* 1. Accounts */}
          <fieldset className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <legend className="text-sm font-medium">{t.publishTo}</legend>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {selectedAccountIds.length}/{Math.min(MAX_ACCOUNTS, usable.length || MAX_ACCOUNTS)} · {t.batchAccountsLimit}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {available.map((account) => {
                const checked = selectedAccountIds.includes(account.id)
                const disabled = account.needsReconnect || (!checked && selectedAccountIds.length >= MAX_ACCOUNTS)
                return (
                  <button
                    key={account.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={disabled}
                    onClick={() => toggleAccount(account)}
                    className={cn(
                      "flex min-h-13 w-full items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-background",
                      checked && "border-primary/45 bg-primary/[.04]",
                    )}
                  >
                    <AccountAvatar account={account} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{account.displayName}</span>
                      <span className={cn("block truncate text-xs text-muted-foreground", account.needsReconnect && "text-amber-700 dark:text-amber-400")}>
                        {account.needsReconnect ? t.publishNeedsReconnect : t.socialPlatforms[account.platform]}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-[5px] border border-input transition-colors",
                        checked && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {checked && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          {/* Platform options (YouTube / TikTok) */}
          {selectedYouTube.length > 0 && (
            <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-3.5">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.06em] text-muted-foreground">
                <YouTubeMark className="size-3.5" />
                {t.socialPlatforms.youtube}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field className="relative">
                  <FieldLabel htmlFor="batch-yt-privacy">{t.publishPrivacy}</FieldLabel>
                  <Select value={privacy} onValueChange={(value) => setPrivacy(value as Privacy)}>
                    <SelectTrigger id="batch-yt-privacy" className="h-9 w-full bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {PRIVACY.map((option) => (
                        <SelectItem key={option} value={option}>
                          {t.privacyOptions[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="relative justify-center">
                  <div className="relative flex items-center justify-between gap-3">
                    <FieldLabel htmlFor="batch-yt-kids">{t.publishMadeForKids}</FieldLabel>
                    <Switch id="batch-yt-kids" checked={madeForKids} onCheckedChange={setMadeForKids} />
                  </div>
                  <FieldDescription className="text-[11px]">{t.publishMadeForKidsHint}</FieldDescription>
                </Field>
              </div>
            </section>
          )}

          {selectedTikTok.length > 0 && (
            <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.06em] text-muted-foreground">
                  <TikTokMark className="size-3.5" />
                  {t.socialPlatforms.tiktok}
                </h3>
                <ToggleGroup
                  type="single"
                  value={tiktokMode}
                  onValueChange={(value) => {
                    if (value) setTiktokMode(value as PublishMode)
                  }}
                  aria-label={t.tiktokModeLabel}
                  spacing={1}
                  className="rounded-lg border border-border bg-secondary/50 p-0.5"
                >
                  <ToggleGroupItem
                    value="inbox"
                    size="sm"
                    className="h-7 rounded-md px-2.5 text-xs font-medium data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs"
                  >
                    {t.tiktokPrivacy.inbox}
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="direct"
                    size="sm"
                    className="h-7 rounded-md px-2.5 text-xs font-medium data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs"
                  >
                    {t.tiktokModeDirect}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              {tiktokMode === "inbox" ? (
                <p className="flex items-start gap-2 rounded-lg bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
                  <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>{t.batchTiktokInboxHint}</span>
                </p>
              ) : (
                <div className="space-y-3">
                  {creatorQuery.isPending ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <LoaderCircle className="size-3.5 animate-spin" />
                      {t.tiktokCreatorLoading}
                    </p>
                  ) : creatorQuery.isError ? (
                    <Alert variant="destructive">
                      <AlertDescription className="flex items-center justify-between gap-2 text-xs">
                        <span>{t.tiktokCreatorError}</span>
                        <Button type="button" variant="outline" size="sm" onClick={() => void creatorQuery.refetch()}>
                          {t.retry}
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    creatorQuery.data && (
                      <>
                        <Field className="relative">
                          <FieldLabel htmlFor="batch-tiktok-privacy">{t.tiktokPrivacyLabel}</FieldLabel>
                          <Select value={privacyLevel} onValueChange={setPrivacyLevel}>
                            <SelectTrigger id="batch-tiktok-privacy" className="h-9 w-full bg-background">
                              <SelectValue placeholder={t.tiktokPrivacyPlaceholder} />
                            </SelectTrigger>
                            <SelectContent position="popper">
                              {creatorQuery.data.privacyLevelOptions
                                .filter((option) => TIKTOK_PRIVACY.includes(option))
                                .map((option) => (
                                  <SelectItem key={option} value={option} disabled={brandContent && option === "SELF_ONLY"}>
                                    {t.tiktokPrivacy[option as keyof typeof t.tiktokPrivacy]}
                                    {brandContent && option === "SELF_ONLY" ? ` — ${t.tiktokBrandedNotPrivate}` : ""}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          {brandedCantPrivate && <FieldDescription className="text-destructive">{t.tiktokBrandedNotPrivate}</FieldDescription>}
                        </Field>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {(
                            [
                              ["comment", allowComment, setAllowComment, creatorQuery.data.commentDisabled, t.tiktokAllowComments],
                              ["duet", allowDuet, setAllowDuet, creatorQuery.data.duetDisabled, t.tiktokAllowDuet],
                              ["stitch", allowStitch, setAllowStitch, creatorQuery.data.stitchDisabled, t.tiktokAllowStitch],
                            ] as const
                          ).map(([key, enabled, setter, disabled, label]) => (
                            <div
                              key={key}
                              className="relative flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-2"
                            >
                              <label htmlFor={`batch-tt-${key}`} className={cn("text-xs", disabled && "text-muted-foreground")}>
                                {label}
                              </label>
                              <Switch id={`batch-tt-${key}`} size="sm" checked={enabled} disabled={disabled} onCheckedChange={setter} />
                            </div>
                          ))}
                        </div>
                        <div className="space-y-2 rounded-lg border border-border bg-background p-2.5">
                          <div className="relative flex items-center justify-between gap-3">
                            <p className="text-xs font-medium">{t.tiktokDisclose}</p>
                            <Switch
                              size="sm"
                              checked={disclose}
                              onCheckedChange={(checked) => {
                                setDisclose(checked)
                                if (!checked) {
                                  setBrandOrganic(false)
                                  setBrandContent(false)
                                }
                              }}
                            />
                          </div>
                          {disclose && (
                            <div className="flex flex-wrap gap-4 border-t border-border pt-2">
                              <label className="flex items-center gap-1.5 text-xs">
                                <input
                                  type="checkbox"
                                  checked={brandOrganic}
                                  onChange={(event) => setBrandOrganic(event.target.checked)}
                                  className="accent-primary"
                                />
                                {t.tiktokYourBrand}
                              </label>
                              <label className="flex items-center gap-1.5 text-xs">
                                <input
                                  type="checkbox"
                                  checked={brandContent}
                                  onChange={(event) => setBrandContent(event.target.checked)}
                                  className="accent-primary"
                                />
                                {t.tiktokBranded}
                              </label>
                              {disclosureInvalid && <p className="w-full text-xs text-destructive">{t.tiktokDiscloseRequired}</p>}
                            </div>
                          )}
                        </div>
                      </>
                    )
                  )}
                </div>
              )}
            </section>
          )}

          {/* 2. Timing controls */}
          <section className="space-y-4 rounded-xl border border-border bg-muted/20 p-3.5 sm:p-4">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Clock aria-hidden="true" className="size-4 text-muted-foreground" />
                  {t.batchStartLabel}
                </span>
                <ToggleGroup
                  type="single"
                  value={startMode}
                  onValueChange={(value) => {
                    if (!value) return
                    const next = value as "now" | "custom"
                    setStartMode(next)
                    if (next === "custom") {
                      const d = startLocal ? new Date(startLocal) : null
                      if (!d || Number.isNaN(d.getTime()) || d.getTime() <= Date.now() + 60_000) {
                        setStartLocal(toDatetimeLocalValue(presetPlusHours(1)))
                      }
                    }
                  }}
                  aria-label={t.batchStartLabel}
                  spacing={1}
                  className="rounded-lg border border-border bg-secondary/50 p-0.5"
                >
                  <ToggleGroupItem
                    value="now"
                    size="sm"
                    className="h-7 rounded-md px-2.5 text-xs font-medium data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs"
                  >
                    {t.batchStartNow}
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="custom"
                    size="sm"
                    className="h-7 rounded-md px-2.5 text-xs font-medium data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs"
                  >
                    {t.batchStartPick}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              {startMode === "custom" && (
                <div className="space-y-2">
                  <Input
                    id="batch-start-at"
                    aria-label={t.batchStartPick}
                    type="datetime-local"
                    min={minLocal}
                    max={maxLocal}
                    value={startLocal}
                    onChange={(event) => setStartLocal(event.target.value)}
                    aria-invalid={startDateInvalid}
                    className="h-9 bg-background font-mono text-sm tabular-nums"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {startPresets.map((preset) => (
                      <Button
                        key={preset.key}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-full bg-background px-2.5 text-xs font-normal"
                        onClick={() => setStartLocal(toDatetimeLocalValue(preset.date()))}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                  {startDateInvalid && (
                    <p role="alert" className="text-xs text-destructive">
                      {t.scheduleMustBeFuture}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-border/70 pt-3">
              <FieldLabel htmlFor="batch-interval-hours" className="text-sm font-medium">
                {t.batchIntervalLabel}
              </FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {INTERVAL_PRESETS.map((preset) => {
                    const active = intervalValid && intervalHours === preset
                    return (
                      <Button
                        key={preset}
                        type="button"
                        variant={active ? "default" : "outline"}
                        size="sm"
                        className={cn("h-8 rounded-md px-3 font-mono text-xs tabular-nums", !active && "bg-background")}
                        onClick={() => setIntervalInput(String(preset))}
                      >
                        {preset}h
                      </Button>
                    )
                  })}
                </div>
                <div className="relative flex items-center">
                  <Input
                    id="batch-interval-hours"
                    type="number"
                    min={MIN_INTERVAL_HOURS}
                    max={MAX_INTERVAL_HOURS}
                    step={0.5}
                    value={intervalInput}
                    onChange={(event) => setIntervalInput(event.target.value)}
                    aria-invalid={!intervalValid}
                    className="h-8 w-28 bg-background pr-12 font-mono text-xs tabular-nums"
                  />
                  <span className="pointer-events-none absolute right-2.5 text-[11px] text-muted-foreground">{t.batchIntervalHours}</span>
                </div>
              </div>
              {!intervalValid && (
                <p role="alert" className="text-xs text-destructive">
                  {t.batchIntervalInvalid}
                </p>
              )}
              {scheduleTooFar && (
                <p role="alert" className="text-xs text-destructive">
                  {t.scheduleTooFar}
                </p>
              )}
            </div>
          </section>

          {/* 3. Clips with live computed schedule slots */}
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t.batchClipsLabel}</span>
                <Badge variant="secondary" className="font-mono text-[11px] tabular-nums">
                  {orderedSelectedClips.length}/{sortedClips.length}
                </Badge>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setSelectedClipIds(allSelected ? [] : sortedClips.slice(0, MAX_CLIPS).map((clip) => clip.id))
                }
              >
                {allSelected ? t.batchClipsClearAll : t.batchClipsSelectAll}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t.batchClipsMaxHint}</p>

            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-background">
              {sortedClips.map((clip, listIdx) => {
                const slotIdx = slotIndexByClipId.get(clip.id)
                const checked = slotIdx !== undefined
                const disabled = !checked && orderedSelectedClips.length >= MAX_CLIPS
                const score = typeof clip.viralScore === "number" && Number.isFinite(clip.viralScore) ? Math.max(0, Math.min(100, Math.round(clip.viralScore))) : null
                const slotDate =
                  checked && intervalValid
                    ? new Date(effectiveBaseMs + Math.round(slotIdx * intervalHours * 3_600_000))
                    : null
                const isImmediateSlot = checked && slotIdx === 0 && startMode === "now"

                return (
                  <li key={clip.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      disabled={disabled}
                      onClick={() => toggleClip(clip.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                        !checked && "opacity-60",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid size-4.5 shrink-0 place-items-center rounded-[4px] border border-input transition-colors",
                          checked && "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        {checked && <Check className="size-3" strokeWidth={3} />}
                      </span>
                      <span className="w-5 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {checked ? `#${slotIdx + 1}` : `#${listIdx + 1}`}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{clip.title || `${t.clip} ${listIdx + 1}`}</span>
                      {score !== null && (
                        <span
                          className={cn(
                            "inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full border px-1.5 font-mono text-[10px] font-semibold tabular-nums",
                            score >= 80
                              ? "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                              : score >= 60
                                ? "border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-300"
                                : "border-zinc-500/30 bg-zinc-500/12 text-zinc-700 dark:text-zinc-300",
                          )}
                        >
                          <Flame aria-hidden="true" className="size-3 shrink-0" />
                          {score}
                        </span>
                      )}
                      {checked && slotDate ? (
                        isImmediateSlot ? (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-emerald-500/35 bg-emerald-500/12 font-mono text-[11px] font-medium text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-400/15 dark:text-emerald-300"
                          >
                            {t.nowShort}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="shrink-0 gap-1 border-sky-500/35 bg-sky-500/12 font-mono text-[11px] font-medium tabular-nums text-sky-700 dark:border-sky-400/35 dark:bg-sky-400/15 dark:text-sky-300"
                          >
                            <Clock aria-hidden="true" className="size-3" />
                            {formatScheduleSlot(slotDate, locale, { today: t.todayShort, tomorrow: t.tomorrowShort })}
                          </Badge>
                        )
                      ) : (
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">—</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>

            {totalPublications > 0 && (
              <p className="text-xs text-muted-foreground">
                {t.batchSummaryLine
                  .replace("{clips}", String(orderedSelectedClips.length))
                  .replace("{accounts}", String(selectedAccountIds.length))
                  .replace("{total}", String(totalPublications))}
              </p>
            )}
          </section>

          {submitError && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>
      </div>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card px-5 py-3 sm:px-6">
        <Button type="button" variant="ghost" className="h-10 px-4" onClick={onClose}>
          {t.cancelAction}
        </Button>
        <Button type="submit" className="h-10 min-w-44 px-4" disabled={scheduleBatch.isPending || submitBlocked}>
          {scheduleBatch.isPending ? (
            <>
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              {t.batchSubmitting}
            </>
          ) : (
            <>
              <CalendarClock aria-hidden="true" className="size-4" />
              {t.batchSubmit.replace("{count}", String(totalPublications))}
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
