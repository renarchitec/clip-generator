import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useT } from "@/lib/i18n"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

type Theme = "light" | "dark" | "system"
const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null)

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
}

export function ThemeProvider({ initialTheme, children }: { initialTheme: Theme; children: ReactNode }) {
  const [theme, setThemeState] = useState(initialTheme)
  useEffect(() => {
    applyTheme(theme)
    document.cookie = `clipper_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`
  }, [theme])
  useEffect(() => {
    if (theme !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const listener = () => applyTheme("system")
    media.addEventListener("change", listener)
    return () => media.removeEventListener("change", listener)
  }, [theme])
  return <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>{children}</ThemeContext.Provider>
}

export function ThemeSelect() {
  const context = useContext(ThemeContext)
  const t = useT()
  if (!context) throw new Error("ThemeSelect must be used within ThemeProvider")
  const Icon = context.theme === "light" ? Sun : context.theme === "dark" ? Moon : Monitor
  return <DropdownMenu>
    <DropdownMenuTrigger aria-label={t.theme} title={t.theme} className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon className="size-[18px]" aria-hidden="true"/><span className="sr-only">{t.theme}</span></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-36">
      <DropdownMenuLabel>{t.theme}</DropdownMenuLabel><DropdownMenuSeparator/>
      <DropdownMenuItem onSelect={() => context.setTheme("light")}><Sun className="size-4"/>{t.light}{context.theme === "light" && <span className="ml-auto text-primary">✓</span>}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => context.setTheme("dark")}><Moon className="size-4"/>{t.dark}{context.theme === "dark" && <span className="ml-auto text-primary">✓</span>}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => context.setTheme("system")}><Monitor className="size-4"/>{t.system}{context.theme === "system" && <span className="ml-auto text-primary">✓</span>}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
