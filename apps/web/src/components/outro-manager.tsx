import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Clapperboard, LoaderCircle, Play, Trash2, Upload } from "lucide-react"
import { useRef, useState, type ChangeEvent } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { formatBytes, formatOutroDuration, isOutroFileType, OUTRO_ACCEPT, OUTRO_MAX_BYTES, OUTRO_MAX_COUNT, outroFileUrl, uploadOutro, type Outro } from "@/lib/outro"
import { cn } from "@/lib/utils"

export const outroKey = ["outros"] as const
const outroDefaultKey = [...outroKey, "default"] as const

export function useOutroLibrary() {
  return useQuery({ queryKey: outroKey, queryFn: () => api<Outro[]>("/outros") })
}

export function useOutroDefault() {
  return useQuery({ queryKey: outroDefaultKey, queryFn: () => api<{ default: { outroId: string } | null }>("/outros/default") })
}

export function useOutroUpload() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ file, name }: { file: File; name?: string }) => uploadOutro(file, name),
    onSuccess: () => { void client.invalidateQueries({ queryKey: outroKey }) },
  })
}

/** Muted, looping preview. Plays on hover/focus; tap toggles on touch screens. */
export function OutroPreview({ outro, className }: { outro: Pick<Outro, "id" | "name">; className?: string }) {
  const t = useT()
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const start = () => { void ref.current?.play().catch(() => {}) }
  const stop = () => {
    const video = ref.current
    if (!video) return
    video.pause()
    video.currentTime = 0
  }
  return <button
    type="button"
    aria-label={t.outroPreviewLabel.replace("{name}", outro.name)}
    onMouseEnter={start}
    onMouseLeave={stop}
    onFocus={start}
    onBlur={stop}
    onClick={() => (playing ? stop() : start())}
    className={cn("group/preview relative block shrink-0 cursor-pointer overflow-hidden rounded-md border border-border bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
  >
    <video ref={ref} src={`${outroFileUrl(outro.id)}#t=0.1`} muted loop playsInline preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} className="size-full object-contain"/>
    <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0 grid place-items-center bg-black/25 transition-opacity", playing ? "opacity-0" : "opacity-100")}><Play className="size-4 fill-white text-white"/></span>
  </button>
}

/** Outro library: upload, preview, default, delete. Lives on /settings. */
export function OutroManager() {
  const t = useT()
  const client = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const library = useOutroLibrary()
  const defaults = useOutroDefault()
  const upload = useOutroUpload()
  const defaultId = defaults.data?.default?.outroId ?? null
  const outros = library.data ?? []

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: outroKey })
    await client.invalidateQueries({ queryKey: outroDefaultKey })
  }
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/outros/${id}`, { method: "DELETE" }),
    onSuccess: async () => { await refresh(); toast.success(t.outroDeleted) },
    onError: () => toast.error(t.outroDeleteFailed),
  })
  const setDefault = useMutation({
    mutationFn: (id: string | null) => api<{ default: { outroId: string } | null }>("/outros/default", { method: "PUT", body: JSON.stringify(id ? { outroId: id } : null) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: outroDefaultKey }) },
    onError: () => toast.error(t.outroDefaultFailed),
  })

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setError("")
    if (!isOutroFileType(file)) { setError(t.outroBadType); return }
    if (file.size > OUTRO_MAX_BYTES) { setError(t.outroTooLarge); return }
    try {
      await upload.mutateAsync({ file, name: name.trim() || undefined })
      setName("")
      toast.success(t.outroUploaded)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.outroUploadFailed)
    }
  }

  const full = outros.length >= OUTRO_MAX_COUNT

  return <div className="space-y-3">
    {library.isPending ? <div className="space-y-2">{Array.from({ length: 2 }).map((_, index) => <Skeleton key={index} className="h-[72px] w-full rounded-lg"/>)}</div>
      : library.isError ? <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-2"><span>{t.outroLibraryFailed}</span><Button size="sm" variant="outline" onClick={() => void library.refetch()}>{t.retry}</Button></AlertDescription></Alert>
        : outros.length === 0 ? <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-secondary/20 px-3 py-6 text-center"><span aria-hidden="true" className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground"><Clapperboard className="size-4"/></span><p className="text-xs text-muted-foreground">{t.outroEmpty}</p></div>
          : <ul className="space-y-2">{outros.map((outro) => {
            const isDefault = outro.id === defaultId
            return <li key={outro.id} className={cn("flex flex-wrap items-center gap-3 rounded-lg border bg-card p-2.5 transition-colors", isDefault ? "border-accent/60 ring-1 ring-accent/40" : "border-border")}>
              <OutroPreview outro={outro} className="h-14 w-20"/>
              <div className="min-w-0 flex-1 basis-40">
                <div className="flex min-w-0 items-center gap-2"><p className="truncate text-sm font-medium" title={outro.name}>{outro.name}</p>{isDefault && <Badge variant="secondary" className="shrink-0">{t.outroDefault}</Badge>}</div>
                <p className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">{formatOutroDuration(outro.durationSec)} · {outro.width}×{outro.height} · {formatBytes(outro.sizeBytes)}</p>
              </div>
              <div className="ml-auto flex items-center gap-1">
                {isDefault
                  ? <Button type="button" variant="ghost" size="sm" disabled={setDefault.isPending} onClick={() => setDefault.mutate(null)}>{t.outroClearDefault}</Button>
                  : <Button type="button" variant="outline" size="sm" disabled={setDefault.isPending} onClick={() => setDefault.mutate(outro.id)}>{t.outroSetDefault}</Button>}
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={`${t.outroDelete} ${outro.name}`} className="size-8 text-muted-foreground hover:text-destructive"><Trash2 className="size-4"/></Button></AlertDialogTrigger>
                  <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t.outroDeleteTitle}</AlertDialogTitle><AlertDialogDescription>{t.outroDeleteBody.replace("{name}", outro.name)}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t.cancelAction}</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={(event) => { event.preventDefault(); remove.mutate(outro.id) }}>{remove.isPending && <LoaderCircle aria-hidden="true" className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none"/>}{t.outroDelete}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                </AlertDialog>
              </div>
            </li>
          })}</ul>}
    <input ref={inputRef} type="file" accept={OUTRO_ACCEPT} className="sr-only" tabIndex={-1} onChange={(event) => void onFile(event)} aria-label={t.outroUploadNew}/>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={upload.isPending || full} onClick={() => inputRef.current?.click()}>{upload.isPending ? <LoaderCircle aria-hidden="true" className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none"/> : <Upload aria-hidden="true" className="mr-1.5 size-3.5"/>}{upload.isPending ? t.outroUploading : t.outroUploadNew}</Button>
      <Field className="min-w-0 flex-1"><Input aria-label={t.outroNameLabel} placeholder={t.outroNamePlaceholder} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="h-9 rounded-md text-sm"/></Field>
      <span className="text-xs tabular-nums text-muted-foreground">{outros.length}/{OUTRO_MAX_COUNT}</span>
    </div>
    <FieldDescription>{t.outroUploadHint}</FieldDescription>
    {full && <p className="text-xs text-muted-foreground">{t.outroLimitReached}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
}
