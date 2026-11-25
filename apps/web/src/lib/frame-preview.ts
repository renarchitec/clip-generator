import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { api, type AspectRatio, type Reframe } from "@/lib/api"
import type { CaptionStyle } from "@/lib/caption-style"

export const FRAME_DEFAULT_SEC = 30
export const FRAME_STEP_SEC = 15
export const FRAME_MAX_SEC = 36000
const FRAME_POLL_MS = 1500

/** Everything that changes what the worker would render. A frame is only valid for the settings it was made with. */
export type FrameParams = { url: string; aspectRatio: AspectRatio; reframe: Reframe; twoSpeakers: boolean; facecam: boolean; captions: boolean; captionStyle?: CaptionStyle | null }
export type FrameResponse = { id: string; status: "queued" | "running" | "done" | "failed"; error?: string; width?: number; height?: number; atSec?: number; imageUrl?: string }
export type RenderedFrame = { id: string; imageUrl: string; width: number; height: number; atSec: number }
export type FrameErrorKind = "busy" | "invalid" | "failed" | "network" | "expired"

/** Accepts "90", "90.5", "1:30" or "1:02:03". Returns null when the text is not a usable time. */
export function parseFrameTime(text: string): number | null {
  const value = text.trim()
  if (!value) return null
  const parts = value.split(":")
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part.trim()))) return null
  const seconds = parts.map((part) => Number(part.trim())).reduce((total, part) => total * 60 + part, 0)
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= FRAME_MAX_SEC ? seconds : null
}

export function formatFrameTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, "0")
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${String(minutes).padStart(2, "0")}:${rest}`
}

const frameKey = (params: FrameParams) => JSON.stringify([params.url.trim(), params.aspectRatio, params.reframe, params.twoSpeakers, params.facecam, params.captions, params.captionStyle ?? null])
const statusOf = (error: unknown) => (error as { status?: number } | null)?.status

/**
 * Renders one real output frame on the worker and polls until it is ready.
 * `timeText` is prefilled from `suggestedSec` until the user types their own value.
 */
export function useFramePreview(params: FrameParams, suggestedSec: number) {
  const key = frameKey(params)
  const [timeInput, setTimeInput] = useState<string | null>(null)
  const [request, setRequest] = useState<{ id: string; atSec: number; key: string } | null>(null)
  const [kept, setKept] = useState<(RenderedFrame & { key: string }) | null>(null)
  const [brokenIds, setBrokenIds] = useState<string[]>([])

  const create = useMutation({
    mutationFn: (variables: { atSec: number; params: FrameParams; key: string }) => api<{ id: string }>("/frames", {
      method: "POST",
      body: JSON.stringify({ url: variables.params.url.trim(), atSec: variables.atSec, aspectRatio: variables.params.aspectRatio, reframe: variables.params.reframe, twoSpeakers: variables.params.twoSpeakers, facecam: variables.params.facecam, captions: variables.params.captions, captionStyle: variables.params.captionStyle ?? null }),
    }),
    onSuccess: ({ id }, variables) => setRequest({ id, atSec: variables.atSec, key: variables.key }),
  })

  const query = useQuery({
    queryKey: ["frames", request?.id],
    queryFn: () => api<FrameResponse>(`/frames/${request?.id}`),
    enabled: !!request,
    refetchInterval: (query) => query.state.error || ["done", "failed"].includes(query.state.data?.status ?? "") ? false : FRAME_POLL_MS,
    retry: (count, error) => statusOf(error) !== 404 && count < 3,
  })

  const data = request ? query.data : undefined
  const settled = data?.status === "done" || data?.status === "failed" || query.isError
  const running = create.isPending || (!!request && !settled)
  const stale = !!request && request.key !== key

  const current: RenderedFrame | null = request && !stale && data?.status === "done" && data.imageUrl && data.width && data.height
    ? { id: request.id, imageUrl: data.imageUrl, width: data.width, height: data.height, atSec: data.atSec ?? request.atSec }
    : null
  useEffect(() => { if (current) setKept({ ...current, key }) }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Keep showing the previous frame while "Another frame" renders, but never one made with different settings.
  const shown = current ?? (kept && kept.key === key ? kept : null)
  const frame = shown && !brokenIds.includes(shown.id) ? shown : null
  const expired = !!shown && brokenIds.includes(shown.id)

  const errorKind: FrameErrorKind | null = create.isError
    ? statusOf(create.error) === 429 ? "busy" : statusOf(create.error) === 400 ? "invalid" : "network"
    : request && !stale && (data?.status === "failed" || query.isError) ? "failed"
      : expired ? "expired" : null
  const errorDetail = request && !stale && data?.status === "failed" ? data.error : undefined

  const timeText = timeInput ?? formatFrameTime(suggestedSec)
  const parsedSec = parseFrameTime(timeText)
  const hasUrl = /^https?:\/\//i.test(params.url.trim())

  const start = (atSec: number) => {
    create.reset()
    create.mutate({ atSec, params, key })
  }

  return {
    timeText,
    setTimeText: setTimeInput,
    parsedSec,
    hasUrl,
    frame,
    running,
    stale,
    queued: !!request && !settled && data?.status !== "running" && !create.isPending,
    errorKind,
    errorDetail,
    lastAtSec: request?.atSec ?? null,
    render: () => { if (parsedSec !== null && hasUrl && !running) start(parsedSec) },
    renderAnother: () => {
      if (!hasUrl || running) return
      const next = Math.min(FRAME_MAX_SEC, (request?.atSec ?? parsedSec ?? suggestedSec) + FRAME_STEP_SEC)
      setTimeInput(formatFrameTime(next))
      start(next)
    },
    markImageBroken: (id: string) => setBrokenIds((ids) => ids.includes(id) ? ids : [...ids, id]),
  }
}

export type FramePreviewState = ReturnType<typeof useFramePreview>
