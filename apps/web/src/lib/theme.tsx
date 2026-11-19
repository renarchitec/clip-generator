import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useT } from "@/lib/i18n"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

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
  return <Select value={context.theme} onValueChange={(value) => context.setTheme(value as Theme)}><SelectTrigger aria-label={t.theme} className="w-[120px] border-0 bg-transparent shadow-none"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="light">{t.light}</SelectItem><SelectItem value="dark">{t.dark}</SelectItem><SelectItem value="system">{t.system}</SelectItem></SelectContent></Select>
}
