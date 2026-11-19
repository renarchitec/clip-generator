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
