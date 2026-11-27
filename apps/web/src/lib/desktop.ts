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
  sttBaseUrl: string
  sttModel: string
  hasSttApiKey: boolean
  sttApiKeyHint: string | null
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
  sttBaseUrl?: string
  sttModel?: string
  sttApiKey?: string
  clearSttApiKey?: boolean
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

export type DesktopRuntime = {
  mode: string
  isDesktop: boolean
  publishEnabled: boolean
  clipsDir?: string
  dataDir?: string
  platform?: string
}

export type DesktopTool = "ffmpeg" | "yt-dlp"
export type DesktopToolSource = "managed" | "system" | "env"
export type DesktopToolState = {
  detected: boolean
  source?: DesktopToolSource | null
  version?: string | null
  downloading?: boolean
  progress?: number | null
  error?: string | null
}
export type DesktopToolsStatus = Record<DesktopTool, DesktopToolState>

export const desktopTools = ["ffmpeg", "yt-dlp"] as const satisfies readonly DesktopTool[]
export const desktopToolDownloadKey = ["desktop", "tools", "download"] as const
export type DesktopToolDownloadInput = { tool: DesktopTool; force: boolean }

export function hasDesktopToolDownload(status?: DesktopToolsStatus): boolean {
  return desktopTools.some((tool) => status?.[tool]?.downloading === true)
}

type NativeResult = void | { ok: boolean; error?: string }
type DesktopBridge = {
  isDesktop?: boolean
  apiBaseUrl?: string
  clipsDir?: string
  platform?: string
  openExternalUrl?: (url: string) => Promise<NativeResult>
  revealPath?: (path: string) => Promise<NativeResult>
  openFolder?: (path: string) => Promise<NativeResult>
  openClipsFolder?: () => Promise<NativeResult>
  revealInFinder?: (path: string) => Promise<NativeResult>
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T> }
    __DARTCLIP_DESKTOP__?: DesktopBridge
    dartclipDesktop?: DesktopBridge
  }
}

const bridge = () => typeof window === "undefined" ? undefined : window.__DARTCLIP_DESKTOP__ ?? window.dartclipDesktop

export function isDesktopBuild(): boolean {
  return import.meta.env?.VITE_DESKTOP === "1" || (typeof window !== "undefined" && Boolean(bridge() || window.__TAURI_INTERNALS__))
}

export function apiUrl(path: string): string {
  if (!path || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) return path
  const normalized = path === "/api" || path.startsWith("/api/") ? path : `/api${path.startsWith("/") ? path : `/${path}`}`
  if (!isDesktopBuild()) return normalized
  const base = (bridge()?.apiBaseUrl || import.meta.env?.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "").replace(/\/api$/, "")
  return `${base}${normalized}`
}

async function systemRequest<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await fetch(apiUrl(`/system/${path}`), {
    method,
    ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
  })
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export const getDesktopRuntime = () => systemRequest<DesktopRuntime>("runtime")
export const getDesktopSettings = () => systemRequest<DesktopSettingsView>("desktop-settings")
export const saveDesktopSettings = (patch: DesktopSettingsPatch) => systemRequest<DesktopSettingsView>("desktop-settings", "PATCH", patch)
export const testDesktopLlm = () => systemRequest<DesktopLlmTestResult>("llm-test", "POST")
export const getDesktopTools = (): Promise<DesktopToolsStatus> => systemRequest<DesktopToolsStatus>("tools")
export const downloadDesktopTool = (tool: DesktopTool, options?: { force?: boolean }) =>
  systemRequest<void>(`tools/${tool}/download${options?.force ? "?force=1" : ""}`, "POST")

export const desktopToolsQuery = {
  queryKey: ["desktop", "tools"] as const,
  queryFn: getDesktopTools,
  refetchInterval: (query: { state: { data?: DesktopToolsStatus } }): number | false =>
    hasDesktopToolDownload(query.state.data) ? 1500 : false,
}

export async function trackDesktopToolDownload(
  { tool, force }: DesktopToolDownloadInput,
  refreshStatus: () => Promise<unknown>,
): Promise<void> {
  // The POST waits for installation; check once after it starts to pick up server-side progress.
  const request = downloadDesktopTool(tool, { force })
  const check = setTimeout(() => void refreshStatus(), 400)
  try {
    await request
  } finally {
    clearTimeout(check)
    await refreshStatus()
  }
}

function assertNativeResult(result: NativeResult) {
  if (result?.ok === false) throw new Error(result.error || "Native action failed")
}

function invoke(command: string, args: Record<string, unknown>) {
  const runtime = typeof window === "undefined" ? undefined : window.__TAURI_INTERNALS__
  if (!runtime?.invoke) throw new Error("Native action unavailable")
  return runtime.invoke<NativeResult>(command, args)
}

export async function openExternalUrl(url: string) {
  const target = new URL(url)
  if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("Invalid external URL")
  const native = bridge()
  if (native?.openExternalUrl) assertNativeResult(await native.openExternalUrl(target.href))
  else if (isDesktopBuild()) assertNativeResult(await invoke("open_external_url", { url: target.href }))
  else window.open(target.href, "_blank", "noopener,noreferrer")
}

export async function revealClipInFinder(clipId: string) {
  const { path } = await systemRequest<{ path: string }>(`clips/${encodeURIComponent(clipId)}/local-path`)
  if (!path) throw new Error("Clip path unavailable")
  const native = bridge()
  if (native?.revealPath) assertNativeResult(await native.revealPath(path))
  else if (native?.revealInFinder) assertNativeResult(await native.revealInFinder(path))
  else assertNativeResult(await invoke("reveal_in_finder", { path }))
}

export async function openDesktopFolder(path: string) {
  const native = bridge()
  if (native?.openFolder) assertNativeResult(await native.openFolder(path))
  else if (native?.openClipsFolder) assertNativeResult(await native.openClipsFolder())
  else assertNativeResult(await invoke("open_folder", { path }))
}

export function desktopPlatform(): string {
  return bridge()?.platform ?? (typeof navigator === "undefined" ? "" : navigator.platform)
}
