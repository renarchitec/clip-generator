import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { HeadContent, Scripts } from "@tanstack/react-router"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { I18nProvider, type Language } from "@/lib/i18n"
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
  head: () => ({ meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "Clipper — Make the moments worth sharing." }, { name: "description", content: "A calmer way to turn long videos into short clips." }], links: [{ rel: "stylesheet", href: appCss }] }),
  component: RootComponent,
  shellComponent: ({ children }) => <html lang="en"><head><HeadContent /><script dangerouslySetInnerHTML={{ __html: `(()=>{try{const c=document.cookie.split('; ').find(x=>x.startsWith('clipper_theme='))?.split('=')[1]||'system';const d=c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch{}})()` }} /></head><body>{children}<Scripts /></body></html>,
  notFoundComponent: () => <main className="mx-auto max-w-2xl p-12 text-center"><h1 className="font-display text-3xl">Page not found</h1></main>,
})

function RootComponent() {
  const preferences = Route.useRouteContext()
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }))
  useRouterState({ select: (state) => state.location.pathname })
  return <QueryClientProvider client={queryClient}><I18nProvider initialLanguage={preferences.language as Language}><ThemeProvider initialTheme={preferences.theme as "light" | "dark" | "system"}><TooltipProvider><Outlet /><Toaster richColors position="top-right" /></TooltipProvider></ThemeProvider></I18nProvider></QueryClientProvider>
}
