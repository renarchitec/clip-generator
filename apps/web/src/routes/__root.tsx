import { createRootRoute, Link, Outlet, useRouterState } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { createServerFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { HeadContent, Scripts } from "@tanstack/react-router"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { I18nProvider, useT, type Language } from "@/lib/i18n"
import { ThemeProvider } from "@/lib/theme"
import appCss from "../styles.css?url"

const getPreferences = createServerFn({ method: "GET" }).handler(() => {
  const cookie = getRequestHeader("cookie") ?? ""
  const read = (key: string) => cookie.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`))?.[1]
  const language = read("clipper_language") === "id" ? "id" : "en"
  const theme = ["light", "dark", "system"].includes(read("clipper_theme") ?? "") ? read("clipper_theme")! : "system"
  return { language, theme }
})

export const Route = createRootRoute({
  beforeLoad: () => getPreferences(),
  head: () => ({ meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" }, { name: "theme-color", content: "#18181b" }, { title: "DartClip — Make the moments worth sharing." }, { name: "description", content: "A calmer way to turn long videos into short clips." }], links: [{ rel: "icon", href: "/favicon.ico?v=2", sizes: "any" }, { rel: "icon", href: "/favicon.svg?v=2", type: "image/svg+xml" }, { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=2" }, { rel: "manifest", href: "/manifest.json" }, { rel: "stylesheet", href: appCss }] }),
  component: RootComponent,
  shellComponent: ({ children }) => <html lang="en"><head><HeadContent /><script dangerouslySetInnerHTML={{ __html: `(()=>{try{const c=document.cookie.split('; ').find(x=>x.startsWith('clipper_theme='))?.split('=')[1]||'system';const d=c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch{}})()` }} /></head><body>{children}<Scripts /></body></html>,
  notFoundComponent: NotFound,
})

function NotFound() {
  const t = useT()
  return <main className="mx-auto max-w-2xl p-12 text-center"><h1 className="font-display text-3xl">{t.pageNotFound}</h1><Link to="/" className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft aria-hidden="true" className="size-4" />{t.legalBack}</Link></main>
}

function RootComponent() {
  const preferences = Route.useRouteContext()
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }))
  useRouterState({ select: (state) => state.location.pathname })
  return <QueryClientProvider client={queryClient}><I18nProvider initialLanguage={preferences.language as Language}><ThemeProvider initialTheme={preferences.theme as "light" | "dark" | "system"}><TooltipProvider><Outlet /><Toaster richColors position="top-right" mobileOffset={{ top: "max(12px, env(safe-area-inset-top))" }} /></TooltipProvider></ThemeProvider></I18nProvider></QueryClientProvider>
}
