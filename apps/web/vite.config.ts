import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  server: { host: "0.0.0.0", port: Number(process.env.PORT) || 3000 },
  ssr: { noExternal: true },
  resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom"] },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
