import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useForm } from "@tanstack/react-form"
import { useState } from "react"
import { LoaderCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Brand, Preferences } from "@/components/chrome"
import { buildGoogleAuthHref, GoogleAuthSection } from "@/components/google-auth-button"
import { LegalFooterLinks } from "@/components/legal-page"
import {
  api,
  DEMO_CONTENT_TYPES,
  safeRedirectTarget,
  type ApiError,
  type AuthConfigResponse,
  type DemoContentType,
} from "@/lib/api"
import { useT } from "@/lib/i18n"
import { getCurrentUser } from "@/lib/auth"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type RegisterSearch = {
  redirect?: string
  src?: string
  utm_source?: string
  utm_campaign?: string
}

const cleanSearchParam = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : undefined

export const Route = createFileRoute("/register")({
  validateSearch: (search: Record<string, unknown>): RegisterSearch => ({
    redirect: safeRedirectTarget(search.redirect),
    src: cleanSearchParam(search.src),
    utm_source: cleanSearchParam(search.utm_source),
    utm_campaign: cleanSearchParam(search.utm_campaign),
  }),
  beforeLoad: async () => { if (await getCurrentUser()) throw redirect({ to: "/" }) },
  component: RegisterPage,
})

function RegisterPage() {
  const t = useT()
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const [contentType, setContentType] = useState<DemoContentType | undefined>(undefined)
  const search = Route.useSearch()
  const safeRedirect = safeRedirectTarget(search.redirect)
  const config = useQuery({
    queryKey: ["auth", "config"],
    queryFn: () => api<AuthConfigResponse>("/auth/config"),
  })
  const mutation = useMutation({
    mutationFn: (body: {
      email: string
      name: string
      password: string
      signupSource?: string
      utmSource?: string
      utmCampaign?: string
      contentType?: DemoContentType
    }) => api("/auth/register", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => safeRedirect ? navigate({ href: safeRedirect }) : navigate({ to: "/" }),
    onError: (e: Error) => {
      const err = e as Partial<ApiError>
      if (err.status === 409) setError(t.emailAlreadyUsed)
      else if (err.status === 429) setError(err.serverMessage || t.registerRateLimited)
      else if (err.status === 403) setError(err.serverMessage || t.registerClosed)
      else setError(err.serverMessage || t.apiError)
    },
  })

  const form = useForm({
    defaultValues: { name: "", email: "", password: "" } as { name: string; email: string; password: string },
    onSubmit: ({ value }) => mutation.mutate({
      name: value.name.trim(),
      email: value.email.trim(),
      password: value.password,
      ...(search.src ? { signupSource: search.src } : {}),
      ...(search.utm_source ? { utmSource: search.utm_source } : {}),
      ...(search.utm_campaign ? { utmCampaign: search.utm_campaign } : {}),
      ...(contentType ? { contentType } : {}),
    }),
  })

  const isDemoRegistration = config.data?.defaultRole === "demo"
  const googleHref = buildGoogleAuthHref({
    redirect: safeRedirect,
    src: search.src,
    utmSource: search.utm_source,
    utmCampaign: search.utm_campaign,
    contentType,
  })

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-8 sm:py-6">
        <Brand />
        <Preferences />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:py-12">
        <Card className="w-full max-w-[420px] rounded-lg border-border bg-card shadow-none">
          <CardHeader className="space-y-2 px-6 pt-6 sm:px-7 sm:pt-7">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="font-display text-2xl font-medium tracking-[-.04em]">{t.register}</CardTitle>
              {isDemoRegistration && <Badge variant="secondary" className="font-mono text-[11px]">{t.demoSignupBadge}</Badge>}
            </div>
            <CardDescription>{isDemoRegistration ? t.demoSignupIntro : t.appDesc}</CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 sm:px-7 sm:pb-7">
            {!config.isLoading && !config.data?.registrationOpen ? (
              <Alert><AlertDescription>{t.registerClosed}</AlertDescription></Alert>
            ) : (
              <>
                <div className="mb-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{t.contentTypeLabel}</p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.contentTypeLabel}>
                    {DEMO_CONTENT_TYPES.map((ct) => {
                      const active = contentType === ct
                      return (
                        <button
                          key={ct}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setContentType(active ? undefined : ct)}
                          className={`inline-flex min-h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            active
                              ? "border-accent bg-accent/15 text-foreground"
                              : "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"
                          }`}
                        >
                          {t.contentTypes[ct]}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {config.data?.googleAuthEnabled && <GoogleAuthSection href={googleHref} />}

                <form noValidate onSubmit={(e) => { e.preventDefault(); setError(""); void form.handleSubmit() }}>
                  <FieldGroup>
                    <form.Field name="name" validators={{ onChange: ({ value }) => value.trim().length > 100 ? t.nameTooLong : undefined }}>
                      {(field) => (
                        <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
                          <FieldLabel htmlFor="name">{t.name}</FieldLabel>
                          <Input id="name" name="name" autoComplete="name" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid} />
                          {field.state.meta.isTouched && field.state.meta.errors.length > 0 && <FieldDescription className="text-destructive">{field.state.meta.errors[0]}</FieldDescription>}
                        </Field>
                      )}
                    </form.Field>
                    <form.Field name="email" validators={{ onChange: ({ value }) => !value.trim() ? t.emailRequired : !EMAIL.test(value.trim()) ? t.emailInvalid : undefined }}>
                      {(field) => (
                        <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
                          <FieldLabel htmlFor="email">{t.email}</FieldLabel>
                          <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid} aria-required="true" />
                          {field.state.meta.isTouched && field.state.meta.errors.length > 0 && <FieldDescription className="text-destructive">{field.state.meta.errors[0]}</FieldDescription>}
                        </Field>
                      )}
                    </form.Field>
                    <form.Field name="password" validators={{ onChange: ({ value }) => !value ? t.passwordRequired : value.length < 8 ? t.passwordHint : undefined }}>
                      {(field) => (
                        <Field data-invalid={field.state.meta.isTouched && !field.state.meta.isValid}>
                          <FieldLabel htmlFor="password">{t.password}</FieldLabel>
                          <Input id="password" name="password" type="password" autoComplete="new-password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid} aria-required="true" />
                          <FieldDescription className={field.state.meta.isTouched && field.state.meta.errors.length > 0 ? "text-destructive" : undefined}>
                            {field.state.meta.isTouched && field.state.meta.errors.length > 0 ? field.state.meta.errors[0] : t.passwordHint}
                          </FieldDescription>
                        </Field>
                      )}
                    </form.Field>
                    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                    <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
                      {([canSubmit, isSubmitting]) => (
                        <Field>
                          <Button type="submit" className="mt-1 h-11 w-full rounded-md" disabled={mutation.isPending || isSubmitting || !canSubmit || !config.data?.registrationOpen}>
                            {mutation.isPending && <LoaderCircle className="mr-2 size-4 animate-spin" />}
                            {t.signUp}
                          </Button>
                          <FieldDescription className="pt-2 text-center">
                            {t.haveAccount}{" "}
                            <Link to="/login" search={safeRedirect ? { redirect: safeRedirect } : {}} className="font-medium text-primary underline-offset-4 hover:underline">
                              {t.logIn}
                            </Link>
                          </FieldDescription>
                        </Field>
                      )}
                    </form.Subscribe>
                  </FieldGroup>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <footer className="px-4 pb-5 text-center text-xs text-muted-foreground">
        <LegalFooterLinks className="mb-1" />© DartClip
      </footer>
    </main>
  )
}
