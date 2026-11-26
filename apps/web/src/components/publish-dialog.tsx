import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  Ban,
  CalendarClock,
  Check,
  CircleAlert,
  Clock,
  ExternalLink,
  Eye,
  Heart,
  Info,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { InstagramMark, TikTokMark, YouTubeMark, type SocialAccount, type SocialPlatform } from "@/components/social-accounts"
import {
  api,
  CAPTION_LANGUAGES,
  isActivePublication,
  isCaptionLanguage,
  isScheduledPublication,
  isUploadingPublication,
  type CaptionLanguage,
  type ClipPublicationSummary,
  type PlatformCaptions,
  type PlatformCaptionVariant,
  type Publication,
  type PublicationStatus,
  type TikTokCreatorInfo,
} from "@/lib/api"
import { formatScheduledDateTime, relativeAge, toDatetimeLocalValue } from "@/lib/format"
import { formatCompactCount, formatExactCount, summarizeClipViews } from "@/lib/format-views"
import { useLanguage, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type Privacy = "public" | "unlisted" | "private"
export type { PublicationStatus }
export { isActivePublication, isScheduledPublication, isUploadingPublication }
export type ClipPublication = ClipPublicationSummary
export type PublicationResponse = Publication

export interface RefreshMetricsResponse {
  publications: PublicationResponse[]
  refreshed: number
  skipped: number
  nextAllowedAt: string | null
}

export function refreshClipPublicationMetrics(clipId: string) {
  return api<RefreshMetricsResponse>(`/clips/${clipId}/publications/refresh-metrics`, {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export function metricsErrorMessage(code: string | null | undefined, t: ReturnType<typeof useT>): string {
  if (!code) return t.metricsErrorUnknown
  return t.metricsErrors[code as keyof typeof t.metricsErrors] ?? t.metricsErrorUnknown
}

export type PublishableClip = {
  id: string
  title: string
  caption?: string | null
  hashtags?: string[]
  platformCaptions?: PlatformCaptions | null
  startSec?: number
  endSec?: number
}

const TITLE_MAX = 100
const CAPTION_MAX = 5000
const TIKTOK_CAPTION_MAX = 2200
const INSTAGRAM_CAPTION_MAX = 2200
const INSTAGRAM_HASHTAG_MAX = 30
const SCHEDULE_MAX_DAYS = 90
const PRIVACY: Privacy[] = ["public", "unlisted", "private"]
const PLATFORM_ORDER: readonly SocialPlatform[] = ["youtube", "tiktok", "instagram"]
const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]

export const publicationsKey = (clipId: string) => ["clips", clipId, "publications"] as const

type CaptionResponse = {
  caption: string
  hashtags: string[]
  platformCaptions?: PlatformCaptions | null
}

function formatCaption(caption: string | null | undefined, hashtags: string[] | undefined) {
  const tags = (hashtags ?? [])
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map((tag) => `#${tag}`)
    .join(" ")
  return [caption?.trim(), tags].filter(Boolean).join("\n\n")
}

function defaultCaption(clip: PublishableClip) {
  return formatCaption(clip.caption, clip.hashtags)
}

function composeVariantCaption(variant: PlatformCaptionVariant | undefined, fallback: string) {
  if (!variant) return fallback
  const composed = formatCaption(variant.caption, variant.hashtags)
  return composed || fallback
}

function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length
}

function defaultScheduleDate(hoursAhead = 3): Date {
  const next = new Date(Date.now() + hoursAhead * 3_600_000)
  next.setSeconds(0, 0)
  const remainder = next.getMinutes() % 5
  if (remainder !== 0) next.setMinutes(next.getMinutes() + (5 - remainder))
  return next
}

function tomorrowAt19(): Date {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(19, 0, 0, 0)
  return date
}

function PlatformIcon({ platform, className }: { platform: SocialPlatform; className?: string }) {
  if (platform === "tiktok") return <TikTokMark className={className} />
  if (platform === "instagram") return <InstagramMark className={className} />
  return <YouTubeMark className={className} />
}

function Counter({ value, max, id, className }: { value: number; max: number; id: string; className?: string }) {
  const locale = useLanguage().language === "id" ? "id-ID" : "en-US"
  const over = value > max
  return (
    <span
      id={id}
      aria-live={over ? "polite" : "off"}
      className={cn(
        "ml-auto font-mono text-[11px] tabular-nums text-muted-foreground",
        over && "font-semibold text-destructive",
        !over && value > max * 0.9 && "text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      {value.toLocaleString(locale)}/{max.toLocaleString(locale)}
    </span>
  )
}

export function PublishDialog({ clip, open, onOpenChange }: { clip: PublishableClip; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl gap-0 p-0 sm:p-0"
        onInteractOutside={(event) => {
          if ((event.target as Element | null)?.closest?.("[data-sonner-toaster]")) event.preventDefault()
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <DialogTitle className="font-display text-lg font-medium tracking-[-.02em]">{t.publishClip}</DialogTitle>
            <DialogDescription className="mt-1 truncate">{clip.title || t.clip}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button type="button" variant="ghost" className="size-10 shrink-0 px-0" aria-label={t.closePlayer}>
              <X className="size-4" />
            </Button>
          </DialogClose>
        </div>
        {open && <PublishBody key={clip.id} clip={clip} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function PublishBody({ clip, onClose }: { clip: PublishableClip; onClose: () => void }) {
  const t = useT()
  const { language } = useLanguage()
  const locale = language === "id" ? "id-ID" : "en-US"
  const client = useQueryClient()

  const fallbackCaption = defaultCaption(clip)
  const [view, setView] = useState<"form" | "progress">("form")
  const [submittedIds, setSubmittedIds] = useState<string[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [accountError, setAccountError] = useState("")

  // Per-platform copy state
  const [youtubeTitle, setYoutubeTitle] = useState(() => (clip.platformCaptions?.youtube?.title?.trim() || clip.title || "").slice(0, TITLE_MAX))
  const [youtubeTitleTouched, setYoutubeTitleTouched] = useState(false)
  const [platformCopy, setPlatformCopy] = useState<Record<SocialPlatform, string>>(() => ({
    youtube: composeVariantCaption(clip.platformCaptions?.youtube, fallbackCaption),
    tiktok: composeVariantCaption(clip.platformCaptions?.tiktok, fallbackCaption),
    instagram: composeVariantCaption(clip.platformCaptions?.instagram, fallbackCaption),
  }))
  const [activePlatformTab, setActivePlatformTab] = useState<SocialPlatform>("youtube")

  // Platform settings
  const [privacy, setPrivacy] = useState<Privacy>("public")
  const [madeForKids, setMadeForKids] = useState(false)
  const [mode, setMode] = useState<"direct" | "inbox">("direct")
  const [privacyLevel, setPrivacyLevel] = useState("")
  const [allowComment, setAllowComment] = useState(false)
  const [allowDuet, setAllowDuet] = useState(false)
  const [allowStitch, setAllowStitch] = useState(false)
  const [disclose, setDisclose] = useState(false)
  const [brandOrganic, setBrandOrganic] = useState(false)
  const [brandContent, setBrandContent] = useState(false)

  // Schedule controls
  const [publishTiming, setPublishTiming] = useState<"now" | "schedule">("now")
  const [scheduledLocal, setScheduledLocal] = useState(() => toDatetimeLocalValue(defaultScheduleDate(3)))
  const [submitError, setSubmitError] = useState("")

  const accounts = useQuery({ queryKey: ["social", "accounts"], queryFn: () => api<SocialAccount[]>("/social/accounts") })
  const publications = useQuery({
    queryKey: publicationsKey(clip.id),
    queryFn: () => api<PublicationResponse[]>(`/clips/${clip.id}/publications`),
    refetchInterval: (query) => (query.state.data?.some((item) => isUploadingPublication(item.status)) ? 3000 : false),
  })
  const wasUploading = useRef(false)
  const anyUploading = !!publications.data?.some((item) => isUploadingPublication(item.status))
  useEffect(() => {
    if (wasUploading.current && !anyUploading) {
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      void client.invalidateQueries({ queryKey: ["jobs"] })
    }
    wasUploading.current = anyUploading
  }, [anyUploading, client])

  const available = accounts.data ?? []
  const usable = available.filter((account) => !account.needsReconnect)
  const selected = available.filter((item) => selectedIds.includes(item.id))
  const selectedTikTok = selected.filter((item) => item.platform === "tiktok")
  const selectedYouTube = selected.filter((item) => item.platform === "youtube")
  const selectedInstagram = selected.filter((item) => item.platform === "instagram")
  const selectedPlatforms = PLATFORM_ORDER.filter((platform) => selected.some((account) => account.platform === platform))
  const currentPlatform: SocialPlatform = selectedPlatforms.includes(activePlatformTab)
    ? activePlatformTab
    : (selectedPlatforms[0] ?? activePlatformTab)

  useEffect(() => {
    if (selectedPlatforms.length > 0 && !selectedPlatforms.includes(activePlatformTab)) {
      setActivePlatformTab(selectedPlatforms[0])
    }
  }, [selectedPlatforms, activePlatformTab])

  const tiktokAccount = selectedTikTok[0]
  const creatorQuery = useQuery({
    queryKey: ["social", "accounts", tiktokAccount?.id, "tiktok", "creator-info"],
    queryFn: () => api<TikTokCreatorInfo>(`/social/accounts/${tiktokAccount!.id}/tiktok/creator-info`),
    enabled: !!tiktokAccount && mode === "direct",
    staleTime: 0,
    refetchOnMount: "always",
  })

  // Per-platform validation
  const youtubeTitleEmpty = selectedYouTube.length > 0 && !youtubeTitle.trim()
  const youtubeTitleTooLong = selectedYouTube.length > 0 && youtubeTitle.length > TITLE_MAX
  const youtubeCaptionTooLong = selectedYouTube.length > 0 && platformCopy.youtube.length > CAPTION_MAX
  const youtubeHasError = youtubeTitleEmpty || youtubeTitleTooLong || youtubeCaptionTooLong

  const tiktokCaptionTooLong = selectedTikTok.length > 0 && platformCopy.tiktok.length > TIKTOK_CAPTION_MAX
  const tiktokHasError = tiktokCaptionTooLong

  const instagramCaptionTooLong = selectedInstagram.length > 0 && platformCopy.instagram.length > INSTAGRAM_CAPTION_MAX
  const instagramHashtagCount = countHashtags(platformCopy.instagram)
  const tooManyInstagramHashtags = selectedInstagram.length > 0 && instagramHashtagCount > INSTAGRAM_HASHTAG_MAX
  const instagramHasError = instagramCaptionTooLong || tooManyInstagramHashtags

  const platformHasError: Record<SocialPlatform, boolean> = {
    youtube: youtubeHasError,
    tiktok: tiktokHasError,
    instagram: instagramHasError,
  }

  const brandedCantPrivate = brandContent && privacyLevel === "SELF_ONLY"
  const duration = clip.startSec !== undefined && clip.endSec !== undefined ? Math.max(0, clip.endSec - clip.startSec) : null
  const durationTooLong = !!duration && !!creatorQuery.data && duration > creatorQuery.data.maxVideoPostDurationSec
  const disclosureInvalid = disclose && !brandOrganic && !brandContent

  // Schedule validation
  const nowMs = Date.now()
  const minLocal = toDatetimeLocalValue(new Date(nowMs + 60_000))
  const maxLocal = toDatetimeLocalValue(new Date(nowMs + SCHEDULE_MAX_DAYS * 86_400_000))
  const parsedScheduleDate = publishTiming === "schedule" && scheduledLocal ? new Date(scheduledLocal) : null
  const scheduleInvalidDate = publishTiming === "schedule" && (!parsedScheduleDate || Number.isNaN(parsedScheduleDate.getTime()))
  const scheduleInPast =
    publishTiming === "schedule" && !!parsedScheduleDate && !Number.isNaN(parsedScheduleDate.getTime()) && parsedScheduleDate.getTime() <= nowMs + 60_000
  const scheduleTooFar =
    publishTiming === "schedule" &&
    !!parsedScheduleDate &&
    !Number.isNaN(parsedScheduleDate.getTime()) &&
    parsedScheduleDate.getTime() > nowMs + SCHEDULE_MAX_DAYS * 86_400_000
  const scheduleInvalid = scheduleInvalidDate || scheduleInPast || scheduleTooFar
  const scheduledIso = publishTiming === "schedule" && parsedScheduleDate && !scheduleInvalid ? parsedScheduleDate.toISOString() : undefined

  const publish = useMutation({
    mutationFn: () =>
      api<PublicationResponse[]>(`/clips/${clip.id}/publish`, {
        method: "POST",
        body: JSON.stringify({
          ...(scheduledIso ? { scheduledAt: scheduledIso } : {}),
          targets: selectedIds.map((accountId) => {
            const account = available.find((item) => item.id === accountId)!
            if (account.platform === "instagram") {
              return { accountId, title: "", caption: platformCopy.instagram.trim() }
            }
            if (account.platform === "youtube") {
              return {
                accountId,
                title: youtubeTitle.trim(),
                caption: platformCopy.youtube.trim(),
                privacy,
                madeForKids,
              }
            }
            return mode === "inbox"
              ? { accountId, mode: "inbox", title: "", caption: platformCopy.tiktok.trim() }
              : {
                  accountId,
                  mode: "direct",
                  title: "",
                  caption: platformCopy.tiktok.trim(),
                  tiktok: {
                    privacyLevel,
                    disableComment: !allowComment,
                    disableDuet: !allowDuet,
                    disableStitch: !allowStitch,
                    brandContent,
                    brandOrganic,
                  },
                }
          }),
        }),
      }),
    onSuccess: (created) => {
      setSubmitError("")
      setSubmittedIds(created.map((item) => item.id))
      client.setQueryData<PublicationResponse[]>(publicationsKey(clip.id), (previous = []) => [
        ...created,
        ...previous.filter((item) => !created.some((next) => next.id === item.id)),
      ])
      void client.invalidateQueries({ queryKey: publicationsKey(clip.id) })
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      void client.invalidateQueries({ queryKey: ["jobs"] })
      setView("progress")
      toast.success(publishTiming === "schedule" ? t.publishScheduledToast : t.publishStarted)
    },
    onError: (error) => {
      const status = (error as Error & { status?: number }).status
      setSubmitError(status === 409 ? t.publishConflict : status === 400 ? t.publishInvalid : t.publishFailedGeneric)
    },
  })

  const [captionLanguage, setCaptionLanguage] = useState<CaptionLanguage>("auto")
  const regenerate = useMutation({
    mutationFn: (lang: CaptionLanguage) =>
      api<CaptionResponse>(`/clips/${clip.id}/caption`, {
        method: "POST",
        body: JSON.stringify({ language: lang }),
      }),
    onSuccess: (result) => {
      const prevTitle = youtubeTitle
      const prevCopy = { ...platformCopy }
      const baseNext = formatCaption(result.caption, result.hashtags)
      const nextTitle = (result.platformCaptions?.youtube?.title?.trim() || youtubeTitle || clip.title || "").slice(0, TITLE_MAX)
      const nextCopy: Record<SocialPlatform, string> = {
        youtube: composeVariantCaption(result.platformCaptions?.youtube, baseNext),
        tiktok: composeVariantCaption(result.platformCaptions?.tiktok, baseNext),
        instagram: composeVariantCaption(result.platformCaptions?.instagram, baseNext),
      }
      setYoutubeTitle(nextTitle)
      setPlatformCopy(nextCopy)
      void client.invalidateQueries({ queryKey: ["clips"] })
      void client.invalidateQueries({ queryKey: ["jobs"] })
      const changed =
        prevTitle !== nextTitle ||
        prevCopy.youtube !== nextCopy.youtube ||
        prevCopy.tiktok !== nextCopy.tiktok ||
        prevCopy.instagram !== nextCopy.instagram
      if (changed) {
        toast.success(selectedPlatforms.length > 1 ? t.captionRegeneratedAll : t.captionRegenerated, {
          action: {
            label: t.captionUndo,
            onClick: () => {
              setYoutubeTitle(prevTitle)
              setPlatformCopy(prevCopy)
            },
          },
        })
      }
    },
    onError: (error) => toast.error((error as Error & { status?: number }).status === 503 ? t.captionUnavailable : t.captionFailed),
  })

  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || !usable.length) return
    prefilled.current = true
    setSelectedIds([usable[0].id])
    setActivePlatformTab(usable[0].platform)
  }, [usable])

  useEffect(() => {
    setPrivacyLevel("")
    setAllowComment(false)
    setAllowDuet(false)
    setAllowStitch(false)
    setBrandOrganic(false)
    setBrandContent(false)
    setDisclose(false)
  }, [tiktokAccount?.id])

  if (accounts.isPending) {
    return (
      <div role="status" aria-label={t.loading} className="space-y-4 px-5 py-5 sm:px-6">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-28 w-full" />
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

  const history = (publications.data ?? []).filter((item) => !submittedIds.includes(item.id))
  const current = (publications.data ?? []).filter((item) => submittedIds.includes(item.id))

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
        {history.length > 0 && (
          <div className="mt-8 text-left">
            <PublicationList title={t.publishHistory} items={history} clipId={clip.id} />
          </div>
        )}
      </div>
    )
  }

  if (view === "progress") {
    return (
      <div className="space-y-6 px-5 py-5 sm:px-6">
        <PublicationList title={t.publishProgress} items={current} clipId={clip.id} live />
        {publications.isError && <p className="text-sm text-destructive">{t.publishLoadError}</p>}
        {history.length > 0 && <PublicationList title={t.publishHistory} items={history} clipId={clip.id} />}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            className="h-10 px-4"
            onClick={() => {
              setView("form")
              setSubmittedIds([])
            }}
          >
            {t.publishAnother}
          </Button>
          <Button type="button" className="h-10 px-4" onClick={onClose}>
            {t.publishDone}
          </Button>
        </div>
      </div>
    )
  }

  const submitBlocked =
    !selectedIds.length ||
    youtubeHasError ||
    instagramHasError ||
    scheduleInvalid ||
    (selectedTikTok.length > 0 &&
      (tiktokCaptionTooLong ||
        (mode === "direct" &&
          (!privacyLevel ||
            brandedCantPrivate ||
            disclosureInvalid ||
            creatorQuery.isPending ||
            creatorQuery.isError ||
            !creatorQuery.data?.privacyLevelOptions.includes(privacyLevel) ||
            durationTooLong))))

  function handleToggleAccount(account: SocialAccount) {
    const checked = selectedIds.includes(account.id)
    setAccountError("")
    if (checked) {
      setSelectedIds((prev) => prev.filter((id) => id !== account.id))
      return
    }
    setSelectedIds((prev) => [
      ...(account.platform === "tiktok" ? prev.filter((id) => available.find((item) => item.id === id)?.platform !== "tiktok") : prev),
      account.id,
    ])
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedIds.length) {
      setAccountError(t.publishChooseAccount)
      return
    }
    if (selectedYouTube.length > 0) setYoutubeTitleTouched(true)
    if (submitBlocked) {
      const firstErrorPlatform = selectedPlatforms.find((p) => platformHasError[p])
      if (firstErrorPlatform) setActivePlatformTab(firstErrorPlatform)
      return
    }
    setSubmitError("")
    publish.mutate()
  }

  const currentCaptionValue = platformCopy[currentPlatform]
  const currentCaptionMax = currentPlatform === "youtube" ? CAPTION_MAX : currentPlatform === "tiktok" ? TIKTOK_CAPTION_MAX : INSTAGRAM_CAPTION_MAX
  const currentCaptionInvalid =
    currentPlatform === "youtube"
      ? youtubeCaptionTooLong
      : currentPlatform === "tiktok"
        ? tiktokCaptionTooLong
        : instagramCaptionTooLong || tooManyInstagramHashtags

  const schedulePresets = [
    { key: "3h", label: "+3h", date: () => defaultScheduleDate(3) },
    { key: "6h", label: "+6h", date: () => defaultScheduleDate(6) },
    { key: "12h", label: "+12h", date: () => defaultScheduleDate(12) },
    { key: "tmrw19", label: t.schedulePresetTomorrow19, date: () => tomorrowAt19() },
  ]

  const submitLabel =
    publishTiming === "schedule"
      ? t.schedulePublishSubmit
      : selectedTikTok.length && !selectedYouTube.length && !selectedInstagram.length && mode === "inbox"
        ? t.publishSubmitInbox
        : t.publishSubmit

  return (
    <form noValidate onSubmit={handleSubmit}>
      <div className="space-y-6 px-5 py-5 sm:px-6">
        <FieldGroup className="gap-5">
          {/* Account selector */}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t.publishTo}</legend>
            <div className="grid gap-2">
              {available.map((account) => {
                const checked = selectedIds.includes(account.id)
                const disabled = account.needsReconnect
                return (
                  <button
                    key={account.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={disabled}
                    onClick={() => handleToggleAccount(account)}
                    className={cn(
                      "flex min-h-14 w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-background",
                      checked && "border-primary/40 bg-primary/[.04]",
                    )}
                  >
                    <AccountAvatar account={account} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{account.displayName}</span>
                      <span className={cn("block text-xs text-muted-foreground", disabled && "text-amber-700 dark:text-amber-400")}>
                        {disabled ? t.publishNeedsReconnect : t.socialPlatforms[account.platform]}
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
            {accountError && <p className="text-sm text-destructive">{accountError}</p>}
          </fieldset>

          {/* Per-platform copy editor */}
          {selectedPlatforms.length > 0 && (
            <section className="space-y-4 rounded-xl border border-border bg-muted/15 p-3.5 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{selectedPlatforms.length > 1 ? t.platformCopyLabel : t.publishCaptionLabelTikTok}</span>
                  {selectedPlatforms.length === 1 && (
                    <Badge variant="secondary" className="gap-1.5 px-2 py-0.5 text-xs font-medium">
                      <PlatformIcon platform={selectedPlatforms[0]} className="size-3.5" />
                      {t.socialPlatforms[selectedPlatforms[0]]}
                    </Badge>
                  )}
                </div>

                {/* AI Regenerate controls */}
                <div className="relative flex items-center gap-1.5">
                  <Select value={captionLanguage} onValueChange={(value) => { if (isCaptionLanguage(value)) setCaptionLanguage(value) }}>
                    <SelectTrigger aria-label={t.captionLanguage} className="h-8 w-auto min-w-24 gap-1.5 rounded-md bg-background px-2.5 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {CAPTION_LANGUAGES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {t.captionLanguageShort[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-md bg-background px-2.5 text-xs"
                    disabled={regenerate.isPending}
                    onClick={() => regenerate.mutate(captionLanguage)}
                  >
                    {regenerate.isPending ? (
                      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles aria-hidden="true" className="size-3.5" />
                    )}
                    {regenerate.isPending ? t.captionWriting : t.regenerateCaptionAction}
                  </Button>
                </div>
              </div>

              {selectedPlatforms.length > 1 && (
                <ToggleGroup
                  type="single"
                  value={currentPlatform}
                  onValueChange={(value) => {
                    if (value) setActivePlatformTab(value as SocialPlatform)
                  }}
                  aria-label={t.platformCopyTabsLabel}
                  spacing={1}
                  className="grid w-full grid-cols-2 rounded-lg border border-border bg-secondary/50 p-1 sm:flex"
                >
                  {selectedPlatforms.map((platform) => (
                    <ToggleGroupItem
                      key={platform}
                      value={platform}
                      size="sm"
                      className="relative h-8 flex-1 gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs"
                    >
                      <PlatformIcon platform={platform} className="size-3.5 shrink-0" />
                      <span>{t.socialPlatforms[platform]}</span>
                      {platformHasError[platform] && (
                        <span
                          aria-label={t.platformTabHasError}
                          title={t.platformTabHasError}
                          className="size-1.5 shrink-0 rounded-full bg-destructive"
                        />
                      )}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}

              {/* YouTube title field */}
              {currentPlatform === "youtube" && (
                <Field data-invalid={(youtubeTitleTouched && youtubeTitleEmpty) || youtubeTitleTooLong}>
                  <div className="flex items-center gap-2">
                    <FieldLabel htmlFor="publish-title">{t.publishTitleLabel}</FieldLabel>
                    <Counter id="publish-title-count" value={youtubeTitle.length} max={TITLE_MAX} />
                  </div>
                  <Input
                    id="publish-title"
                    name="title"
                    className="h-10 bg-background"
                    value={youtubeTitle}
                    onChange={(event) => setYoutubeTitle(event.target.value)}
                    onBlur={() => setYoutubeTitleTouched(true)}
                    aria-invalid={(youtubeTitleTouched && youtubeTitleEmpty) || youtubeTitleTooLong}
                    aria-required="true"
                    aria-describedby="publish-title-count"
                  />
                  {youtubeTitleTouched && youtubeTitleEmpty && <FieldDescription className="text-destructive">{t.publishTitleRequired}</FieldDescription>}
                  {youtubeTitleTooLong && <FieldDescription className="text-destructive">{t.publishTitleTooLong}</FieldDescription>}
                </Field>
              )}

              {/* Active platform caption/description textarea */}
              <Field data-invalid={currentCaptionInvalid}>
                <div className="flex items-center gap-2">
                  <FieldLabel htmlFor={`publish-caption-${currentPlatform}`}>
                    {currentPlatform === "youtube" ? t.publishCaptionLabel : t.publishCaptionLabelTikTok}
                  </FieldLabel>
                  {currentPlatform === "instagram" && (
                    <>
                      <span
                        id="publish-hashtag-count"
                        aria-live={tooManyInstagramHashtags ? "polite" : "off"}
                        className={cn(
                          "ml-auto font-mono text-[11px] tabular-nums text-muted-foreground",
                          tooManyInstagramHashtags && "font-semibold text-destructive",
                          !tooManyInstagramHashtags && instagramHashtagCount >= Math.floor(INSTAGRAM_HASHTAG_MAX * 0.9) && "text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {instagramHashtagCount.toLocaleString(locale)}/{INSTAGRAM_HASHTAG_MAX.toLocaleString(locale)} #
                      </span>
                      <span aria-hidden="true" className="text-xs text-border">
                        ·
                      </span>
                    </>
                  )}
                  <Counter
                    id={`publish-caption-count-${currentPlatform}`}
                    value={currentCaptionValue.length}
                    max={currentCaptionMax}
                    className={currentPlatform === "instagram" ? "ml-0" : undefined}
                  />
                </div>
                <textarea
                  id={`publish-caption-${currentPlatform}`}
                  name={`caption-${currentPlatform}`}
                  rows={5}
                  value={currentCaptionValue}
                  onChange={(event) => {
                    const nextVal = event.target.value
                    setPlatformCopy((prev) => ({ ...prev, [currentPlatform]: nextVal }))
                  }}
                  aria-invalid={currentCaptionInvalid}
                  aria-busy={regenerate.isPending}
                  aria-describedby={
                    currentPlatform === "instagram"
                      ? `publish-caption-count-${currentPlatform} publish-hashtag-count`
                      : `publish-caption-count-${currentPlatform}`
                  }
                  readOnly={regenerate.isPending}
                  className="field-sizing-content max-h-64 min-h-28 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-6 outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 read-only:opacity-60"
                />
                {currentPlatform === "youtube" && youtubeCaptionTooLong && (
                  <FieldDescription className="text-destructive">{t.publishCaptionTooLong}</FieldDescription>
                )}
                {currentPlatform === "tiktok" && tiktokCaptionTooLong && (
                  <FieldDescription className="text-destructive">{t.publishCaptionTikTokLimit}</FieldDescription>
                )}
                {currentPlatform === "instagram" && instagramCaptionTooLong && (
                  <FieldDescription className="text-destructive">{t.publishCaptionInstagramLimit}</FieldDescription>
                )}
                {currentPlatform === "instagram" && tooManyInstagramHashtags && (
                  <FieldDescription className="text-destructive">{t.publishHashtagsInstagramLimit}</FieldDescription>
                )}
              </Field>
            </section>
          )}

          {/* TikTok settings */}
          {selectedTikTok.length > 0 && (
            <section className="space-y-4 rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <TikTokMark className="size-4" />
                {t.socialPlatforms.tiktok}
              </h3>
              <Field>
                <FieldLabel>{t.tiktokModeLabel}</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["direct", "inbox"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={mode === option}
                      onClick={() => setMode(option)}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors",
                        mode === option ? "border-primary/50 bg-primary/[.05]" : "border-border bg-background hover:bg-muted/50",
                      )}
                    >
                      <span className="block text-sm font-medium">{option === "direct" ? t.tiktokModeDirect : t.tiktokModeInbox}</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {option === "direct" ? t.tiktokModeDirectHint : t.tiktokModeInboxHint}
                      </span>
                    </button>
                  ))}
                </div>
              </Field>
              {mode === "inbox" ? (
                <div className="space-y-3 rounded-lg bg-background p-3">
                  <p className="text-sm leading-5 text-muted-foreground">{t.tiktokInboxNote}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(platformCopy.tiktok)
                        .then(() => toast.success(t.tiktokCaptionCopied))
                        .catch(() => toast.error(t.tiktokCopyFailed))
                    }}
                  >
                    {t.tiktokCopyCaption}
                  </Button>
                </div>
              ) : (
                <>
                  <p className="rounded-lg bg-amber-500/10 px-3 py-2.5 text-xs leading-5 text-amber-900 dark:text-amber-200">{t.tiktokUnauditedNote}</p>
                  {creatorQuery.isPending ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      {t.tiktokCreatorLoading}
                    </p>
                  ) : creatorQuery.isError ? (
                    <Alert variant="destructive">
                      <AlertDescription className="flex items-center justify-between gap-2">
                        <span>{t.tiktokCreatorError}</span>
                        <Button type="button" variant="outline" onClick={() => void creatorQuery.refetch()}>
                          {t.retry}
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    creatorQuery.data && (
                      <>
                        <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                          {creatorQuery.data.avatarUrl ? (
                            <img src={creatorQuery.data.avatarUrl} alt="" className="size-10 rounded-full object-cover" />
                          ) : (
                            <AccountAvatar account={tiktokAccount!} />
                          )}
                          <div>
                            <p className="text-sm font-medium">{creatorQuery.data.nickname}</p>
                            <p className="text-xs text-muted-foreground">@{creatorQuery.data.username}</p>
                          </div>
                        </div>
                        <Field className="relative">
                          <FieldLabel htmlFor="tiktok-privacy">{t.tiktokPrivacyLabel}</FieldLabel>
                          <Select value={privacyLevel} onValueChange={setPrivacyLevel}>
                            <SelectTrigger id="tiktok-privacy" className="h-10 w-full">
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
                          {brandContent && privacyLevel === "SELF_ONLY" && (
                            <FieldDescription className="text-destructive">{t.tiktokBrandedNotPrivate}</FieldDescription>
                          )}
                        </Field>
                        <fieldset className="space-y-2">
                          <legend className="mb-2 text-sm font-medium">{t.tiktokInteractions}</legend>
                          {(
                            [
                              ["comment", allowComment, setAllowComment, creatorQuery.data.commentDisabled, t.tiktokAllowComments],
                              ["duet", allowDuet, setAllowDuet, creatorQuery.data.duetDisabled, t.tiktokAllowDuet],
                              ["stitch", allowStitch, setAllowStitch, creatorQuery.data.stitchDisabled, t.tiktokAllowStitch],
                            ] as const
                          ).map(([key, enabled, setter, disabled, label]) => (
                            <div key={key} className="relative flex items-center justify-between gap-3">
                              <label htmlFor={`tiktok-${key}`} className={cn("text-sm", disabled && "text-muted-foreground")}>
                                {label}
                                {disabled && <span className="ml-2 text-xs">{t.tiktokInteractionOff}</span>}
                              </label>
                              <Switch id={`tiktok-${key}`} checked={enabled} disabled={disabled} onCheckedChange={setter} />
                            </div>
                          ))}
                        </fieldset>
                        <div className="space-y-3 rounded-lg border border-border bg-background p-3">
                          <div className="relative flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">{t.tiktokDisclose}</p>
                              <p className="text-xs text-muted-foreground">{t.tiktokDiscloseHint}</p>
                            </div>
                            <Switch
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
                            <div className="space-y-3 border-t border-border pt-3">
                              <label className="flex items-start gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={brandOrganic}
                                  onChange={(event) => setBrandOrganic(event.target.checked)}
                                  className="mt-1 accent-primary"
                                />
                                <span>
                                  {t.tiktokYourBrand}
                                  <span className="block text-xs text-muted-foreground">{t.tiktokYourBrandHint}</span>
                                </span>
                              </label>
                              <label className="flex items-start gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={brandContent}
                                  onChange={(event) => setBrandContent(event.target.checked)}
                                  className="mt-1 accent-primary"
                                />
                                <span>
                                  {t.tiktokBranded}
                                  <span className="block text-xs text-muted-foreground">{t.tiktokBrandedHint}</span>
                                </span>
                              </label>
                              {disclosureInvalid && <p className="text-xs text-destructive">{t.tiktokDiscloseRequired}</p>}
                            </div>
                          )}
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">
                          {t.tiktokDeclarePrefix}{" "}
                          <a
                            className="underline underline-offset-2"
                            href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t.tiktokMusicUsage}
                          </a>
                          {brandContent && (
                            <>
                              {" "}
                              {t.tiktokAnd}{" "}
                              <a
                                className="underline underline-offset-2"
                                href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                                target="_blank"
                                rel="noreferrer"
                              >
                                {t.tiktokBrandedPolicy}
                              </a>
                            </>
                          )}
                          .
                        </p>
                        <p className="text-xs leading-5 text-muted-foreground">{t.tiktokProcessingNote}</p>
                        {durationTooLong && creatorQuery.data && (
                          <p role="alert" className="text-sm text-destructive">
                            {t.tiktokTooLong
                              .replace("{duration}", formatDuration(duration!))
                              .replace("{max}", formatDuration(creatorQuery.data.maxVideoPostDurationSec))}
                          </p>
                        )}
                      </>
                    )
                  )}
                </>
              )}
            </section>
          )}

          {/* Instagram note */}
          {selectedInstagram.length > 0 && (
            <section className="space-y-2 rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <InstagramMark className="size-4" />
                {t.socialPlatforms.instagram}
              </h3>
              <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">{t.instagramPublicNote}</p>
              <p className="text-xs leading-5 text-muted-foreground">
                {t.instagramCaptionHint.replace("{chars}", INSTAGRAM_CAPTION_MAX.toLocaleString(locale)).replace("{tags}", String(INSTAGRAM_HASHTAG_MAX))}
              </p>
            </section>
          )}

          {/* YouTube visibility & madeForKids */}
          {selectedYouTube.length > 0 && (
            <>
              <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
                <Field className="relative">
                  <FieldLabel htmlFor="publish-privacy">{t.publishPrivacy}</FieldLabel>
                  <Select value={privacy} onValueChange={(value) => setPrivacy(value as Privacy)}>
                    <SelectTrigger id="publish-privacy" className="h-10 w-full" aria-describedby="publish-privacy-hint">
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
                  <FieldDescription id="publish-privacy-hint" className="text-xs">
                    {t.privacyHints[privacy]}
                  </FieldDescription>
                </Field>
                <Field className="relative">
                  <div className="relative flex min-h-5 items-center justify-between gap-3">
                    <FieldLabel htmlFor="publish-kids">{t.publishMadeForKids}</FieldLabel>
                    <Switch id="publish-kids" checked={madeForKids} onCheckedChange={setMadeForKids} aria-describedby="publish-kids-hint" />
                  </div>
                  <FieldDescription id="publish-kids-hint" className="text-xs">
                    {t.publishMadeForKidsHint}
                  </FieldDescription>
                </Field>
              </div>
              <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                <YouTubeMark className="mt-0.5 size-4 shrink-0" />
                {t.publishShortsNote}
              </p>
            </>
          )}

          {/* Publish timing / Schedule controls */}
          <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock aria-hidden="true" className="size-4 text-muted-foreground" />
                <span>{t.publishTiming}</span>
              </div>
              <ToggleGroup
                type="single"
                value={publishTiming}
                onValueChange={(value) => {
                  if (!value) return
                  const next = value as "now" | "schedule"
                  setPublishTiming(next)
                  if (next === "schedule") {
                    const currentDate = scheduledLocal ? new Date(scheduledLocal) : null
                    if (!currentDate || Number.isNaN(currentDate.getTime()) || currentDate.getTime() <= Date.now() + 60_000) {
                      setScheduledLocal(toDatetimeLocalValue(defaultScheduleDate(3)))
                    }
                  }
                }}
                aria-label={t.publishTiming}
                spacing={1}
                className="rounded-lg border border-border bg-secondary/50 p-0.5"
              >
                <ToggleGroupItem
                  value="now"
                  size="sm"
                  className="h-7 rounded-md px-2.5 text-xs font-medium data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs"
                >
                  {t.publishTimingNow}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="schedule"
                  size="sm"
                  className="h-7 gap-1 rounded-md px-2.5 text-xs font-medium data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs"
                >
                  <CalendarClock aria-hidden="true" className="size-3.5" />
                  {t.publishTimingSchedule}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {publishTiming === "schedule" && (
              <div className="space-y-2.5 border-t border-border/70 pt-3">
                <Field data-invalid={scheduleInvalid}>
                  <FieldLabel htmlFor="publish-schedule-at" className="text-xs text-muted-foreground">
                    {t.scheduleDateTimeLabel}
                  </FieldLabel>
                  <Input
                    id="publish-schedule-at"
                    type="datetime-local"
                    min={minLocal}
                    max={maxLocal}
                    value={scheduledLocal}
                    onChange={(event) => setScheduledLocal(event.target.value)}
                    aria-invalid={scheduleInvalid}
                    className="h-10 bg-background font-mono text-sm tabular-nums"
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-1.5">
                  {schedulePresets.map((preset) => (
                    <Button
                      key={preset.key}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full bg-background px-2.5 text-xs font-normal"
                      onClick={() => setScheduledLocal(toDatetimeLocalValue(preset.date()))}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                {scheduleInPast || scheduleInvalidDate ? (
                  <p role="alert" className="text-xs text-destructive">
                    {t.scheduleMustBeFuture}
                  </p>
                ) : scheduleTooFar ? (
                  <p role="alert" className="text-xs text-destructive">
                    {t.scheduleTooFar}
                  </p>
                ) : (
                  parsedScheduleDate && (
                    <p className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300">
                      <CalendarClock aria-hidden="true" className="size-3.5 shrink-0" />
                      <span>{t.scheduleWillPublishAt.replace("{time}", formatScheduledDateTime(parsedScheduleDate, locale))}</span>
                    </p>
                  )
                )}
              </div>
            )}
          </section>

          {submitError && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          {history.length > 0 && <PublicationList title={t.publishHistory} items={history} clipId={clip.id} />}
        </FieldGroup>
      </div>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card px-5 py-3 sm:px-6">
        <Button type="button" variant="ghost" className="h-10 px-4" onClick={onClose}>
          {t.cancelAction}
        </Button>
        <Button type="submit" className="h-10 min-w-36 px-4" disabled={publish.isPending || submitBlocked}>
          {publish.isPending ? (
            <>
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              {t.publishSubmitting}
            </>
          ) : (
            <>
              {publishTiming === "schedule" && <CalendarClock aria-hidden="true" className="size-4" />}
              {submitLabel}
              {selectedIds.length > 1 && <span className="tabular-nums opacity-70">· {selectedIds.length}</span>}
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return mins ? `${mins}m ${secs}s` : `${secs}s`
}

export function AccountAvatar({ account }: { account: SocialAccount }) {
  const [failed, setFailed] = useState(false)
  const Mark = account.platform === "tiktok" ? TikTokMark : account.platform === "instagram" ? InstagramMark : YouTubeMark
  return (
    <span className="relative shrink-0">
      {account.avatarUrl && !failed ? (
        <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="size-9 rounded-full bg-muted object-cover" />
      ) : (
        <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {account.displayName.trim()[0]?.toUpperCase() ?? "?"}
        </span>
      )}
      <span className="absolute -bottom-0.5 -right-1 grid size-4 place-items-center rounded-full bg-card">
        <Mark className="size-3.5" />
      </span>
    </span>
  )
}

function PublicationList({ title, items, clipId, live = false }: { title: string; items: PublicationResponse[]; clipId: string; live?: boolean }) {
  const t = useT()
  const { language } = useLanguage()
  const client = useQueryClient()
  const summary = summarizeClipViews(items)
  const refreshMetrics = useMutation({
    mutationFn: () => refreshClipPublicationMetrics(clipId),
    onSuccess: (result) => {
      client.setQueryData<PublicationResponse[]>(publicationsKey(clipId), result.publications)
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

  return (
    <section aria-label={title}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium uppercase tracking-[.08em] text-muted-foreground">{title}</h3>
          {summary.hasPublished && summary.totalViews !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="h-5 gap-1 px-1.5 font-mono text-[11px] font-medium tabular-nums">
                  <Eye aria-hidden="true" className="size-3 text-muted-foreground" />
                  {formatCompactCount(summary.totalViews)}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top">
                <span>{t.totalViews}:</span>
                <span className="font-mono font-semibold tabular-nums">{formatExactCount(summary.totalViews, language)}</span>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {summary.hasPublished && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            disabled={refreshMetrics.isPending}
            onClick={() => refreshMetrics.mutate()}
          >
            <RefreshCw aria-hidden="true" className={cn("size-3.5", refreshMetrics.isPending && "animate-spin")} />
            {refreshMetrics.isPending ? t.refreshingStats : t.refreshStats}
          </Button>
        )}
      </div>
      {items.length ? (
        <ul aria-live={live ? "polite" : undefined} className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
          {items.map((item) => (
            <PublicationRow key={item.id} item={item} clipId={clipId} />
          ))}
        </ul>
      ) : live ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-1 w-full" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t.publishHistoryEmpty}</p>
      )}
    </section>
  )
}

function PublicationRow({ item, clipId }: { item: PublicationResponse; clipId: string }) {
  const t = useT()
  const { language } = useLanguage()
  const locale = language === "id" ? "id-ID" : "en-US"
  const client = useQueryClient()

  const retry = useMutation({
    mutationFn: () => api<PublicationResponse>(`/publications/${item.id}/retry`, { method: "POST" }),
    onSuccess: (next) => {
      if (next?.id) {
        client.setQueryData<PublicationResponse[]>(publicationsKey(clipId), (previous = []) =>
          previous.map((row) => (row.id === next.id ? next : row)),
        )
      }
      void client.invalidateQueries({ queryKey: publicationsKey(clipId) })
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      void client.invalidateQueries({ queryKey: ["jobs"] })
    },
    onError: () => toast.error(t.retryUploadFailed),
  })

  const cancelScheduled = useMutation({
    mutationFn: () => api<PublicationResponse>(`/publications/${item.id}/cancel`, { method: "POST" }),
    onSuccess: (next) => {
      if (next?.id) {
        client.setQueryData<PublicationResponse[]>(publicationsKey(clipId), (previous = []) =>
          previous.map((row) => (row.id === next.id ? next : row)),
        )
      }
      void client.invalidateQueries({ queryKey: publicationsKey(clipId) })
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      void client.invalidateQueries({ queryKey: ["jobs"] })
      toast.success(t.publishScheduleCancelled)
    },
    onError: () => toast.error(t.publishCancelFailed),
  })

  const progress = Math.max(0, Math.min(100, Math.round(item.progress)))
  const when = item.publishedAt ?? item.updatedAt ?? item.createdAt
  const statusText =
    item.platform === "tiktok" && item.mode === "inbox" && item.status === "published"
      ? t.publishSentToInbox
      : item.status === "processing" && item.platform === "tiktok"
        ? t.publishProcessingTikTok
        : item.status === "processing" && item.platform === "instagram"
          ? t.publishProcessingInstagram
          : t.publishStatus[item.status]
  const privacyLabel =
    item.platform === "tiktok"
      ? (t.tiktokPrivacy[item.privacy as keyof typeof t.tiktokPrivacy] ?? item.privacy)
      : item.platform === "instagram"
        ? t.instagramPrivacyLabel
        : (t.privacyOptions[item.privacy as keyof typeof t.privacyOptions] ?? item.privacy)
  const PlatformMarkIcon = item.platform === "tiktok" ? TikTokMark : item.platform === "instagram" ? InstagramMark : YouTubeMark
  const accountLabel = item.accountName?.trim() || t.socialPlatforms[item.platform]
  const hasMetrics = item.viewCount !== null || item.likeCount !== null || item.commentCount !== null
  const errorHint = item.metricsError ? metricsErrorMessage(item.metricsError, t) : null
  const formattedSchedule = item.scheduledAt ? formatScheduledDateTime(item.scheduledAt, locale) : ""
  const canRetry = (item.status === "failed" || item.status === "cancelled") && item.accountId !== null

  return (
    <li className="px-3 py-3">
      <div className="flex items-center gap-3">
        <StatusIcon status={item.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium">
              <PlatformMarkIcon className="size-3.5 shrink-0" />
              <span className="truncate">{accountLabel}</span>
            </p>
            {item.status === "scheduled" && (
              <Badge
                variant="outline"
                className="h-5 gap-1 border-sky-500/35 bg-sky-500/12 px-2 text-[11px] font-medium text-sky-700 dark:border-sky-400/35 dark:bg-sky-400/15 dark:text-sky-300"
              >
                <Clock aria-hidden="true" className="size-3" />
                {formattedSchedule ? t.scheduledAtLabel.replace("{time}", formattedSchedule) : t.publishStatus.scheduled}
              </Badge>
            )}
            {item.status === "cancelled" && (
              <Badge variant="secondary" className="h-5 px-2 text-[11px] font-medium text-muted-foreground">
                {t.publishStatus.cancelled}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {item.status === "scheduled" ? (
              <>
                {privacyLabel}
                {item.scheduledAt && <> · {relativeAge(item.scheduledAt, locale)}</>}
              </>
            ) : item.status === "cancelled" ? (
              <>
                {privacyLabel} · {relativeAge(when, locale)}
              </>
            ) : (
              <>
                <span className={cn(item.status === "failed" && "text-destructive", item.status === "published" && "text-foreground")}>
                  {statusText}
                  {item.status === "uploading" && <span className="tabular-nums"> · {progress}%</span>}
                </span>{" "}
                · {privacyLabel} · {relativeAge(when, locale)}
              </>
            )}
          </p>
        </div>
        {item.status === "published" && item.externalUrl && (
          <a
            href={item.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            {item.platform === "tiktok" ? t.openOnTikTok : item.platform === "instagram" ? t.openOnInstagram : t.openOnYouTube}
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        )}
        {item.status === "scheduled" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2.5 text-xs text-muted-foreground hover:text-destructive"
            disabled={cancelScheduled.isPending}
            onClick={() => cancelScheduled.mutate()}
          >
            {cancelScheduled.isPending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <X aria-hidden="true" className="size-3.5" />}
            {t.cancelSchedule}
          </Button>
        )}
        {canRetry && (
          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0 px-3"
            disabled={retry.isPending}
            onClick={() => retry.mutate()}
          >
            {retry.isPending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <RotateCcw aria-hidden="true" className="size-3.5" />}
            {t.retryUpload}
          </Button>
        )}
      </div>

      {item.status === "published" && hasMetrics && (
        <div className="mt-2 ml-11 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {item.viewCount !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex items-center gap-1 font-mono font-medium tabular-nums text-foreground">
                  <Eye aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  {formatCompactCount(item.viewCount)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <span className="font-mono tabular-nums">{formatExactCount(item.viewCount, language)}</span>
                <span>{t.views}</span>
              </TooltipContent>
            </Tooltip>
          )}
          {item.likeCount !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex items-center gap-1 font-mono tabular-nums">
                  <Heart aria-hidden="true" className="size-3.5" />
                  {formatCompactCount(item.likeCount)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <span className="font-mono tabular-nums">{formatExactCount(item.likeCount, language)}</span>
                <span>{t.likes}</span>
              </TooltipContent>
            </Tooltip>
          )}
          {item.commentCount !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex items-center gap-1 font-mono tabular-nums">
                  <MessageCircle aria-hidden="true" className="size-3.5" />
                  {formatCompactCount(item.commentCount)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <span className="font-mono tabular-nums">{formatExactCount(item.commentCount, language)}</span>
                <span>{t.comments}</span>
              </TooltipContent>
            </Tooltip>
          )}
          {item.metricsUpdatedAt && (
            <>
              <Separator orientation="vertical" className="h-3" />
              <span className="text-[11px] text-muted-foreground/80">{t.statsUpdatedAgo.replace("{age}", relativeAge(item.metricsUpdatedAt, locale))}</span>
            </>
          )}
          {item.metricsError === "account_disconnected" && item.viewCount !== null && errorHint && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={errorHint}
                  className="size-5 text-muted-foreground/80 hover:text-foreground"
                >
                  <Info aria-hidden="true" className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" align="end">
                {errorHint}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
      {item.status === "published" && item.viewCount === null && errorHint && (
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="mt-2 ml-11 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/80" />
              <span className="truncate">{errorHint}</span>
            </p>
          </TooltipTrigger>
          <TooltipContent side="top" align="start">
            {errorHint}
          </TooltipContent>
        </Tooltip>
      )}
      {item.status === "uploading" && <Progress value={progress} aria-label={`${t.publishStatus.uploading} ${progress}%`} className="mt-2.5 h-1.5" />}
      {(item.status === "queued" || item.status === "processing") && (
        <div aria-hidden="true" className="publish-indeterminate mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <span className="block h-full w-1/3 rounded-full bg-primary/60" />
        </div>
      )}
      {item.status === "failed" && item.error && (
        <p className="mt-2 rounded-md bg-destructive/5 px-2.5 py-2 text-xs leading-5 text-destructive">{item.error}</p>
      )}
    </li>
  )
}

function StatusIcon({ status }: { status: PublicationStatus }) {
  if (status === "published") {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
        <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
      </span>
    )
  }
  if (status === "scheduled") {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sky-500/12 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400">
        <Clock aria-hidden="true" className="size-4" />
      </span>
    )
  }
  if (status === "cancelled") {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <Ban aria-hidden="true" className="size-4" />
      </span>
    )
  }
  if (status === "failed") {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert aria-hidden="true" className="size-4" />
      </span>
    )
  }
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
    </span>
  )
}
