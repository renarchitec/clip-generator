import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Check, CircleAlert, ExternalLink, LoaderCircle, RotateCcw, TriangleAlert, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { YouTubeMark, type SocialAccount, type SocialPlatform } from "@/components/social-accounts"
import { api } from "@/lib/api"
import { relativeAge } from "@/lib/format"
import { useLanguage, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type Privacy = "public" | "unlisted" | "private"
export type PublicationStatus = "queued" | "uploading" | "processing" | "published" | "failed"
export type ClipPublication = { platform: SocialPlatform; status: PublicationStatus; externalUrl: string | null }
export type PublicationResponse = { id: string; clipId: string; platform: SocialPlatform; accountId: string; accountName: string; title: string; caption: string; privacy: Privacy; status: PublicationStatus; progress: number; externalId: string | null; externalUrl: string | null; error: string | null; createdAt: string; updatedAt: string; publishedAt: string | null }
export type PublishableClip = { id: string; title: string; caption?: string | null; hashtags?: string[] }

const TITLE_MAX = 100
const CAPTION_MAX = 5000
const PRIVACY: Privacy[] = ["public", "unlisted", "private"]
const ACTIVE: PublicationStatus[] = ["queued", "uploading", "processing"]
export const isActivePublication = (status: PublicationStatus) => ACTIVE.includes(status)
export const publicationsKey = (clipId: string) => ["clips", clipId, "publications"] as const

type Values = { accountIds: string[]; title: string; caption: string; privacy: Privacy; madeForKids: boolean }

function defaultCaption(clip: PublishableClip) {
  const tags = (clip.hashtags ?? []).map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean).map((tag) => `#${tag}`).join(" ")
  return [clip.caption?.trim(), tags].filter(Boolean).join("\n\n")
}

function Counter({ value, max, id }: { value: number; max: number; id: string }) {
  const locale = useLanguage().language === "id" ? "id-ID" : "en-US"
  const over = value > max
  return <span id={id} aria-live={over ? "polite" : "off"} className={cn("ml-auto font-mono text-[11px] tabular-nums text-muted-foreground", over && "font-semibold text-destructive", !over && value > max * 0.9 && "text-amber-700 dark:text-amber-400")}>{value.toLocaleString(locale)}/{max.toLocaleString(locale)}</span>
}

export function PublishDialog({ clip, open, onOpenChange }: { clip: PublishableClip; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-xl gap-0 p-0 sm:p-0">
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div className="min-w-0"><DialogTitle className="font-display text-lg font-medium tracking-[-.02em]">{t.publishClip}</DialogTitle><DialogDescription className="mt-1 truncate">{clip.title || t.clip}</DialogDescription></div>
        <DialogClose asChild><Button type="button" variant="ghost" className="size-10 shrink-0 px-0" aria-label={t.closePlayer}><X className="size-4"/></Button></DialogClose>
      </div>
      {open && <PublishBody key={clip.id} clip={clip} onClose={() => onOpenChange(false)}/>}
    </DialogContent>
  </Dialog>
}

function PublishBody({ clip, onClose }: { clip: PublishableClip; onClose: () => void }) {
  const t = useT()
  const client = useQueryClient()
  const [view, setView] = useState<"form" | "progress">("form")
  const [submittedIds, setSubmittedIds] = useState<string[]>([])
  const accounts = useQuery({ queryKey: ["social", "accounts"], queryFn: () => api<SocialAccount[]>("/social/accounts") })
  const publications = useQuery({
    queryKey: publicationsKey(clip.id),
    queryFn: () => api<PublicationResponse[]>(`/clips/${clip.id}/publications`),
    refetchInterval: (query) => query.state.data?.some((item) => isActivePublication(item.status)) ? 3000 : false,
  })
  const anyActive = !!publications.data?.some((item) => isActivePublication(item.status))
  const wasActive = useRef(false)
  useEffect(() => {
    if (wasActive.current && !anyActive) {
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      void client.invalidateQueries({ queryKey: ["jobs"] })
    }
    wasActive.current = anyActive
  }, [anyActive, client])

  const youtube = (accounts.data ?? []).filter((account) => account.platform === "youtube")
  const usable = youtube.filter((account) => !account.needsReconnect)
  const [submitError, setSubmitError] = useState("")

  const publish = useMutation({
    mutationFn: (value: Values) => api<PublicationResponse[]>(`/clips/${clip.id}/publish`, { method: "POST", body: JSON.stringify({ targets: value.accountIds.map((accountId) => ({ accountId, title: value.title.trim(), caption: value.caption.trim(), privacy: value.privacy, madeForKids: value.madeForKids })) }) }),
    onSuccess: (created) => {
      setSubmitError("")
      setSubmittedIds(created.map((item) => item.id))
      client.setQueryData<PublicationResponse[]>(publicationsKey(clip.id), (previous = []) => [...created, ...previous.filter((item) => !created.some((next) => next.id === item.id))])
      void client.invalidateQueries({ queryKey: publicationsKey(clip.id) })
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      void client.invalidateQueries({ queryKey: ["jobs"] })
      setView("progress")
      toast.success(t.publishStarted)
    },
    onError: (error) => {
      const status = (error as Error & { status?: number }).status
      setSubmitError(status === 409 ? t.publishConflict : status === 400 ? t.publishInvalid : t.publishFailedGeneric)
    },
  })

  const form = useForm({
    defaultValues: { accountIds: [], title: (clip.title ?? "").slice(0, TITLE_MAX), caption: defaultCaption(clip), privacy: "public", madeForKids: false } as Values,
    onSubmit: ({ value }) => { setSubmitError(""); publish.mutate(value) },
  })
  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || !usable.length) return
    prefilled.current = true
    form.setFieldValue("accountIds", [usable[0].id])
  }, [usable, form])

  if (accounts.isPending) return <div role="status" aria-label={t.loading} className="space-y-4 px-5 py-5 sm:px-6"><Skeleton className="h-14 w-full rounded-lg"/><Skeleton className="h-9 w-full"/><Skeleton className="h-28 w-full"/></div>
  if (accounts.isError) return <div className="px-5 py-5 sm:px-6"><Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{t.socialLoadError}</span><Button variant="outline" onClick={() => void accounts.refetch()}>{t.retry}</Button></AlertDescription></Alert></div>

  const history = (publications.data ?? []).filter((item) => !submittedIds.includes(item.id))
  const current = (publications.data ?? []).filter((item) => submittedIds.includes(item.id))

  if (!youtube.length) return <div className="px-5 py-8 text-center sm:px-6">
    <span className="mx-auto grid size-12 place-items-center rounded-xl border border-border bg-background"><YouTubeMark className="size-6"/></span>
    <p className="mt-4 font-medium">{t.publishNoAccounts}</p>
    <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t.publishNoAccountsBody}</p>
    <Button asChild className="mt-5 h-10 px-4"><Link to="/settings" onClick={onClose}>{t.publishGoToSettings}</Link></Button>
    {history.length > 0 && <div className="mt-8 text-left"><PublicationList title={t.publishHistory} items={history} clipId={clip.id}/></div>}
  </div>

  if (view === "progress") return <div className="space-y-6 px-5 py-5 sm:px-6">
    <PublicationList title={t.publishProgress} items={current} clipId={clip.id} live/>
    {publications.isError && <p className="text-sm text-destructive">{t.publishLoadError}</p>}
    {history.length > 0 && <PublicationList title={t.publishHistory} items={history} clipId={clip.id}/>}
    <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
      <Button type="button" variant="outline" className="h-10 px-4" onClick={() => { setView("form"); setSubmittedIds([]) }}>{t.publishAnother}</Button>
      <Button type="button" className="h-10 px-4" onClick={onClose}>{t.publishDone}</Button>
    </div>
  </div>

  return <form noValidate onSubmit={(event) => { event.preventDefault(); void form.handleSubmit() }}>
    <div className="space-y-6 px-5 py-5 sm:px-6">
      <FieldGroup className="gap-5">
        <form.Field name="accountIds" validators={{ onSubmit: ({ value }) => value.length ? undefined : t.publishChooseAccount }}>
          {(field) => <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t.publishTo}</legend>
            <div className="grid gap-2">
              {youtube.map((account) => {
                const checked = field.state.value.includes(account.id)
                const disabled = account.needsReconnect
                return <button key={account.id} type="button" role="checkbox" aria-checked={checked} disabled={disabled} onClick={() => field.handleChange(checked ? field.state.value.filter((id) => id !== account.id) : [...field.state.value, account.id])} className={cn("flex min-h-14 w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-background", checked && "border-primary/40 bg-primary/[.04]")}>
                  <AccountAvatar account={account}/>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{account.displayName}</span><span className={cn("block text-xs text-muted-foreground", disabled && "text-amber-700 dark:text-amber-400")}>{disabled ? t.publishNeedsReconnect : t.socialPlatforms.youtube}</span></span>
                  <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-[5px] border border-input transition-colors", checked && "border-primary bg-primary text-primary-foreground")}>{checked && <Check className="size-3.5" strokeWidth={3}/>}</span>
                </button>
              })}
            </div>
            {field.state.meta.errors.length > 0 && <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>}
          </fieldset>}
        </form.Field>

        <form.Field name="title" validators={{ onChange: ({ value }) => !value.trim() ? t.publishTitleRequired : value.length > TITLE_MAX ? t.publishTitleTooLong : undefined }}>
          {(field) => { const invalid = field.state.meta.isTouched && !field.state.meta.isValid; return <Field data-invalid={invalid}>
            <div className="flex items-center gap-2"><FieldLabel htmlFor="publish-title">{t.publishTitleLabel}</FieldLabel><Counter id="publish-title-count" value={field.state.value.length} max={TITLE_MAX}/></div>
            <Input id="publish-title" name="title" className="h-10" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} onBlur={field.handleBlur} aria-invalid={invalid} aria-required="true" aria-describedby="publish-title-count"/>
            {invalid && <FieldDescription className="text-destructive">{field.state.meta.errors[0]}</FieldDescription>}
          </Field> }}
        </form.Field>

        <form.Field name="caption" validators={{ onChange: ({ value }) => value.length > CAPTION_MAX ? t.publishCaptionTooLong : undefined }}>
          {(field) => { const invalid = field.state.meta.isTouched && !field.state.meta.isValid; return <Field data-invalid={invalid}>
            <div className="flex items-center gap-2"><FieldLabel htmlFor="publish-caption">{t.publishCaptionLabel}</FieldLabel><Counter id="publish-caption-count" value={field.state.value.length} max={CAPTION_MAX}/></div>
            <textarea id="publish-caption" name="caption" rows={5} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} onBlur={field.handleBlur} aria-invalid={invalid} aria-describedby="publish-caption-count" className="field-sizing-content max-h-64 min-h-28 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"/>
            {invalid && <FieldDescription className="text-destructive">{field.state.meta.errors[0]}</FieldDescription>}
          </Field> }}
        </form.Field>

        <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
          <form.Field name="privacy">
            {(field) => <Field>
              <FieldLabel htmlFor="publish-privacy">{t.publishPrivacy}</FieldLabel>
              <Select value={field.state.value} onValueChange={(value) => field.handleChange(value as Privacy)}>
                <SelectTrigger id="publish-privacy" className="h-10 w-full" aria-describedby="publish-privacy-hint"><SelectValue/></SelectTrigger>
                <SelectContent position="popper">{PRIVACY.map((option) => <SelectItem key={option} value={option}>{t.privacyOptions[option]}</SelectItem>)}</SelectContent>
              </Select>
              <FieldDescription id="publish-privacy-hint" className="text-xs">{t.privacyHints[field.state.value]}</FieldDescription>
            </Field>}
          </form.Field>
          <form.Field name="madeForKids">
            {(field) => <Field>
              <div className="flex min-h-5 items-center justify-between gap-3"><FieldLabel htmlFor="publish-kids">{t.publishMadeForKids}</FieldLabel><Switch id="publish-kids" checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked)} aria-describedby="publish-kids-hint"/></div>
              <FieldDescription id="publish-kids-hint" className="text-xs">{t.publishMadeForKidsHint}</FieldDescription>
            </Field>}
          </form.Field>
        </div>
      </FieldGroup>

      <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground"><YouTubeMark className="mt-0.5 size-4 shrink-0"/>{t.publishShortsNote}</p>

      {submitError && <Alert variant="destructive"><CircleAlert/><AlertDescription>{submitError}</AlertDescription></Alert>}

      {history.length > 0 && <PublicationList title={t.publishHistory} items={history} clipId={clip.id}/>}
    </div>
    <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card px-5 py-3 sm:px-6">
      <Button type="button" variant="ghost" className="h-10 px-4" onClick={onClose}>{t.cancelAction}</Button>
      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting, state.values.accountIds.length] as const}>
        {([canSubmit, isSubmitting, count]) => <Button type="submit" className="h-10 min-w-32 px-4" disabled={publish.isPending || isSubmitting || !canSubmit || !count}>{publish.isPending ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin"/>{t.publishSubmitting}</> : <>{t.publishSubmit}{count > 1 && <span className="tabular-nums opacity-70">· {count}</span>}</>}</Button>}
      </form.Subscribe>
    </div>
  </form>
}

function AccountAvatar({ account }: { account: SocialAccount }) {
  const [failed, setFailed] = useState(false)
  return <span className="relative shrink-0">
    {account.avatarUrl && !failed
      ? <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="size-9 rounded-full bg-muted object-cover"/>
      : <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{account.displayName.trim()[0]?.toUpperCase() ?? "?"}</span>}
    <span className="absolute -bottom-0.5 -right-1 grid size-4 place-items-center rounded-full bg-card"><YouTubeMark className="size-3.5"/></span>
  </span>
}

function PublicationList({ title, items, clipId, live = false }: { title: string; items: PublicationResponse[]; clipId: string; live?: boolean }) {
  const t = useT()
  return <section aria-label={title}>
    <h3 className="mb-2 text-xs font-medium uppercase tracking-[.08em] text-muted-foreground">{title}</h3>
    {items.length ? <ul aria-live={live ? "polite" : undefined} className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">{items.map((item) => <PublicationRow key={item.id} item={item} clipId={clipId}/>)}</ul>
      : live ? <div className="space-y-2 rounded-lg border border-border p-3"><Skeleton className="h-4 w-1/2"/><Skeleton className="h-1 w-full"/></div>
      : <p className="text-sm text-muted-foreground">{t.publishHistoryEmpty}</p>}
  </section>
}

function PublicationRow({ item, clipId }: { item: PublicationResponse; clipId: string }) {
  const t = useT()
  const locale = useLanguage().language === "id" ? "id-ID" : "en-US"
  const client = useQueryClient()
  const retry = useMutation({
    mutationFn: () => api<PublicationResponse>(`/publications/${item.id}/retry`, { method: "POST" }),
    onSuccess: (next) => {
      if (next?.id) client.setQueryData<PublicationResponse[]>(publicationsKey(clipId), (previous = []) => previous.map((row) => row.id === next.id ? next : row))
      void client.invalidateQueries({ queryKey: publicationsKey(clipId) })
    },
    onError: () => toast.error(t.retryUploadFailed),
  })
  const progress = Math.max(0, Math.min(100, Math.round(item.progress)))
  const when = item.publishedAt ?? item.updatedAt ?? item.createdAt
  return <li className="px-3 py-3">
    <div className="flex items-center gap-3">
      <StatusIcon status={item.status}/>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.accountName}</p>
        <p className="truncate text-xs text-muted-foreground"><span className={cn(item.status === "failed" && "text-destructive", item.status === "published" && "text-foreground")}>{t.publishStatus[item.status]}{item.status === "uploading" && <span className="tabular-nums"> · {progress}%</span>}</span> · {t.privacyOptions[item.privacy] ?? item.privacy} · {relativeAge(when, locale)}</p>
      </div>
      {item.status === "published" && item.externalUrl && <a href={item.externalUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted">{t.openOnYouTube}<ExternalLink aria-hidden="true" className="size-3.5"/></a>}
      {item.status === "failed" && <Button type="button" variant="outline" className="h-9 shrink-0 px-3" disabled={retry.isPending} onClick={() => retry.mutate()}>{retry.isPending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin"/> : <RotateCcw aria-hidden="true" className="size-3.5"/>}{t.retryUpload}</Button>}
    </div>
    {item.status === "uploading" && <Progress value={progress} aria-label={`${t.publishStatus.uploading} ${progress}%`} className="mt-2.5 h-1.5"/>}
    {(item.status === "queued" || item.status === "processing") && <div aria-hidden="true" className="publish-indeterminate mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full w-1/3 rounded-full bg-primary/60"/></div>}
    {item.status === "failed" && item.error && <p className="mt-2 rounded-md bg-destructive/5 px-2.5 py-2 text-xs leading-5 text-destructive">{item.error}</p>}
  </li>
}

function StatusIcon({ status }: { status: PublicationStatus }) {
  if (status === "published") return <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent/15 text-accent"><Check aria-hidden="true" className="size-4" strokeWidth={2.5}/></span>
  if (status === "failed") return <span className="grid size-8 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"><TriangleAlert aria-hidden="true" className="size-4"/></span>
  return <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin"/></span>
}
