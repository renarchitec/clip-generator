export async function getPreferences(): Promise<{ language: "en" | "id"; theme: string }> {
  if (typeof document === "undefined") {
    return { language: "en", theme: "system" }
  }
  const cookie = document.cookie ?? ""
  const read = (key: string) => cookie.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`))?.[1]
  const language = read("clipper_language") === "id" ? "id" : "en"
  const rawTheme = read("clipper_theme") ?? ""
  const theme = ["light", "dark", "system"].includes(rawTheme) ? rawTheme : "system"
  return { language, theme }
}
