import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"

function GoogleMark({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.08 3.57-5.14 3.57-8.64Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.87-3c-1.07.72-2.45 1.15-4.08 1.15-3.14 0-5.8-2.12-6.75-4.97H1.25v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.25 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.25a12 12 0 0 0 0 10.76l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.25 6.62l4 3.1C6.2 6.87 8.86 4.75 12 4.75Z" />
    </svg>
  )
}

export function buildGoogleAuthHref(params: {
  redirect?: string
  src?: string
  utmSource?: string
  utmCampaign?: string
  contentType?: string
}): string {
  const query = new URLSearchParams()
  if (params.redirect) query.set("redirect", params.redirect)
  if (params.src) query.set("src", params.src)
  if (params.utmSource) query.set("utm_source", params.utmSource)
  if (params.utmCampaign) query.set("utm_campaign", params.utmCampaign)
  if (params.contentType) query.set("content_type", params.contentType)
  const qs = query.toString()
  return qs ? `/api/auth/google?${qs}` : "/api/auth/google"
}

export function GoogleAuthSection({ href }: { href: string }) {
  const t = useT()
  return (
    <div className="mb-5 space-y-4">
      <Button asChild variant="outline" className="h-11 w-full justify-center gap-2.5 rounded-md font-medium">
        <a href={href}>
          <GoogleMark className="size-4 shrink-0" />
          <span>{t.continueWithGoogle}</span>
        </a>
      </Button>
      <div className="relative flex items-center justify-center">
        <span aria-hidden="true" className="w-full border-t border-border" />
        <span className="bg-card px-3 text-xs text-muted-foreground whitespace-nowrap">{t.orContinueWithEmail}</span>
        <span aria-hidden="true" className="w-full border-t border-border" />
      </div>
    </div>
  )
}
