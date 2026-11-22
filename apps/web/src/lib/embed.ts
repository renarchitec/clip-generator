export function getVideoEmbed(url: string): { src: string; title: string } | null {
  try {
    const parsed = new URL(url.trim())
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
    if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      const id = parsed.pathname === "/watch" ? parsed.searchParams.get("v") : parsed.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1]
      if (id && /^[\w-]{11}$/.test(id)) return { src: `https://www.youtube-nocookie.com/embed/${id}`, title: "YouTube video" }
    }
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0]
      if (id && /^[\w-]{11}$/.test(id)) return { src: `https://www.youtube-nocookie.com/embed/${id}`, title: "YouTube video" }
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
