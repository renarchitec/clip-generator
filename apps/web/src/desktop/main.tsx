import "../styles.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { getRouter } from "../router"

const router = getRouter()
const container = document.getElementById("root")

if (typeof window !== "undefined") {
  let resizeTimer: number | undefined
  window.addEventListener(
    "resize",
    () => {
      document.documentElement.classList.add("window-resizing")
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        document.documentElement.classList.remove("window-resizing")
      }, 180)
    },
    { passive: true },
  )
}

if (container) {
  createRoot(container).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}
