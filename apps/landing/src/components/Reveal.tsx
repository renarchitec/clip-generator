import { useEffect, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"

export interface RevealProps {
  children: ReactNode
  delayMs?: number
  className?: string
}

function shouldRevealImmediately(): boolean {
  if (typeof window === "undefined") return true
  if (typeof window.IntersectionObserver !== "function") return true
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return true
  }
  return false
}

export function Reveal({ children, delayMs = 0, className = "" }: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState<boolean>(shouldRevealImmediately)

  useEffect(() => {
    if (visible) return
    const node = ref.current
    if (!node) return

    const rect = node.getBoundingClientRect()
    if (rect.top < window.innerHeight * 0.96 && rect.bottom > 0) {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.disconnect()
            break
          }
        }
      },
      {
        threshold: 0.08,
        rootMargin: "0px 0px -32px 0px",
      },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])

  const style: CSSProperties | undefined =
    delayMs > 0 ? { transitionDelay: `${delayMs}ms` } : undefined

  return (
    <div
      ref={ref}
      data-visible={visible ? "true" : "false"}
      style={style}
      className={`reveal ${className}`}
    >
      {children}
    </div>
  )
}
