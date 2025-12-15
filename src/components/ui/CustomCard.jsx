import { forwardRef } from "react"

import { cn } from "@/lib/utils"

const Card = forwardRef(function Card({ className, children, ...props }, ref) {
  return (
    <section
      ref={ref}
      className={cn("rounded-lg border border-border bg-surface p-lg shadow-card", className)}
      {...props}
    >
      {children}
    </section>
  )
})

export default Card
