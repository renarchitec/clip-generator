import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BookmarkPlus, History, LoaderCircle, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { useIsMobile } from "@/hooks/use-mobile"
import { api } from "@/lib/api"
import { relativeAge } from "@/lib/format"
import { useLanguage, useT } from "@/lib/i18n"

export type BriefHistoryItem = { id: string; text: string; useCount: number; lastUsedAt: string }

export const briefHistoryKey = ["brief-history"] as const

export function BriefHistoryMenu({ brief, disabled, onPick }: { brief: string; disabled?: boolean; onPick: (text: string) => void }) {
  const t = useT()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const locale = useLanguage().language === "id" ? "id" : "en"
  const client = useQueryClient()
  const history = useQuery({ queryKey: briefHistoryKey, queryFn: () => api<BriefHistoryItem[]>("/briefs/history"), staleTime: 30_000 })
  const save = useMutation({
    mutationFn: (text: string) => api<BriefHistoryItem>("/briefs/history", { method: "POST", body: JSON.stringify({ text }) }),
    onSuccess: () => { toast.success(t.briefSaved); void client.invalidateQueries({ queryKey: briefHistoryKey }) },
    onError: () => toast.error(t.briefSaveError),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/briefs/history/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: briefHistoryKey }),
    onError: () => toast.error(t.briefDeleteError),
  })
  const trimmed = brief.trim()
  const items = history.data ?? []

  const triggerButton = (
    <Button type="button" variant="outline" size="sm" className="min-h-9 gap-1.5 rounded-md px-2.5 text-xs sm:h-7 sm:min-h-0 sm:gap-1 sm:px-2" aria-label={t.briefHistory} disabled={disabled}>
      <History aria-hidden="true" className="size-3.5 sm:size-3" />
      <span className="hidden sm:inline">{t.briefHistory}</span>
    </Button>
  )

  if (isMobile) {
    return (
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerTrigger asChild>{triggerButton}</DrawerTrigger>
        <DrawerContent className="flex max-h-[85dvh] flex-col overflow-hidden pb-0">
          <DrawerHeader className="shrink-0 border-b border-border px-4 py-3.5 text-left">
            <DrawerTitle className="font-display text-base font-medium tracking-[-.01em]">{t.briefHistoryTitle}</DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
            {history.isPending ? (
              <div className="space-y-2 p-2" aria-busy="true">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-4/5 rounded-lg" />
              </div>
            ) : history.isError ? (
              <p role="alert" className="px-2 py-4 text-sm text-destructive">
                {t.briefHistoryError}
              </p>
            ) : items.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm leading-6 text-muted-foreground">{t.briefHistoryEmpty}</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {items.map((item) => {
                  const deleting = remove.isPending && remove.variables === item.id
                  return (
                    <li key={item.id} className="flex items-center gap-1.5 py-1">
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => {
                          onPick(item.text)
                          setDrawerOpen(false)
                        }}
                        className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors active:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      >
                        <span className="line-clamp-2 w-full text-sm leading-snug text-foreground">{item.text}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {relativeAge(item.lastUsedAt, locale)}
                          {item.useCount > 1 && <> · {t.briefUseCount.replace("{count}", String(item.useCount))}</>}
                        </span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t.deleteBrief}
                        title={t.deleteBrief}
                        disabled={deleting}
                        onClick={() => remove.mutate(item.id)}
                        className="size-10 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        {deleting ? (
                          <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <Trash2 aria-hidden="true" className="size-4" />
                        )}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <DrawerFooter className="shrink-0 border-t border-border bg-card px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              variant="outline"
              disabled={trimmed.length < 2 || save.isPending}
              onClick={() => save.mutate(trimmed)}
              className="min-h-11 w-full gap-2 text-sm"
            >
              {save.isPending ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <BookmarkPlus aria-hidden="true" className="size-4" />
              )}
              {t.saveBrief}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      {triggerButton}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))] max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))]">
      <DropdownMenuLabel>{t.briefHistoryTitle}</DropdownMenuLabel>
      <DropdownMenuItem disabled={trimmed.length < 2 || save.isPending} onSelect={(event) => { event.preventDefault(); save.mutate(trimmed) }} className="text-xs">
        {save.isPending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none"/> : <BookmarkPlus aria-hidden="true" className="size-3.5"/>}
        {t.saveBrief}
      </DropdownMenuItem>
      <DropdownMenuSeparator/>
      {history.isPending ? <div className="space-y-2 p-1.5" aria-busy="true"><Skeleton className="h-8 w-full"/><Skeleton className="h-8 w-4/5"/></div>
        : history.isError ? <p role="alert" className="px-1.5 py-2 text-xs text-destructive">{t.briefHistoryError}</p>
        : items.length === 0 ? <p className="px-1.5 py-3 text-xs leading-5 text-muted-foreground">{t.briefHistoryEmpty}</p>
        : <DropdownMenuGroup>
          {items.map((item) => {
            const deleting = remove.isPending && remove.variables === item.id
            return <div key={item.id} className="group/brief flex items-start gap-0.5">
              <DropdownMenuItem onSelect={() => onPick(item.text)} className="min-w-0 flex-1 flex-col items-start gap-0.5 py-1.5" disabled={deleting}>
                <span className="line-clamp-2 w-full text-left text-sm leading-snug">{item.text}</span>
                <span className="text-[0.7rem] tabular-nums text-muted-foreground">
                  {relativeAge(item.lastUsedAt, locale)}{item.useCount > 1 && <> · {t.briefUseCount.replace("{count}", String(item.useCount))}</>}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" aria-label={t.deleteBrief} title={t.deleteBrief} disabled={deleting}
                onClick={(event) => event.stopPropagation()}
                onSelect={(event) => { event.preventDefault(); remove.mutate(item.id) }}
                className="mt-0.5 size-7 shrink-0 justify-center p-0 text-muted-foreground opacity-60 group-hover/brief:opacity-100 focus:opacity-100">
                {deleting ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none"/> : <Trash2 aria-hidden="true" className="size-3.5"/>}
              </DropdownMenuItem>
            </div>
          })}
        </DropdownMenuGroup>}
    </DropdownMenuContent>
  </DropdownMenu>
}
