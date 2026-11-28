import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { WorkspaceShell } from "@/components/chrome"
import { SocialAccounts, type SocialPlatform } from "@/components/social-accounts"
import { WatermarkManager } from "@/components/watermark-manager"
import { OutroManager } from "@/components/outro-manager"
import type { User } from "@/lib/api"
import { getCurrentUser } from "@/lib/auth"
import { useT } from "@/lib/i18n"

const PLATFORMS: readonly SocialPlatform[] = ["youtube", "instagram", "tiktok"]
const ERROR_CODES = ["not_configured", "invalid_state", "missing_code", "token_exchange", "channel_fetch", "channel_not_found", "oauth_start", "oauth_failed"] as const
type SocialErrorCode = (typeof ERROR_CODES)[number]
type SettingsSearch = { connected?: SocialPlatform; social_error?: string }

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    connected: PLATFORMS.includes(search.connected as SocialPlatform) ? (search.connected as SocialPlatform) : undefined,
    social_error: typeof search.social_error === "string" && search.social_error ? search.social_error : undefined,
  }),
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: "/login", search: { redirect: location.href } })
    return { user }
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { user } = Route.useRouteContext() as { user: User }
  const search = Route.useSearch()
  const navigate = useNavigate()
  const t = useT()
  const handled = useRef<string | null>(null)

  useEffect(() => {
    const key = `${search.connected ?? ""}|${search.social_error ?? ""}`
    if (key === "|" || handled.current === key) return
    handled.current = key
    if (search.connected) {
      toast.success(t.socialConnectedToast.replace("{platform}", t.socialPlatforms[search.connected]))
    } else if (search.social_error) {
      const code = (ERROR_CODES as readonly string[]).includes(search.social_error) ? (search.social_error as SocialErrorCode) : "oauth_failed"
      toast.error(t.socialErrors[code])
    }
    void navigate({ to: "/settings", search: {}, replace: true })
  }, [search.connected, search.social_error, navigate, t])

  return <WorkspaceShell user={user}>
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-8 border-b border-border pb-6">
        <h2 className="font-display text-3xl font-medium tracking-[-.045em]">{t.settings}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t.settingsIntro}</p>
      </header>
      <div className="space-y-10">
        <SocialAccounts />
        <section aria-labelledby="watermark-library-heading">
          <div className="mb-4">
            <h3 id="watermark-library-heading" className="font-display text-lg font-medium tracking-[-.02em]">{t.watermarkLibrary}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t.watermarkLibraryIntro}{user.role === "demo" ? ` ${t.demoAssetHint.replace("{watermarks}", "2").replace("{outros}", "1")}` : ""}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <WatermarkManager selectedId={null} onSelect={() => {}} />
          </div>
        </section>
        <section aria-labelledby="outro-library-heading">
          <div className="mb-4">
            <h3 id="outro-library-heading" className="font-display text-lg font-medium tracking-[-.02em]">{t.outroLibrary}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t.outroLibraryIntro}{user.role === "demo" ? ` ${t.demoAssetHint.replace("{watermarks}", "2").replace("{outros}", "1")}` : ""}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <OutroManager />
          </div>
        </section>
      </div>
    </div>
  </WorkspaceShell>
}
