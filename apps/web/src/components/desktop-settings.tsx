import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2,
  Cpu,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  getDesktopBridge,
  type DesktopLlmTestResult,
  type DesktopSettingsPatch,
  type DesktopSettingsView,
  type DesktopVideoEncoder,
} from "@/lib/desktop"
import { useT } from "@/lib/i18n"

const desktopSettingsKey = ["desktop", "settings"] as const

type FormValues = {
  nineRouterUrl: string
  nineRouterApiKey: string
  nineRouterModel: string
  geminiApiKey: string
  geminiModel: string
  openaiApiKey: string
  openaiModel: string
  videoEncoder: DesktopVideoEncoder
}

export function DesktopSettings() {
  const t = useT()
  const bridge = getDesktopBridge()
  const client = useQueryClient()
  const [testResult, setTestResult] = useState<DesktopLlmTestResult | null>(null)
  const [clearFlags, setClearFlags] = useState({
    nineRouter: false,
    gemini: false,
    openai: false,
  })

  const settingsQuery = useQuery({
    queryKey: desktopSettingsKey,
    queryFn: async () => {
      if (!bridge) throw new Error("Desktop bridge unavailable")
      return bridge.getSettings()
    },
    enabled: Boolean(bridge),
  })

  const saveMutation = useMutation({
    mutationFn: async (patch: DesktopSettingsPatch) => {
      if (!bridge) throw new Error("Desktop bridge unavailable")
      return bridge.saveSettings(patch)
    },
    onSuccess: (next) => {
      client.setQueryData<DesktopSettingsView>(desktopSettingsKey, next)
      setClearFlags({ nineRouter: false, gemini: false, openai: false })
      setTestResult(null)
      void client.invalidateQueries({ queryKey: ["system", "llm-status"] })
      toast.success(t.desktop.savedToast)
    },
    onError: () => {
      toast.error(t.desktop.saveFailedToast)
    },
  })

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!bridge) throw new Error("Desktop bridge unavailable")
      return bridge.testLlm()
    },
    onSuccess: (result) => {
      setTestResult(result)
      void client.invalidateQueries({ queryKey: ["system", "llm-status"] })
    },
    onError: (err) => {
      setTestResult({
        ok: false,
        configured: false,
        error: err instanceof Error ? err.message : t.desktop.testFailed,
      })
    },
  })

  const form = useForm({
    defaultValues: {
      nineRouterUrl: "https://9router.rencraft.site/v1",
      nineRouterApiKey: "",
      nineRouterModel: "tabi-fixer",
      geminiApiKey: "",
      geminiModel: "gemini-2.5-flash",
      openaiApiKey: "",
      openaiModel: "gpt-4o-mini",
      videoEncoder: "h264_videotoolbox" as DesktopVideoEncoder,
    } as FormValues,
    onSubmit: async ({ value }) => {
      const patch: DesktopSettingsPatch = {
        nineRouterUrl: value.nineRouterUrl.trim(),
        nineRouterModel: value.nineRouterModel.trim(),
        geminiModel: value.geminiModel.trim(),
        openaiModel: value.openaiModel.trim(),
        videoEncoder: value.videoEncoder,
      }
      if (value.nineRouterApiKey.trim()) {
        patch.nineRouterApiKey = value.nineRouterApiKey.trim()
      } else if (clearFlags.nineRouter) {
        patch.clearNineRouterApiKey = true
      }
      if (value.geminiApiKey.trim()) {
        patch.geminiApiKey = value.geminiApiKey.trim()
      } else if (clearFlags.gemini) {
        patch.clearGeminiApiKey = true
      }
      if (value.openaiApiKey.trim()) {
        patch.openaiApiKey = value.openaiApiKey.trim()
      } else if (clearFlags.openai) {
        patch.clearOpenaiApiKey = true
      }
      await saveMutation.mutateAsync(patch)
      form.setFieldValue("nineRouterApiKey", "")
      form.setFieldValue("geminiApiKey", "")
      form.setFieldValue("openaiApiKey", "")
    },
  })

  useEffect(() => {
    const data = settingsQuery.data
    if (!data) return
    form.setFieldValue("nineRouterUrl", data.nineRouterUrl || "https://9router.rencraft.site/v1")
    form.setFieldValue("nineRouterModel", data.nineRouterModel || "tabi-fixer")
    form.setFieldValue("geminiModel", data.geminiModel || "gemini-2.5-flash")
    form.setFieldValue("openaiModel", data.openaiModel || "gpt-4o-mini")
    form.setFieldValue("videoEncoder", data.videoEncoder || "h264_videotoolbox")
  }, [settingsQuery.data, form])

  if (!bridge) {
    return (
      <section aria-labelledby="desktop-ai-heading">
        <div className="mb-4">
          <h3 id="desktop-ai-heading" className="font-display text-lg font-medium tracking-[-.02em]">
            {t.desktop.aiHeading}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{t.desktop.bridgeUnavailable}</p>
        </div>
      </section>
    )
  }

  const saved = settingsQuery.data

  return (
    <section aria-labelledby="desktop-ai-heading" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="desktop-ai-heading" className="font-display text-lg font-medium tracking-[-.02em]">
            {t.desktop.aiHeading}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{t.desktop.aiIntro}</p>
        </div>
        {saved && (
          <Badge variant="secondary" className="gap-1.5 font-normal">
            <ShieldCheck aria-hidden="true" className="size-3.5 text-accent" />
            {saved.encryptionAvailable ? t.desktop.keychainEncrypted : t.desktop.localFileStorage}
          </Badge>
        )}
      </div>

      {settingsQuery.isPending ? (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      ) : settingsQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t.desktop.loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void settingsQuery.refetch()}>
              {t.retry}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
          className="space-y-6"
        >
          {/* Primary provider: 9router / OpenAI-compatible */}
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles aria-hidden="true" className="size-4 text-accent" />
                <h4 className="text-sm font-semibold">{t.desktop.primaryProvider}</h4>
              </div>
              <Badge variant="outline" className="font-mono text-[11px] font-normal">
                {t.desktop.primaryBadge}
              </Badge>
            </div>

            <FieldGroup className="gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <form.Field name="nineRouterUrl">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="desktop-9router-url">{t.desktop.baseUrl}</FieldLabel>
                      <Input
                        id="desktop-9router-url"
                        type="url"
                        placeholder="https://9router.rencraft.site/v1"
                        className="h-10 font-mono text-xs"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="nineRouterModel">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="desktop-9router-model">{t.desktop.model}</FieldLabel>
                      <Input
                        id="desktop-9router-model"
                        placeholder="tabi-fixer"
                        className="h-10 font-mono text-xs"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>
              </div>

              <form.Field name="nineRouterApiKey">
                {(field) => {
                  const hasSaved = Boolean(saved?.hasNineRouterApiKey && !clearFlags.nineRouter)
                  return (
                    <Field>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <FieldLabel htmlFor="desktop-9router-key">{t.desktop.apiKey}</FieldLabel>
                        {hasSaved && (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                              <KeyRound aria-hidden="true" className="size-3 text-accent" />
                              {saved?.nineRouterApiKeyHint ?? t.desktop.keySaved}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setClearFlags((prev) => ({ ...prev, nineRouter: true }))
                                field.handleChange("")
                              }}
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
                            >
                              <Trash2 aria-hidden="true" className="size-3" />
                              {t.desktop.clearKey}
                            </button>
                          </div>
                        )}
                      </div>
                      <Input
                        id="desktop-9router-key"
                        type="password"
                        autoComplete="off"
                        placeholder={hasSaved ? t.desktop.keyReplacePlaceholder : t.desktop.keyPlaceholder}
                        className="h-10 font-mono text-xs"
                        value={field.state.value}
                        onChange={(e) => {
                          if (clearFlags.nineRouter) {
                            setClearFlags((prev) => ({ ...prev, nineRouter: false }))
                          }
                          field.handleChange(e.target.value)
                        }}
                      />
                      <FieldDescription className="text-xs">{t.desktop.primaryHint}</FieldDescription>
                    </Field>
                  )
                }}
              </form.Field>
            </FieldGroup>
          </div>

          {/* Fallback providers: Gemini + OpenAI */}
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-4">
              <h4 className="text-sm font-semibold">{t.desktop.fallbackHeading}</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t.desktop.fallbackIntro}</p>
            </div>

            <div className="space-y-5">
              {/* Gemini */}
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
                <form.Field name="geminiApiKey">
                  {(field) => {
                    const hasSaved = Boolean(saved?.hasGeminiApiKey && !clearFlags.gemini)
                    return (
                      <Field>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <FieldLabel htmlFor="desktop-gemini-key">{t.desktop.geminiKey}</FieldLabel>
                          {hasSaved && (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {saved?.geminiApiKeyHint ?? t.desktop.keySaved}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setClearFlags((prev) => ({ ...prev, gemini: true }))
                                  field.handleChange("")
                                }}
                                className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                              >
                                {t.desktop.clearKey}
                              </button>
                            </div>
                          )}
                        </div>
                        <Input
                          id="desktop-gemini-key"
                          type="password"
                          autoComplete="off"
                          placeholder={hasSaved ? t.desktop.keyReplacePlaceholder : "AIza…"}
                          className="h-10 font-mono text-xs"
                          value={field.state.value}
                          onChange={(e) => {
                            if (clearFlags.gemini) setClearFlags((prev) => ({ ...prev, gemini: false }))
                            field.handleChange(e.target.value)
                          }}
                        />
                      </Field>
                    )
                  }}
                </form.Field>

                <form.Field name="geminiModel">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="desktop-gemini-model">{t.desktop.geminiModel}</FieldLabel>
                      <Input
                        id="desktop-gemini-model"
                        placeholder="gemini-2.5-flash"
                        className="h-10 font-mono text-xs"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>
              </div>

              {/* OpenAI */}
              <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-[minmax(0,1fr)_200px]">
                <form.Field name="openaiApiKey">
                  {(field) => {
                    const hasSaved = Boolean(saved?.hasOpenaiApiKey && !clearFlags.openai)
                    return (
                      <Field>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <FieldLabel htmlFor="desktop-openai-key">{t.desktop.openaiKey}</FieldLabel>
                          {hasSaved && (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {saved?.openaiApiKeyHint ?? t.desktop.keySaved}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setClearFlags((prev) => ({ ...prev, openai: true }))
                                  field.handleChange("")
                                }}
                                className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                              >
                                {t.desktop.clearKey}
                              </button>
                            </div>
                          )}
                        </div>
                        <Input
                          id="desktop-openai-key"
                          type="password"
                          autoComplete="off"
                          placeholder={hasSaved ? t.desktop.keyReplacePlaceholder : "sk-…"}
                          className="h-10 font-mono text-xs"
                          value={field.state.value}
                          onChange={(e) => {
                            if (clearFlags.openai) setClearFlags((prev) => ({ ...prev, openai: false }))
                            field.handleChange(e.target.value)
                          }}
                        />
                      </Field>
                    )
                  }}
                </form.Field>

                <form.Field name="openaiModel">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="desktop-openai-model">{t.desktop.openaiModel}</FieldLabel>
                      <Input
                        id="desktop-openai-model"
                        placeholder="gpt-4o-mini"
                        className="h-10 font-mono text-xs"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>
              </div>
            </div>
          </div>

          {/* Local encoding & storage */}
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <Cpu aria-hidden="true" className="size-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">{t.desktop.localEngineHeading}</h4>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="videoEncoder">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="desktop-video-encoder">{t.desktop.encoderLabel}</FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={(next) => field.handleChange(next as DesktopVideoEncoder)}
                    >
                      <SelectTrigger id="desktop-video-encoder" className="h-10 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="h264_videotoolbox">{t.desktop.encoderVideoToolbox}</SelectItem>
                        <SelectItem value="libx264">{t.desktop.encoderX264}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription className="text-xs">{t.desktop.encoderHint}</FieldDescription>
                  </Field>
                )}
              </form.Field>

              <Field>
                <FieldLabel>{t.desktop.storageFolder}</FieldLabel>
                <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5">
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={saved?.clipsDir}>
                    {saved?.clipsDir ?? "~/DartClip"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 px-2 text-xs"
                    onClick={() => void bridge.openClipsFolder()}
                  >
                    <FolderOpen aria-hidden="true" className="size-3.5" />
                    {t.desktop.openFolder}
                  </Button>
                </div>
                <FieldDescription className="text-xs">{t.desktop.storageHint}</FieldDescription>
              </Field>
            </div>
          </div>

          {testResult && (
            <Alert variant={testResult.ok ? "default" : "destructive"}>
              <AlertDescription className="flex items-start gap-2.5 text-sm">
                {testResult.ok ? (
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                ) : (
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                )}
                <div className="min-w-0">
                  {testResult.ok ? (
                    <p>
                      {t.desktop.testPassed
                        .replace("{provider}", testResult.provider || "LLM")
                        .replace("{model}", testResult.model || "default")}
                    </p>
                  ) : (
                    <p className="break-words">{testResult.error || t.desktop.testFailed}</p>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 px-4"
              disabled={testMutation.isPending || saveMutation.isPending}
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending && <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />}
              {testMutation.isPending ? t.desktop.testingLlm : t.desktop.testLlm}
            </Button>
            <Button type="submit" className="min-h-11 min-w-36 px-5" disabled={saveMutation.isPending}>
              {saveMutation.isPending && <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />}
              {t.desktop.saveSettings}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
