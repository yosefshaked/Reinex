import { cn } from "@/lib/utils"

/**
 * @param {any} props
 */
function Skeleton({
  className,
  ...props
}) {
  return (<div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />);
}

export { Skeleton }
