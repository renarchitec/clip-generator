import { createServerFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"

export const getPreferences = createServerFn({ method: "GET" }).handler(() => {
  const cookie = getRequestHeader("cookie") ?? ""
  const read = (key: string) => cookie.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`))?.[1]
  const language = read("clipper_language") === "id" ? "id" : "en"
  const theme = ["light", "dark", "system"].includes(read("clipper_theme") ?? "") ? read("clipper_theme")! : "system"
  return { language, theme }
})
