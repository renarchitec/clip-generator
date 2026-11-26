function youtubeEmbedSrc(id: string): string {
  const win = typeof window === "undefined"
    ? undefined
    : (window as { __DARTCLIP_DESKTOP__?: { apiBaseUrl?: string }; dartclipDesktop?: { apiBaseUrl?: string } })
  const base = (win?.__DARTCLIP_DESKTOP__?.apiBaseUrl ?? win?.dartclipDesktop?.apiBaseUrl ?? "").trim().replace(/\/+$/, "").replace(/\/api$/, "")
  if (base && /^https?:\/\//i.test(base)) {
    const embedOrigin = base.replace(/^(https?:\/\/)(?:127\.0\.0\.1|\[::1\])(?=(?::\d+)?$)/i, "$1localhost")
    return `${embedOrigin}/api/system/embed/youtube/${id}`
  }
  return `https://www.youtube-nocookie.com/embed/${id}`
}

export function getVideoEmbed(url: string): { src: string; title: string } | null {
  try {
    const parsed = new URL(url.trim())
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
    if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      const id = parsed.pathname === "/watch" ? parsed.searchParams.get("v") : parsed.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1]
      if (id && /^[\w-]{11}$/.test(id)) return { src: youtubeEmbedSrc(id), title: "YouTube video" }
    }
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0]
      if (id && /^[\w-]{11}$/.test(id)) return { src: youtubeEmbedSrc(id), title: "YouTube video" }
    }
    if (["tiktok.com", "m.tiktok.com"].includes(host)) {
      const id = parsed.pathname.match(/^\/@[^/]+\/video\/(\d+)/)?.[1]
      if (id) return { src: `https://www.tiktok.com/player/v1/${id}`, title: "TikTok video" }
    }
    if (["instagram.com", "m.instagram.com"].includes(host)) {
      const code = parsed.pathname.match(/^\/(?:p|reel)\/([^/]+)/)?.[1]
      if (code) return { src: `https://www.instagram.com/p/${code}/embed`, title: "Instagram video" }
    }
  } catch { /* Empty or malformed URL. */ }
  return null
}
