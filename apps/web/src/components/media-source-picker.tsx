import { SplitChoice } from "./split-choice"
import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Badge } from "./ui/badge"
import { Progress } from "./ui/progress"
import {
  api,
  listMedia,
  uploadMedia,
  deleteMedia,
  type RecentClip,
} from "@/lib/api"
import {
  MEDIA_UPLOAD_MAX_BYTES,
  type PrimaryMediaSource,
} from "@/lib/split-screen"
import { useLanguage } from "@/lib/i18n"
import en from "@/i18n/en.json"
import id from "@/i18n/id.json"
export function useSplitText() {
  return useLanguage().language === "id" ? id : en
}
export function MediaSourcePicker({
  value,
  onChange,
}: {
  value: PrimaryMediaSource
  onChange: (source: PrimaryMediaSource) => void
}) {
  const t = useSplitText(),
    client = useQueryClient()
  const [search, setSearch] = useState(""),
    [pct, setPct] = useState(0),
    [large, setLarge] = useState(false)
  const media = useQuery({
    queryKey: ["media"],
    queryFn: listMedia,
    enabled: value.kind === "upload",
  })
  const clips = useQuery({
    queryKey: ["clips", "picker"],
    queryFn: () => api<RecentClip[]>("/clips/recent?limit=100"),
    enabled: value.kind === "clip",
  })
  const upload = useMutation({
    mutationFn: (f: File) => uploadMedia(f, setPct),
    onSuccess: (m) => {
      void client.invalidateQueries({ queryKey: ["media"] })
      onChange({
        kind: "upload",
        mediaId: m.id,
        label: m.name,
        durationSec: m.durationSec,
      })
    },
  })
  const remove = useMutation({
    mutationFn: deleteMedia,
    onSuccess: (_, key) => {
      if (key === value.mediaId) onChange({ kind: "upload" })
      void client.invalidateQueries({ queryKey: ["media"] })
    },
  })
  const items =
    value.kind === "upload"
      ? (media.data ?? []).map((m) => ({
          id: m.id,
          title: m.name,
          seconds: m.durationSec,
          size: `${m.width}×${m.height}`,
        }))
      : (clips.data ?? [])
          .filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
          .map((c) => ({
            id: c.id,
            title: c.title,
            seconds: c.endSec - c.startSec,
            size: "",
          }))
  const query = value.kind === "upload" ? media : clips
  return (
    <div className="min-w-0 space-y-2">
      <div role="group" aria-label={t.source} className="flex flex-wrap gap-1">
        {(["url", "upload", "clip"] as const).map((kind) => (
          <SplitChoice
            selected={kind === value.kind}
            key={kind}
            disabled={upload.isPending}
            onClick={() => {
              if (kind !== value.kind) onChange({ kind })
            }}
          >
            {t[kind]}
          </SplitChoice>
        ))}
      </div>
      {value.kind === "url" ? (
        <Input
          aria-label={t.link}
          placeholder={t.link}
          type="url"
          value={value.url ?? ""}
          onChange={(e) => onChange({ kind: "url", url: e.target.value })}
        />
      ) : (
        <>
          {value.label && (
            <Badge variant="secondary" className="max-w-full truncate">
              {value.label}
            </Badge>
          )}
          {value.kind === "upload" ? (
            <label className="block text-xs">
              {t.file}
              <Input
                disabled={upload.isPending}
                type="file"
                accept=".mp4,.mov,.webm"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ""
                  if (f) {
                    setLarge(f.size > MEDIA_UPLOAD_MAX_BYTES)
                    if (f.size <= MEDIA_UPLOAD_MAX_BYTES) {
                      setPct(0)
                      upload.mutate(f)
                    }
                  }
                }}
              />
            </label>
          ) : (
            <Input
              aria-label={t.search}
              placeholder={t.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          {upload.isPending && <Progress value={pct} aria-label={t.upload} />}
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {items.map((m) => (
              <div key={m.id} className="flex min-w-0 items-center gap-1">
                <SplitChoice
                  selected={
                    m.id ===
                    (value.kind === "upload" ? value.mediaId : value.clipId)
                  }
                  className="min-w-0 flex-1 justify-start"
                  onClick={() =>
                    onChange({
                      kind: value.kind,
                      ...(value.kind === "upload"
                        ? { mediaId: m.id }
                        : { clipId: m.id }),
                      label: m.title,
                      durationSec: m.seconds,
                    })
                  }
                >
                  <span className="truncate">{m.title}</span>
                  <Badge variant="secondary">
                    {Math.round(m.seconds)}s {m.size}
                  </Badge>
                </SplitChoice>
                {value.kind === "upload" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    aria-label={`${t.delete}: ${m.title}`}
                    onClick={() => remove.mutate(m.id)}
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
          </div>
          {query.isError ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              {t.failed} {t.retry}
            </Button>
          ) : (
            !items.length && (
              <p className="text-xs text-muted-foreground">
                {query.isPending ? t.loading : t.empty}
              </p>
            )
          )}
          {(large || upload.isError || remove.isError) && (
            <p role="alert">
              {large
                ? t.large
                : upload.isError
                  ? t.uploadFailed
                  : t.deleteFailed}
            </p>
          )}
        </>
      )}
    </div>
  )
}
