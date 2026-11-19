import { createServerFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import type { User } from "@/lib/api"

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const response = await fetch(new URL("/api/auth/me", process.env.API_INTERNAL_URL || "http://localhost:3000"), { headers: { cookie: getRequestHeader("cookie") ?? "" } })
    if (!response.ok) return null
    return (await response.json() as { user: User }).user
  } catch {
    return null
  }
})
