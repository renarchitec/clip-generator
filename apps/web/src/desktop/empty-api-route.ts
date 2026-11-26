import { createFileRoute } from "@tanstack/react-router"

// Desktop SPA calls the local NestJS API directly; no SSR proxy route is used.
export const Route = createFileRoute("/api/$")({})
