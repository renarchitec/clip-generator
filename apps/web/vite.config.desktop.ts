import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, type Plugin } from "vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function emitIndexHtml(): Plugin {
  return {
    name: "dartclip-desktop-index-html",
    closeBundle() {
      const from = path.resolve(__dirname, "dist-desktop/index.desktop.html")
      const to = path.resolve(__dirname, "dist-desktop/index.html")
      if (fs.existsSync(from)) {
        fs.renameSync(from, to)
      }
    },
  }
}

export default defineConfig({
  root: __dirname,
  envDir: false,
  base: "./",
  define: {
    "import.meta.env.VITE_DESKTOP": JSON.stringify("1"),
  },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
    alias: [
      { find: "@/lib/auth", replacement: path.resolve(__dirname, "src/desktop/auth.ts") },
      { find: "@/lib/preferences", replacement: path.resolve(__dirname, "src/desktop/preferences.ts") },
      { find: /^\.\/routes\/api\.\$$/, replacement: path.resolve(__dirname, "src/desktop/empty-api-route.ts") },
    ],
  },
  plugins: [tailwindcss(), viteReact(), emitIndexHtml()],
  build: {
    outDir: "dist-desktop",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "index.desktop.html"),
    },
  },
})
