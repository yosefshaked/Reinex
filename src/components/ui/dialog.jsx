import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef(({ className, children, footer, wide = false, hideDefaultClose = false, autoFocus = false, ...props }, ref) => {
  const defaultDescId = React.useId()
  const internalRef = React.useRef(null)
  const setRef = (node) => {
    internalRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }

  const handleOpenAutoFocus = (e) => {
    if (autoFocus) return
    // Prevent focusing the first focusable (which could pop the keyboard on mobile),
    // but move focus to the dialog container itself to avoid aria-hidden focus warnings.
    e.preventDefault()
    requestAnimationFrame(() => {
      try {
        internalRef.current?.focus({ preventScroll: true })
      } catch {
        // Silently ignore focus errors
      }
    })
  }

  const handleCloseAutoFocus = (e) => {
    if (autoFocus) return
    e.preventDefault()
  }

  // Allow consumers to pass their own aria-describedby; fall back to a hidden empty description to satisfy a11y checkers.
  const describedBy = props["aria-describedby"] ?? defaultDescId

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setRef}
        tabIndex={-1}
        aria-describedby={describedBy}
        className={cn(
          "fixed left-[50%] z-50 flex flex-col w-[calc(100%-1rem)] border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=open]:slide-in-from-left-1/2 sm:w-full sm:rounded-lg",
          // Mobile: position from top with spacing, calculate max-height to leave room for bottom nav + browser UI
          "top-[2rem] translate-x-[-50%] max-h-[calc(100vh-12rem)]",
          // Desktop: center vertically with 90vh max-height
          "sm:top-[50%] sm:translate-y-[-50%] sm:max-h-[90vh]",
          wide ? "max-w-none" : "max-w-lg",
          className
        )}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        {...props}>
        {/* Hidden empty description node as a safe default */}
        <span id={defaultDescId} className="sr-only" aria-hidden="true"></span>
        <div className="flex-1 overflow-y-auto dialog-scroll-content p-4 sm:p-6">
          {children}
        </div>
        {footer && (
          <div className="border-t bg-background p-3 sm:p-4 sm:rounded-b-lg">
            {footer}
          </div>
        )}
        {!hideDefaultClose && (
          <DialogPrimitive.Close
            className="absolute left-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">סגור</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-right mb-6", className)}
    {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row-reverse sm:justify-start gap-2", className)}
    {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
