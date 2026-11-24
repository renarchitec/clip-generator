import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BookmarkPlus, History, LoaderCircle, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
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
import { api } from "@/lib/api"
import { relativeAge } from "@/lib/format"
import { useLanguage, useT } from "@/lib/i18n"

export type BriefHistoryItem = { id: string; text: string; useCount: number; lastUsedAt: string }

export const briefHistoryKey = ["brief-history"] as const

export function BriefHistoryMenu({ brief, disabled, onPick }: { brief: string; disabled?: boolean; onPick: (text: string) => void }) {
  const t = useT()
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

  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="outline" size="sm" className="h-7 gap-1 rounded-md px-2 text-xs" aria-label={t.briefHistory} disabled={disabled}>
        <History aria-hidden="true" className="size-3"/>
        <span className="hidden sm:inline">{t.briefHistory}</span>
      </Button>
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
