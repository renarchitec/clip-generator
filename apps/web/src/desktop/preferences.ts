export async function getPreferences(): Promise<{ language: "en" | "id"; theme: string }> {
  try {
    const language = localStorage.getItem("clipper_language") === "id" ? "id" : "en"
    const savedTheme = localStorage.getItem("clipper_theme")
    const theme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : "system"
    return { language, theme }
  } catch {
    return { language: "en", theme: "system" }
  }
}
