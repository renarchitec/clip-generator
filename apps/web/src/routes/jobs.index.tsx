import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { WorkspaceShell } from "@/components/chrome"
import { api, type Job, type User } from "@/lib/api"
import { getCurrentUser } from "@/lib/auth"
import { relativeAge, sourceLabel } from "@/lib/format"
import { useLanguage, useT } from "@/lib/i18n"

export const Route = createFileRoute("/jobs/")({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: "/login", search: { redirect: location.href } })
    return { user }
  },
  component: JobsIndex,
})

function JobsIndex() {
  const { user } = Route.useRouteContext() as { user: User }
  const t = useT()
  const locale = useLanguage().language === "id" ? "id" : "en"
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api<Job[]>("/jobs"), refetchInterval: 5000 })

  return <WorkspaceShell user={user}>
    <div className="mb-4 flex items-end justify-between gap-4 border-b border-border pb-4 sm:mb-6 sm:pb-5">
      <div><h2 className="font-display text-xl font-medium tracking-[-.025em]">{t.jobs}</h2><p className="mt-1 text-sm text-muted-foreground">{t.jobsDescription}</p></div>
      {jobs.data && <span className="font-mono text-xs tabular-nums text-muted-foreground">{jobs.data.length}</span>}
    </div>
    {jobs.isPending ? <div className="divide-y divide-border border-y border-border" role="status" aria-label={t.loading}>{[0, 1, 2, 3].map((item) => <div key={item} className="space-y-3 py-5"><Skeleton className="h-4 w-1/3"/><Skeleton className="h-2 w-full"/></div>)}</div> : jobs.isError ? <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{t.apiError}</span><Button variant="outline" onClick={() => jobs.refetch()}>{t.retry}</Button></AlertDescription></Alert> : jobs.data?.length ? <div className="divide-y divide-border border-y border-border">{jobs.data.map((job) => {
      const active = job.status === "queued" || job.status === "running"
      const progress = Math.max(0, Math.min(100, job.progress))
      return <Link key={job.id} to="/jobs/$jobId" params={{ jobId: job.id }} className="group flex min-h-20 flex-col gap-y-2 py-4 transition-colors hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-x-6 sm:px-3">
        <span className="flex items-center gap-3 sm:contents">
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{sourceLabel(job.url)}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{job.url}</span></span>
          <span className={`shrink-0 rounded-sm border px-2 py-1 text-xs ${job.status === "failed" ? "border-destructive/40 text-destructive" : job.status === "done" ? "border-border text-muted-foreground" : "border-accent/40 text-accent"}`}>{job.status === "running" && job.stage ? t.stages[job.stage] : t.status[job.status]}</span>
        </span>
        <span className="flex items-center gap-3 sm:contents">
          <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground sm:gap-3">
            <span>{job.clipsCount} {t.clipCountLabel}</span>
            {active && <span className="flex min-w-0 flex-1 items-center gap-1.5 sm:w-28 sm:flex-none sm:gap-2"><span className="h-1 min-w-2 flex-1 overflow-hidden rounded-full bg-secondary"><span className="block h-full bg-accent transition-[width] duration-500" style={{ width: `${progress}%` }} /></span><span className="font-mono tabular-nums">{progress}%</span></span>}
          </span>
          <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-muted-foreground sm:gap-2">{relativeAge(job.createdAt, locale)}<ArrowUpRight className="size-4 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true"/></span>
        </span>
      </Link>
    })}</div> : <div className="border-y border-border py-12"><p className="font-medium">{t.emptyJobs}</p><p className="mt-1 text-sm text-muted-foreground">{t.startNow}</p></div>}
  </WorkspaceShell>
}
