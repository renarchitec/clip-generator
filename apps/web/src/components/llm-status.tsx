import { Link } from "@tanstack/react-router"
import { isDesktopBuild } from "@/lib/desktop"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { AlertTriangle, CheckCircle2, CircleHelp, Cpu, LoaderCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type LlmStatus as LlmStatusData } from "@/lib/api"
import { useLanguage, useT } from "@/lib/i18n"

type StatusState = "offline" | "unconfigured" | "failed" | "ready" | "untested" | "unavailable"

function relativeTime(value: string | null, locale: string, fallback: string) {
  if (!value || Number.isNaN(Date.parse(value))) return fallback
  const seconds = Math.round((Date.parse(value) - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31_536_000], ["month", 2_592_000], ["day", 86_400], ["hour", 3_600], ["minute", 60], ["second", 1]]
  const [unit, divisor] = units.find(([, size]) => Math.abs(seconds) >= size) ?? units[units.length - 1]!
  return formatter.format(Math.round(seconds / divisor), unit)
}

export function LlmStatus({ jobStatus, compact = false, prominent = false }: { jobStatus?: string; compact?: boolean; prominent?: boolean }) {
  const t = useT()
  const queryClient = useQueryClient()
  const locale = useLanguage().language === "id" ? "id" : "en"
  const query = useQuery({
    queryKey: ["system", "llm-status"],
    queryFn: () => api<LlmStatusData>("/system/llm-status"),
    refetchInterval: 30_000,
  })
  useEffect(() => {
    if (jobStatus && ["done", "failed", "cancelled"].includes(jobStatus)) {
      void queryClient.invalidateQueries({ queryKey: ["system", "llm-status"] })
    }
  }, [jobStatus, queryClient])
  const data = query.data
  const state: StatusState = query.isError && !data ? "unavailable" : !data ? "unavailable" : !data.workerOnline ? "offline" : !data.configured ? "unconfigured" : data.lastCall?.ok === false ? "failed" : data.lastCall?.ok ? "ready" : "untested"
  // Older backends, including the desktop local API, may omit STT status.
  const sttStatus = data?.sttConfigured === true
    ? `${t.sttConfigured}${data.sttModel ? ` · ${data.sttModel}` : ""}`
    : data?.sttConfigured === false ? t.sttNotConfigured : null
  const withSttStatus = (label: string) => sttStatus ? `${label} · ${sttStatus}` : label
  const labels: Record<StatusState, string> = {
    offline: t.llmWorkerOffline,
    unconfigured: t.llmNotConfigured,
    failed: t.llmFailed,
    ready: `${t.llmReady} · ${data?.model ?? t.llmUnknownModel}`,
    untested: `${t.llmConfigured} · ${data?.model ?? t.llmUnknownModel}, ${t.llmNotTested}`,
    unavailable: t.llmStatusUnavailable,
  }
  const errorText = data?.lastCall?.error || t.error
  const failedAt = relativeTime(data?.lastCall?.at ?? null, locale, t.llmUnknownTime)
  const successAt = relativeTime(data?.lastCall?.at ?? null, locale, t.llmUnknownTime)
  const icon = state === "offline" || state === "unconfigured" || state === "failed" || state === "unavailable"
    ? <AlertTriangle aria-hidden="true" className="size-3.5" />
    : state === "ready"
      ? <CheckCircle2 aria-hidden="true" className="size-3.5" />
      : state === "untested"
        ? <CircleHelp aria-hidden="true" className="size-3.5" />
        : <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
  const detail = state === "failed" ? <span>{errorText} · {t.llmFailureTime.toLowerCase()} {failedAt}</span> : state === "ready" ? <span>{t.llmLastSuccess} {successAt}</span> : state === "untested" ? <span>{t.llmNotTested}</span> : state === "unavailable" ? <span>{t.apiError}</span> : null

  const configureLink = isDesktopBuild() && (state === "unconfigured" || state === "failed") && (
    <Link to="/settings" className="font-medium underline underline-offset-2 focus-visible:outline-2">{t.desktop.configureLlmLink}</Link>
  )

  if (state === "offline" || state === "unconfigured" || state === "failed") {
    if (compact && !prominent) return <p role="status" className="flex items-center gap-2 text-xs text-destructive"><span className="shrink-0">{icon}</span><span className="font-medium">{labels[state]}</span>{state === "failed" && <span className="min-w-0 truncate text-muted-foreground">{errorText} · {failedAt}</span>}{sttStatus && <span className="text-muted-foreground">{sttStatus}</span>}{configureLink}</p>
    if (prominent) return <Alert variant="destructive" className="rounded-md py-2"><AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span className="inline-flex items-center gap-2 font-medium">{icon}{labels[state]}</span>{state === "failed" && <span className="truncate">{errorText} · {failedAt}</span>}{sttStatus && <span className="text-muted-foreground">{sttStatus}</span>}{configureLink}</AlertDescription></Alert>
    return <Alert variant="destructive" className="rounded-lg py-2.5"><AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><span className="inline-flex items-center gap-2 font-medium">{icon}{labels[state]}</span>{state === "failed" && <Tooltip><TooltipTrigger aria-label={`${t.llmFailed}: ${errorText}, ${t.llmFailureTime.toLowerCase()} ${failedAt}`} className="max-w-full cursor-help truncate rounded-sm text-left text-xs underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{errorText} · {t.llmFailureTime.toLowerCase()} {failedAt}</TooltipTrigger><TooltipContent side="top" className="max-w-sm whitespace-normal">{errorText} · {t.llmFailureTime.toLowerCase()} {failedAt}</TooltipContent></Tooltip>}{sttStatus && <span className="text-muted-foreground">{sttStatus}</span>}{configureLink}</AlertDescription></Alert>
  }

  if (compact) return <Tooltip><TooltipTrigger aria-label={`${labels[state]}${detail ? `, ${state === "ready" ? t.llmLastSuccess : ""} ${state === "ready" ? successAt : ""}` : ""}`} className="inline-flex min-h-8 max-w-full cursor-help items-center gap-1.5 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className={state === "ready" ? "text-accent" : undefined}>{icon}</span><span className="truncate">{state === "ready" ? t.llmReady : labels[state]}</span></TooltipTrigger><TooltipContent side="top" className="max-w-sm whitespace-normal">{withSttStatus(labels[state])}{detail && <> · {detail}</>}</TooltipContent></Tooltip>
  return <Tooltip><TooltipTrigger aria-label={`${labels[state]}${detail ? `, ${state === "ready" ? t.llmLastSuccess : ""} ${state === "ready" ? successAt : ""}` : ""}`} className="inline-flex max-w-full cursor-help rounded-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Badge variant={state === "ready" ? "secondary" : "outline"} className="h-8 max-w-full gap-2 rounded-full px-3 text-xs font-normal">{state === "unavailable" ? icon : state === "untested" ? icon : state === "ready" ? icon : <Cpu aria-hidden="true" className="size-3.5"/>}<span className="truncate">{labels[state]}</span></Badge></TooltipTrigger><TooltipContent side="top" className="max-w-sm whitespace-normal">{withSttStatus(labels[state])}{detail && <> · {detail}</>}</TooltipContent></Tooltip>
}
