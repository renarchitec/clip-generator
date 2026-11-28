import { ArrowDownToLine, Check, ChevronDown, ChevronUp, CircleCheck, Clock, Copy, ExternalLink, Eye, Flame, Heart, Info, LoaderCircle, Lock, MessageCircle, MoreVertical, Play, RefreshCw, Send, Trash2, Volume2, VolumeX, X } from "lucide-react"
import { Link } from "@tanstack/react-router"
import { Children, createContext, isValidElement, useContext, useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { api, trackUserEvent, type PlatformCaptions } from "@/lib/api"
import { useWorkspaceUser } from "@/lib/demo-context"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useIsMobile } from "@/hooks/use-mobile"
import { formatScheduledDateTime, sourceLabel } from "@/lib/format"
import { formatCompactCount, formatExactCount, summarizeClipViews } from "@/lib/format-views"
import { useLanguage, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { isUploadingPublication, metricsErrorMessage, publicationsKey, PublishDialog, refreshClipPublicationMetrics, type ClipPublication, type PublicationResponse } from "@/components/publish-dialog"
import { InstagramMark, TikTokMark, YouTubeMark, type SocialPlatform } from "@/components/social-accounts"

export type ClipCardData = { id: string; title: string; startSec: number; endSec: number; downloadedAt?: string | null; caption?: string | null; hashtags?: string[]; platformCaptions?: PlatformCaptions | null; viralScore?: number | null; hookText?: string | null; publications?: ClipPublication[]; job: { id: string; url: string; aspectRatio: "9:16" | "1:1" | "16:9" } }

export type ClipFeedItem = { clip: ClipCardData; meta: string; index?: number }

/** Ordered sibling clips, supplied automatically by grids and carousels. */
export const ClipFeedContext = createContext<ClipFeedItem[]>([])

export function ClipFeedProvider({ items, children }: { items: ClipFeedItem[]; children: React.ReactNode }) {
  return <ClipFeedContext.Provider value={items}>{children}</ClipFeedContext.Provider>
}

function feedItemsFromChildren(children: React.ReactNode): ClipFeedItem[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ clip?: ClipCardData; meta?: string; index?: number }>(child)) return []
    const clip = child.props?.clip
    if (!clip?.id) return []
    return [{ clip, meta: typeof child.props?.meta === "string" ? child.props.meta : "", index: typeof child.props?.index === "number" ? child.props.index : undefined }]
  })
}

function shortDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return minutes ? (rest ? `${minutes}m ${rest}s` : `${minutes}m`) : `${rest}s`
}

function formatTimecode(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`
}

function formatCaption(caption: string | null | undefined, hashtags: string[] | undefined) {
  const tags = (hashtags ?? []).map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean).map((tag) => `#${tag}`).join(" ")
  return [caption?.trim(), tags].filter(Boolean).join("\n\n")
}

export function clipAspectClass(aspectRatio: ClipCardData["job"]["aspectRatio"]) {
  return aspectRatio === "9:16" ? "aspect-[9/16]" : aspectRatio === "1:1" ? "aspect-square" : "aspect-video"
}

export function ClipCardGrid({ aspectRatio, children, className = "", ...props }: { aspectRatio: ClipCardData["job"]["aspectRatio"]; children: React.ReactNode; className?: string; "aria-label"?: string }) {
  const columns = aspectRatio === "16:9"
    ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
    : aspectRatio === "1:1"
      ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7"
      : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8"
  return <ClipFeedProvider items={feedItemsFromChildren(children)}><div {...props} className={`grid items-start ${columns} gap-x-3 gap-y-5 sm:gap-4 ${className}`}>{children}</div></ClipFeedProvider>
}

export function ClipCard({ clip, meta, downloaded = false, index, frame }: { clip: ClipCardData; meta: string; downloaded?: boolean; index?: number; /** Force one media frame (e.g. mixed-ratio library) */ frame?: "uniform" }) {
  const t = useT()
  const { isDemo } = useWorkspaceUser()
  const isMobile = useIsMobile()
  const { language } = useLanguage()
  const [playerOpen, setPlayerOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const handlePublishClick = (source: string) => {
    if (isDemo) {
      trackUserEvent("locked_feature_clicked", { feature: "publish", source })
      toast.info(t.demoPublishLocked)
      return
    }
    setPublishOpen(true)
  }
  const client = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api(`/clips/${clip.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmOpen(false)
      setPlayerOpen(false)
      setActionsOpen(false)
      void client.invalidateQueries({ queryKey: ["jobs"] })
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      toast.success(t.clipDeleted)
    },
    onError: () => toast.error(t.clipDeleteFailed),
  })
  const title = clip.title || `${t.clip} ${index === undefined ? "" : index + 1}`.trim()
  const duration = Math.max(0, clip.endSec - clip.startSec)
  const viewsSummary = summarizeClipViews(clip.publications)
  const isDownloaded = Boolean(downloaded || clip.downloadedAt)
  const hookText = clip.hookText?.trim() ?? ""
  const showHookText = Boolean(hookText && hookText.toLowerCase() !== title.trim().toLowerCase())

  return <article className={`clip-card group relative isolate min-w-0 overflow-hidden rounded-lg border border-border bg-card ${frame === "uniform" ? "aspect-[9/16]" : clipAspectClass(clip.job.aspectRatio)}`}>
    <video src={`/api/clips/${clip.id}/stream`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" className="absolute inset-0 size-full bg-black object-contain"/>
    <button type="button" onClick={() => setPlayerOpen(true)} aria-label={`${t.playClip}: ${title}`} className="absolute inset-0 z-[1] grid size-full place-items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <span className="clip-card-play grid size-11 place-items-center rounded-full border border-accent/60 bg-background/75 text-primary shadow-lg backdrop-blur-sm transition duration-150 group-hover:scale-105 group-hover:ring-4 group-hover:ring-accent/20"><Play className="ml-0.5 size-[18px] fill-current"/></span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-16 text-left text-white"><span className="line-clamp-2 block min-h-10 text-xs font-semibold leading-5 sm:text-sm">{title}</span><span className="mt-1 line-clamp-2 block text-[10px] leading-4 text-white/80 sm:text-xs">{meta}</span></span>
    </button>
    <div className="pointer-events-none absolute left-2 right-12 top-2 z-[2] flex flex-col items-start gap-1.5 sm:right-2">
      <span className="flex flex-wrap items-center gap-1">
        <span className="rounded-full border border-accent/40 bg-accent/90 px-2 py-1 font-mono text-[10px] font-semibold tabular-nums text-accent-foreground shadow-sm">{shortDuration(duration)}</span>
        {typeof clip.viralScore === "number" && <ViralScorePill score={clip.viralScore} />}
        <PublishBadge publications={clip.publications}/>
        {isDownloaded && (
          <span title={t.downloaded} className="inline-flex h-[22px] items-center justify-center rounded-full border border-accent/40 bg-background/85 px-1.5 text-primary shadow-sm sm:hidden">
            <CircleCheck aria-hidden="true" className="size-3.5"/>
            <span className="sr-only">{t.downloaded}</span>
          </span>
        )}
      </span>
      {viewsSummary.totalViews !== null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                if (isMobile) setActionsOpen(true)
                else setPlayerOpen(true)
              }}
              aria-label={`${t.totalViews}: ${formatExactCount(viewsSummary.totalViews, language)}`}
              className="pointer-events-auto inline-flex h-[22px] items-center gap-1 rounded-full border border-white/15 bg-black/60 px-2 font-mono text-[10px] font-semibold tabular-nums text-white shadow-sm backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Eye aria-hidden="true" className="size-3 text-white/85"/>
              {formatCompactCount(viewsSummary.totalViews)}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="flex-col items-stretch gap-1.5 p-2.5">
            <div className="flex items-center justify-between gap-4 border-b border-background/15 pb-1.5">
              <span className="text-[11px] font-medium opacity-80">{t.totalViews}</span>
              <span className="font-mono text-xs font-semibold tabular-nums">{formatExactCount(viewsSummary.totalViews, language)}</span>
            </div>
            <div className="space-y-1">
              {viewsSummary.byPlatform.map((entry) => (
                <div key={entry.platform} className="flex items-center justify-between gap-4 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <PlatformMark platform={entry.platform} className="size-3.5 shrink-0 [&_.fill-foreground]:fill-background"/>
                    <span>{t.socialPlatforms[entry.platform]}</span>
                  </span>
                  <span className="font-mono tabular-nums opacity-90">
                    {entry.viewCount !== null ? formatExactCount(entry.viewCount, language) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
    {isDownloaded && <span title={t.downloaded} className="absolute right-2 top-2 z-[2] hidden size-7 items-center justify-center rounded-full border border-accent/40 bg-background/85 text-primary shadow-sm transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0 sm:inline-flex"><CircleCheck aria-hidden="true" className="size-4"/><span className="sr-only">{t.downloaded}</span></span>}
    {/* Mobile crisp MoreVertical trigger -> Clip Actions & Details Drawer */}
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        setActionsOpen(true)
      }}
      aria-label={`${t.moreActions}: ${title}`}
      className="absolute right-1.5 top-1.5 z-[3] grid size-9 place-items-center rounded-full border border-white/20 bg-black/60 text-white shadow-md backdrop-blur-sm transition-colors active:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:hidden"
    >
      <MoreVertical aria-hidden="true" className="size-4"/>
    </button>
    {/* Desktop hover 3-icon bar */}
    <div className="clip-card-actions absolute right-2 top-2 z-[3] hidden -translate-y-1 items-center gap-1 rounded-md border border-white/20 bg-black/65 p-0.5 text-white opacity-0 shadow-lg backdrop-blur-sm transition duration-150 focus-within:translate-y-0 focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 sm:flex">
      <a href={`/api/clips/${clip.id}/download`} download aria-label={`${t.download}: ${title}`} title={t.download} className="grid size-7 shrink-0 place-items-center rounded-md text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><ArrowDownToLine className="size-3.5"/></a>
      <button type="button" onClick={() => handlePublishClick("clip_card_hover")} aria-label={`${t.publish}: ${title}`} title={isDemo ? t.demoLockedBadge : t.publish} className="grid size-7 shrink-0 place-items-center rounded-md text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{isDemo ? <Lock className="size-3.5"/> : <Send className="size-3.5"/>}</button>
      <button type="button" onClick={() => setConfirmOpen(true)} disabled={remove.isPending} aria-label={`${t.deleteClip}: ${title}`} title={t.deleteClip} className="grid size-7 shrink-0 place-items-center rounded-md text-white transition-colors hover:bg-destructive/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:opacity-50"><Trash2 className="size-3.5"/></button>
    </div>

    {/* Mobile Clip Actions & Details Drawer */}
    <Drawer open={actionsOpen} onOpenChange={setActionsOpen}>
      <DrawerContent className="flex max-h-[88dvh] flex-col overflow-hidden pb-0">
        <DrawerHeader className="shrink-0 border-b border-border px-4 py-3.5 text-left">
          <DrawerTitle className="line-clamp-2 font-display text-base font-semibold leading-snug">{title}</DrawerTitle>
          <DrawerDescription asChild>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="secondary" className="h-5 font-mono text-[11px] font-medium tabular-nums">
                {shortDuration(duration)}
              </Badge>
              {typeof clip.viralScore === "number" && <ViralScorePill score={clip.viralScore} surface="card" />}
              {isDownloaded && (
                <Badge variant="outline" className="h-5 gap-1 text-[11px]">
                  <CircleCheck aria-hidden="true" className="size-3 text-accent"/>
                  {t.downloaded}
                </Badge>
              )}
              {meta && <span className="truncate">{meta}</span>}
            </div>
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {showHookText && (
            <div className="rounded-lg border border-border bg-muted/35 px-3 py-2.5 text-xs">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t.hookLabel}</span>
              <p className="mt-1 italic leading-5 text-foreground">“{hookText}”</p>
            </div>
          )}

          {viewsSummary.hasPublished && (
            <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-[.06em] text-muted-foreground">{t.viewStats}</span>
                {viewsSummary.totalViews !== null && (
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums text-foreground">
                    <Eye aria-hidden="true" className="size-3.5 text-muted-foreground"/>
                    {formatExactCount(viewsSummary.totalViews, language)}
                  </span>
                )}
              </div>
              <div className="divide-y divide-border/70">
                {viewsSummary.byPlatform.map((entry) => (
                  <div key={entry.platform} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-1 last:pb-0 text-xs">
                    <span className="flex items-center gap-2 font-medium text-foreground">
                      <PlatformMark platform={entry.platform} className="size-4 shrink-0"/>
                      {t.socialPlatforms[entry.platform]}
                    </span>
                    {entry.viewCount !== null ? (
                      <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-muted-foreground">
                        <span className="inline-flex items-center gap-1 text-foreground">
                          <Eye aria-hidden="true" className="size-3 text-muted-foreground"/>
                          {formatExactCount(entry.viewCount, language)}
                        </span>
                        {entry.likeCount !== null && (
                          <span className="inline-flex items-center gap-1">
                            <Heart aria-hidden="true" className="size-3"/>
                            {formatExactCount(entry.likeCount, language)}
                          </span>
                        )}
                        {entry.commentCount !== null && (
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle aria-hidden="true" className="size-3"/>
                            {formatExactCount(entry.commentCount, language)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{entry.metricsError ? metricsErrorMessage(entry.metricsError, t) : t.statsPending}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="default"
              className="min-h-11 w-full justify-start gap-3 px-4 text-sm"
              onClick={() => {
                setActionsOpen(false)
                setPlayerOpen(true)
              }}
            >
              <Play aria-hidden="true" className="size-4 fill-current"/>
              {t.playClip}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full justify-start gap-3 px-4 text-sm"
              onClick={() => {
                setActionsOpen(false)
                handlePublishClick("clip_drawer")
              }}
            >
              {isDemo ? <Lock aria-hidden="true" className="size-4"/> : <Send aria-hidden="true" className="size-4"/>}
              {t.publish}
              {isDemo && <Badge variant="outline" className="ml-auto font-mono text-[10px]">{t.demoLockedBadge}</Badge>}
            </Button>
            <Button asChild variant="outline" className="min-h-11 w-full justify-start gap-3 px-4 text-sm">
              <a href={`/api/clips/${clip.id}/download`} download onClick={() => setActionsOpen(false)}>
                <ArrowDownToLine aria-hidden="true" className="size-4"/>
                {t.download}
              </a>
            </Button>
            <Button asChild variant="outline" className="min-h-11 w-full justify-start gap-3 px-4 text-sm">
              <Link to="/jobs/$jobId" params={{ jobId: clip.job.id }} onClick={() => setActionsOpen(false)}>
                <ExternalLink aria-hidden="true" className="size-4"/>
                {t.openJob}
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={remove.isPending}
              className="min-h-11 w-full justify-start gap-3 px-4 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setActionsOpen(false)
                setConfirmOpen(true)
              }}
            >
              <Trash2 aria-hidden="true" className="size-4"/>
              {t.deleteClip}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>

    <ClipPlayerDialog clip={clip} open={playerOpen} onOpenChange={setPlayerOpen} meta={meta}/>
    <PublishDialog clip={clip} open={publishOpen} onOpenChange={setPublishOpen}/>
    <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!remove.isPending) setConfirmOpen(open) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t.deleteClipTitle}</AlertDialogTitle><AlertDialogDescription>{t.deleteClipDescription}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={remove.isPending} onClick={(event) => { event.preventDefault(); remove.mutate() }}>{remove.isPending && <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin"/>}{t.confirmDelete}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </article>
}

export function ClipPlayerDialog({ clip, onOpenChange, open, meta, onDelete, onPublish }: { clip: ClipCardData | null; open: boolean; onOpenChange: (open: boolean) => void; meta?: string; onDelete?: () => void; onPublish?: () => void }) {
  const t = useT()
  const { isDemo } = useWorkspaceUser()
  const isMobile = useIsMobile()
  const { language } = useLanguage()
  const client = useQueryClient()
  const feed = useContext(ClipFeedContext)
  const [activeClipId, setActiveClipId] = useState(clip?.id ?? "")
  const [muted, setMuted] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [mediaDuration, setMediaDuration] = useState(0)
  const [bufferedTime, setBufferedTime] = useState(0)
  const [captionExpanded, setCaptionExpanded] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [publishClip, setPublishClip] = useState<ClipCardData | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const touchStartY = useRef<number | null>(null)
  const suppressClick = useRef(false)

  const activeIndex = feed.findIndex((item) => item.clip.id === activeClipId)
  const activeItem = activeIndex >= 0 ? feed[activeIndex] : null
  const activeClip = activeItem?.clip ?? clip
  const activeMeta = activeItem?.meta ?? meta
  const fallbackDuration = activeClip ? Math.max(0, activeClip.endSec - activeClip.startSec) : 0
  const seekDuration = mediaDuration || fallbackDuration || 1
  const playedPercent = Math.min(100, (currentTime / seekDuration) * 100)
  const bufferedPercent = Math.min(100, (bufferedTime / seekDuration) * 100)
  const trackFill = Math.max(playedPercent, bufferedPercent)
  const canNavigate = feed.length > 1
  const position = activeIndex >= 0 ? activeIndex + 1 : undefined
  const title = activeClip?.title || t.clip
  const timeRange = activeClip ? `${formatTimecode(activeClip.startSec)}–${formatTimecode(activeClip.endSec)}` : ""
  const metaLabel = activeMeta && activeMeta !== timeRange ? activeMeta : activeClip ? sourceLabel(activeClip.job.url) : ""
  const showTimeRange = Boolean(timeRange && !metaLabel.includes(timeRange))
  const captionText = activeClip?.caption?.trim() ?? ""
  const hookText = activeClip?.hookText?.trim() ?? ""
  const showHookText = Boolean(hookText && hookText.toLowerCase() !== title.trim().toLowerCase())
  const tags = (activeClip?.hashtags ?? []).map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean)
  const hasCaption = Boolean(captionText || tags.length)
  const canExpandCaption = captionText.length + tags.join(" ").length > 75 || captionText.includes("\n")

  const cachedPublications = useQuery({
    queryKey: publicationsKey(activeClip?.id ?? ""),
    queryFn: () => api<PublicationResponse[]>(`/clips/${activeClip!.id}/publications`),
    enabled: false,
  })
  const activePublications = cachedPublications.data ?? activeClip?.publications
  const viewsSummary = summarizeClipViews(activePublications)

  const refreshMetrics = useMutation({
    mutationFn: (id: string) => refreshClipPublicationMetrics(id),
    onSuccess: (result, id) => {
      client.setQueryData<PublicationResponse[]>(publicationsKey(id), result.publications)
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      void client.invalidateQueries({ queryKey: ["jobs"] })
      void client.invalidateQueries({ queryKey: publicationsKey(id) })
      if (result.refreshed > 0) {
        toast.success(result.refreshed === 1 ? t.statsRefreshedOne : t.statsRefreshed.replace("{count}", String(result.refreshed)))
      } else {
        toast.info(t.statsUpToDate)
      }
    },
    onError: () => toast.error(t.statsRefreshFailed),
  })

  function playWithFallback(video: HTMLVideoElement) {
    video.muted = muted
    void video.play().then(() => setPlaying(true)).catch(() => {
      if (!video.muted) {
        video.muted = true
        setMuted(true)
        void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
      } else {
        setPlaying(false)
      }
    })
  }

  useEffect(() => {
    if (open && clip?.id) setActiveClipId(clip.id)
  }, [open, clip?.id])

  useEffect(() => {
    if (!open) {
      setDetailsOpen(false)
      return
    }
    if (!activeClip) return
    setCurrentTime(0)
    setBufferedTime(0)
    setMediaDuration(0)
    setCaptionExpanded(false)
    setDetailsOpen(false)
    setCopied(false)
    setPlaying(true)
    const video = videoRef.current
    if (video) {
      video.currentTime = 0
      playWithFallback(video)
    }
  }, [open, activeClipId])

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted, activeClipId, open])

  const remove = useMutation({
    mutationFn: (id: string) => api(`/clips/${id}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      setDeleteOpen(false)
      void client.invalidateQueries({ queryKey: ["jobs"] })
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      void client.invalidateQueries({ queryKey: ["clips"] })
      toast.success(t.clipDeleted)
      const deletedIndex = feed.findIndex((item) => item.clip.id === id)
      const next = deletedIndex >= 0 && deletedIndex < feed.length - 1 ? feed[deletedIndex + 1] : deletedIndex > 0 ? feed[deletedIndex - 1] : null
      if (next) setActiveClipId(next.clip.id)
      else onOpenChange(false)
    },
    onError: () => toast.error(t.clipDeleteFailed),
  })

  function goTo(index: number) {
    if (!canNavigate || index < 0 || index >= feed.length) return
    setActiveClipId(feed[index].clip.id)
  }

  function goPrevious() { goTo(activeIndex >= 0 ? activeIndex - 1 : -1) }
  function goNext() { goTo(activeIndex >= 0 ? activeIndex + 1 : -1) }

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    else { video.pause(); setPlaying(false) }
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    if (videoRef.current) videoRef.current.muted = next
  }

  function seek(value: number) {
    const video = videoRef.current
    if (!video) return
    const bounded = Math.max(0, Math.min(value, seekDuration))
    video.currentTime = bounded
    setCurrentTime(bounded)
  }

  function syncBuffered(video: HTMLVideoElement) {
    if (video.buffered.length) setBufferedTime(video.buffered.end(video.buffered.length - 1))
  }

  function copyCaption() {
    if (!activeClip) return
    const text = formatCaption(activeClip.caption, activeClip.hashtags) || title
    if (!navigator.clipboard?.writeText) { toast.error(t.tiktokCopyFailed); return }
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      toast.success(t.tiktokCaptionCopied)
      window.setTimeout(() => setCopied(false), 1800)
    }).catch(() => toast.error(t.tiktokCopyFailed))
  }

  function openPublish() {
    if (!activeClip) return
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause()
      setPlaying(false)
    }
    if (onPublish && !canNavigate && activeClip.id === clip?.id) { onOpenChange(false); onPublish(); return }
    if (isDemo) {
      trackUserEvent("locked_feature_clicked", { feature: "publish", source: "clip_player" })
      toast.info(t.demoPublishLocked)
      return
    }
    setPublishClip(activeClip)
  }

  function openDelete() {
    if (!activeClip) return
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause()
      setPlaying(false)
    }
    if (onDelete && !canNavigate && activeClip.id === clip?.id) { onDelete(); return }
    setDeleteOpen(true)
  }

  function isTextTarget(target: EventTarget | null) {
    const element = target as HTMLElement | null
    return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"))
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null
    const typing = isTextTarget(target)
    if (event.key === "ArrowUp" && !typing) { event.preventDefault(); goPrevious(); return }
    if (event.key === "ArrowDown" && !typing) { event.preventDefault(); goNext(); return }
    if (event.key === " " && !typing && !target?.closest("button, a")) { event.preventDefault(); togglePlay(); return }
    if ((event.key === "m" || event.key === "M") && !typing) { event.preventDefault(); toggleMute() }
  }

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    touchStartY.current = event.touches[0]?.clientY ?? null
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const start = touchStartY.current
    touchStartY.current = null
    const end = event.changedTouches[0]?.clientY
    if (start == null || end == null) return
    const delta = end - start
    if (Math.abs(delta) <= 45) return
    suppressClick.current = true
    if (delta > 0) goPrevious()
    else goNext()
  }

  function handleStageClick() {
    if (suppressClick.current) { suppressClick.current = false; return }
    togglePlay()
  }

  if (!activeClip) return null

  return <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-0 left-0 top-0 h-dvh w-screen max-h-none max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white shadow-2xl outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[calc(100dvh-1.5rem)] sm:w-auto sm:max-w-[calc(100vw-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:border-white/15 sm:p-0" onKeyDown={handleKeyDown}>
        <div className="relative size-full overflow-hidden bg-black sm:aspect-[9/16] sm:h-[min(88dvh,764px,167vw)] sm:max-h-[min(88dvh,820px)] sm:w-auto sm:max-w-[min(94vw,430px)] sm:rounded-2xl">
          <div
            role="button"
            tabIndex={-1}
            aria-label={playing ? t.pauseClip : t.playClip}
            onClick={handleStageClick}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={() => { touchStartY.current = null }}
            className="absolute inset-0 z-0 cursor-pointer bg-black focus-visible:outline-none"
          >
            <video
              key={activeClip.id}
              ref={videoRef}
              src={`/api/clips/${activeClip.id}/stream`}
              autoPlay
              loop
              playsInline
              muted={muted}
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget
                if (Number.isFinite(video.duration)) setMediaDuration(video.duration)
                playWithFallback(video)
              }}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onProgress={(event) => syncBuffered(event.currentTarget)}
              className="size-full bg-black object-contain"
            />
            {!playing && <span className="pointer-events-none absolute inset-0 grid place-items-center"><span className="grid size-16 place-items-center rounded-full border border-white/20 bg-black/55 shadow-xl backdrop-blur-md"><Play className="ml-1 size-7 fill-current"/></span></span>}
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/80 via-black/35 to-transparent pb-12 pl-3 pr-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex h-6 items-center rounded-full border border-white/15 bg-black/55 px-2 font-mono text-[10px] font-semibold tabular-nums text-white backdrop-blur-sm">{shortDuration(fallbackDuration)}</span>
                  {canNavigate && position !== undefined && <Badge variant="outline" className="h-6 border-white/15 bg-black/55 px-2 font-mono text-[10px] tabular-nums text-white backdrop-blur-sm">{position} / {feed.length}</Badge>}
                  <PublishBadge publications={activePublications}/>
                </div>
                {viewsSummary.hasPublished && (
                  <div
                    onClick={(event) => event.stopPropagation()}
                    className="pointer-events-auto mt-1.5 flex flex-wrap items-center gap-1.5"
                  >
                    {viewsSummary.totalViews !== null && viewsSummary.byPlatform.length > 1 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => {
                              if (isMobile) setDetailsOpen(true)
                            }}
                            aria-label={`${t.totalViews}: ${formatExactCount(viewsSummary.totalViews, language)}`}
                            className="inline-flex h-7 items-center gap-1 rounded-full border border-white/15 bg-black/55 px-2.5 font-mono text-[10px] font-semibold tabular-nums text-white backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:h-6 sm:px-2"
                          >
                            <Eye aria-hidden="true" className="size-3"/>
                            {formatCompactCount(viewsSummary.totalViews)}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="start">
                          <span>{t.totalViews}:</span>
                          <span className="font-mono font-semibold tabular-nums">{formatExactCount(viewsSummary.totalViews, language)}</span>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {viewsSummary.byPlatform.map((entry) => (
                      <Tooltip key={entry.platform}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => {
                              if (isMobile) setDetailsOpen(true)
                            }}
                            aria-label={`${t.socialPlatforms[entry.platform]} ${t.views}: ${entry.viewCount !== null ? formatExactCount(entry.viewCount, language) : t.statsPending}`}
                            className="inline-flex h-7 items-center gap-1 rounded-full border border-white/15 bg-black/55 px-2.5 font-mono text-[10px] font-medium tabular-nums text-white/95 backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:h-6 sm:px-2"
                          >
                            <PlatformMark platform={entry.platform} className="size-3.5 shrink-0 [&_.fill-foreground]:fill-white"/>
                            {entry.viewCount !== null ? <span>{formatCompactCount(entry.viewCount)}</span> : <span className="text-white/55">—</span>}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="start" className="flex-col items-start gap-1 p-2">
                          <span className="font-medium">{t.socialPlatforms[entry.platform]}</span>
                          {entry.viewCount !== null ? (
                            <div className="flex flex-wrap items-center gap-2.5 font-mono text-[11px] tabular-nums opacity-90">
                              <span className="inline-flex items-center gap-1"><Eye aria-hidden="true" className="size-3"/>{formatExactCount(entry.viewCount, language)}</span>
                              {entry.likeCount !== null && <span className="inline-flex items-center gap-1"><Heart aria-hidden="true" className="size-3"/>{formatExactCount(entry.likeCount, language)}</span>}
                              {entry.commentCount !== null && <span className="inline-flex items-center gap-1"><MessageCircle aria-hidden="true" className="size-3"/>{formatExactCount(entry.commentCount, language)}</span>}
                            </div>
                          ) : (
                            <span className="text-[11px] opacity-80">{entry.metricsError ? metricsErrorMessage(entry.metricsError, t) : t.statsPending}</span>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={refreshMetrics.isPending}
                          onClick={(event) => {
                            event.stopPropagation()
                            refreshMetrics.mutate(activeClip.id)
                          }}
                          aria-label={refreshMetrics.isPending ? t.refreshingStats : t.refreshStats}
                          className="size-8 rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-md hover:bg-black/75 hover:text-white focus-visible:ring-white/70 sm:size-6"
                        >
                          <RefreshCw aria-hidden="true" className={cn("size-3.5 sm:size-3", refreshMetrics.isPending && "animate-spin")}/>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {refreshMetrics.isPending ? t.refreshingStats : t.refreshStats}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
              <div className="pointer-events-auto flex shrink-0 items-center gap-1.5 sm:gap-1">
                <Button type="button" variant="ghost" size="icon-sm" onClick={toggleMute} aria-label={muted ? t.unmuteClip : t.muteClip} title={muted ? t.unmuteClip : t.muteClip} className="size-10 rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-md hover:bg-black/75 hover:text-white focus-visible:ring-white/70 sm:size-9">{muted ? <VolumeX className="size-4"/> : <Volume2 className="size-4"/>}</Button>
                <DialogClose asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={t.closePlayer} title={t.closePlayer} className="size-10 rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-md hover:bg-black/75 hover:text-white focus-visible:ring-white/70 sm:size-9"><X className="size-4"/></Button></DialogClose>
              </div>
            </div>
          </div>

          {canNavigate && <div className="absolute left-2 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1.5">
            <Button type="button" variant="ghost" size="icon-sm" onClick={goPrevious} disabled={activeIndex <= 0} aria-label={t.previousClip} title={t.previousClip} className="size-9 rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-md hover:bg-black/75 hover:text-white focus-visible:ring-white/70 disabled:opacity-35"><ChevronUp className="size-4"/></Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={goNext} disabled={activeIndex >= feed.length - 1} aria-label={t.nextClip} title={t.nextClip} className="size-9 rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-md hover:bg-black/75 hover:text-white focus-visible:ring-white/70 disabled:opacity-35"><ChevronDown className="size-4"/></Button>
          </div>}

          <div className="absolute bottom-[calc(4rem+env(safe-area-inset-bottom))] right-2 z-30 flex w-14 flex-col items-center gap-2 sm:bottom-16 sm:gap-3">
            <button type="button" onClick={openPublish} aria-label={`${t.publish}: ${title}`} title={isDemo ? t.demoLockedBadge : t.publish} className="group/rail flex w-full flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
              <span className={`grid size-11 place-items-center rounded-full border shadow-lg backdrop-blur-md transition-transform group-hover/rail:scale-105 ${isDemo ? "border-white/15 bg-black/55 text-white/80" : "border-accent/50 bg-accent text-accent-foreground"}`}>{isDemo ? <Lock className="size-[18px]"/> : <Send className="size-[18px]"/>}</span>
              <span className="line-clamp-1 max-w-full text-center text-[10px] font-medium leading-tight text-white/90 drop-shadow">{t.publish}</span>
            </button>
            <a href={`/api/clips/${activeClip.id}/download`} download aria-label={`${t.download}: ${title}`} title={t.download} className="flex w-full flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
              <span className="grid size-11 place-items-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-md transition-transform hover:scale-105"><ArrowDownToLine className="size-[18px]"/></span>
              <span className="line-clamp-1 max-w-full text-center text-[10px] font-medium leading-tight text-white/90 drop-shadow">{t.download}</span>
            </a>
            <button type="button" onClick={() => setDetailsOpen(true)} aria-label={t.clipDetails} title={t.clipDetails} className="flex w-full flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:hidden">
              <span className="grid size-11 place-items-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-md transition-transform active:scale-95"><Info className="size-[18px]"/></span>
              <span className="line-clamp-1 max-w-full text-center text-[10px] font-medium leading-tight text-white/90 drop-shadow">{t.clipDetails}</span>
            </button>
            <button type="button" onClick={copyCaption} aria-label={t.tiktokCopyCaption} title={t.tiktokCopyCaption} className="hidden w-full flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:flex">
              <span className="grid size-11 place-items-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-md transition-transform hover:scale-105">{copied ? <Check className="size-[18px]"/> : <Copy className="size-[18px]"/>}</span>
              <span className="line-clamp-1 max-w-full text-center text-[10px] font-medium leading-tight text-white/90 drop-shadow">{t.tiktokCopyCaption}</span>
            </button>
            <Link to="/jobs/$jobId" params={{ jobId: activeClip.job.id }} onClick={() => onOpenChange(false)} aria-label={`${t.openJob}: ${title}`} title={t.openJob} className="hidden w-full flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:flex">
              <span className="grid size-11 place-items-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-md transition-transform hover:scale-105"><ExternalLink className="size-[18px]"/></span>
              <span className="line-clamp-1 max-w-full text-center text-[10px] font-medium leading-tight text-white/90 drop-shadow">{t.openJob}</span>
            </Link>
            <button type="button" onClick={openDelete} disabled={remove.isPending} aria-label={`${t.deleteClip}: ${title}`} title={t.deleteClip} className="group/rail flex w-full flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/70 disabled:opacity-50">
              <span className="grid size-11 place-items-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-md transition-all group-hover/rail:border-destructive group-hover/rail:bg-destructive group-hover/rail:text-destructive-foreground">{remove.isPending ? <LoaderCircle className="size-[18px] animate-spin"/> : <Trash2 className="size-[18px]"/>}</span>
              <span className="line-clamp-1 max-w-full text-center text-[10px] font-medium leading-tight text-white/90 drop-shadow">{t.deleteClip}</span>
            </button>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/70 to-transparent pb-[calc(3.75rem+env(safe-area-inset-bottom))] pl-3 pr-20 pt-16 sm:pb-12">
            <DialogDescription className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] leading-4 text-white/75 sm:text-xs">
              <span className="line-clamp-1 min-w-0">{metaLabel}</span>
              {showTimeRange && <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{timeRange}</span>
              </>}
              {typeof activeClip.viralScore === "number" && <ViralScorePill score={activeClip.viralScore} />}
              {activeClip.job.aspectRatio !== "9:16" && <Badge variant="outline" className="h-5 border-white/20 bg-black/50 px-1.5 text-[10px] text-white">{activeClip.job.aspectRatio}</Badge>}
            </DialogDescription>
            <DialogTitle className="mt-1 line-clamp-2 font-display text-sm font-semibold leading-snug text-white sm:text-base">
              {isMobile ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setDetailsOpen(true)
                  }}
                  className="pointer-events-auto text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  {title}
                </button>
              ) : (
                title
              )}
            </DialogTitle>
            {showHookText && (
              <p className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-white/15 bg-black/55 px-2 py-0.5 text-[11px] leading-4 text-white/90 backdrop-blur-sm">
                <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wide text-accent">{t.hookLabel}:</span>
                <span className="line-clamp-1 min-w-0 italic">“{hookText}”</span>
              </p>
            )}
            {hasCaption && (
              isMobile ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setDetailsOpen(true)
                  }}
                  className="pointer-events-auto mt-1.5 block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <p className="line-clamp-2 text-xs leading-5 text-white/90">
                    {captionText}
                    {captionText && tags.length > 0 ? " " : ""}
                    {tags.map((tag) => <span key={tag} className="mr-1.5 font-semibold text-accent">#{tag}</span>)}
                  </p>
                </button>
              ) : (
                <div className="pointer-events-auto mt-1.5">
                  {captionExpanded ? (
                    <div className="max-h-36 overflow-y-auto rounded-lg bg-black/60 p-2 text-xs leading-5 text-white/90 backdrop-blur-sm sm:text-sm">
                      {captionText && <p className="whitespace-pre-line">{captionText}</p>}
                      {tags.length > 0 && <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">{tags.map((tag) => <span key={tag} className="font-semibold text-accent">#{tag}</span>)}</p>}
                    </div>
                  ) : (
                    <p className="line-clamp-2 text-xs leading-5 text-white/90 sm:text-sm">
                      {captionText}
                      {captionText && tags.length > 0 ? " " : ""}
                      {tags.map((tag) => <span key={tag} className="mr-1.5 font-semibold text-accent">#{tag}</span>)}
                    </p>
                  )}
                  {canExpandCaption && <button type="button" onClick={() => setCaptionExpanded((value) => !value)} className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-white/70 transition-colors hover:text-white sm:text-xs">{captionExpanded ? t.lessCaption : t.moreCaption}</button>}
                </div>
              )
            )}
          </div>

          <div
            onTouchStart={(event) => event.stopPropagation()}
            onTouchEnd={(event) => event.stopPropagation()}
            className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 to-transparent pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-3 pr-3 pt-4 sm:pb-2 sm:pt-6"
          >
            <div className="flex items-center gap-2">
              <div className="relative flex h-8 min-w-0 flex-1 touch-none items-center py-2 sm:h-6">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 h-1.5 rounded-full"
                  style={{ background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${playedPercent}%, rgba(255,255,255,.45) ${playedPercent}%, rgba(255,255,255,.45) ${trackFill}%, rgba(255,255,255,.22) ${trackFill}%, rgba(255,255,255,.22) 100%)` }}
                />
                <input
                  type="range"
                  min={0}
                  max={seekDuration}
                  step={0.1}
                  value={Math.min(currentTime, seekDuration)}
                  onChange={(event) => seek(Number(event.target.value))}
                  aria-label={t.seekVideo}
                  className="relative z-10 h-8 w-full cursor-pointer appearance-none bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:h-6 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow sm:[&::-moz-range-thumb]:size-3 sm:[&::-webkit-slider-thumb]:size-3"
                />
              </div>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-white/85">{formatTimecode(currentTime)} / {formatTimecode(seekDuration)}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Player Clip Details & Stats Drawer (mobile) */}
    <Drawer open={detailsOpen} onOpenChange={setDetailsOpen}>
      <DrawerContent className="flex max-h-[85dvh] flex-col overflow-hidden pb-0">
        <DrawerHeader className="shrink-0 border-b border-border px-4 py-3.5 text-left">
          <DrawerTitle className="font-display text-base font-semibold leading-snug">{title}</DrawerTitle>
          <DrawerDescription asChild>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {metaLabel && <span className="min-w-0 truncate">{metaLabel}</span>}
              {showTimeRange && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{timeRange}</span>
                </>
              )}
              {typeof activeClip.viralScore === "number" && <ViralScorePill score={activeClip.viralScore} surface="card" />}
              {activeClip.job.aspectRatio !== "9:16" && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {activeClip.job.aspectRatio}
                </Badge>
              )}
            </div>
          </DrawerDescription>
        </DrawerHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {showHookText && (
            <div className="rounded-lg border border-border bg-muted/35 px-3 py-2.5 text-xs">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t.hookLabel}</span>
              <p className="mt-1 italic leading-5 text-foreground">“{hookText}”</p>
            </div>
          )}

          {/* Full caption + hashtags + copy */}
          <div className="space-y-2.5 rounded-xl border border-border bg-muted/20 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-[.06em] text-muted-foreground">{t.publishCaptionLabelTikTok}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyCaption}
                className="min-h-10 gap-1.5 px-3 text-xs"
              >
                {copied ? <Check aria-hidden="true" className="size-3.5 text-accent"/> : <Copy aria-hidden="true" className="size-3.5"/>}
                {t.tiktokCopyCaption}
              </Button>
            </div>
            {hasCaption ? (
              <div className="space-y-2 text-sm leading-6 text-foreground">
                {captionText && <p className="whitespace-pre-line">{captionText}</p>}
                {tags.length > 0 && (
                  <p className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
                    {tags.map((tag) => (
                      <span key={tag} className="font-semibold text-primary">#{tag}</span>
                    ))}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t.noCaptionYet}</p>
            )}
          </div>

          {/* Per-platform performance stats + refresh */}
          {viewsSummary.hasPublished && (
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-medium uppercase tracking-[.06em] text-muted-foreground">{t.viewStats}</span>
                  {viewsSummary.totalViews !== null && (
                    <p className="mt-0.5 flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums text-foreground">
                      <Eye aria-hidden="true" className="size-4 text-muted-foreground"/>
                      {formatExactCount(viewsSummary.totalViews, language)}
                      <span className="font-sans text-xs font-normal text-muted-foreground">{t.views}</span>
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={refreshMetrics.isPending}
                  onClick={() => refreshMetrics.mutate(activeClip.id)}
                  className="min-h-10 gap-1.5 px-3 text-xs"
                >
                  <RefreshCw aria-hidden="true" className={cn("size-3.5", refreshMetrics.isPending && "animate-spin")}/>
                  {refreshMetrics.isPending ? t.refreshingStats : t.refreshStats}
                </Button>
              </div>
              <div className="divide-y divide-border/70">
                {viewsSummary.byPlatform.map((entry) => (
                  <div key={entry.platform} className="space-y-1 py-2.5 first:pt-1 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 font-medium text-foreground">
                        <PlatformMark platform={entry.platform} className="size-4 shrink-0"/>
                        {t.socialPlatforms[entry.platform]}
                      </span>
                      {entry.viewCount !== null ? (
                        <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-muted-foreground">
                          <span className="inline-flex items-center gap-1 text-foreground">
                            <Eye aria-hidden="true" className="size-3.5 text-muted-foreground"/>
                            {formatExactCount(entry.viewCount, language)}
                          </span>
                          {entry.likeCount !== null && (
                            <span className="inline-flex items-center gap-1">
                              <Heart aria-hidden="true" className="size-3.5"/>
                              {formatExactCount(entry.likeCount, language)}
                            </span>
                          )}
                          {entry.commentCount !== null && (
                            <span className="inline-flex items-center gap-1">
                              <MessageCircle aria-hidden="true" className="size-3.5"/>
                              {formatExactCount(entry.commentCount, language)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{t.statsPending}</span>
                      )}
                    </div>
                    {entry.metricsError && (
                      <p className="text-xs leading-5 text-muted-foreground">
                        {metricsErrorMessage(entry.metricsError, t)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button asChild variant="outline" className="min-h-11 w-full justify-center gap-2 text-sm">
            <Link
              to="/jobs/$jobId"
              params={{ jobId: activeClip.job.id }}
              onClick={() => {
                setDetailsOpen(false)
                onOpenChange(false)
              }}
            >
              <ExternalLink aria-hidden="true" className="size-4"/>
              {t.openJob}
            </Link>
          </Button>
        </div>
      </DrawerContent>
    </Drawer>

    {publishClip && <PublishDialog clip={publishClip} open={Boolean(publishClip)} onOpenChange={(value) => { if (!value) setPublishClip(null) }}/>}

    <AlertDialog open={deleteOpen} onOpenChange={(value) => { if (!remove.isPending) setDeleteOpen(value) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t.deleteClipTitle}</AlertDialogTitle><AlertDialogDescription>{t.deleteClipDescription}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={remove.isPending} onClick={(event) => { event.preventDefault(); remove.mutate(activeClip.id) }}>{remove.isPending && <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin"/>}{t.confirmDelete}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}

function ViralScorePill({ score, className, surface = "overlay" }: { score: number; className?: string; surface?: "overlay" | "card" }) {
  const t = useT()
  if (!Number.isFinite(score)) return null
  const rounded = Math.max(0, Math.min(100, Math.round(score)))
  const tone = surface === "card"
    ? rounded >= 80
      ? "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
      : rounded >= 60
        ? "border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-300"
        : "border-zinc-500/30 bg-zinc-500/12 text-zinc-700 dark:text-zinc-300"
    : rounded >= 80
      ? "border-emerald-400/30 bg-emerald-500/20 text-emerald-300"
      : rounded >= 60
        ? "border-amber-400/30 bg-amber-500/20 text-amber-300"
        : "border-zinc-400/30 bg-zinc-500/25 text-zinc-200"
  const tooltip = t.viralScoreTooltip.replace("{score}", String(rounded))
  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        "pointer-events-auto inline-flex h-[22px] items-center gap-0.5 rounded-full border px-1.5 font-mono text-[10px] font-semibold tabular-nums",
        surface === "overlay" && "shadow-sm backdrop-blur-md [text-shadow:0_1px_2px_rgb(0_0_0/60%)]",
        tone,
        className,
      )}
    >
      <Flame aria-hidden="true" className="size-3 shrink-0" />
      <span>{rounded}</span>
    </span>
  )
}

function PlatformMark({ platform, className }: { platform: SocialPlatform; className?: string }) {
  if (platform === "tiktok") return <TikTokMark className={className}/>
  if (platform === "instagram") return <InstagramMark className={className}/>
  return <YouTubeMark className={className}/>
}

function PublishBadge({ publications }: { publications?: ClipPublication[] }) {
  const t = useT()
  const locale = useLanguage().language === "id" ? "id-ID" : "en-US"
  if (!publications?.length) return null
  const busy = publications.some((item) => isUploadingPublication(item.status))
  const published = publications.some((item) => item.status === "published")
  const scheduledItems = publications.filter((item) => item.status === "scheduled")
  const hasScheduled = scheduledItems.length > 0
  if (!busy && !published && !hasScheduled) return null

  const liveShown = publications.filter((item) => item.status === "published" || isUploadingPublication(item.status))
  const livePlatforms = (["youtube", "tiktok", "instagram"] as const).filter((platform) => liveShown.some((item) => item.platform === platform))
  const liveSingle = livePlatforms.length === 1 ? t.socialPlatforms[livePlatforms[0]] : null
  const liveLabel = liveSingle ? (busy ? t.publishingTo : t.publishedOn).replace("{platform}", liveSingle) : busy ? t.publishingBadge : t.publishedBadge

  const scheduledPlatforms = (["youtube", "tiktok", "instagram"] as const).filter((platform) => scheduledItems.some((item) => item.platform === platform))
  const scheduledSingle = scheduledPlatforms.length === 1 ? t.socialPlatforms[scheduledPlatforms[0]] : null
  const earliestScheduledAt = scheduledItems
    .map((item) => item.scheduledAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0]
  const formattedTime = earliestScheduledAt ? formatScheduledDateTime(earliestScheduledAt, locale) : ""
  const scheduledTitle = scheduledSingle ? t.scheduledFor.replace("{platform}", scheduledSingle) : t.scheduledBadge
  const scheduledTooltip = formattedTime ? `${scheduledTitle} · ${formattedTime}` : scheduledTitle

  return (
    <>
      {(busy || published) && (
        <span
          title={liveLabel}
          className="inline-flex h-[22px] items-center gap-1 rounded-full border border-white/15 bg-black/60 pl-1 pr-1.5 text-white shadow-sm backdrop-blur-sm"
        >
          {livePlatforms.includes("youtube") && <YouTubeMark className="size-3.5" />}
          {livePlatforms.includes("tiktok") && <TikTokMark className="size-3.5 [&_.fill-foreground]:fill-white" />}
          {livePlatforms.includes("instagram") && <InstagramMark className="size-3.5" />}
          {busy ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin text-white/80" /> : <CircleCheck aria-hidden="true" className="size-3" />}
          <span className="sr-only">{liveLabel}</span>
        </span>
      )}
      {hasScheduled && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label={scheduledTooltip}
              className="pointer-events-auto inline-flex h-[22px] items-center gap-1 rounded-full border border-sky-400/40 bg-sky-950/75 pl-1 pr-1.5 text-sky-100 shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              {scheduledPlatforms.includes("youtube") && <YouTubeMark className="size-3.5" />}
              {scheduledPlatforms.includes("tiktok") && <TikTokMark className="size-3.5 [&_.fill-foreground]:fill-white" />}
              {scheduledPlatforms.includes("instagram") && <InstagramMark className="size-3.5" />}
              <Clock aria-hidden="true" className="size-3 text-sky-300" />
              <span className="sr-only">{scheduledTooltip}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            <Clock aria-hidden="true" className="size-3 text-sky-400" />
            <span>{scheduledTooltip}</span>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  )
}
