import type { User } from "@/lib/api"
import { apiUrl } from "@/lib/desktop"

const localUser: User = { id: "local-desktop-user", email: "local@dartclip.desktop", name: "Local" }

export async function getCurrentUser(): Promise<User> {
  try {
    const response = await fetch(apiUrl("/auth/me"))
    if (response.ok) return ((await response.json()) as { user: User }).user ?? localUser
  } catch {
    // Keep the workspace and settings accessible while the local API is unavailable.
  }
  return localUser
}
