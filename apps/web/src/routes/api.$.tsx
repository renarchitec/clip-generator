import { createFileRoute } from "@tanstack/react-router"

async function proxy({ request }: { request: Request }) {
  const incoming = new URL(request.url)
  const upstream = new URL(`${incoming.pathname}${incoming.search}`, process.env.API_INTERNAL_URL || "http://localhost:3000")
  const headers = new Headers(request.headers)
  // Hop-by-hop headers must not be forwarded; undici rejects transfer-encoding outright.
  for (const name of ["host", "connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-connection", "content-length"]) headers.delete(name)
  const response = await fetch(upstream, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, duplex: "half", redirect: "manual" } as RequestInit)
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete("connection")
  responseHeaders.delete("transfer-encoding")
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders })
}

export const Route = createFileRoute("/api/$")({ server: { handlers: { GET: proxy, POST: proxy, PUT: proxy, PATCH: proxy, DELETE: proxy, HEAD: proxy, OPTIONS: proxy } } })
