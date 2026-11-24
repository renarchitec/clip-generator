import { createFileRoute } from "@tanstack/react-router"
import { LegalPage } from "@/components/legal-page"

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy — DartClip" }] }),
  component: () => <LegalPage kind="privacy"/>,
})
