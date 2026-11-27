import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerOverlay, DrawerPortal, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

const AlertDrawerContext = React.createContext<{ close: () => void } | null>(null)

function AlertDialog({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  const isMobile = useIsMobile()
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const handleOpenChange = (nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  return isMobile ? (
    <AlertDrawerContext.Provider value={{ close: () => handleOpenChange(false) }}>
      <Drawer data-slot="alert-dialog" open={open ?? internalOpen} onOpenChange={handleOpenChange} autoFocus {...props} />
    </AlertDrawerContext.Provider>
  ) : (
    <AlertDialogPrimitive.Root data-slot="alert-dialog" open={open ?? internalOpen} onOpenChange={handleOpenChange} {...props} />
  )
}

function AlertDialogTrigger(props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  const drawer = React.useContext(AlertDrawerContext)
  return drawer ? <DrawerTrigger data-slot="alert-dialog-trigger" {...props} /> : <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogPortal(props: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  const drawer = React.useContext(AlertDrawerContext)
  return drawer ? <DrawerPortal data-slot="alert-dialog-portal" {...props} /> : <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  const drawer = React.useContext(AlertDrawerContext)
  return drawer ? (
    <DrawerOverlay data-slot="alert-dialog-overlay" className={className} {...props} />
  ) : (
    <AlertDialogPrimitive.Overlay data-slot="alert-dialog-overlay" className={cn("fixed inset-0 z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0", className)} {...props} />
  )
}

function AlertDialogContent({ className, onOpenAutoFocus, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  const drawer = React.useContext(AlertDrawerContext)
  return drawer ? (
    <DrawerContent
      data-slot="alert-dialog-content"
      role="alertdialog"
      className={cn("overflow-y-auto px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]", className)}
      onInteractOutside={(event) => event.preventDefault()}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event)
        if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return
        const cancel = event.target.querySelector<HTMLElement>("[data-alert-dialog-cancel]:not(:disabled)")
        if (cancel) {
          event.preventDefault()
          cancel.focus({ preventScroll: true })
        }
      }}
      {...props}
    />
  ) : (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content data-slot="alert-dialog-content" className={cn("fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-background p-6 shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className)} onOpenAutoFocus={onOpenAutoFocus} {...props} />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  const drawer = React.useContext(AlertDrawerContext)
  return <div className={cn("flex flex-col gap-2", drawer ? "mt-3 text-left" : "text-center sm:text-left", className)} {...props} />
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  const drawer = React.useContext(AlertDrawerContext)
  return <div className={cn("flex flex-col-reverse", drawer ? "mt-4 gap-2.5 [&>button]:w-full" : "gap-2 sm:flex-row sm:justify-end", className)} {...props} />
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  const drawer = React.useContext(AlertDrawerContext)
  return drawer ? (
    <DrawerTitle data-slot="alert-dialog-title" className={className} {...props} />
  ) : (
    <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className={cn("text-lg font-semibold", className)} {...props} />
  )
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  const drawer = React.useContext(AlertDrawerContext)
  return drawer ? (
    <DrawerDescription data-slot="alert-dialog-description" className={className} {...props} />
  ) : (
    <AlertDialogPrimitive.Description data-slot="alert-dialog-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
}

function AlertDialogAction({ className, onClick, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  const drawer = React.useContext(AlertDrawerContext)
  return drawer ? (
    <Button
      type="button"
      className={cn("min-h-11 sm:min-h-9", className)}
      {...props}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) drawer.close()
      }}
    />
  ) : (
    <AlertDialogPrimitive.Action asChild><Button className={className} onClick={onClick} {...props} /></AlertDialogPrimitive.Action>
  )
}

function AlertDialogCancel({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  const drawer = React.useContext(AlertDrawerContext)
  return drawer ? (
    <DrawerClose asChild><Button data-alert-dialog-cancel="" variant="outline" className={cn("min-h-11 sm:min-h-9", className)} {...props} /></DrawerClose>
  ) : (
    <AlertDialogPrimitive.Cancel asChild><Button variant="outline" className={className} {...props} /></AlertDialogPrimitive.Cancel>
  )
}

export { AlertDialog, AlertDialogTrigger, AlertDialogPortal, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel }
