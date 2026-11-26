import { ArrowDownToLine, CircleCheck, Copy, FolderOpen, LoaderCircle, Play, Send, Sparkles, Trash2, X } from "lucide-react"
import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { api, apiUrl, CAPTION_LANGUAGES, type CaptionLanguage } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getDesktopBridge, isDesktopApp } from "@/lib/desktop"
import { useT } from "@/lib/i18n"
import { isActivePublication, PublishDialog, type ClipPublication } from "@/components/publish-dialog"
import { InstagramMark, TikTokMark, YouTubeMark } from "@/components/social-accounts"

export type ClipCardData = { id: string; title: string; startSec: number; endSec: number; downloadedAt?: string | null; caption?: string | null; hashtags?: string[]; publications?: ClipPublication[]; job: { id: string; url: string; aspectRatio: "9:16" | "1:1" | "16:9" } }

function shortDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return minutes ? (rest ? `${minutes}m ${rest}s` : `${minutes}m`) : `${rest}s`
}

function formatClipCaption(caption: string | null | undefined, hashtags: string[] | undefined) {
  const tags = (hashtags ?? []).map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean).map((tag) => `#${tag}`).join(" ")
  return [caption?.trim(), tags].filter(Boolean).join("\n\n")
}

async function revealClipInFinder(clipId: string, errorMessage: string) {
  const bridge = getDesktopBridge()
  if (!bridge) return
  try {
    const { path } = await api<{ path: string }>(`/system/clips/${clipId}/local-path`)
    const res = await bridge.revealInFinder(path)
    if (!res.ok) toast.error(res.error || errorMessage)
  } catch {
    toast.error(errorMessage)
  }
}

export function clipAspectClass(aspectRatio: ClipCardData["job"]["aspectRatio"]) {
  return aspectRatio === "9:16" ? "aspect-[9/16]" : aspectRatio === "1:1" ? "aspect-square" : "aspect-video"
}

export function ClipCardGrid({ aspectRatio, children, className = "", ...props }: { aspectRatio: ClipCardData["job"]["aspectRatio"]; children: React.ReactNode; className?: string; "aria-label"?: string }) {
  const columns = aspectRatio === "16:9"
    ? "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
    : aspectRatio === "1:1"
      ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7"
      : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8"
  return <div {...props} className={`grid items-start ${columns} gap-x-3 gap-y-5 sm:gap-4 ${className}`}>{children}</div>
}

export function ClipCard({ clip, meta, downloaded = false, index, frame }: { clip: ClipCardData; meta: string; downloaded?: boolean; index?: number; /** Force one media frame (e.g. mixed-ratio library) */ frame?: "uniform" }) {
  const t = useT()
  const desktop = isDesktopApp()
  const hasFinder = Boolean(getDesktopBridge())
  const [playerOpen, setPlayerOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const client = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api(`/clips/${clip.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmOpen(false)
      setPlayerOpen(false)
      void client.invalidateQueries({ queryKey: ["jobs"] })
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      toast.success(t.clipDeleted)
    },
    onError: () => toast.error(t.clipDeleteFailed),
  })
  const title = clip.title || `${t.clip} ${index === undefined ? "" : index + 1}`.trim()
  const duration = Math.max(0, clip.endSec - clip.startSec)
  const streamSrc = apiUrl(`/clips/${clip.id}/stream`)
  const downloadHref = apiUrl(`/clips/${clip.id}/download`)
  return <article className={`clip-card group relative isolate min-w-0 overflow-hidden rounded-lg border border-border bg-card ${frame === "uniform" ? "aspect-[9/16]" : clipAspectClass(clip.job.aspectRatio)}`}>
    <video src={streamSrc} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" className="absolute inset-0 size-full bg-black object-contain"/>
    <button type="button" onClick={() => setPlayerOpen(true)} aria-label={`${t.playClip}: ${title}`} className="absolute inset-0 z-[1] grid size-full place-items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <span className="clip-card-play grid size-11 place-items-center rounded-full border border-accent/60 bg-background/90 text-primary shadow-lg transition duration-150 group-hover:scale-105 group-hover:ring-4 group-hover:ring-accent/20"><Play className="ml-0.5 size-[18px] fill-current"/></span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-16 text-left text-white"><span className="line-clamp-2 block min-h-10 text-xs font-semibold leading-5 sm:text-sm">{title}</span><span className="mt-1 line-clamp-2 block text-[10px] leading-4 text-white/80 sm:text-xs">{meta}</span></span>
    </button>
    <span className="pointer-events-none absolute left-2 top-2 z-[2] flex items-center gap-1"><span className="rounded-full border border-accent/40 bg-accent/90 px-2 py-1 font-mono text-[10px] font-semibold tabular-nums text-accent-foreground shadow-sm">{shortDuration(duration)}</span>{!desktop && <PublishBadge publications={clip.publications}/>}</span>
    {(downloaded || clip.downloadedAt) && <span title={t.downloaded} className="absolute right-2 top-2 z-[2] transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0 [@media(hover:none)]:hidden inline-flex size-7 items-center justify-center rounded-full border border-accent/40 bg-background/85 text-primary shadow-sm"><CircleCheck aria-hidden="true" className="size-4"/><span className="sr-only">{t.downloaded}</span></span>}
    <div className="clip-card-actions absolute right-2 top-2 z-[3] flex -translate-y-1 items-center gap-1 rounded-md border border-white/20 bg-black/80 p-0.5 text-white opacity-0 shadow-lg transition duration-150 focus-within:translate-y-0 focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
      <a href={downloadHref} download aria-label={`${t.download}: ${title}`} title={t.download} className="grid size-7 shrink-0 place-items-center rounded-md text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><ArrowDownToLine className="size-3.5"/></a>
      {desktop ? (
        hasFinder && <button type="button" onClick={() => void revealClipInFinder(clip.id, t.desktop.revealFailed)} aria-label={`${t.desktop.showInFinder}: ${title}`} title={t.desktop.showInFinder} className="grid size-7 shrink-0 place-items-center rounded-md text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><FolderOpen className="size-3.5"/></button>
      ) : (
        <button type="button" onClick={() => setPublishOpen(true)} aria-label={`${t.publish}: ${title}`} title={t.publish} className="grid size-7 shrink-0 place-items-center rounded-md text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><Send className="size-3.5"/></button>
      )}
      <button type="button" onClick={() => setConfirmOpen(true)} disabled={remove.isPending} aria-label={`${t.deleteClip}: ${title}`} title={t.deleteClip} className="grid size-7 shrink-0 place-items-center rounded-md text-white transition-colors hover:bg-destructive/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:opacity-50"><Trash2 className="size-3.5"/></button>
    </div>
    <ClipPlayerDialog clip={clip} open={playerOpen} onOpenChange={setPlayerOpen} meta={meta} onDelete={() => setConfirmOpen(true)} onPublish={() => setPublishOpen(true)}/>
    {!desktop && <PublishDialog clip={clip} open={publishOpen} onOpenChange={setPublishOpen}/>}
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
  const desktop = isDesktopApp()
  const hasFinder = Boolean(getDesktopBridge())
  const client = useQueryClient()
  const [ownPublishOpen, setOwnPublishOpen] = useState(false)
  const [captionLanguage, setCaptionLanguage] = useState<CaptionLanguage>("auto")
  const [captionDraft, setCaptionDraft] = useState("")

  useEffect(() => {
    if (clip) setCaptionDraft(formatClipCaption(clip.caption, clip.hashtags))
  }, [clip?.id, clip?.caption, clip?.hashtags])

  const regenerate = useMutation({
    mutationFn: (language: CaptionLanguage) => api<{ caption: string; hashtags: string[] }>(`/clips/${clip!.id}/caption`, { method: "POST", body: JSON.stringify({ language }) }),
    onSuccess: (result) => {
      const previous = captionDraft
      const next = formatClipCaption(result.caption, result.hashtags)
      setCaptionDraft(next)
      void client.invalidateQueries({ queryKey: ["clips"] })
      void client.invalidateQueries({ queryKey: ["jobs"] })
      if (previous !== next) {
        toast.success(t.captionRegenerated, { action: { label: t.captionUndo, onClick: () => setCaptionDraft(previous) } })
      }
    },
    onError: (error) => toast.error((error as Error & { status?: number }).status === 503 ? t.captionUnavailable : t.captionFailed),
  })

  if (!clip) return null
  const openPublish = onPublish ?? (() => setOwnPublishOpen(true))
  const title = clip.title || t.clip
  const streamSrc = apiUrl(`/clips/${clip.id}/stream`)
  const downloadHref = apiUrl(`/clips/${clip.id}/download`)

  return <><Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-4xl gap-3 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <DialogTitle className="truncate font-display text-base">{title}</DialogTitle>
          <DialogDescription className="mt-1 truncate">{meta || clip.job.url}</DialogDescription>
        </div>
        <DialogClose asChild><Button type="button" variant="outline" className="size-10 shrink-0 px-0" aria-label={t.closePlayer}><X className="size-4"/></Button></DialogClose>
      </div>
      <video key={clip.id} src={streamSrc} controls autoPlay playsInline className="mx-auto max-h-[min(64dvh,680px)] w-full rounded-md bg-black object-contain"/>
      {desktop && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground">{t.desktop.captionHeading}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Select value={captionLanguage} onValueChange={(value) => setCaptionLanguage(value as CaptionLanguage)}>
                <SelectTrigger className="h-8 w-36 text-xs" aria-label={t.captionLanguage}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {CAPTION_LANGUAGES.map((lang) => (
                    <SelectItem key={lang} value={lang}>{t.captionLanguageShort[lang]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" disabled={regenerate.isPending} onClick={() => regenerate.mutate(captionLanguage)}>
                {regenerate.isPending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin"/> : <Sparkles aria-hidden="true" className="size-3.5"/>}
                {regenerate.isPending ? t.captionWriting : t.regenerateCaptionAction}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" disabled={!captionDraft.trim()} onClick={() => void navigator.clipboard.writeText(captionDraft).then(() => toast.success(t.desktop.captionCopied)).catch(() => toast.error(t.desktop.copyFailed))}>
                <Copy aria-hidden="true" className="size-3.5"/>
                {t.desktop.copyCaption}
              </Button>
            </div>
          </div>
          <textarea
            rows={3}
            value={captionDraft}
            onChange={(event) => setCaptionDraft(event.target.value)}
            placeholder={t.desktop.captionEmpty}
            readOnly={regenerate.isPending}
            className="max-h-36 min-h-16 w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {desktop ? (
            hasFinder && <Button type="button" className="mr-1 h-10 px-4" onClick={() => void revealClipInFinder(clip.id, t.desktop.revealFailed)}><FolderOpen aria-hidden="true" className="size-4"/>{t.desktop.showInFinder}</Button>
          ) : (
            <Button type="button" className="mr-1 h-10 px-4" onClick={() => { onOpenChange(false); openPublish() }}><Send aria-hidden="true" className="size-4"/>{t.publish}</Button>
          )}
          <a href={downloadHref} download className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"><ArrowDownToLine className="size-4"/>{t.download}</a>
          {onDelete && <button type="button" onClick={onDelete} className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-4"/>{t.deleteClip}</button>}
        </div>
        <Link to="/jobs/$jobId" params={{ jobId: clip.job.id }} className="inline-flex min-h-11 items-center gap-2 px-3 text-sm text-muted-foreground transition-colors hover:text-foreground">{t.openJob}</Link>
      </div>
    </DialogContent>
  </Dialog>
  {!desktop && !onPublish && <PublishDialog clip={clip} open={ownPublishOpen} onOpenChange={setOwnPublishOpen}/>}</>
}

function PublishBadge({ publications }: { publications?: ClipPublication[] }) {
  const t = useT()
  if (!publications?.length) return null
  const busy = publications.some((item) => isActivePublication(item.status))
  const published = publications.some((item) => item.status === "published")
  if (!busy && !published) return null
  const shown = publications.filter((item) => item.status === "published" || isActivePublication(item.status))
  const platforms = (["youtube", "tiktok", "instagram"] as const).filter((platform) => shown.some((item) => item.platform === platform))
  const hasYouTube = platforms.includes("youtube"), hasTikTok = platforms.includes("tiktok"), hasInstagram = platforms.includes("instagram")
  const single = platforms.length === 1 ? t.socialPlatforms[platforms[0]] : null
  const label = single ? (busy ? t.publishingTo : t.publishedOn).replace("{platform}", single) : busy ? t.publishingBadge : t.publishedBadge
  return <span title={label} className="inline-flex h-[22px] items-center gap-1 rounded-full border border-white/15 bg-black/75 pl-1 pr-1.5 text-white shadow-sm sm:bottom-20">
    {hasYouTube && <YouTubeMark className="size-3.5"/>}{hasTikTok && <TikTokMark className="size-3.5"/>}{hasInstagram && <InstagramMark className="size-3.5"/>}{busy ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin text-white/80"/> : <CircleCheck aria-hidden="true" className="size-3 text-accent"/>}<span className="sr-only">{label}</span>
  </span>
}
