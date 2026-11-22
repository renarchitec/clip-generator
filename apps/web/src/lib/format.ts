export function sourceLabel(url: string) {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, "")
    const pathParts = parsed.pathname.split("/").filter(Boolean)
    if (host === "youtu.be") return pathParts[0] || host
    if (host === "youtube.com" || host === "m.youtube.com") return parsed.searchParams.get("v") || (pathParts[0] === "shorts" ? pathParts[1] : null) || host
    return host
  } catch {
    return url
  }
}

export function relativeAge(value: string, locale: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return ""
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31_536_000], ["month", 2_592_000], ["day", 86_400], ["hour", 3_600], ["minute", 60]]
  const [unit, divisor] = units.find(([, size]) => Math.abs(seconds) >= size) ?? ["minute", 60]
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(seconds / divisor), unit)
}
