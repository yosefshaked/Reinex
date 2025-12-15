import { forwardRef, useId } from "react"

import { cn } from "@/lib/utils"

const Input = forwardRef(function Input(
  { id, name, label, helperText, error, className, inputClassName, ...props },
  ref,
) {
  const generatedId = useId()
  const controlId = id ?? name ?? generatedId

  return (
    <div className={cn("flex flex-col gap-xs", className)}>
      {label ? (
        <label htmlFor={controlId} className="text-body-sm font-semibold text-neutral-700">
          {label}
        </label>
      ) : null}
      <input
        id={controlId}
        name={name}
        ref={ref}
        className={cn(
          "w-full rounded-xl border border-border bg-surface px-md py-sm text-body-md text-neutral-900 placeholder:text-neutral-400 transition-colors focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-neutral-100",
          error && "border-error-500 focus:border-error focus:ring-error-100",
          inputClassName,
        )}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error ? (
        <p className="text-body-sm text-error-600">{error}</p>
      ) : helperText ? (
        <p className="text-body-sm text-neutral-500">{helperText}</p>
      ) : null}
    </div>
  )
})

export default Input
