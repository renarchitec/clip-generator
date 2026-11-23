import { ArrowDownToLine, CircleCheck, Play, X } from "lucide-react"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useT } from "@/lib/i18n"

export type ClipCardData = { id: string; title: string; startSec: number; endSec: number; downloadedAt?: string | null; job: { id: string; url: string; aspectRatio: "9:16" | "1:1" | "16:9" } }

function shortDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return minutes ? (rest ? `${minutes}m ${rest}s` : `${minutes}m`) : `${rest}s`
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

export function ClipCard({ clip, meta, deleteAction, downloaded = false, index, frame }: { clip: ClipCardData; meta: string; deleteAction?: React.ReactNode; downloaded?: boolean; index?: number; /** Force one media frame (e.g. mixed-ratio library) */ frame?: "uniform" }) {
  const t = useT()
  const [playerOpen, setPlayerOpen] = useState(false)
  const title = clip.title || `${t.clip} ${index === undefined ? "" : index + 1}`.trim()
  const duration = Math.max(0, clip.endSec - clip.startSec)
  return <article className={`clip-card group relative isolate min-w-0 overflow-hidden rounded-lg border border-border bg-card ${frame === "uniform" ? "aspect-[9/16]" : clipAspectClass(clip.job.aspectRatio)}`}>
    <video src={`/api/clips/${clip.id}/stream`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" className="absolute inset-0 size-full bg-black object-contain"/>
    <button type="button" onClick={() => setPlayerOpen(true)} aria-label={`${t.playClip}: ${title}`} className="absolute inset-0 z-[1] grid size-full place-items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <span className="clip-card-play grid size-11 place-items-center rounded-full border border-accent/60 bg-background/75 text-primary shadow-lg backdrop-blur-sm transition duration-150 group-hover:scale-105 group-hover:ring-4 group-hover:ring-accent/20"><Play className="ml-0.5 size-[18px] fill-current"/></span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-16 text-left text-white"><span className="line-clamp-2 block min-h-10 text-xs font-semibold leading-5 sm:text-sm">{title}</span><span className="mt-1 line-clamp-2 block text-[10px] leading-4 text-white/80 sm:text-xs">{meta}</span></span>
    </button>
    <span className="absolute left-2 top-2 z-[2] rounded-full border border-accent/40 bg-accent/90 px-2 py-1 font-mono text-[10px] font-semibold tabular-nums text-accent-foreground shadow-sm">{shortDuration(duration)}</span>
    {(downloaded || clip.downloadedAt) && <span title={t.downloaded} className="absolute right-2 top-2 z-[2] transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0 [@media(hover:none)]:hidden inline-flex size-7 items-center justify-center rounded-full border border-accent/40 bg-background/85 text-primary shadow-sm"><CircleCheck aria-hidden="true" className="size-4"/><span className="sr-only">{t.downloaded}</span></span>}
    <div className="clip-card-actions absolute right-2 top-2 z-[3] flex -translate-y-1 items-center gap-1 rounded-lg border border-white/20 bg-black/65 p-0.5 text-white opacity-0 shadow-lg backdrop-blur-sm transition duration-150 focus-within:translate-y-0 focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
      <a href={`/api/clips/${clip.id}/download`} download aria-label={`${t.download}: ${title}`} title={t.download} className="grid size-10 shrink-0 place-items-center rounded-md text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><ArrowDownToLine className="size-4"/></a>
      {deleteAction}
    </div>
    <ClipPlayerDialog clip={clip} open={playerOpen} onOpenChange={setPlayerOpen} meta={meta}/>
  </article>
}

export function ClipPlayerDialog({ clip, onOpenChange, open, meta }: { clip: ClipCardData | null; open: boolean; onOpenChange: (open: boolean) => void; meta?: string }) {
  const t = useT()
  if (!clip) return null
  const title = clip.title || t.clip
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-4xl gap-3 p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><DialogTitle className="truncate font-display text-base">{title}</DialogTitle><DialogDescription className="mt-1 truncate">{meta || clip.job.url}</DialogDescription></div><DialogClose asChild><Button type="button" variant="outline" className="size-10 shrink-0 px-0" aria-label={t.closePlayer}><X className="size-4"/></Button></DialogClose></div><video key={clip.id} src={`/api/clips/${clip.id}/stream`} controls autoPlay playsInline className="mx-auto max-h-[min(72dvh,760px)] w-full rounded-md bg-black object-contain"/><div className="flex justify-end"><Link to="/jobs/$jobId" params={{ jobId: clip.job.id }} className="inline-flex min-h-11 items-center gap-2 px-3 text-sm text-muted-foreground transition-colors hover:text-foreground">{t.openJob}</Link></div></DialogContent>
  </Dialog>
}
