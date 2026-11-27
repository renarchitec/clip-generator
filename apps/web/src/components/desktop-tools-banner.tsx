import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Download, LoaderCircle, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  desktopToolDownloadKey,
  desktopTools,
  desktopToolsQuery,
  isDesktopBuild,
  trackDesktopToolDownload,
  type DesktopTool,
  type DesktopToolDownloadInput,
} from "@/lib/desktop"
import { useT } from "@/lib/i18n"

export function DesktopToolsBanner() {
  if (!isDesktopBuild()) return null
  return <DesktopToolsBannerContent />
}

function DesktopToolsBannerContent() {
  const t = useT()
  const client = useQueryClient()
  const { data } = useQuery(desktopToolsQuery)
  const pending = useMutationState({
    filters: { mutationKey: desktopToolDownloadKey, status: "pending" },
    select: (mutation) => mutation.state.variables as DesktopToolDownloadInput,
  })
  const download = useMutation({
    mutationKey: desktopToolDownloadKey,
    mutationFn: (input: DesktopToolDownloadInput) => trackDesktopToolDownload(input, () =>
      client.invalidateQueries({ queryKey: desktopToolsQuery.queryKey }),
    ),
    onError: (_error, { tool }) => toast.error(`${tool}: ${t.desktop.downloadFailed}`),
  })
  const install = useMutation({
    mutationFn: async (tools: DesktopTool[]) => {
      for (const tool of tools) {
        try {
          await download.mutateAsync({ tool, force: false })
        } catch {
          // Try the other missing tool even if this one failed.
        }
      }
    },
  })

  if (!data) return null
  const missing = desktopTools.filter((tool) => !data[tool]?.detected)
  const downloading = desktopTools.filter((tool) => data[tool]?.downloading || pending.some((input) => input.tool === tool))
  if (missing.length === 0 && downloading.length === 0) return null

  if (downloading.length > 0) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2 text-xs">
        <LoaderCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin text-accent motion-reduce:animate-none" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p role="status" className="font-medium">{t.desktop.toolsBannerDownloading}</p>
          {downloading.map((tool) => {
            const progress = data[tool]?.progress
            return (
              <div key={tool} className="flex items-center gap-2 text-muted-foreground">
                <span className="w-14 shrink-0 font-mono">{tool}</span>
                <Progress aria-label={`${t.desktop.downloading} ${tool}`} value={progress ?? null} />
                {typeof progress === "number" && <span className="shrink-0 tabular-nums">{progress}%</span>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
      <div className="flex min-w-0 flex-1 items-start gap-2" role="status">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="min-w-0">
          <p className="font-medium">{t.desktop.toolsBannerMissing}</p>
          {desktopTools.map((tool) => data[tool]?.error && (
            <p key={tool} className="mt-1 break-words text-destructive">{tool}: {data[tool].error}</p>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={install.isPending || download.isPending} onClick={() => install.mutate(missing)}>
          <Download aria-hidden="true" />{t.desktop.toolsBannerSetupAction}
        </Button>
        <Button asChild size="sm" variant="link">
          <Link to="/settings">{t.desktop.toolsBannerSettingsLink}</Link>
        </Button>
      </div>
    </div>
  )
}
