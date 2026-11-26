import { useEffect, useState } from "react"

export const MOBILE_BREAKPOINT = 768

export function useIsMobile(breakpoint = MOBILE_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const sync = () => setIsMobile(query.matches)

    query.addEventListener("change", sync)
    sync()
    return () => query.removeEventListener("change", sync)
  }, [breakpoint])

  return isMobile
}
