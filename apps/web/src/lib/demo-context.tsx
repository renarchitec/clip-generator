import { createContext, useContext } from "react"
import type { DemoQuotaSummary, User } from "@/lib/api"

export const DESKTOP_DOWNLOAD_URL =
  (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL as string | undefined) ||
  "https://dartclip.rencraft.site/#download"

export interface WorkspaceUserContextValue {
  user: User | null
  isDemo: boolean
  isAdmin: boolean
  quota: DemoQuotaSummary | null
  refreshQuota: () => void
}

export const WorkspaceUserContext = createContext<WorkspaceUserContextValue>({
  user: null,
  isDemo: false,
  isAdmin: false,
  quota: null,
  refreshQuota: () => undefined,
})

export function useWorkspaceUser(): WorkspaceUserContextValue {
  return useContext(WorkspaceUserContext)
}
