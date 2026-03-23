import { cn } from "@/lib/utils"

function PageLayout({
  title,
  description,
  actions,
  children,
  className,
  headerClassName,
  contentClassName,
  fullHeight = true,
  variant = "default",
  ...props
}) {
  const isWorkspace = variant === "workspace";

  return (
    <div className={cn(fullHeight ? "min-h-screen h-screen flex flex-col overflow-hidden" : "min-h-full", "bg-background text-neutral-900 w-full")}>
      <div
        className={cn(
          "mx-auto flex w-full flex-col h-full",
          !isWorkspace && "max-w-5xl px-sm py-md sm:px-md sm:py-lg lg:px-xl overflow-y-auto",
          isWorkspace && "flex-1 overflow-hidden",
          className
        )}
        style={!isWorkspace ? { maxWidth: "min(1680px, calc(100vw - 1.5rem))" } : undefined}
        {...props}
      >
        {(title || description || actions) && (
          <header
            className={cn(
              "flex flex-col gap-sm sm:flex-row sm:items-end sm:justify-between flex-shrink-0",
              !isWorkspace && "pb-sm sm:pb-md",
              isWorkspace && "px-6 py-4 border-b border-border bg-white z-10",
              headerClassName
            )}
          >
            <div className="space-y-xs">
              {title && <h1 className="text-xl font-semibold text-neutral-900 sm:text-title-lg">{title}</h1>}
              {description && <p className="max-w-2xl text-sm text-neutral-600 sm:text-body-md">{description}</p>}
            </div>
            {actions && <div className="mt-sm sm:mt-0 sm:flex-shrink-0">{actions}</div>}
          </header>
        )}
        <main className={cn(
          "flex-1",
          !isWorkspace && "space-y-lg",
          isWorkspace && "flex overflow-hidden h-full",
          contentClassName
        )}>
          {children}
        </main>
      </div>
    </div>
  )
}

export default PageLayout
