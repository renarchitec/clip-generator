import { createFileRoute } from "@tanstack/react-router"

async function proxy({ request }: { request: Request }) {
  const incoming = new URL(request.url)
  const upstream = new URL(`${incoming.pathname}${incoming.search}`, process.env.API_INTERNAL_URL || "http://localhost:3000")
  const headers = new Headers(request.headers)
  // Hop-by-hop headers must not be forwarded; undici rejects transfer-encoding outright.
  for (const name of ["host", "connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-connection", "content-length"]) headers.delete(name)
  // Multipart (file upload) dikirim utuh lewat arrayBuffer: boundary tetap ada di
  // content-type, dan body tidak bergantung pada stream yang sudah dikonsumsi.
  // Untuk method lain, stream diteruskan langsung (duplex half).
  const isMultipart = (request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")
  const noBody = ["GET", "HEAD"].includes(request.method)
  const body = noBody
    ? undefined
    : isMultipart
      ? new Uint8Array(await request.arrayBuffer())
      : request.body
  const response = await fetch(upstream, { method: request.method, headers, body, duplex: "half", redirect: "manual" } as RequestInit)
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete("connection")
  responseHeaders.delete("transfer-encoding")
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders })
}

export const Route = createFileRoute("/api/$")({ server: { handlers: { GET: proxy, POST: proxy, PUT: proxy, PATCH: proxy, DELETE: proxy, HEAD: proxy, OPTIONS: proxy } } })
