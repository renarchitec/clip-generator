import { ArrowDownToLine, CircleCheck, Play, X } from "lucide-react"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useT } from "@/lib/i18n"

export type ClipCardData = { id: string; title: string; startSec: number; endSec: number; downloadedAt?: string | null; job: { id: string; url: string; aspectRatio: "9:16" | "1:1" | "16:9" } }

function timecode(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
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
  return <article className="group flex min-w-0 flex-col self-start overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
    <button type="button" onClick={() => setPlayerOpen(true)} aria-label={`${t.playClip}: ${title}`} className={`relative block w-full ${frame === "uniform" ? "aspect-[9/16]" : clipAspectClass(clip.job.aspectRatio)} overflow-hidden bg-black text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}>
      <video src={`/api/clips/${clip.id}/stream`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" className="size-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"/>
      <span className="absolute left-2 top-2 rounded-sm bg-black/70 px-1.5 py-1 font-mono text-[10px] tabular-nums text-white">{timecode(clip.startSec)}–{timecode(clip.endSec)}</span>
      <span className="absolute bottom-2 right-2 rounded-sm bg-black/70 px-1.5 py-1 font-mono text-[10px] tabular-nums text-white">{timecode(duration)}</span>
      <span className="absolute inset-0 grid place-items-center bg-black/0 text-white transition-colors group-hover:bg-black/20"><span className="grid size-10 place-items-center rounded-full border border-white/70 bg-black/65"><Play className="ml-0.5 size-4 fill-current"/></span></span>
    </button>
    <div className="w-full p-2.5 sm:p-3">
      <h3 className="line-clamp-2 min-h-9 text-xs font-medium leading-[18px] sm:text-sm">{title}</h3>
      <p className="mt-1 min-h-4 line-clamp-2 break-words text-[10px] leading-4 text-muted-foreground sm:text-xs">{meta}</p>
      <div className="mt-2 flex min-h-10 items-center justify-between gap-1 border-t border-border pt-1.5">
        <div className="flex min-w-0 items-center gap-1.5"><a href={`/api/clips/${clip.id}/download`} download aria-label={`${t.download}: ${title}`} title={t.download} className="grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowDownToLine className="size-4"/></a>{(downloaded || clip.downloadedAt) && <span title={t.downloaded} className="inline-flex items-center text-primary"><CircleCheck aria-hidden="true" className="size-3.5"/><span className="sr-only">{t.downloaded}</span></span>}</div>
        {deleteAction}
      </div>
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
