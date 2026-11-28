import { createFileRoute, redirect } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, LoaderCircle, Search, Shield } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { WorkspaceShell } from "@/components/chrome"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  api,
  type AdminOverviewResponse,
  type AdminUserRow,
  type AdminUsersResponse,
  type ApiError,
  type DemoContentType,
  type User,
  type UserRole,
} from "@/lib/api"
import { getCurrentUser } from "@/lib/auth"
import { useLanguage, useT } from "@/lib/i18n"

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: "/login", search: { redirect: location.href } })
    if (user.role !== "admin") throw redirect({ to: "/" })
    return { user }
  },
  component: AdminPage,
})

const ROLES: readonly UserRole[] = ["demo", "member", "admin"]
const PAGE_SIZE = 25

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(locale === "id" ? "id-ID" : "en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.min(100, Math.round((part / whole) * 100))
}

function AdminPage() {
  const { user } = Route.useRouteContext() as { user: User }
  const t = useT()
  const { language } = useLanguage()
  const client = useQueryClient()
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all")
  const [page, setPage] = useState(1)

  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api<AdminOverviewResponse>("/admin/overview"),
    refetchInterval: 60_000,
  })

  const usersQuery = useQuery({
    queryKey: ["admin", "users", search.trim(), roleFilter, page],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (search.trim()) qs.set("search", search.trim())
      if (roleFilter !== "all") qs.set("role", roleFilter)
      qs.set("page", String(page))
      qs.set("limit", String(PAGE_SIZE))
      return api<AdminUsersResponse>(`/admin/users?${qs.toString()}`)
    },
  })

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      api<{ id: string; role: UserRole }>(`/admin/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      toast.success(t.adminRoleUpdated)
      void client.invalidateQueries({ queryKey: ["admin", "users"] })
      void client.invalidateQueries({ queryKey: ["admin", "overview"] })
    },
    onError: (e: Error) => {
      const err = e as Partial<ApiError>
      toast.error(err.serverMessage || t.adminRoleUpdateFailed)
    },
  })

  const ov = overview.data
  const totalPages = usersQuery.data ? Math.max(1, Math.ceil(usersQuery.data.total / usersQuery.data.limit)) : 1
  const dailyPct = ov ? pct(ov.dailyDemoCap.used, ov.dailyDemoCap.limit) : 0

  const funnelRows = ov
    ? [
        { key: "registered", label: t.adminFunnelSteps.registered, value: ov.funnel.registered },
        { key: "previewed", label: t.adminFunnelSteps.previewed, value: ov.funnel.previewed },
        { key: "generatedJob", label: t.adminFunnelSteps.generatedJob, value: ov.funnel.generatedJob },
        { key: "downloadedClip", label: t.adminFunnelSteps.downloadedClip, value: ov.funnel.downloadedClip },
        { key: "clickedLockedFeature", label: t.adminFunnelSteps.clickedLockedFeature, value: ov.funnel.clickedLockedFeature },
      ]
    : []

  const kpiItems = ov
    ? [
        { label: t.adminKpis.totalUsers, value: String(ov.kpis.totalUsers), sub: `${ov.kpis.adminUsers} admin · ${ov.kpis.memberUsers} member` },
        { label: t.adminKpis.demoUsers, value: String(ov.kpis.demoUsers), sub: `${t.adminKpis.activeDemo7d}: ${ov.kpis.activeDemoUsers7d}` },
        { label: t.adminKpis.signupsToday, value: String(ov.kpis.signupsToday), sub: `${t.adminKpis.signups7d}: ${ov.kpis.signupsLast7d}` },
        { label: t.adminKpis.googleVsEmail, value: `${ov.kpis.googleSignups} / ${ov.kpis.emailSignups}`, sub: "Google / Email" },
        { label: t.adminKpis.totalJobs, value: String(ov.kpis.totalJobs), sub: `${ov.kpis.totalPreviews} previews` },
        { label: t.adminKpis.totalClips, value: String(ov.kpis.totalClips), sub: `${t.adminKpis.totalDownloads}: ${ov.kpis.totalDownloads}` },
      ]
    : []

  const labelContentType = (raw: string) => {
    if (raw in t.contentTypes) return t.contentTypes[raw as DemoContentType]
    return raw
  }

  return (
    <WorkspaceShell user={user}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-accent" aria-hidden="true" />
            <h2 className="font-display text-3xl font-medium tracking-[-.045em]">{t.admin}</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t.adminIntro}</p>
        </div>
        <Button asChild variant="outline" className="min-h-10 gap-2">
          <a href="/api/admin/users/export.csv" download>
            <Download className="size-4" aria-hidden="true" />
            {t.adminExportCsv}
          </a>
        </Button>
      </div>

      {overview.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : overview.isError ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{t.apiError}</span>
            <Button size="sm" variant="outline" onClick={() => void overview.refetch()}>{t.retry}</Button>
          </AlertDescription>
        </Alert>
      ) : ov ? (
        <div className="space-y-6">
          <Card className="rounded-xl border-border shadow-none">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-foreground">{t.adminDailyCap}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {ov.dailyDemoCap.used} / {ov.dailyDemoCap.limit} ({dailyPct}%)
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full rounded-full transition-all ${dailyPct >= 90 ? "bg-destructive" : "bg-accent"}`}
                    style={{ width: `${dailyPct}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kpiItems.map((item) => (
              <Card key={item.label} className="rounded-xl border-border shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                    {item.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">{item.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="rounded-xl border-border shadow-none">
            <CardHeader>
              <CardTitle className="font-display text-lg font-medium">{t.adminFunnelTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {funnelRows.map((row) => {
                const ratio = pct(row.value, ov.funnel.registered)
                return (
                  <div key={row.key} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-foreground">{row.label}</span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {row.value} ({ratio}%)
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${ratio}%` }} />
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <BreakdownCard
              title={t.adminSourcesTitle}
              emptyText={t.adminEmptyBreakdown}
              rows={ov.sources.map((s) => ({ label: s.source, count: s.count }))}
            />
            <BreakdownCard
              title={t.adminContentTypesTitle}
              emptyText={t.adminEmptyBreakdown}
              rows={ov.contentTypes.map((c) => ({ label: labelContentType(c.contentType), count: c.count }))}
            />
            <BreakdownCard
              title={t.adminLockedFeaturesTitle}
              emptyText={t.adminEmptyBreakdown}
              rows={ov.lockedFeatures.map((f) => ({ label: f.feature, count: f.count }))}
            />
          </div>
        </div>
      ) : null}

      <section aria-labelledby="admin-users-heading" className="mt-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 id="admin-users-heading" className="font-display text-xl font-medium tracking-[-.02em]">
              {t.adminUsersTitle}
            </h3>
            {usersQuery.data && (
              <Badge variant="secondary" className="font-mono text-xs tabular-nums">
                {usersQuery.data.total}
              </Badge>
            )}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative flex-1 sm:w-64 sm:flex-none">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder={t.adminSearchUsers}
                aria-label={t.adminSearchUsers}
                className="h-10 bg-card pl-9"
              />
            </div>
            <Select
              value={roleFilter}
              onValueChange={(value) => { setRoleFilter(value as "all" | UserRole); setPage(1) }}
            >
              <SelectTrigger className="h-10 w-36 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.adminAllRoles}</SelectItem>
                <SelectItem value="demo">demo</SelectItem>
                <SelectItem value="member">member</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          {usersQuery.isPending ? (
            <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin text-accent" />
              {t.loading}
            </div>
          ) : usersQuery.isError ? (
            <div className="p-4">
              <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-3">
                  <span>{t.apiError}</span>
                  <Button size="sm" variant="outline" onClick={() => void usersQuery.refetch()}>{t.retry}</Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : !usersQuery.data?.items.length ? (
            <p className="p-8 text-center text-sm text-muted-foreground">{t.adminNoUsers}</p>
          ) : (
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3">{t.adminColumns.user}</th>
                  <th className="px-4 py-3">{t.adminColumns.role}</th>
                  <th className="px-4 py-3">{t.adminColumns.provider}</th>
                  <th className="px-4 py-3">{t.adminColumns.source}</th>
                  <th className="px-4 py-3">{t.adminColumns.category}</th>
                  <th className="px-4 py-3">{t.adminColumns.usage}</th>
                  <th className="px-4 py-3">{t.adminColumns.joined}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {usersQuery.data.items.map((row) => (
                  <AdminUserTableRow
                    key={row.id}
                    row={row}
                    isSelf={row.id === user.id}
                    language={language}
                    labelContentType={labelContentType}
                    updating={updateRole.isPending && updateRole.variables?.id === row.id}
                    onRoleChange={(role) => updateRole.mutate({ id: row.id, role })}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {usersQuery.data && totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {page} / {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ←
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                →
              </Button>
            </div>
          </div>
        )}
      </section>
    </WorkspaceShell>
  )
}

function BreakdownCard({
  title,
  emptyText,
  rows,
}: {
  title: string
  emptyText: string
  rows: { label: string; count: number }[]
}) {
  const max = rows.reduce((acc, item) => Math.max(acc, item.count), 0)
  return (
    <Card className="rounded-xl border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="font-display text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((item) => (
              <li key={item.label} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-foreground">{item.label}</span>
                  <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{item.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-accent/80"
                    style={{ width: `${max > 0 ? Math.max(4, Math.round((item.count / max) * 100)) : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function AdminUserTableRow({
  row,
  isSelf,
  language,
  labelContentType,
  updating,
  onRoleChange,
}: {
  row: AdminUserRow
  isSelf: boolean
  language: string
  labelContentType: (raw: string) => string
  updating: boolean
  onRoleChange: (role: UserRole) => void
}) {
  const sourceLabel = [row.signupSource, row.utmSource, row.utmCampaign].filter(Boolean).join(" · ") || "—"
  return (
    <tr className="hover:bg-muted/20">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          {row.avatarUrl ? (
            <img src={row.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-8 shrink-0 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent/10 font-mono text-xs font-semibold text-accent">
              {(row.name || row.email).slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{row.name || "—"}</p>
            <p className="truncate text-xs text-muted-foreground">{row.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <Select
          value={row.role}
          disabled={isSelf || updating}
          onValueChange={(value) => onRoleChange(value as UserRole)}
        >
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-4 py-3">
        <Badge variant="outline" className="font-mono text-[11px]">{row.authProvider}</Badge>
      </td>
      <td className="max-w-[180px] truncate px-4 py-3 text-xs text-muted-foreground" title={sourceLabel}>
        {sourceLabel}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {row.contentType ? labelContentType(row.contentType) : "—"}
      </td>
      <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
        {row.usage.jobs}J · {row.usage.clips}C · {row.usage.previews}P · {row.usage.downloads}DL
      </td>
      <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
        {formatDate(row.createdAt, language)}
      </td>
    </tr>
  )
}
