# web — TanStack Start + shadcn/ui

Dashboard for Clipper. Proxies `/api/*` to the NestJS API via `API_INTERNAL_URL`.

## Run

```bash
pnpm install          # from repo root
pnpm --filter web dev # dev server on :3000
pnpm --filter web build
pnpm --filter web start
```

`start` serves the production build (`dist/`) with srvx: all requests hit the SSR entry, `dist/client` is served as static assets. Listens on all interfaces, port from `PORT` (default 3000).

## Environment

- `API_INTERNAL_URL` — internal base URL of the API (default `http://localhost:3000`), used server-side to proxy `/api/*` and resolve `/api/auth/me`.
- `PORT` — port for `start`.

See repo root `.env.example`.

## Tauri v2 desktop build

Run `pnpm --filter web build:desktop` and point Tauri's `build.frontendDist` at `apps/web/dist-desktop`. The result is a static SPA with an `index.html` entry and hash-based routing; it does not use the web SSR server or its API proxy.

Before the SPA starts, set `window.__DARTCLIP_DESKTOP__.apiBaseUrl` to the Axum loopback origin (for example, `http://127.0.0.1:43120`). `window.dartclipDesktop` is also supported. For a fixed port, export `VITE_API_BASE_URL` when building; the desktop config does not load dotenv files. Axum must allow the WebView origin for API and media requests, including SSE and media ranges. Tauri's CSP and platform configuration must allow loopback HTTP.

The desktop SPA expects `/api/auth/me` to return `{ user }` for the local workspace without a web login cookie. `/api/system/runtime` supplies `{ mode, isDesktop, publishEnabled, clipsDir }` and can optionally supply `dataDir` and `platform`. When publishing is disabled, publish and schedule controls, Social Accounts, and Sign Out are hidden. The desktop settings panel manages provider settings, the H.264 encoder, and local tools:

| Local API (`/api/system/…`) | Contract |
| --- | --- |
| `GET desktop-settings` | Returns current settings with key presence and masked hints, not plaintext keys. |
| `PATCH desktop-settings` | Accepts the changed settings, replacement keys, or clear flags; returns the updated masked settings. |
| `POST llm-test` | Tests the saved LLM configuration and returns the connection result. |
| `GET tools` | Returns `ffmpeg` and `yt-dlp` entries with a boolean `detected` field. |
| `POST tools/:tool/download` | Installs the named tool; the UI refreshes tool status on success. |
| `GET clips/:id/local-path` | Returns `{ path }` for the selected local clip. |

Native actions use bridge methods (`revealPath`, `openFolder`, `openExternalUrl`) when supplied; otherwise they invoke Tauri commands `reveal_in_finder({ path })`, `open_folder({ path })`, and `open_external_url({ url })`. The data folder defaults to `~/DartClip` when `dataDir` is not supplied; the native command must resolve `~`.
