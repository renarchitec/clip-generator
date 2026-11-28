import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { LoginForm } from "@/components/login-form"
import { Brand, Preferences } from "@/components/chrome"
import { buildGoogleAuthHref, GoogleAuthSection } from "@/components/google-auth-button"
import { LegalFooterLinks } from "@/components/legal-page"
import { api, safeRedirectTarget, type ApiError, type AuthConfigResponse } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { getCurrentUser } from "@/lib/auth"

type LoginSearch = { redirect?: string; auth_error?: string }

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: safeRedirectTarget(search.redirect),
    auth_error: typeof search.auth_error === "string" && search.auth_error ? search.auth_error : undefined,
  }),
  beforeLoad: async () => { if (await getCurrentUser()) throw redirect({ to: "/" }) },
  component: LoginPage,
})

function LoginPage() {
  const t = useT()
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const { redirect: redirectTarget, auth_error: authError } = Route.useSearch()
  const safeRedirect = safeRedirectTarget(redirectTarget)
  const config = useQuery({ queryKey: ["auth", "config"], queryFn: () => api<AuthConfigResponse>("/auth/config") })
  const mutation = useMutation({
    mutationFn: (body: { email: string; password: string }) => api("/auth/login", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => safeRedirect ? navigate({ href: safeRedirect }) : navigate({ to: "/" }),
    onError: (e: Error) => {
      const err = e as Partial<ApiError>
      if (err.serverMessage) setError(err.serverMessage)
      else setError(err.status === 401 ? t.error : t.apiError)
    },
  })

  const googleErrorText = authError
    ? (t.googleAuthErrors[authError as keyof typeof t.googleAuthErrors] ?? t.googleAuthErrors.google_failed)
    : undefined

  return <main className="flex min-h-screen flex-col bg-background">
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-8 sm:py-6"><Brand /><Preferences /></header>
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:py-12">
      <LoginForm
        className="w-full max-w-[400px]"
        title={t.logIn}
        description={t.appDesc}
        emailLabel={t.email}
        passwordLabel={t.password}
        submitLabel={t.logIn}
        topSlot={config.data?.googleAuthEnabled ? <GoogleAuthSection href={buildGoogleAuthHref({ redirect: safeRedirect })} /> : undefined}
        error={mutation.isError ? error : googleErrorText}
        pending={mutation.isPending}
        onSubmit={(values) => { setError(""); mutation.mutate(values) }}
        footer={<>{t.noAccount} {config.data?.registrationOpen && <Link to="/register" search={safeRedirect ? { redirect: safeRedirect } : {}} className="font-medium text-primary underline-offset-4 hover:underline">{t.signUp}</Link>}</>}
      />
    </div>
    <footer className="px-4 pb-5 text-center text-xs text-muted-foreground"><LegalFooterLinks className="mb-1" />© DartClip</footer>
  </main>
}
