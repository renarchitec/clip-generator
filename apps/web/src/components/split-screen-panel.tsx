import { SplitChoice } from "./split-choice"
import { useState } from "react"
import { Button } from "./ui/button"
import { Switch } from "./ui/switch"
import { Slider } from "./ui/slider"
import { Input } from "./ui/input"
import { Badge } from "./ui/badge"
import { MediaSourcePicker, useSplitText } from "./media-source-picker"
import {
  clipColor,
  type PrimaryMediaSource,
  type SplitScreenConfig,
  type SplitScreenClipSource,
} from "@/lib/split-screen"
function Options<K extends string>({
  title,
  options,
  value,
  change,
}: {
  title: string
  options: readonly (readonly [K, string])[]
  value: K
  change: (v: K) => void
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium">{title}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map(([k, label]) => (
          <SplitChoice selected={k === value} key={k} onClick={() => change(k)}>
            {label}
          </SplitChoice>
        ))}
      </div>
    </fieldset>
  )
}
export function SplitScreenPanel({
  value: v,
  onChange,
  summaries,
}: {
  value: SplitScreenConfig
  onChange: (v: SplitScreenConfig) => void
  summaries?: Record<string, string> | null
}) {
  const t = useSplitText(),
    [adding, setAdding] = useState(false),
    [source, setSource] = useState<PrimaryMediaSource>({ kind: "url" })
  const patch = (p: Partial<SplitScreenConfig>) => onChange({ ...v, ...p }),
    clips = v.clips
  const update = (id: string, p: Partial<SplitScreenClipSource>) =>
    patch({ clips: clips.map((c) => (c.id === id ? { ...c, ...p } : c)) })
  function move(i: number, d: number) {
    const next = clips.slice()
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    patch({ clips: next })
  }
  return (
    <section className="relative space-y-3 border-y py-3">
      <label className="relative flex items-center justify-between gap-2 text-sm font-medium">
        {t.split}
        <span
          aria-hidden="true"
          className="ml-auto text-xs text-muted-foreground"
        >
          {v.enabled ? t.on : t.off}
        </span>
        <Switch
          aria-label={t.split}
          className="data-checked:bg-accent data-[state=checked]:bg-accent"
          checked={v.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
      </label>
      {v.enabled && (
        <>
          <div className="flex items-center justify-between gap-1">
            <h4 className="text-sm font-medium">
              {t.broll} · {clips.length}/10
            </h4>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={clips.length >= 10}
              onClick={() => setAdding(!adding)}
            >
              + {t.add}
            </Button>
          </div>
          {adding && clips.length < 10 && (
            <div className="space-y-2 rounded-md border p-2">
              <MediaSourcePicker value={source} onChange={setSource} />
              <Button
                type="button"
                size="sm"
                disabled={
                  !(source.kind === "url"
                    ? /^https?:\/\//i.test(source.url ?? "")
                    : source.mediaId || source.clipId)
                }
                onClick={() => {
                  patch({
                    clips: [
                      ...clips,
                      {
                        ...source,
                        id: crypto.randomUUID(),
                        label: source.label ?? "",
                      },
                    ],
                  })
                  setSource({ kind: "url" })
                  setAdding(false)
                }}
              >
                {t.add}
              </Button>
            </div>
          )}
          {!clips.length && (
            <p className="text-xs text-muted-foreground">{t.need}</p>
          )}
          {clips.map((c, i) => (
            <article key={c.id} className="space-y-2 rounded-md border p-2">
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="size-2 rounded-full"
                  style={{ background: clipColor(c.id) }}
                />
                {i + 1}
                <Badge variant="secondary">{t[c.kind]}</Badge>
                <div className="ml-auto flex">
                  {([-1, 1] as const).map((d) => (
                    <Button
                      type="button"
                      key={d}
                      size="sm"
                      variant="ghost"
                      aria-label={d < 0 ? t.up : t.down}
                      disabled={!clips[i + d]}
                      onClick={() => move(i, d)}
                    >
                      {d < 0 ? "↑" : "↓"}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t.remove}
                    onClick={() =>
                      patch({ clips: clips.filter((x) => x.id !== c.id) })
                    }
                  >
                    ×
                  </Button>
                </div>
              </div>
              <label className="block text-xs">
                {t.topic}
                <Input
                  value={c.label}
                  placeholder={t.example}
                  maxLength={120}
                  onChange={(e) => update(c.id, { label: e.target.value })}
                />
              </label>
              {c.kind === "url" && (
                <div className="grid grid-cols-2 gap-2">
                  {(["startSec", "endSec"] as const).map((k) => (
                    <label key={k} className="text-xs">
                      {k === "startSec" ? t.start : t.end}
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={c[k] ?? ""}
                        onChange={(e) =>
                          update(c.id, {
                            [k]:
                              e.target.value === ""
                                ? null
                                : Math.max(0, Number(e.target.value)),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
              {(summaries?.[c.id] || c.description) && (
                <p className="text-xs text-muted-foreground">
                  {summaries?.[c.id] || c.description}
                </p>
              )}
            </article>
          ))}
          <Options
            title={t.mode}
            value={v.matchMode}
            options={[
              ["auto", t.auto],
              ["sequential", t.sequential],
            ]}
            change={(matchMode) => patch({ matchMode })}
          />
          <Options
            title={t.ratio}
            value={v.ratio}
            options={[
              ["50:50", "50:50"],
              ["40:60", "40:60"],
              ["60:40", "60:40"],
            ]}
            change={(ratio) => patch({ ratio })}
          />
          <SplitChoice
            selected={v.swap}
            onClick={() => patch({ swap: !v.swap })}
          >
            {t.swap}
          </SplitChoice>
          {(
            [
              v.swap ? "secondaryFit" : "primaryFit",
              v.swap ? "primaryFit" : "secondaryFit",
            ] as const
          ).map((k, i) => (
            <Options
              key={k}
              title={i ? t.bottom : t.top}
              value={v[k]}
              options={[
                ["cover", t.cover],
                ["contain_blur", t.contain_blur],
              ]}
              change={(fit) => patch({ [k]: fit })}
            />
          ))}
          <div className="space-y-3">
            <p className="text-xs">
              {t.volume} · {Math.round(v.secondaryVolume * 100)}%
            </p>
            <Slider
              aria-label={t.volume}
              min={0}
              max={100}
              value={[Math.round(v.secondaryVolume * 100)]}
              onValueChange={([v]) => patch({ secondaryVolume: v / 100 })}
            />
            <div className="flex flex-wrap gap-1">
              {[0, 15, 50].map((n) => (
                <SplitChoice
                  selected={v.secondaryVolume === n / 100}
                  key={n}
                  onClick={() => patch({ secondaryVolume: n / 100 })}
                >
                  {!n ? t.mute + " " : ""}
                  {n}%
                </SplitChoice>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
