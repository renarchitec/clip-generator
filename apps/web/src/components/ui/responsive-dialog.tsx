import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

const ResponsiveDialogContext = React.createContext(false)

type ResponsiveDialogProps = React.ComponentProps<typeof Dialog> & { repositionInputs?: boolean }

function ResponsiveDialog({ repositionInputs = true, ...props }: ResponsiveDialogProps) {
  const isMobile = useIsMobile()

  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      {isMobile ? <Drawer repositionInputs={repositionInputs} {...props} /> : <Dialog {...props} />}
    </ResponsiveDialogContext.Provider>
  )
}

function ResponsiveDialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  const isMobile = React.useContext(ResponsiveDialogContext)
  return isMobile ? <DrawerTrigger {...props} /> : <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

type ResponsiveDialogContentProps = React.ComponentProps<typeof DialogContent> & {
  desktopClassName?: string
  mobileClassName?: string
  showHandle?: boolean
}

function ResponsiveDialogContent({ className, desktopClassName, mobileClassName, showHandle, ...props }: ResponsiveDialogContentProps) {
  const isMobile = React.useContext(ResponsiveDialogContext)

  return isMobile ? (
    <DrawerContent className={cn("max-h-[92dvh] flex flex-col overflow-hidden p-0", mobileClassName)} showHandle={showHandle} {...props} />
  ) : (
    <DialogContent className={cn(className, desktopClassName)} {...props} />
  )
}

function ResponsiveDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  const isMobile = React.useContext(ResponsiveDialogContext)
  const classes = cn("sticky top-0 shrink-0", className)

  return isMobile ? (
    <DrawerHeader className={classes} {...props} />
  ) : (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5", classes)} {...props} />
  )
}

function ResponsiveDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  const isMobile = React.useContext(ResponsiveDialogContext)

  return isMobile ? (
    <DrawerFooter className={cn("shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]", className)} {...props} />
  ) : (
    <div data-slot="dialog-footer" className={cn("flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
  )
}

function ResponsiveDialogTitle(props: React.ComponentProps<typeof DialogTitle>) {
  const isMobile = React.useContext(ResponsiveDialogContext)
  return isMobile ? <DrawerTitle {...props} /> : <DialogTitle {...props} />
}

function ResponsiveDialogDescription(props: React.ComponentProps<typeof DialogDescription>) {
  const isMobile = React.useContext(ResponsiveDialogContext)
  return isMobile ? <DrawerDescription {...props} /> : <DialogDescription {...props} />
}

function ResponsiveDialogClose(props: React.ComponentProps<typeof DialogClose>) {
  const isMobile = React.useContext(ResponsiveDialogContext)
  return isMobile ? <DrawerClose {...props} /> : <DialogClose {...props} />
}

export { ResponsiveDialog, ResponsiveDialogTrigger, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogFooter, ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogClose }
