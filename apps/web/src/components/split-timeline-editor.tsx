import { useState } from "react"
import { Button } from "./ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import { Input } from "./ui/input"
import { Badge } from "./ui/badge"
import { useSplitText } from "./media-source-picker"
import {
  clipColor,
  type SplitScreenClipSource,
  type SplitScreenSegment as Segment,
} from "@/lib/split-screen"
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n))
export function SplitTimelineEditor({
  clips,
  duration,
  value,
  original,
  onChange,
}: {
  clips: SplitScreenClipSource[]
  duration: number
  value: Segment[]
  original?: Segment[]
  onChange: (v: Segment[]) => void
}) {
  const t = useSplitText(),
    [open, setOpen] = useState(false)
  const label = (id: string) =>
    clips.find((c) => c.id === id)?.label ||
    `${t.broll} ${clips.findIndex((c) => c.id === id) + 1}`
  const update = (i: number, p: Partial<Segment>) =>
    onChange(value.map((s, j) => (i === j ? { ...s, ...p } : s)))
  const cut = (i: number) => {
    const s = value[i],
      mid = (s.atStart + s.atEnd) / 2
    onChange([
      ...value.slice(0, i),
      { ...s, atEnd: mid },
      {
        ...s,
        atStart: mid,
        sourceStartSec: (s.sourceStartSec ?? 0) + mid - s.atStart,
      },
      ...value.slice(i + 1),
    ])
  }
  const gap = value
    .map((s, i) => ({ atStart: i ? value[i - 1].atEnd : 0, atEnd: s.atStart }))
    .concat({ atStart: value.at(-1)?.atEnd ?? 0, atEnd: duration })
    .find((s) => s.atEnd > s.atStart)
  return (
    <div className="relative min-w-0 space-y-2 border-t p-3">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t.timeline} ({value.length})
      </Button>
      <div className="relative h-8 rounded bg-muted">
        {value.map((s, i) => (
          <Button
            type="button"
            size="sm"
            key={i}
            title={`${label(s.clipId)} · ${(s.atEnd - s.atStart).toFixed(1)}s`}
            aria-label={`${label(s.clipId)} · ${(s.atEnd - s.atStart).toFixed(1)}s`}
            className="absolute h-full min-w-0 overflow-hidden rounded-none border-r p-0"
            style={{
              backgroundColor: clipColor(s.clipId),
              left: `${(100 * s.atStart) / duration}%`,
              width: `${(100 * (s.atEnd - s.atStart)) / duration}%`,
            }}
            onClick={() => setOpen(true)}
          >
            <span className="truncate bg-black/65 px-1 text-white">
              {label(s.clipId)} · {(s.atEnd - s.atStart).toFixed(1)}s
            </span>
          </Button>
        ))}
      </div>
      {open && (
        <>
          {value.map((s, i) => (
            <div className="relative space-y-2 rounded-md border p-2" key={i}>
              <Select
                value={s.clipId}
                onValueChange={(clipId) =>
                  update(i, { clipId, sourceStartSec: 0 })
                }
              >
                <SelectTrigger aria-label={t.broll}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clips.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {label(c.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(["atStart", "atEnd", "sourceStartSec"] as const).map(
                  (k, j) => {
                    const min =
                        j === 0
                          ? (value[i - 1]?.atEnd ?? 0)
                          : j === 1
                            ? s.atStart + 0.001
                            : 0,
                      max =
                        j === 0
                          ? s.atEnd - 0.001
                          : j === 1
                            ? (value[i + 1]?.atStart ?? duration)
                            : (clips.find((c) => c.id === s.clipId)
                                ?.durationSec ?? Infinity)
                    return (
                      <label key={`${k}:${s[k]}`} className="text-xs">
                        {[t.start, t.end, t.offset][j]}
                        <Input
                          type="number"
                          step="any"
                          min={min}
                          defaultValue={s[k] ?? ""}
                          onBlur={(e) => {
                            const n = clamp(
                              Number(e.target.value) || 0,
                              min,
                              max,
                            )
                            e.target.value = String(n)
                            update(i, { [k]: n })
                          }}
                        />
                      </label>
                    )
                  },
                )}
              </div>
              {s.reason && (
                <Badge variant="secondary" className="whitespace-normal">
                  {s.reason}
                </Badge>
              )}
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={s.atEnd - s.atStart < 0.01}
                  onClick={() => cut(i)}
                >
                  {t.cut}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                >
                  {t.remove}
                </Button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!clips.length || !duration}
              onClick={() =>
                gap
                  ? onChange(
                      [...value, { ...gap, clipId: clips[0].id }].sort(
                        (a, b) => a.atStart - b.atStart,
                      ),
                    )
                  : cut(value.length - 1)
              }
            >
              + {t.segment}
            </Button>
            {original?.length ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange(original)}
              >
                {t.reset}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!clips.length}
              onClick={() =>
                onChange(
                  clips.map((c, i) => ({
                    clipId: c.id,
                    atStart: (i * duration) / clips.length,
                    atEnd: ((i + 1) * duration) / clips.length,
                  })),
                )
              }
            >
              {t.even}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
