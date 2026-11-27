import type { ComponentProps } from "react"
import { Check } from "lucide-react"
import { Button } from "./ui/button"
import { cn } from "@/lib/utils"

type Props = Omit<ComponentProps<"button">, "type" | "aria-pressed"> & {
  selected: boolean
}

export function SplitChoice({
  selected,
  className,
  children,
  ...props
}: Props) {
  return (
    <Button
      {...props}
      type="button"
      size="sm"
      variant="default"
      aria-pressed={selected}
      className={cn(
        "min-h-11 max-w-full gap-1.5 whitespace-normal sm:min-h-9",
        selected
          ? "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
          : "border-border bg-background text-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Check
        aria-hidden="true"
        className={cn("size-3.5", !selected && "invisible")}
      />
      {children}
    </Button>
  )
}
