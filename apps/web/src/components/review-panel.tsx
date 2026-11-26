import { Flame, ListChecks, LoaderCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { JobPreview } from "@/lib/api"
import type { useT } from "@/lib/i18n"

type ReviewRange = { start: number; end: number; title?: string; reason?: string; hookText?: string }

function formatMomentTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

type ReviewPanelProps = {
  preview?: JobPreview
  loading: boolean
  error: string
  t: ReturnType<typeof useT>
  maxSelectable: number
  selectedCandidates: number[]
  setSelectedCandidates: React.Dispatch<React.SetStateAction<number[]>>
  selectedCueStart: number | null
  setSelectedCueStart: React.Dispatch<React.SetStateAction<number | null>>
  selectedCueEnd: number | null
  setSelectedCueEnd: React.Dispatch<React.SetStateAction<number | null>>
  cueRanges: { start: number; end: number }[]
  setCueRanges: React.Dispatch<React.SetStateAction<{ start: number; end: number }[]>>
  createPending: boolean
  renderSelected: (ranges: ReviewRange[]) => void
  retry: () => void
  reviewRef: React.RefObject<HTMLDivElement | null>
}

export function ReviewPanel({ preview, loading, error, t, maxSelectable, selectedCandidates, setSelectedCandidates, selectedCueStart, setSelectedCueStart, selectedCueEnd, setSelectedCueEnd, cueRanges, setCueRanges, createPending, renderSelected, retry, reviewRef }: ReviewPanelProps) {
  const candidates = preview?.candidates ?? []
  const cues = preview?.cues ?? []
  const selectedCount = selectedCandidates.length + cueRanges.length
  const addCueRange = () => {
    if (selectedCueStart === null || selectedCueEnd === null || selectedCount >= maxSelectable) return
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
    <div className="flex flex-wrap items-start gap-3"><span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent"><ListChecks className="size-4" /></span><div className="min-w-0"><h2 id="review-heading" className="font-display text-lg font-medium leading-9">{t.reviewMoments}</h2>{!loading && !error && preview?.status !== "done" && <p className="-mt-1 text-sm leading-relaxed text-muted-foreground">{t.reviewMomentsHint}</p>}</div></div>
    {loading && <div role="status" className="flex items-center gap-3 rounded-lg bg-card p-4 text-sm"><LoaderCircle className="size-4 animate-spin text-primary" />{t.scanningMoments}</div>}
    {error && <Alert variant="destructive"><AlertDescription>{error} <Button type="button" size="sm" variant="ghost" onClick={retry}>{t.retry}</Button></AlertDescription></Alert>}
    {preview?.status === "done" && <><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{t.reviewReady}</p><Button type="button" size="sm" variant="outline" onClick={retry} disabled={loading}>{t.reviewAgain}</Button></div>
      <div><p className="mb-2 text-sm font-medium">{t.candidateMoments} ({candidates.length})</p><div className="space-y-2">{candidates.map((candidate, index) => {
        const checked = selectedCandidates.includes(index)
        const disabled = !checked && selectedCount >= maxSelectable
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
              <span className="line-clamp-2 min-w-0 break-words text-sm font-medium sm:line-clamp-none">{candidate.title}</span>
              <span className="inline-flex shrink-0 items-center gap-1.5">
                {score !== null && (
                  <span
                    title={scoreTooltip}
                    aria-label={scoreTooltip}
                    className={`inline-flex h-5 items-center gap-0.5 rounded-full border px-1.5 font-mono text-[10px] font-semibold tabular-nums ${scoreTone}`}
                  >
                    <Flame aria-hidden="true" className="size-3 shrink-0" />
                    <span>{score}/100</span>
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
        return <Button key={`${cue.start}-${index}`} type="button" variant="ghost" aria-pressed={isStart || isEnd} onClick={() => { if (selectedCueStart === null || selectedCueEnd !== null) { setSelectedCueStart(index); setSelectedCueEnd(null) } else setSelectedCueEnd(index) }} className={`h-auto min-h-10 w-full shrink items-center justify-start gap-3 whitespace-normal rounded-md px-2 py-1.5 text-left text-sm font-normal sm:min-h-8 ${isStart || isEnd ? "bg-primary/10 ring-1 ring-primary" : ""}`}><span className="shrink-0 font-mono text-xs text-muted-foreground">{formatMomentTime(cue.start)}{isStart ? ` · ${t.startSec}` : isEnd ? ` · ${t.endSec}` : ""}</span><span className="min-w-0 break-words">{cue.text}</span></Button>
      })}</div><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={selectedCueStart === null || selectedCueEnd === null || selectedCount >= maxSelectable || cues[selectedCueStart]?.start === cues[selectedCueEnd]?.end} onClick={addCueRange}>{t.addRange}</Button><span aria-live="polite" className="text-xs text-muted-foreground">{selectedCueStart === null ? t.chooseStartCue : selectedCueEnd === null ? t.chooseEndCue : `${t.selectedMoments}: ${formatMomentTime(cues[selectedCueStart]?.start ?? 0)}–${formatMomentTime(cues[selectedCueEnd]?.end ?? 0)}`}</span></div></div>
      <div className="space-y-2"><p className="text-sm font-medium">{t.selectedMoments} ({selectedCount}/{maxSelectable})</p>
        {selectedCount > maxSelectable && <p role="alert" className="text-xs text-destructive">{t.selectedMomentsOverLimit.replace("{max}", String(maxSelectable))}</p>}
        {selectedCandidates.map((index) => { const candidate = candidates[index]; return candidate ? <div key={`candidate-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-3 py-2 text-sm"><span className="min-w-0"><span className="line-clamp-2 break-words sm:line-clamp-1">{candidate.title}</span><span className="text-xs text-muted-foreground">{formatMomentTime(candidate.start)}–{formatMomentTime(candidate.end)}</span></span><Button type="button" variant="ghost" size="sm" className="min-h-10 sm:min-h-8" onClick={() => setSelectedCandidates((current) => current.filter((item) => item !== index))}>{t.removeRange}</Button></div> : null })}{cueRanges.map((range, index) => <div key={`cue-range-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-3 py-2 text-sm"><span>{formatMomentTime(range.start)}–{formatMomentTime(range.end)}</span><Button type="button" variant="ghost" size="sm" className="min-h-10 sm:min-h-8" onClick={() => setCueRanges((current) => current.filter((_, item) => item !== index))}>{t.removeRange}</Button></div>)}</div>
      <Button type="button" className="w-full rounded-md" disabled={selectedCount < 1 || selectedCount > maxSelectable || createPending} onClick={() => renderSelected([...selectedCandidates.flatMap((index) => candidates[index] ? [{ start: candidates[index].start, end: candidates[index].end, title: candidates[index].title, reason: candidates[index].reason, ...(candidates[index].hookText ? { hookText: candidates[index].hookText } : {}) }] : []), ...cueRanges])}>{createPending && <LoaderCircle className="mr-2 size-4 animate-spin" />}{t.renderClips.replace("{count}", String(selectedCount))}</Button>
    </>}
  </section>
}
