import { Check, LoaderCircle } from "lucide-react"
import type { JobSnapshot } from "@/lib/api"
import type { useT } from "@/lib/i18n"
import { ClipCard, ClipCardGrid, clipAspectClass } from "@/components/clip-card"
import { ClipCardCarousel } from "@/components/clip-card-carousel"

const stages = ["download", "transcribe", "select", "render", "save"] as const
type Copy = ReturnType<typeof useT>

function timecode(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`
}

export function JobAssembly({ job, t, layout = "grid" }: { job: JobSnapshot; t: Copy; /** "carousel" = single swipeable row (workspace Results); "grid" = wrapping grid (job details) */ layout?: "grid" | "carousel" }) {
  const Cards = layout === "carousel" ? ClipCardCarousel : ClipCardGrid
  const running = job.status === "queued" || job.status === "running"
  const done = job.status === "done"
  const stage = job.stage ?? "download"
  const stageIndex = stages.indexOf(stage as typeof stages[number])
  const progress = Math.max(0, Math.min(100, job.progress ?? 0))
  const count = Math.max(1, Math.min(10, job.clipCount ?? 3))
  const clips = job.clips.filter((clip) => !clip.deletedAt)

  return <div className="space-y-5">
    {running && <div className="rounded-lg border border-border bg-secondary/20 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-medium">{job.status === "queued" ? t.status.queued : t.stages[stage]}</p><p className="mt-1 text-xs text-muted-foreground">{job.message || t.assemblingClips}</p></div>
        <span className="font-mono text-sm tabular-nums text-muted-foreground">{progress}%</span>
      </div>
      <div role="progressbar" aria-label={t.processing} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mb-4 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${progress}%` }}/></div>
      <ol aria-label={t.processing} className="mb-4 grid grid-cols-5 gap-1">{stages.map((item, index) => <li key={item} className={`min-w-0 border-t-2 pt-2 text-[10px] leading-4 ${index < stageIndex ? "border-primary/60 text-muted-foreground" : index === stageIndex ? "border-primary text-foreground" : "border-border text-muted-foreground/65"}`}><span className="flex items-center gap-1">{index < stageIndex ? <Check className="size-3 shrink-0"/> : index === stageIndex ? <LoaderCircle className="size-3 shrink-0 animate-spin motion-reduce:animate-none"/> : <span className="size-3 shrink-0 rounded-full border border-current"/>}<span className="truncate">{t.stages[item]}</span></span></li>)}</ol>
      <Cards aspectRatio={job.aspectRatio} aria-label={t.assemblingClips} className={`job-assembly ${`job-stage-${stage}`}`}>
        {Array.from({ length: count }, (_, index) => <article key={`placeholder-${index}`} aria-label={`${t.clip} ${index + 1} ${t.assemblingClips}`} className={`job-assembly__placeholder ${clipAspectClass(job.aspectRatio)} relative min-w-0 overflow-hidden rounded-lg border border-border bg-card`}>
          <div className="job-assembly__frame absolute inset-0" style={{ "--card-index": index, "--frame-blur": `${stage === "render" ? Math.max(0.5, 7 - progress * 0.045) : stage === "save" ? 1 : 7}px`, "--frame-opacity": stage === "render" ? String(Math.min(0.95, 0.68 + progress * 0.0025)) : stage === "select" ? ".84" : stage === "save" ? ".96" : ".72" } as React.CSSProperties} aria-hidden="true"><div className="job-assembly__art absolute inset-0"/><div className="job-assembly__scan absolute inset-y-0 -left-1/2 w-1/2"/><div className="absolute inset-x-3 bottom-4 space-y-2"><span className="job-assembly__bar block h-1 w-1/3 rounded-full"/><span className="job-assembly__bar block h-1.5 w-4/5 rounded-full"/><span className="job-assembly__bar block h-1.5 w-3/5 rounded-full"/><span className="flex gap-1 pt-1">{Array.from({ length: 9 }, (_, bar) => <i key={bar} className="job-assembly__wave h-3 flex-1 rounded-sm bg-primary/35" style={{ "--bar-index": bar } as React.CSSProperties}/>)}</span></div><span className="job-assembly__timecode absolute left-2 top-2 rounded px-1.5 py-1 font-mono text-[9px] tabular-nums">{timecode(index * 24)} · {String(index + 1).padStart(2, "0")}</span></div>
        </article>)}
      </Cards>
    </div>}
    {done && clips.length > 0 && <Cards aspectRatio={job.aspectRatio} aria-label={t.readyClips}>
      {clips.map((clip, index) => <ClipCard key={clip.id} clip={{ ...clip, job: { id: job.id, url: job.url, aspectRatio: job.aspectRatio } }} index={index} meta={`${timecode(clip.startSec)}–${timecode(clip.endSec)}`}/>) }
    </Cards>}
    {done && clips.length === 0 && <p className="text-sm text-muted-foreground">{t.generatedAppear}</p>}
  </div>
}
