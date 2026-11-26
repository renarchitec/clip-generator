import type { User } from "@/lib/api"
import { apiUrl } from "@/lib/desktop"

export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await fetch(apiUrl("/auth/me"))
    if (!response.ok) return null
    return ((await response.json()) as { user: User }).user ?? null
  } catch {
    return null
  }
}
