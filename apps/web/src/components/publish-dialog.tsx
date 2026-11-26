import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Check, CircleAlert, ExternalLink, Eye, Heart, Info, LoaderCircle, MessageCircle, RefreshCw, RotateCcw, Send, Sparkles, TriangleAlert, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { YouTubeMark, TikTokMark, InstagramMark, type SocialAccount, type SocialPlatform } from "@/components/social-accounts"
import { api, CAPTION_LANGUAGES, isCaptionLanguage, type CaptionLanguage, type TikTokCreatorInfo } from "@/lib/api"
import { relativeAge } from "@/lib/format"
import { formatCompactCount, formatExactCount, summarizeClipViews } from "@/lib/format-views"
import { useLanguage, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type Privacy = "public" | "unlisted" | "private"
export type PublicationStatus = "queued" | "uploading" | "processing" | "published" | "failed"
export type ClipPublication = {
  platform: SocialPlatform
  status: PublicationStatus
  externalUrl: string | null
  mode?: "direct" | "inbox"
  viewCount?: number | null
  likeCount?: number | null
  commentCount?: number | null
  metricsUpdatedAt?: string | null
  metricsError?: string | null
}
export type PublicationResponse = {
  id: string
  clipId: string
  platform: SocialPlatform
  accountId: string | null
  accountName: string
  title: string
  caption: string
  privacy: string
  mode: "direct" | "inbox"
  status: PublicationStatus
  progress: number
  externalId: string | null
  externalUrl: string | null
  error: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  viewCount: number | null
  likeCount: number | null
  commentCount: number | null
  metricsUpdatedAt: string | null
  metricsError: string | null
}
export interface RefreshMetricsResponse {
  publications: PublicationResponse[]
  refreshed: number
  skipped: number
  nextAllowedAt: string | null
}
export function refreshClipPublicationMetrics(clipId: string) {
  return api<RefreshMetricsResponse>(`/clips/${clipId}/publications/refresh-metrics`, {
    method: "POST",
    body: JSON.stringify({}),
  })
}
export function metricsErrorMessage(code: string | null | undefined, t: ReturnType<typeof useT>): string {
  if (!code) return t.metricsErrorUnknown
  return t.metricsErrors[code as keyof typeof t.metricsErrors] ?? t.metricsErrorUnknown
}
export type PublishableClip = { id: string; title: string; caption?: string | null; hashtags?: string[]; startSec?: number; endSec?: number }
const TITLE_MAX = 100
const CAPTION_MAX = 5000
const TIKTOK_CAPTION_MAX = 2200
const INSTAGRAM_CAPTION_MAX = 2200
const INSTAGRAM_HASHTAG_MAX = 30
const PRIVACY: Privacy[] = ["public", "unlisted", "private"]
const ACTIVE: PublicationStatus[] = ["queued", "uploading", "processing"]
const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]
export const isActivePublication = (status: PublicationStatus) => ACTIVE.includes(status)
export const publicationsKey = (clipId: string) => ["clips", clipId, "publications"] as const

type Values = { accountIds: string[]; title: string; caption: string; privacy: Privacy; madeForKids: boolean }
type CaptionResponse = { caption: string; hashtags: string[] }
function formatCaption(caption: string | null | undefined, hashtags: string[] | undefined) {
  const tags = (hashtags ?? []).map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean).map((tag) => `#${tag}`).join(" ")
  return [caption?.trim(), tags].filter(Boolean).join("\n\n")
}
function defaultCaption(clip: PublishableClip) { return formatCaption(clip.caption, clip.hashtags) }
function Counter({ value, max, id, className }: { value: number; max: number; id: string; className?: string }) {
  const locale = useLanguage().language === "id" ? "id-ID" : "en-US"
  const over = value > max
  return <span id={id} aria-live={over ? "polite" : "off"} className={cn("ml-auto font-mono text-[11px] tabular-nums text-muted-foreground", over && "font-semibold text-destructive", !over && value > max * 0.9 && "text-amber-700 dark:text-amber-400", className)}>{value.toLocaleString(locale)}/{max.toLocaleString(locale)}</span>
}
export function PublishDialog({ clip, open, onOpenChange }: { clip: PublishableClip; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-xl gap-0 p-0 sm:p-0" onInteractOutside={(event) => { if ((event.target as Element | null)?.closest?.("[data-sonner-toaster]")) event.preventDefault() }}>
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6"><div className="min-w-0"><DialogTitle className="font-display text-lg font-medium tracking-[-.02em]">{t.publishClip}</DialogTitle><DialogDescription className="mt-1 truncate">{clip.title || t.clip}</DialogDescription></div><DialogClose asChild><Button type="button" variant="ghost" className="size-10 shrink-0 px-0" aria-label={t.closePlayer}><X className="size-4"/></Button></DialogClose></div>
    {open && <PublishBody key={clip.id} clip={clip} onClose={() => onOpenChange(false)}/>}
  </DialogContent></Dialog>
}
function PublishBody({ clip, onClose }: { clip: PublishableClip; onClose: () => void }) {
  const t = useT(), locale = useLanguage().language === "id" ? "id-ID" : "en-US", client = useQueryClient()
  const [view, setView] = useState<"form" | "progress">("form")
  const [submittedIds, setSubmittedIds] = useState<string[]>([])
  const [mode, setMode] = useState<"direct" | "inbox">("direct")
  const [privacyLevel, setPrivacyLevel] = useState("")
  const [allowComment, setAllowComment] = useState(false), [allowDuet, setAllowDuet] = useState(false), [allowStitch, setAllowStitch] = useState(false)
  const [disclose, setDisclose] = useState(false), [brandOrganic, setBrandOrganic] = useState(false), [brandContent, setBrandContent] = useState(false)
  const [submitError, setSubmitError] = useState("")
  const accounts = useQuery({ queryKey: ["social", "accounts"], queryFn: () => api<SocialAccount[]>("/social/accounts") })
  const publications = useQuery({ queryKey: publicationsKey(clip.id), queryFn: () => api<PublicationResponse[]>(`/clips/${clip.id}/publications`), refetchInterval: (query) => query.state.data?.some((item) => isActivePublication(item.status)) ? 3000 : false })
  const wasActive = useRef(false), anyActive = !!publications.data?.some((item) => isActivePublication(item.status))
  useEffect(() => { if (wasActive.current && !anyActive) { void client.invalidateQueries({ queryKey: ["clips", "recent"] }); void client.invalidateQueries({ queryKey: ["jobs"] }) } wasActive.current = anyActive }, [anyActive, client])
  const available = accounts.data ?? []
  const usable = available.filter((account) => !account.needsReconnect)
  const form = useForm({ defaultValues: { accountIds: [], title: (clip.title ?? "").slice(0, TITLE_MAX), caption: defaultCaption(clip), privacy: "public", madeForKids: false } as Values, onSubmit: ({ value }) => { setSubmitError(""); publish.mutate(value) } })
  const selectedIds = useStore(form.store, (state) => state.values.accountIds)
  const selected = available.filter((item) => selectedIds.includes(item.id))
  const selectedTikTok = selected.filter((item) => item.platform === "tiktok")
  const selectedYouTube = selected.filter((item) => item.platform === "youtube")
  const selectedInstagram = selected.filter((item) => item.platform === "instagram")
  const tiktokAccount = selectedTikTok[0]
  const creatorQuery = useQuery({ queryKey: ["social", "accounts", tiktokAccount?.id, "tiktok", "creator-info"], queryFn: () => api<TikTokCreatorInfo>(`/social/accounts/${tiktokAccount!.id}/tiktok/creator-info`), enabled: !!tiktokAccount && mode === "direct", staleTime: 0, refetchOnMount: "always" })
  const caption = useStore(form.store, (state) => state.values.caption)
  const captionTooLongTikTok = !!selectedTikTok.length && caption.length > TIKTOK_CAPTION_MAX
  const captionTooLongInstagram = !!selectedInstagram.length && caption.length > INSTAGRAM_CAPTION_MAX
  const hashtagCount = (caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length
  const tooManyInstagramHashtags = !!selectedInstagram.length && hashtagCount > INSTAGRAM_HASHTAG_MAX
  const brandedCantPrivate = brandContent && privacyLevel === "SELF_ONLY"
  const duration = clip.startSec !== undefined && clip.endSec !== undefined ? Math.max(0, clip.endSec - clip.startSec) : null
  const durationTooLong = !!duration && !!creatorQuery.data && duration > creatorQuery.data.maxVideoPostDurationSec
  const disclosureInvalid = disclose && !brandOrganic && !brandContent
  const publish = useMutation({
    mutationFn: (value: Values) => api<PublicationResponse[]>(`/clips/${clip.id}/publish`, { method: "POST", body: JSON.stringify({ targets: value.accountIds.map((accountId) => { const account = available.find((item) => item.id === accountId)!; if (account.platform === "instagram") return { accountId, title: "", caption: value.caption.trim() }; return account.platform === "youtube" ? { accountId, title: value.title.trim(), caption: value.caption.trim(), privacy: value.privacy, madeForKids: value.madeForKids } : mode === "inbox" ? { accountId, mode: "inbox", title: "", caption: value.caption.trim() } : { accountId, mode: "direct", title: "", caption: value.caption.trim(), tiktok: { privacyLevel, disableComment: !allowComment, disableDuet: !allowDuet, disableStitch: !allowStitch, brandContent, brandOrganic } } }) }) }),
    onSuccess: (created) => { setSubmitError(""); setSubmittedIds(created.map((item) => item.id)); client.setQueryData<PublicationResponse[]>(publicationsKey(clip.id), (previous = []) => [...created, ...previous.filter((item) => !created.some((next) => next.id === item.id))]); void client.invalidateQueries({ queryKey: publicationsKey(clip.id) }); void client.invalidateQueries({ queryKey: ["clips", "recent"] }); void client.invalidateQueries({ queryKey: ["jobs"] }); setView("progress"); toast.success(t.publishStarted) },
    onError: (error) => { const status = (error as Error & { status?: number }).status; setSubmitError(status === 409 ? t.publishConflict : status === 400 ? t.publishInvalid : t.publishFailedGeneric) },
  })
  const [captionLanguage, setCaptionLanguage] = useState<CaptionLanguage>("auto")
  const regenerate = useMutation({ mutationFn: (language: CaptionLanguage) => api<CaptionResponse>(`/clips/${clip.id}/caption`, { method: "POST", body: JSON.stringify({ language }) }), onSuccess: (result) => { const previous = form.getFieldValue("caption"), next = formatCaption(result.caption, result.hashtags); form.setFieldValue("caption", next); void client.invalidateQueries({ queryKey: ["clips"] }); void client.invalidateQueries({ queryKey: ["jobs"] }); if (previous !== next) toast.success(t.captionRegenerated, { action: { label: t.captionUndo, onClick: () => form.setFieldValue("caption", previous) } }) }, onError: (error) => toast.error((error as Error & { status?: number }).status === 503 ? t.captionUnavailable : t.captionFailed) })
  const prefilled = useRef(false)
  useEffect(() => { if (prefilled.current || !usable.length) return; prefilled.current = true; form.setFieldValue("accountIds", [usable[0].id]) }, [usable, form])
  useEffect(() => { setPrivacyLevel(""); setAllowComment(false); setAllowDuet(false); setAllowStitch(false); setBrandOrganic(false); setBrandContent(false); setDisclose(false) }, [tiktokAccount?.id])
  if (accounts.isPending) return <div role="status" aria-label={t.loading} className="space-y-4 px-5 py-5 sm:px-6"><Skeleton className="h-14 w-full rounded-lg"/><Skeleton className="h-9 w-full"/><Skeleton className="h-28 w-full"/></div>
  if (accounts.isError) return <div className="px-5 py-5 sm:px-6"><Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{t.socialLoadError}</span><Button variant="outline" onClick={() => void accounts.refetch()}>{t.retry}</Button></AlertDescription></Alert></div>
  const history = (publications.data ?? []).filter((item) => !submittedIds.includes(item.id)), current = (publications.data ?? []).filter((item) => submittedIds.includes(item.id))
  if (!available.length) return <div className="px-5 py-8 text-center sm:px-6"><span className="mx-auto grid size-12 place-items-center rounded-xl border border-border bg-background"><Send aria-hidden="true" className="size-5 text-muted-foreground"/></span><p className="mt-4 font-medium">{t.publishNoAccounts}</p><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t.publishNoAccountsBody}</p><Button asChild className="mt-5 h-10 px-4"><Link to="/settings" onClick={onClose}>{t.publishGoToSettings}</Link></Button>{history.length > 0 && <div className="mt-8 text-left"><PublicationList title={t.publishHistory} items={history} clipId={clip.id}/></div>}</div>
  if (view === "progress") return <div className="space-y-6 px-5 py-5 sm:px-6"><PublicationList title={t.publishProgress} items={current} clipId={clip.id} live/>{publications.isError && <p className="text-sm text-destructive">{t.publishLoadError}</p>}{history.length > 0 && <PublicationList title={t.publishHistory} items={history} clipId={clip.id}/>}<div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" className="h-10 px-4" onClick={() => { setView("form"); setSubmittedIds([]) }}>{t.publishAnother}</Button><Button type="button" className="h-10 px-4" onClick={onClose}>{t.publishDone}</Button></div></div>
  const submitBlocked = !selectedIds.length || captionTooLongInstagram || tooManyInstagramHashtags || (selectedTikTok.length > 0 && (captionTooLongTikTok || (mode === "direct" && (!privacyLevel || brandedCantPrivate || disclosureInvalid || creatorQuery.isPending || creatorQuery.isError || !creatorQuery.data?.privacyLevelOptions.includes(privacyLevel) || durationTooLong))))
  return <form noValidate onSubmit={(event) => { event.preventDefault(); void form.handleSubmit() }}><div className="space-y-6 px-5 py-5 sm:px-6"><FieldGroup className="gap-5">
    <form.Field name="accountIds" validators={{ onSubmit: ({ value }) => value.length ? undefined : t.publishChooseAccount }}>{(field) => <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t.publishTo}</legend><div className="grid gap-2">{available.map((account) => { const checked = field.state.value.includes(account.id), disabled = account.needsReconnect; return <button key={account.id} type="button" role="checkbox" aria-checked={checked} disabled={disabled} onClick={() => field.handleChange(checked ? field.state.value.filter((id) => id !== account.id) : [...(account.platform === "tiktok" ? field.state.value.filter((id) => available.find((item) => item.id === id)?.platform !== "tiktok") : field.state.value), account.id])} className={cn("flex min-h-14 w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-background", checked && "border-primary/40 bg-primary/[.04]")}><AccountAvatar account={account}/><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{account.displayName}</span><span className={cn("block text-xs text-muted-foreground", disabled && "text-amber-700 dark:text-amber-400")}>{disabled ? t.publishNeedsReconnect : t.socialPlatforms[account.platform]}</span></span><span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-[5px] border border-input transition-colors", checked && "border-primary bg-primary text-primary-foreground")}>{checked && <Check className="size-3.5" strokeWidth={3}/>}</span></button> })}</div>{field.state.meta.errors.length > 0 && <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>}</fieldset>}</form.Field>
    {selectedTikTok.length > 0 && <section className="space-y-4 rounded-xl border border-border bg-muted/20 p-3 sm:p-4"><h3 className="text-sm font-semibold">TikTok</h3><Field><FieldLabel>{t.tiktokModeLabel}</FieldLabel><div className="grid gap-2 sm:grid-cols-2">{(["direct", "inbox"] as const).map((option) => <button key={option} type="button" aria-pressed={mode === option} onClick={() => setMode(option)} className={cn("rounded-lg border p-3 text-left transition-colors", mode === option ? "border-primary/50 bg-primary/[.05]" : "border-border bg-background hover:bg-muted/50")}><span className="block text-sm font-medium">{option === "direct" ? t.tiktokModeDirect : t.tiktokModeInbox}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{option === "direct" ? t.tiktokModeDirectHint : t.tiktokModeInboxHint}</span></button>)}</div></Field>
      {mode === "inbox" ? <div className="space-y-3 rounded-lg bg-background p-3"><p className="text-sm leading-5 text-muted-foreground">{t.tiktokInboxNote}</p><Button type="button" variant="outline" className="h-9" onClick={() => { void navigator.clipboard.writeText(form.getFieldValue("caption")).then(() => toast.success(t.tiktokCaptionCopied)).catch(() => toast.error(t.tiktokCopyFailed)) }}>{t.tiktokCopyCaption}</Button></div> : <>
        <p className="rounded-lg bg-amber-500/10 px-3 py-2.5 text-xs leading-5 text-amber-900 dark:text-amber-200">{t.tiktokUnauditedNote}</p>
        {creatorQuery.isPending ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin"/>{t.tiktokCreatorLoading}</p> : creatorQuery.isError ? <Alert variant="destructive"><AlertDescription className="flex items-center justify-between gap-2"><span>{t.tiktokCreatorError}</span><Button type="button" variant="outline" onClick={() => void creatorQuery.refetch()}>{t.retry}</Button></AlertDescription></Alert> : creatorQuery.data && <>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">{creatorQuery.data.avatarUrl ? <img src={creatorQuery.data.avatarUrl} alt="" className="size-10 rounded-full object-cover"/> : <AccountAvatar account={tiktokAccount!}/>}<div><p className="text-sm font-medium">{creatorQuery.data.nickname}</p><p className="text-xs text-muted-foreground">@{creatorQuery.data.username}</p></div></div>
          <Field><FieldLabel htmlFor="tiktok-privacy">{t.tiktokPrivacyLabel}</FieldLabel><Select value={privacyLevel} onValueChange={setPrivacyLevel}><SelectTrigger id="tiktok-privacy" className="h-10 w-full"><SelectValue placeholder={t.tiktokPrivacyPlaceholder}/></SelectTrigger><SelectContent position="popper">{creatorQuery.data.privacyLevelOptions.filter((option) => TIKTOK_PRIVACY.includes(option)).map((option) => <SelectItem key={option} value={option} disabled={brandContent && option === "SELF_ONLY"}>{t.tiktokPrivacy[option as keyof typeof t.tiktokPrivacy]}{brandContent && option === "SELF_ONLY" ? ` — ${t.tiktokBrandedNotPrivate}` : ""}</SelectItem>)}</SelectContent></Select>{brandContent && privacyLevel === "SELF_ONLY" && <FieldDescription className="text-destructive">{t.tiktokBrandedNotPrivate}</FieldDescription>}</Field>
          <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t.tiktokInteractions}</legend>{([ ["comment", allowComment, setAllowComment, creatorQuery.data.commentDisabled, t.tiktokAllowComments], ["duet", allowDuet, setAllowDuet, creatorQuery.data.duetDisabled, t.tiktokAllowDuet], ["stitch", allowStitch, setAllowStitch, creatorQuery.data.stitchDisabled, t.tiktokAllowStitch] ] as const).map(([key, enabled, setter, disabled, label]) => <div key={key} className="flex items-center justify-between gap-3"><label htmlFor={`tiktok-${key}`} className={cn("text-sm", disabled && "text-muted-foreground")}>{label}{disabled && <span className="ml-2 text-xs">{t.tiktokInteractionOff}</span>}</label><Switch id={`tiktok-${key}`} checked={enabled} disabled={disabled} onCheckedChange={setter}/></div>)}</fieldset>
          <div className="space-y-3 rounded-lg border border-border bg-background p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">{t.tiktokDisclose}</p><p className="text-xs text-muted-foreground">{t.tiktokDiscloseHint}</p></div><Switch checked={disclose} onCheckedChange={(checked) => { setDisclose(checked); if (!checked) { setBrandOrganic(false); setBrandContent(false) } }}/></div>{disclose && <div className="space-y-3 border-t border-border pt-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={brandOrganic} onChange={(event) => setBrandOrganic(event.target.checked)} className="mt-1 accent-primary"/><span>{t.tiktokYourBrand}<span className="block text-xs text-muted-foreground">{t.tiktokYourBrandHint}</span></span></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={brandContent} onChange={(event) => setBrandContent(event.target.checked)} className="mt-1 accent-primary"/><span>{t.tiktokBranded}<span className="block text-xs text-muted-foreground">{t.tiktokBrandedHint}</span></span></label>{disclosureInvalid && <p className="text-xs text-destructive">{t.tiktokDiscloseRequired}</p>}</div>}</div>
          <p className="text-xs leading-5 text-muted-foreground">{t.tiktokDeclarePrefix} <a className="underline underline-offset-2" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">{t.tiktokMusicUsage}</a>{brandContent && <> {t.tiktokAnd} <a className="underline underline-offset-2" href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">{t.tiktokBrandedPolicy}</a></>}.</p>
          <p className="text-xs leading-5 text-muted-foreground">{t.tiktokProcessingNote}</p>{durationTooLong && creatorQuery.data && <p role="alert" className="text-sm text-destructive">{t.tiktokTooLong.replace("{duration}", formatDuration(duration!)).replace("{max}", formatDuration(creatorQuery.data.maxVideoPostDurationSec))}</p>}
        </>}
      </>}
    </section>}
    {selectedInstagram.length > 0 && <section className="space-y-2 rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><InstagramMark className="size-4"/>{t.socialPlatforms.instagram}</h3>
      <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">{t.instagramPublicNote}</p>
      <p className="text-xs leading-5 text-muted-foreground">{t.instagramCaptionHint.replace("{chars}", INSTAGRAM_CAPTION_MAX.toLocaleString(locale)).replace("{tags}", String(INSTAGRAM_HASHTAG_MAX))}</p>
    </section>}
    <form.Field name="title" validators={{ onChange: ({ value }) => !selectedYouTube.length ? undefined : !value.trim() ? t.publishTitleRequired : value.length > TITLE_MAX ? t.publishTitleTooLong : undefined }}>{(field) => selectedYouTube.length > 0 ? <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}><div className="flex items-center gap-2"><FieldLabel htmlFor="publish-title">{t.publishTitleLabel}</FieldLabel><Counter id="publish-title-count" value={field.state.value.length} max={TITLE_MAX}/></div><Input id="publish-title" name="title" className="h-10" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} onBlur={field.handleBlur} aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid} aria-required="true" aria-describedby="publish-title-count"/>{field.state.meta.isTouched && !field.state.meta.isValid && <FieldDescription className="text-destructive">{field.state.meta.errors[0]}</FieldDescription>}</Field> : null}</form.Field>
    <form.Field name="caption" validators={{ onChange: ({ value }) => value.length > CAPTION_MAX ? t.publishCaptionTooLong : undefined }}>{(field) => { const invalid = field.state.meta.isTouched && !field.state.meta.isValid; return <Field data-invalid={invalid || captionTooLongTikTok || captionTooLongInstagram || tooManyInstagramHashtags}><div className="flex items-center gap-2"><FieldLabel htmlFor="publish-caption">{selectedYouTube.length && (selectedTikTok.length || selectedInstagram.length) ? t.publishCaptionLabelBoth : selectedTikTok.length || selectedInstagram.length ? t.publishCaptionLabelTikTok : t.publishCaptionLabel}</FieldLabel>{selectedInstagram.length > 0 && <><span id="publish-hashtag-count" aria-live={tooManyInstagramHashtags ? "polite" : "off"} className={cn("ml-auto font-mono text-[11px] tabular-nums text-muted-foreground", tooManyInstagramHashtags && "font-semibold text-destructive", !tooManyInstagramHashtags && hashtagCount >= Math.floor(INSTAGRAM_HASHTAG_MAX * 0.9) && "text-amber-700 dark:text-amber-400")}>{hashtagCount.toLocaleString(locale)}/{INSTAGRAM_HASHTAG_MAX.toLocaleString(locale)} #</span><span aria-hidden="true" className="text-xs text-border">·</span></>}<Counter id="publish-caption-count" value={field.state.value.length} max={selectedTikTok.length || selectedInstagram.length ? TIKTOK_CAPTION_MAX : CAPTION_MAX} className={selectedInstagram.length > 0 ? "ml-0" : undefined}/></div><textarea id="publish-caption" name="caption" rows={5} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} onBlur={field.handleBlur} aria-invalid={invalid || captionTooLongTikTok || captionTooLongInstagram || tooManyInstagramHashtags} aria-busy={regenerate.isPending} aria-describedby={selectedInstagram.length ? "publish-caption-count publish-hashtag-count" : "publish-caption-count"} readOnly={regenerate.isPending} className="field-sizing-content read-only:opacity-60 max-h-64 min-h-28 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"/>{invalid && <FieldDescription className="text-destructive">{field.state.meta.errors[0]}</FieldDescription>}{captionTooLongTikTok && <FieldDescription className="text-destructive">{t.publishCaptionTikTokLimit}</FieldDescription>}{captionTooLongInstagram && <FieldDescription className="text-destructive">{t.publishCaptionInstagramLimit}</FieldDescription>}{tooManyInstagramHashtags && <FieldDescription className="text-destructive">{t.publishHashtagsInstagramLimit}</FieldDescription>}<div role="group" aria-label={t.regenerateCaption} className="flex flex-wrap items-center justify-end gap-2 text-foreground"><span className="mr-auto text-xs text-muted-foreground">{t.regenerateCaption}</span><Select value={captionLanguage} disabled={regenerate.isPending} onValueChange={(value) => { if (isCaptionLanguage(value)) setCaptionLanguage(value) }}><SelectTrigger className="h-8 w-auto min-w-28 text-xs" aria-label={t.captionLanguage}><SelectValue/></SelectTrigger><SelectContent position="popper" align="end">{CAPTION_LANGUAGES.map((option) => <SelectItem key={option} value={option}>{t.captionLanguageShort[option]}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="sm" className="h-8 min-w-28 px-3 text-xs" aria-busy={regenerate.isPending} disabled={regenerate.isPending || publish.isPending} onClick={() => regenerate.mutate(captionLanguage)}>{regenerate.isPending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none"/> : <Sparkles aria-hidden="true" className="size-3.5"/>}<span aria-live="polite">{regenerate.isPending ? t.captionWriting : t.regenerateCaptionAction}</span></Button></div></Field> }}</form.Field>
    {selectedYouTube.length > 0 && <div className="grid gap-5 sm:grid-cols-2 sm:gap-4"><form.Field name="privacy">{(field) => <Field><FieldLabel htmlFor="publish-privacy">{t.publishPrivacy}</FieldLabel><Select value={field.state.value} onValueChange={(value) => field.handleChange(value as Privacy)}><SelectTrigger id="publish-privacy" className="h-10 w-full" aria-describedby="publish-privacy-hint"><SelectValue/></SelectTrigger><SelectContent position="popper">{PRIVACY.map((option) => <SelectItem key={option} value={option}>{t.privacyOptions[option]}</SelectItem>)}</SelectContent></Select><FieldDescription id="publish-privacy-hint" className="text-xs">{t.privacyHints[field.state.value]}</FieldDescription></Field>}</form.Field><form.Field name="madeForKids">{(field) => <Field><div className="flex min-h-5 items-center justify-between gap-3"><FieldLabel htmlFor="publish-kids">{t.publishMadeForKids}</FieldLabel><Switch id="publish-kids" checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked)} aria-describedby="publish-kids-hint"/></div><FieldDescription id="publish-kids-hint" className="text-xs">{t.publishMadeForKidsHint}</FieldDescription></Field>}</form.Field></div>}
    {selectedYouTube.length > 0 && <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground"><YouTubeMark className="mt-0.5 size-4 shrink-0"/>{t.publishShortsNote}</p>}
    {submitError && <Alert variant="destructive"><CircleAlert/><AlertDescription>{submitError}</AlertDescription></Alert>}{history.length > 0 && <PublicationList title={t.publishHistory} items={history} clipId={clip.id}/>}
  </FieldGroup></div><div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card px-5 py-3 sm:px-6"><Button type="button" variant="ghost" className="h-10 px-4" onClick={onClose}>{t.cancelAction}</Button><form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting, state.values.accountIds.length] as const}>{([canSubmit, isSubmitting, count]) => <Button type="submit" className="h-10 min-w-32 px-4" disabled={publish.isPending || isSubmitting || !canSubmit || submitBlocked}>{publish.isPending ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin"/>{t.publishSubmitting}</> : <>{selectedTikTok.length && !selectedYouTube.length && !selectedInstagram.length && mode === "inbox" ? t.publishSubmitInbox : t.publishSubmit}{count > 1 && <span className="tabular-nums opacity-70">· {count}</span>}</>}</Button>}</form.Subscribe></div></form>
}
function formatDuration(seconds: number) { const mins = Math.floor(seconds / 60), secs = Math.floor(seconds % 60); return mins ? `${mins}m ${secs}s` : `${secs}s` }
function AccountAvatar({ account }: { account: SocialAccount }) {
  const [failed, setFailed] = useState(false), Mark = account.platform === "tiktok" ? TikTokMark : account.platform === "instagram" ? InstagramMark : YouTubeMark
  return <span className="relative shrink-0">{account.avatarUrl && !failed ? <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="size-9 rounded-full bg-muted object-cover"/> : <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{account.displayName.trim()[0]?.toUpperCase() ?? "?"}</span>}<span className="absolute -bottom-0.5 -right-1 grid size-4 place-items-center rounded-full bg-card"><Mark className="size-3.5"/></span></span>
}
function PublicationList({ title, items, clipId, live = false }: { title: string; items: PublicationResponse[]; clipId: string; live?: boolean }) {
  const t = useT()
  const { language } = useLanguage()
  const client = useQueryClient()
  const summary = summarizeClipViews(items)
  const refreshMetrics = useMutation({
    mutationFn: () => refreshClipPublicationMetrics(clipId),
    onSuccess: (result) => {
      client.setQueryData<PublicationResponse[]>(publicationsKey(clipId), result.publications)
      void client.invalidateQueries({ queryKey: ["clips", "recent"] })
      void client.invalidateQueries({ queryKey: ["jobs"] })
      if (result.refreshed > 0) {
        toast.success(result.refreshed === 1 ? t.statsRefreshedOne : t.statsRefreshed.replace("{count}", String(result.refreshed)))
      } else {
        toast.info(t.statsUpToDate)
      }
    },
    onError: () => toast.error(t.statsRefreshFailed),
  })

  return <section aria-label={title}>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-[.08em] text-muted-foreground">{title}</h3>
        {summary.hasPublished && summary.totalViews !== null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="h-5 gap-1 px-1.5 font-mono text-[11px] font-medium tabular-nums">
                <Eye aria-hidden="true" className="size-3 text-muted-foreground" />
                {formatCompactCount(summary.totalViews)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span>{t.totalViews}:</span>
              <span className="font-mono font-semibold tabular-nums">{formatExactCount(summary.totalViews, language)}</span>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {summary.hasPublished && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          disabled={refreshMetrics.isPending}
          onClick={() => refreshMetrics.mutate()}
        >
          <RefreshCw aria-hidden="true" className={cn("size-3.5", refreshMetrics.isPending && "animate-spin")} />
          {refreshMetrics.isPending ? t.refreshingStats : t.refreshStats}
        </Button>
      )}
    </div>
    {items.length ? <ul aria-live={live ? "polite" : undefined} className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">{items.map((item) => <PublicationRow key={item.id} item={item} clipId={clipId}/>)}</ul> : live ? <div className="space-y-2 rounded-lg border border-border p-3"><Skeleton className="h-4 w-1/2"/><Skeleton className="h-1 w-full"/></div> : <p className="text-sm text-muted-foreground">{t.publishHistoryEmpty}</p>}
  </section>
}
function PublicationRow({ item, clipId }: { item: PublicationResponse; clipId: string }) {
  const t = useT()
  const { language } = useLanguage()
  const locale = language === "id" ? "id-ID" : "en-US"
  const client = useQueryClient()
  const retry = useMutation({ mutationFn: () => api<PublicationResponse>(`/publications/${item.id}/retry`, { method: "POST" }), onSuccess: (next) => { if (next?.id) client.setQueryData<PublicationResponse[]>(publicationsKey(clipId), (previous = []) => previous.map((row) => row.id === next.id ? next : row)); void client.invalidateQueries({ queryKey: publicationsKey(clipId) }) }, onError: () => toast.error(t.retryUploadFailed) })
  const progress = Math.max(0, Math.min(100, Math.round(item.progress))), when = item.publishedAt ?? item.updatedAt ?? item.createdAt
  const statusText = item.platform === "tiktok" && item.mode === "inbox" && item.status === "published" ? t.publishSentToInbox : item.status === "processing" && item.platform === "tiktok" ? t.publishProcessingTikTok : item.status === "processing" && item.platform === "instagram" ? t.publishProcessingInstagram : t.publishStatus[item.status]
  const privacyLabel = item.platform === "tiktok" ? (t.tiktokPrivacy[item.privacy as keyof typeof t.tiktokPrivacy] ?? item.privacy) : item.platform === "instagram" ? t.instagramPrivacyLabel : (t.privacyOptions[item.privacy as keyof typeof t.privacyOptions] ?? item.privacy)
  const PlatformIcon = item.platform === "tiktok" ? TikTokMark : item.platform === "instagram" ? InstagramMark : YouTubeMark
  const accountLabel = item.accountName?.trim() || t.socialPlatforms[item.platform]
  const hasMetrics = item.viewCount !== null || item.likeCount !== null || item.commentCount !== null
  const errorHint = item.metricsError ? metricsErrorMessage(item.metricsError, t) : null

  return <li className="px-3 py-3">
    <div className="flex items-center gap-3">
      <StatusIcon status={item.status}/>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          <PlatformIcon className="size-3.5 shrink-0"/>
          <span className="truncate">{accountLabel}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          <span className={cn(item.status === "failed" && "text-destructive", item.status === "published" && "text-foreground")}>{statusText}{item.status === "uploading" && <span className="tabular-nums"> · {progress}%</span>}</span> · {privacyLabel} · {relativeAge(when, locale)}
        </p>
      </div>
      {item.status === "published" && item.externalUrl && <a href={item.externalUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted">{item.platform === "tiktok" ? t.openOnTikTok : item.platform === "instagram" ? t.openOnInstagram : t.openOnYouTube}<ExternalLink aria-hidden="true" className="size-3.5"/></a>}
      {item.status === "failed" && item.accountId !== null && <Button type="button" variant="outline" className="h-9 shrink-0 px-3" disabled={retry.isPending} onClick={() => retry.mutate()}>{retry.isPending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin"/> : <RotateCcw aria-hidden="true" className="size-3.5"/>}{t.retryUpload}</Button>}
    </div>
    {item.status === "published" && hasMetrics && (
      <div className="mt-2 ml-11 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {item.viewCount !== null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex items-center gap-1 font-mono font-medium tabular-nums text-foreground">
                <Eye aria-hidden="true" className="size-3.5 text-muted-foreground"/>
                {formatCompactCount(item.viewCount)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span className="font-mono tabular-nums">{formatExactCount(item.viewCount, language)}</span>
              <span>{t.views}</span>
            </TooltipContent>
          </Tooltip>
        )}
        {item.likeCount !== null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex items-center gap-1 font-mono tabular-nums">
                <Heart aria-hidden="true" className="size-3.5"/>
                {formatCompactCount(item.likeCount)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span className="font-mono tabular-nums">{formatExactCount(item.likeCount, language)}</span>
              <span>{t.likes}</span>
            </TooltipContent>
          </Tooltip>
        )}
        {item.commentCount !== null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex items-center gap-1 font-mono tabular-nums">
                <MessageCircle aria-hidden="true" className="size-3.5"/>
                {formatCompactCount(item.commentCount)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span className="font-mono tabular-nums">{formatExactCount(item.commentCount, language)}</span>
              <span>{t.comments}</span>
            </TooltipContent>
          </Tooltip>
        )}
        {item.metricsUpdatedAt && (
          <>
            <Separator orientation="vertical" className="h-3"/>
            <span className="text-[11px] text-muted-foreground/80">{t.statsUpdatedAgo.replace("{age}", relativeAge(item.metricsUpdatedAt, locale))}</span>
          </>
        )}
        {item.metricsError === "account_disconnected" && item.viewCount !== null && errorHint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={errorHint}
                className="size-5 text-muted-foreground/80 hover:text-foreground"
              >
                <Info aria-hidden="true" className="size-3.5"/>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" align="end">
              {errorHint}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    )}
    {item.status === "published" && item.viewCount === null && errorHint && (
      <Tooltip>
        <TooltipTrigger asChild>
          <p className="mt-2 ml-11 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/80"/>
            <span className="truncate">{errorHint}</span>
          </p>
        </TooltipTrigger>
        <TooltipContent side="top" align="start">
          {errorHint}
        </TooltipContent>
      </Tooltip>
    )}
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
