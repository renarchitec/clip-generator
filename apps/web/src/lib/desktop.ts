export type DesktopVideoEncoder = "h264_videotoolbox" | "libx264"

export type DesktopSettingsView = {
  nineRouterUrl: string
  nineRouterModel: string
  hasNineRouterApiKey: boolean
  nineRouterApiKeyHint: string | null
  geminiModel: string
  hasGeminiApiKey: boolean
  geminiApiKeyHint: string | null
  openaiModel: string
  hasOpenaiApiKey: boolean
  openaiApiKeyHint: string | null
  videoEncoder: DesktopVideoEncoder
  encryptionAvailable: boolean
  clipsDir: string
}

export type DesktopSettingsPatch = {
  nineRouterUrl?: string
  nineRouterApiKey?: string
  clearNineRouterApiKey?: boolean
  nineRouterModel?: string
  geminiApiKey?: string
  clearGeminiApiKey?: boolean
  geminiModel?: string
  openaiApiKey?: string
  clearOpenaiApiKey?: boolean
  openaiModel?: string
  videoEncoder?: DesktopVideoEncoder
}

export type DesktopLlmTestResult = {
  ok: boolean
  configured: boolean
  provider?: string | null
  model?: string | null
  baseUrl?: string | null
  error?: string | null
}

export type DartClipDesktopBridge = {
  isDesktop: true
  apiBaseUrl: string
  clipsDir: string
  platform: string
  getSettings: () => Promise<DesktopSettingsView>
  saveSettings: (patch: DesktopSettingsPatch) => Promise<DesktopSettingsView>
  testLlm: () => Promise<DesktopLlmTestResult>
  revealInFinder: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  openClipsFolder: () => Promise<{ ok: boolean }>
  setTheme?: (theme: "light" | "dark" | "system") => void
}

declare global {
  interface Window {
    dartclipDesktop?: DartClipDesktopBridge
  }
}

export function getDesktopBridge(): DartClipDesktopBridge | null {
  if (typeof window === "undefined") return null
  return window.dartclipDesktop?.isDesktop ? window.dartclipDesktop : null
}

export function isDesktopApp(): boolean {
  if (typeof window !== "undefined" && window.dartclipDesktop?.isDesktop) return true
  return import.meta.env.VITE_DARTCLIP_DESKTOP === "1"
}

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined" && window.dartclipDesktop?.apiBaseUrl) {
    return window.dartclipDesktop.apiBaseUrl.replace(/\/+$/, "")
  }
  const configured = import.meta.env.VITE_API_BASE_URL
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim().replace(/\/+$/, "")
  }
  return ""
}

/**
 * Resolves either a short API path ("/jobs") or an "/api/..." asset path against
 * the local desktop API origin when running inside Electron, or keeps relative
 * "/api/..." paths untouched in server mode.
 */
export function apiUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return pathOrUrl
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const normalized = pathOrUrl.startsWith("/api/")
    ? pathOrUrl
    : pathOrUrl === "/api"
      ? "/api"
      : `/api${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`
  const base = getApiBaseUrl()
  return base ? `${base}${normalized}` : normalized
}
