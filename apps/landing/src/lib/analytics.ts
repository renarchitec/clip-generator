const DEFAULT_UMAMI_SCRIPT_URL = "https://stats.rencraft.site/script.js"

interface RuntimeLandingConfig {
  umamiWebsiteId?: string
  umamiScriptUrl?: string
}

declare global {
  interface Window {
    __DARTCLIP_CONFIG__?: RuntimeLandingConfig
    umami?: {
      track?: (event: string, data?: Record<string, unknown>) => void
    }
  }
}

export function initAnalytics(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return
  const runtime = window.__DARTCLIP_CONFIG__
  const websiteId = (runtime?.umamiWebsiteId || import.meta.env.VITE_UMAMI_WEBSITE_ID || "").trim()
  if (!websiteId) return

  const scriptUrl = (runtime?.umamiScriptUrl || import.meta.env.VITE_UMAMI_SCRIPT_URL || DEFAULT_UMAMI_SCRIPT_URL).trim()
  if (document.querySelector(`script[data-website-id="${websiteId}"]`)) return

  const script = document.createElement("script")
  script.defer = true
  script.src = scriptUrl
  script.dataset.websiteId = websiteId
  document.head.appendChild(script)
}

export function trackEvent(event: string, data?: Record<string, unknown>): void {
  if (typeof window === "undefined") return
  try {
    window.umami?.track?.(event, data)
  } catch {
    // Ignore analytics errors
  }
}
