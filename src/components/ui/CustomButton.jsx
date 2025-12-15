import { forwardRef } from "react"

import { cn } from "@/lib/utils"

const variantClasses = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-500 focus-visible:ring-primary-200",
  secondary: "bg-surface text-primary-600 border border-primary-100 hover:bg-primary-50 focus-visible:ring-primary-100",
  destructive: "bg-error text-error-foreground shadow-sm hover:bg-error-600 focus-visible:ring-error-200",
}

const Button = forwardRef(function Button(
  { className, variant = "primary", type = "button", disabled = false, children, ...props },
  ref,
) {
  const resolvedVariant = variantClasses[variant] ?? variantClasses.primary

  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex min-h-[3rem] items-center justify-center gap-xs rounded-xl px-lg py-sm text-body-md font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60",
        resolvedVariant,
        className,
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
})

export default Button
