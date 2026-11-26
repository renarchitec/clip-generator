import "../styles.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createHashHistory, RouterProvider } from "@tanstack/react-router"
import { getRouter } from "../router"

// Hash URLs keep reloads on index.html in Tauri's static asset protocol.
const router = getRouter(createHashHistory())
createRoot(document.getElementById("root")!).render(
  <StrictMode><RouterProvider router={router} /></StrictMode>,
)
