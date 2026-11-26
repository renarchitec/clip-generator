import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Film, ImagePlus, LoaderCircle, Trash2 } from "lucide-react"
import { useRef, useState, type ChangeEvent } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { videoFormatBadge, WatermarkMedia } from "@/components/watermark-media"
import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"
import {
  isVideoWatermark,
  normalizeWatermarkSettingsList,
  uploadWatermark,
  type Watermark,
  type WatermarkDefaultValue,
  type WatermarkSettings,
} from "@/lib/watermark"

export const watermarkKey = ["watermarks"] as const

export type WatermarkDefaultResponse = { default: WatermarkDefaultValue; defaults?: WatermarkSettings[] }
export type NormalizedWatermarkDefaultResponse = { default: WatermarkDefaultValue; defaults: WatermarkSettings[] }

export function useWatermarkLibrary() {
  return useQuery({ queryKey: watermarkKey, queryFn: () => api<Watermark[]>("/watermarks") })
}

export function useWatermarkDefault() {
  return useQuery({
    queryKey: [...watermarkKey, "default"],
    queryFn: async (): Promise<NormalizedWatermarkDefaultResponse> => {
      const data = await api<WatermarkDefaultResponse>("/watermarks/default")
      const defaults = normalizeWatermarkSettingsList(data.defaults ?? data.default)
      return { default: data.default, defaults }
    },
  })
}

export function useSaveWatermarkDefault() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (settings: WatermarkDefaultValue) =>
      api<WatermarkDefaultResponse>("/watermarks/default", {
        method: "PUT",
        body: JSON.stringify(settings),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [...watermarkKey, "default"] })
    },
  })
}

export function useWatermarkUpload() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ file, name }: { file: File; name?: string }) => uploadWatermark(file, name),
    onSuccess: () => { void client.invalidateQueries({ queryKey: watermarkKey }) },
  })
}

type Props = {
  selectedId: string | null
  onSelect: (watermark: Watermark) => void
  onDeleted?: (deletedId: string) => void
  compact?: boolean
}

function formatVideoPill(watermark: Watermark): string {
  const format = videoFormatBadge(watermark)
  if (typeof watermark.durationSec === "number" && Number.isFinite(watermark.durationSec) && watermark.durationSec > 0) {
    const rounded = watermark.durationSec < 10 ? Math.round(watermark.durationSec * 10) / 10 : Math.round(watermark.durationSec)
    return `${format} · ${rounded}s`
  }
  return format
}

/** Library grid + upload. Used in the workspace settings and standalone on /settings. */
export function WatermarkManager({ selectedId, onSelect, onDeleted, compact = false }: Props) {
  const t = useT()
  const client = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const library = useWatermarkLibrary()
  const upload = useWatermarkUpload()
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/watermarks/${id}`, { method: "DELETE" }),
    onSuccess: async (_, id) => {
      if (onDeleted) {
        onDeleted(id)
      } else if (selectedId === id) {
        onSelect({ id: "", name: "", width: 1, height: 1, mimeType: "", createdAt: "", url: "" })
      }
      await client.invalidateQueries({ queryKey: watermarkKey })
      await client.invalidateQueries({ queryKey: [...watermarkKey, "default"] })
      toast.success(t.watermarkDeleted)
    },
    onError: () => toast.error(t.watermarkDeleteFailed),
  })
  const watermarks = library.data ?? []

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setError("")
    try {
      const created = await upload.mutateAsync({ file, name: name.trim() || undefined })
      setName("")
      onSelect(created)
      toast.success(t.watermarkUploaded)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.watermarkUploadFailed)
    }
  }

  return <div className="space-y-3">
    {library.isPending ? <div className="grid grid-cols-3 gap-2">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="aspect-square w-full rounded-lg"/>)}</div>
      : library.isError ? <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-2"><span>{t.watermarkLibraryFailed}</span><Button size="sm" variant="outline" onClick={() => void library.refetch()}>{t.retry}</Button></AlertDescription></Alert>
        : watermarks.length === 0 ? <p className="rounded-lg border border-dashed border-border bg-secondary/20 px-3 py-4 text-center text-xs text-muted-foreground">{t.watermarkEmpty}</p>
          : <div className={`grid max-h-64 gap-2 overflow-y-auto rounded-lg border border-border/70 bg-secondary/20 p-2 ${compact ? "grid-cols-3" : "grid-cols-[repeat(auto-fill,minmax(min(100%,112px),128px))]"}`}>{watermarks.map((watermark) => {
            const video = isVideoWatermark(watermark)
            return <div key={watermark.id} className={`group relative min-w-0 overflow-hidden rounded-lg border bg-card transition-colors ${selectedId === watermark.id ? "border-accent ring-1 ring-accent" : "border-border hover:border-accent/50"}`}>
              <button type="button" aria-pressed={selectedId === watermark.id} aria-label={watermark.name} title={watermark.name} onClick={() => onSelect(watermark)} className="relative block aspect-square w-full cursor-pointer overflow-hidden bg-[linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%),linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%)] bg-[length:12px_12px] bg-[position:0_0,6px_6px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <WatermarkMedia watermark={watermark} compact className="size-full"/>
                {video && <span className="pointer-events-none absolute bottom-1 left-1 inline-flex items-center gap-0.5 rounded-sm bg-black/75 px-1 py-0.5 font-mono text-[9px] font-medium leading-none tabular-nums text-white backdrop-blur-[2px]"><Film aria-hidden="true" className="size-2.5 text-accent"/>{formatVideoPill(watermark)}</span>}
              </button>
              <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground">{watermark.name}</span>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={`${t.watermarkDelete} ${watermark.name}`} className="absolute right-0.5 top-0.5 size-9 bg-background/80 text-muted-foreground opacity-100 transition-opacity hover:text-destructive sm:size-7 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 [@media(hover:none)]:opacity-100"><Trash2 className="size-3"/></Button></AlertDialogTrigger>
                <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t.watermarkDeleteTitle}</AlertDialogTitle><AlertDialogDescription>{t.watermarkDeleteBody.replace("{name}", watermark.name)}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t.cancelAction}</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={(event) => { event.preventDefault(); remove.mutate(watermark.id) }}>{t.watermarkDelete}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
              </AlertDialog>
            </div>
          })}</div>}
    <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,.mov" className="sr-only" onChange={(event) => void onFile(event)} aria-label={t.watermarkUploadNew}/>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" className="min-h-10 max-w-full whitespace-normal sm:min-h-8" disabled={upload.isPending || watermarks.length >= 20} onClick={() => inputRef.current?.click()}>{upload.isPending ? <LoaderCircle aria-hidden="true" className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none"/> : <ImagePlus aria-hidden="true" className="mr-1.5 size-3.5"/>}{t.watermarkUploadNew}</Button>
      {!compact && <Field className="order-last min-w-0 basis-full sm:order-none sm:flex-1"><Input aria-label={t.watermarkNameLabel} placeholder={t.watermarkNamePlaceholder} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="h-9 rounded-md text-sm"/></Field>}
      <span className="text-xs tabular-nums text-muted-foreground">{watermarks.length}/20</span>
    </div>
    <FieldDescription className="text-xs">{t.watermarkUploadHint}</FieldDescription>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
}
