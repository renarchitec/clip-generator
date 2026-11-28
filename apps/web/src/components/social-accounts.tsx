import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUpRight, Lock, Plus, RefreshCw, TriangleAlert, Unplug } from "lucide-react"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, trackUserEvent } from "@/lib/api"
import { DESKTOP_DOWNLOAD_URL, useWorkspaceUser } from "@/lib/demo-context"
import { useLanguage, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type SocialPlatform = "youtube" | "instagram" | "tiktok"
export type SocialProvider = { platform: SocialPlatform; configured: boolean; available: boolean }
export type SocialAccount = { id: string; platform: SocialPlatform; displayName: string; avatarUrl: string | null; connectedAt: string; expiresAt: string | null; needsReconnect: boolean }

const ORDER: SocialPlatform[] = ["youtube", "instagram", "tiktok"]
const connect = (platform: SocialPlatform) => window.location.assign(`/api/social/${platform}/connect`)

export function YouTubeMark({ className = "size-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className}><path fill="#FF0033" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8Z"/><path fill="#fff" d="m9.6 15.6 6.2-3.6-6.2-3.6v7.2Z"/></svg>
}
export function InstagramMark({ className = "size-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("text-[#E1306C]", className)} fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3.25" y="3.25" width="17.5" height="17.5" rx="5.2"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.7" cy="6.7" r="1" fill="currentColor" stroke="none"/></svg>
}
export function TikTokMark({ className = "size-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className}><path fill="#25F4EE" d="M9.4 9.6v-.9a6.8 6.8 0 0 0-1-.1 6.6 6.6 0 0 0-3.8 12 6.6 6.6 0 0 1 4.8-11Z"/><path fill="#25F4EE" d="M9.6 19.9a3 3 0 0 0 3-2.9V2.6h2.6a5 5 0 0 1-.1-.9h-3.6v14.5a3 3 0 0 1-3 2.9 3 3 0 0 1-1.4-.4 3 3 0 0 0 2.5 1.2Zm10.6-12.5v-.9a5 5 0 0 1-2.7-.8 5 5 0 0 0 2.7 1.7Z"/><path fill="#FE2C55" d="M17.5 5.7a5 5 0 0 1-1.2-3.2h-1a5 5 0 0 0 2.2 3.2ZM8.4 12.9a3 3 0 0 0-1.4 5.6 3 3 0 0 1 3.4-4.7V10a6.5 6.5 0 0 0-1-.1h-.1v2.8a3 3 0 0 0-.9.2Z"/><path fill="#FE2C55" d="M20.2 7.4v2.8a8.6 8.6 0 0 1-5-1.6V16a6.6 6.6 0 0 1-10.3 5.4 6.6 6.6 0 0 0 11.4-4.5V9.5a8.6 8.6 0 0 0 5 1.6V7.6a5 5 0 0 1-1.1-.2Z"/><path className="fill-foreground" d="M15.2 16V8.6a8.6 8.6 0 0 0 5 1.6V7.4a5 5 0 0 1-2.7-1.7 5 5 0 0 1-2.2-3.2h-2.7V17a3 3 0 0 1-5.4 1.5 3 3 0 0 1 1.4-5.6 3 3 0 0 1 .9.1V10a6.6 6.6 0 0 0-4.7 11.1A6.6 6.6 0 0 0 15.2 16Z"/></svg>
}
const MARKS: Record<SocialPlatform, (props: { className?: string }) => ReactNode> = { youtube: YouTubeMark, instagram: InstagramMark, tiktok: TikTokMark }

export function SocialAccounts() {
  const t = useT()
  const { isDemo } = useWorkspaceUser()
  const providers = useQuery({ queryKey: ["social", "providers"], queryFn: () => api<SocialProvider[]>("/social/providers") })
  const accounts = useQuery({ queryKey: ["social", "accounts"], queryFn: () => api<SocialAccount[]>("/social/accounts") })
  const pending = providers.isPending || accounts.isPending
  const failed = providers.isError || accounts.isError

  return <section aria-labelledby="connected-accounts-heading">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <h3 id="connected-accounts-heading" className="font-display text-lg font-medium tracking-[-.02em]">{t.connectedAccounts}</h3>
          {isDemo && <Badge variant="secondary" className="gap-1 font-mono text-[10px]"><Lock className="size-3" aria-hidden="true"/>{t.demoLockedBadge}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t.connectedAccountsIntro}</p>
      </div>
    </div>
    {isDemo && (
      <Alert className="mb-4 border-accent/30 bg-accent/5">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <span>{t.demoSocialLockedDesc}</span>
          <a
            href={DESKTOP_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackUserEvent("desktop_cta_clicked", { source: "settings_social" })}
            className="inline-flex shrink-0 items-center gap-1 font-medium text-accent underline-offset-4 hover:underline"
          >
            {t.demoDesktopCta}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        </AlertDescription>
      </Alert>
    )}
    {pending ? <div role="status" aria-label={t.loading} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {ORDER.map((platform) => <div key={platform} className="flex items-center gap-4 p-4 sm:p-5"><Skeleton className="size-10 rounded-lg"/><div className="flex-1 space-y-2"><Skeleton className="h-4 w-24"/><Skeleton className="h-3 w-48 max-w-full"/></div><Skeleton className="h-9 w-24 rounded-lg"/></div>)}
    </div> : failed ? <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{t.socialLoadError}</span><Button variant="outline" onClick={() => { void providers.refetch(); void accounts.refetch() }}>{t.retry}</Button></AlertDescription></Alert> : <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {ORDER.map((platform) => {
        const provider = providers.data?.find((item) => item.platform === platform) ?? { platform, configured: false, available: false }
        return <PlatformBlock key={platform} provider={provider} accounts={accounts.data?.filter((item) => item.platform === platform) ?? []} lockedForDemo={isDemo}/>
      })}
    </ul>}
  </section>
}

function PlatformBlock({ provider, accounts, lockedForDemo = false }: { provider: SocialProvider; accounts: SocialAccount[]; lockedForDemo?: boolean }) {
  const t = useT()
  const Mark = MARKS[provider.platform]
  const name = t.socialPlatforms[provider.platform]
  const comingSoon = !provider.available
  const unconfigured = provider.available && !provider.configured
  const hint = lockedForDemo ? t.demoSocialLocked : comingSoon ? t.socialComingSoonHint : unconfigured ? t.socialNotConfiguredHint : accounts.length ? null : t.socialNoAccounts
  const hintId = `social-${provider.platform}-hint`

  return <li className={cn("p-4 sm:p-5", (comingSoon || lockedForDemo) && "bg-muted/30")}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-background", (comingSoon || lockedForDemo) && "opacity-60")}><Mark/></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><h4 className={cn("font-medium", (comingSoon || lockedForDemo) && "text-muted-foreground")}>{name}</h4>{lockedForDemo ? <Badge variant="secondary" className="gap-1 font-normal"><Lock className="size-3" aria-hidden="true"/>{t.demoLockedBadge}</Badge> : comingSoon && <Badge variant="secondary" className="font-normal">{t.comingSoon}</Badge>}{!comingSoon && !lockedForDemo && accounts.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{accounts.length}</span>}</div>
        {hint && <p id={hintId} className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {!comingSoon && (lockedForDemo ? (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="ml-auto min-h-10 gap-1.5 px-3 text-muted-foreground"
          onClick={() => {
            trackUserEvent("locked_feature_clicked", { feature: "social", source: provider.platform })
            toast.info(t.demoSocialLockedDesc)
          }}
        >
          <Lock aria-hidden="true" className="size-3.5" />
          {t.socialConnect}
          <span className="sr-only"> {name}</span>
        </Button>
      ) : (
        <Button variant={accounts.length ? "outline" : "default"} size="lg" className="ml-auto min-h-10 px-3" disabled={unconfigured} aria-describedby={hint ? hintId : undefined} onClick={() => connect(provider.platform)}><Plus aria-hidden="true"/>{accounts.length ? t.socialAddAccount : t.socialConnect}<span className="sr-only"> {name}</span></Button>
      ))}
    </div>
    {!comingSoon && provider.platform === "instagram" && <p className="mt-3 text-xs text-muted-foreground sm:ml-14">{t.instagramAccountNote}</p>}
    {accounts.length > 0 && <>
      {provider.configured && <p className="mt-3 text-xs text-muted-foreground sm:ml-14 sm:hidden [@media(hover:none)]:block">{t.socialReconnectHint}</p>}
      <ul className="mt-4 space-y-2 sm:pl-14">{accounts.map((account) => <AccountRow key={account.id} account={account} platformName={name} configured={provider.configured}/>)}</ul>
    </>}
  </li>
}

function AccountRow({ account, platformName, configured = true }: { account: SocialAccount; platformName: string; configured?: boolean }) {
  const t = useT()
  const locale = useLanguage().language === "id" ? "id-ID" : "en-US"
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const disconnect = useMutation({
    mutationFn: () => api<void>(`/social/accounts/${account.id}`, { method: "DELETE" }),
    onSuccess: async () => { setOpen(false); toast.success(t.socialDisconnected.replace("{name}", account.displayName)); await client.invalidateQueries({ queryKey: ["social", "accounts"] }) },
    onError: () => toast.error(t.socialDisconnectFailed),
  })
  const initial = account.displayName.trim()[0]?.toUpperCase() ?? "?"
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(account.connectedAt))
  const reconnectButton = <Button
    type="button"
    variant="outline"
    size="sm"
    disabled={!configured}
    className={cn(
      "min-h-10 max-w-full gap-1.5 whitespace-normal px-3 text-sm sm:min-h-9",
      account.needsReconnect && "border-amber-500/50 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 hover:text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:bg-amber-400/20 dark:hover:text-amber-200",
    )}
    onClick={() => connect(account.platform)}
  >
    <RefreshCw aria-hidden="true"/>{t.socialReconnect}<span className="sr-only"> {account.displayName}</span>
  </Button>

  return <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-lg border border-border bg-background px-3 py-2.5", account.needsReconnect && "border-amber-500/40 bg-amber-500/5")}>
    <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-44">
      {account.avatarUrl && !imageFailed
        ? <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="size-8 shrink-0 rounded-full bg-muted object-cover"/>
        : <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{initial}</span>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{account.displayName}</p>
        {account.needsReconnect
          ? <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"><TriangleAlert aria-hidden="true" className="size-3.5 shrink-0"/>{t.socialNeedsReconnect}</p>
          : <p className="text-xs text-muted-foreground">{t.socialConnectedOn.replace("{date}", date)}</p>}
      </div>
    </div>
    <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 sm:gap-1.5">
      {configured ? <Tooltip>
        <TooltipTrigger asChild>{reconnectButton}</TooltipTrigger>
        <TooltipContent side="top" className="hidden sm:block [@media(hover:none)]:hidden">{t.socialReconnectHint}</TooltipContent>
      </Tooltip> : reconnectButton}
      <AlertDialog open={open} onOpenChange={(next) => { if (!disconnect.isPending) setOpen(next) }}>
        <Button type="button" variant="ghost" size="sm" className="min-h-10 max-w-full gap-1.5 whitespace-normal px-3 text-sm text-muted-foreground hover:text-destructive sm:min-h-9" onClick={() => setOpen(true)}><Unplug aria-hidden="true"/>{t.socialDisconnect}<span className="sr-only"> {account.displayName}</span></Button>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.socialDisconnectTitle.replace("{name}", account.displayName)}</AlertDialogTitle>
            <AlertDialogDescription>{t.socialDisconnectBody.replace("{platform}", platformName)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>{t.cancelAction}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40" disabled={disconnect.isPending} onClick={(event) => { event.preventDefault(); disconnect.mutate() }}>{disconnect.isPending ? t.socialDisconnecting : t.socialDisconnect}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </li>
}
