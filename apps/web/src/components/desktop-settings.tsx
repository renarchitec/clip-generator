import { useForm } from "@tanstack/react-form"
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Download,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Mic,
  RefreshCw,
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
  desktopPlatform,
  desktopToolDownloadKey,
  desktopTools,
  desktopToolsQuery,
  getDesktopSettings,
  hasDesktopToolDownload,
  openDesktopFolder,
  saveDesktopSettings,
  testDesktopLlm,
  trackDesktopToolDownload,
  type DesktopLlmTestResult,
  type DesktopToolDownloadInput,
  type DesktopSettingsPatch,
  type DesktopSettingsView,
  type DesktopVideoEncoder,
} from "@/lib/desktop"
import { useRuntime } from "@/lib/use-runtime"
import { useT } from "@/lib/i18n"

const desktopSettingsKey = ["desktop", "settings"] as const
const defaultSttBaseUrl = "https://api.groq.com/openai/v1"
const defaultSttModel = "whisper-large-v3-turbo"

type FormValues = {
  nineRouterUrl: string
  nineRouterApiKey: string
  nineRouterModel: string
  geminiApiKey: string
  geminiModel: string
  openaiApiKey: string
  openaiModel: string
  sttBaseUrl: string
  sttApiKey: string
  sttModel: string
  videoEncoder: DesktopVideoEncoder
}

export function DesktopSettings() {
  const t = useT()
  const runtime = useRuntime()
  const isMac = /mac|darwin/i.test(runtime.platform ?? desktopPlatform())
  const client = useQueryClient()
  const [testResult, setTestResult] = useState<DesktopLlmTestResult | null>(null)
  const [clearFlags, setClearFlags] = useState({
    nineRouter: false,
    gemini: false,
    openai: false,
    stt: false,
  })

  const settingsQuery = useQuery({
    queryKey: desktopSettingsKey,
    queryFn: getDesktopSettings,
    refetchOnMount: false,
  })

  const saveMutation = useMutation({
    mutationFn: saveDesktopSettings,
    onSuccess: (next) => {
      client.setQueryData<DesktopSettingsView>(desktopSettingsKey, next)
      setClearFlags({ nineRouter: false, gemini: false, openai: false, stt: false })
      setTestResult(null)
      void client.invalidateQueries({ queryKey: ["system", "llm-status"] })
      toast.success(t.desktop.savedToast)
    },
    onError: () => {
      toast.error(t.desktop.saveFailedToast)
    },
  })

  const testMutation = useMutation({
    mutationFn: testDesktopLlm,
    onSuccess: (result) => {
      setTestResult(result)
      void client.invalidateQueries({ queryKey: ["system", "llm-status"] })
    },
    onError: () => {
      setTestResult({
        ok: false,
        configured: false,
        error: t.desktop.testFailed,
      })
    },
  })

  const form = useForm({
    defaultValues: {
      nineRouterUrl: "",
      nineRouterApiKey: "",
      nineRouterModel: "",
      geminiApiKey: "",
      geminiModel: "gemini-2.5-flash",
      openaiApiKey: "",
      openaiModel: "gpt-4o-mini",
      sttBaseUrl: defaultSttBaseUrl,
      sttApiKey: "",
      sttModel: defaultSttModel,
      videoEncoder: "libx264" as DesktopVideoEncoder,
    } as FormValues,
    onSubmit: async ({ value }) => {
      const patch: DesktopSettingsPatch = {
        nineRouterUrl: value.nineRouterUrl.trim(),
        nineRouterModel: value.nineRouterModel.trim(),
        geminiModel: value.geminiModel.trim(),
        openaiModel: value.openaiModel.trim(),
        sttBaseUrl: value.sttBaseUrl.trim(),
        sttModel: value.sttModel.trim(),
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
      if (value.sttApiKey.trim()) {
        patch.sttApiKey = value.sttApiKey.trim()
      } else if (clearFlags.stt) {
        patch.clearSttApiKey = true
      }
      try {
        await saveMutation.mutateAsync(patch)
      } catch {
        return // onError shows the failure; keep the unsaved form.
      }
      form.setFieldValue("nineRouterApiKey", "")
      form.setFieldValue("geminiApiKey", "")
      form.setFieldValue("openaiApiKey", "")
      form.setFieldValue("sttApiKey", "")
    },
  })

  useEffect(() => {
    const data = settingsQuery.data
    if (!data) return
    form.setFieldValue("nineRouterUrl", data.nineRouterUrl || "")
    form.setFieldValue("nineRouterModel", data.nineRouterModel || "")
    form.setFieldValue("geminiModel", data.geminiModel || "gemini-2.5-flash")
    form.setFieldValue("openaiModel", data.openaiModel || "gpt-4o-mini")
    form.setFieldValue("sttBaseUrl", data.sttBaseUrl || defaultSttBaseUrl)
    form.setFieldValue("sttModel", data.sttModel || defaultSttModel)
    form.setFieldValue("sttApiKey", "")
    form.setFieldValue("videoEncoder", data.videoEncoder || "libx264")
  }, [settingsQuery.data, form])

  const saved = settingsQuery.data
  const folderPath = runtime.dataDir ?? "~/DartClip"

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

          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <Mic aria-hidden="true" className="size-4 text-accent" />
                <h4 className="text-sm font-semibold">{t.desktop.sttHeading}</h4>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t.desktop.sttDescription}</p>
            </div>

            <FieldGroup className="gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <form.Field name="sttBaseUrl">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="desktop-stt-url">{t.desktop.sttBaseUrl}</FieldLabel>
                      <Input
                        id="desktop-stt-url"
                        type="url"
                        placeholder={defaultSttBaseUrl}
                        className="h-10 font-mono text-xs"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>

                <form.Field name="sttModel">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="desktop-stt-model">{t.desktop.sttModel}</FieldLabel>
                      <Input
                        id="desktop-stt-model"
                        placeholder={defaultSttModel}
                        className="h-10 font-mono text-xs"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>
              </div>

              <form.Field name="sttApiKey">
                {(field) => {
                  const hasSaved = Boolean(saved?.hasSttApiKey && !clearFlags.stt)
                  const savedHint = hasSaved ? saved?.sttApiKeyHint : null
                  return (
                    <Field>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <FieldLabel htmlFor="desktop-stt-key">{t.desktop.sttApiKey}</FieldLabel>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="gap-1 font-mono text-[11px] font-normal">
                            {hasSaved ? (
                              <>
                                <KeyRound aria-hidden="true" className="size-3 text-accent" />
                                {t.desktop.keySaved}{savedHint ? ` (${savedHint})` : ""}
                              </>
                            ) : t.desktop.sttFallbackBadge}
                          </Badge>
                          {hasSaved && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setClearFlags((prev) => ({ ...prev, stt: true }))
                                field.handleChange("")
                              }}
                            >
                              <Trash2 aria-hidden="true" className="size-3" />
                              {t.desktop.clearKey}
                            </Button>
                          )}
                        </div>
                      </div>
                      <Input
                        id="desktop-stt-key"
                        type="password"
                        autoComplete="off"
                        placeholder={savedHint ?? "gsk_..."}
                        className="h-10 font-mono text-xs"
                        value={field.state.value}
                        onChange={(e) => {
                          if (clearFlags.stt) setClearFlags((prev) => ({ ...prev, stt: false }))
                          field.handleChange(e.target.value)
                        }}
                      />
                      <FieldDescription className="text-xs">{t.desktop.sttFallbackHint}</FieldDescription>
                    </Field>
                  )
                }}
              </form.Field>
            </FieldGroup>
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
                        {(isMac || field.state.value === "h264_videotoolbox") && <SelectItem value="h264_videotoolbox" disabled={!isMac}>{t.desktop.encoderVideoToolbox}</SelectItem>}
                        <SelectItem value="libx264">{t.desktop.encoderX264}</SelectItem>
                      </SelectContent>
                    </Select>
                    {isMac && <FieldDescription className="text-xs">{t.desktop.encoderHint}</FieldDescription>}
                  </Field>
                )}
              </form.Field>

              <Field>
                <FieldLabel>{t.desktop.storageFolder}</FieldLabel>
                <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5">
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={folderPath}>
                    {folderPath}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 px-2 text-xs"
                    onClick={() => void openDesktopFolder(folderPath).catch(() => toast.error(t.desktop.openFolderFailed))}
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

          <p id="desktop-test-settings-hint" className="text-xs text-muted-foreground">{t.desktop.testSavedSettings}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 px-4"
              disabled={testMutation.isPending || saveMutation.isPending}
              aria-describedby="desktop-test-settings-hint"
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
      <DesktopTools />
    </section>
  )
}

function DesktopTools() {
  const t = useT()
  const client = useQueryClient()
  const tools = useQuery(desktopToolsQuery)
  const pending = useMutationState({
    filters: { mutationKey: desktopToolDownloadKey, status: "pending" },
    select: (mutation) => mutation.state.variables as DesktopToolDownloadInput,
  })
  const download = useMutation({
    mutationKey: desktopToolDownloadKey,
    mutationFn: (input: DesktopToolDownloadInput) => trackDesktopToolDownload(input, () =>
      client.invalidateQueries({ queryKey: desktopToolsQuery.queryKey }),
    ),
    onSuccess: (_result, { tool, force }) => {
      if (force) toast.success(`${tool}: ${t.desktop.toolUpdated}`)
    },
    onError: () => toast.error(t.desktop.downloadFailed),
  })
  const isBusy = download.isPending || pending.length > 0 || hasDesktopToolDownload(tools.data)
  const sourceLabels = {
    managed: t.desktop.toolSourceManaged,
    system: t.desktop.toolSourceSystem,
    env: t.desktop.toolSourceEnv,
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h4 className="text-sm font-semibold">{t.desktop.toolsHeading}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{t.desktop.toolsDescription}</p>
      {tools.isPending ? <p role="status" className="mt-3 text-sm text-muted-foreground">{t.loading}</p> : !tools.data ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-sm text-muted-foreground">{t.desktop.toolsUnavailable}</p>
          <Button variant="outline" size="sm" onClick={() => void tools.refetch()}>{t.retry}</Button>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {desktopTools.map((tool) => {
            const info = tools.data?.[tool]
            const detected = info?.detected === true
            const active = pending.find((input) => input.tool === tool)
            const downloading = info?.downloading === true || Boolean(active)
            const caption = [info?.version, info?.source && sourceLabels[info.source]].filter(Boolean).join(" · ")
            return (
              <li key={tool} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{tool}</span>
                    {downloading ? (
                      <Badge variant="secondary">
                        <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                        {t.desktop.downloading}{typeof info?.progress === "number" ? ` ${info.progress}%` : ""}
                      </Badge>
                    ) : detected ? (
                      <Badge variant="outline"><CheckCircle2 aria-hidden="true" />{t.desktop.toolDetected}</Badge>
                    ) : (
                      <Badge variant="outline"><AlertCircle aria-hidden="true" />{t.desktop.toolMissing}</Badge>
                    )}
                  </div>
                  {detected && caption && <p className="text-xs text-muted-foreground">{caption}</p>}
                  {!downloading && info?.error && <p className="break-words text-xs text-destructive">{info.error}</p>}
                </div>
                {(!detected || info?.source !== "env") && (
                  <Button size="sm" variant="outline" disabled={isBusy} onClick={() => download.mutate({ tool, force: detected })}>
                    {detected ? <RefreshCw aria-hidden="true" /> : <Download aria-hidden="true" />}
                    {detected ? (active?.force ? t.desktop.toolUpdating : t.desktop.toolUpdate) : t.download}
                    <span className="sr-only"> {tool}</span>
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
