import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import { App } from "./App.tsx"
import { initAnalytics } from "./lib/analytics.ts"

initAnalytics()

const rootEl = document.getElementById("root")

if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
