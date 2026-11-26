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

export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatScheduledDateTime(value: string | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)
}

export function formatScheduleSlot(
  date: Date,
  locale: string,
  labels: { today: string; tomorrow: string },
): string {
  if (Number.isNaN(date.getTime())) return ""
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDiff = Math.round((startOfTarget - startOfToday) / 86_400_000)
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)
  if (dayDiff === 0) return `${labels.today}, ${time}`
  if (dayDiff === 1) return `${labels.tomorrow}, ${time}`
  return formatScheduledDateTime(date, locale)
}
