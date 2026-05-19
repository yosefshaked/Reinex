import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const WIDTH_CLASS = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-3xl',
  full: 'sm:max-w-[90vw]',
};

/**
 * Admin detail drawer — slides in from the right with header, scrollable body,
 * and optional sticky footer. Used for org/user/audit detail panels.
 */
export default function Drawer({
  open,
  onOpenChange,
  title,
  description = null,
  badge = null,
  footer = null,
  width = 'md',
  side = 'right',
  children,
  className,
}) {
  const widthClass = WIDTH_CLASS[width] || WIDTH_CLASS.md;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className={cn(
          'flex h-full w-full flex-col gap-0 p-0',
          widthClass,
          className,
        )}
      >
        <SheetHeader className="border-b border-slate-200 px-5 py-4 text-left">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0 space-y-1">
              <SheetTitle className="truncate text-base font-semibold text-slate-900">
                {title}
              </SheetTitle>
              {description ? (
                <SheetDescription className="text-xs text-slate-500">
                  {description}
                </SheetDescription>
              ) : null}
            </div>
            {badge ? <div className="shrink-0">{badge}</div> : null}
          </div>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm text-slate-700">
          {children}
        </div>
        {footer ? (
          <SheetFooter className="border-t border-slate-200 bg-slate-50 px-5 py-3">
            {footer}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
