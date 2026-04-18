import React from 'react';
import { cn } from '@/lib/utils';

const TONE_CLASSES = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
  accent: 'bg-violet-50 text-violet-700 ring-violet-200',
};

const SIZE_CLASSES = {
  sm: 'px-1.5 py-0.5 text-[11px]',
  md: 'px-2 py-0.5 text-xs',
  lg: 'px-2.5 py-1 text-sm',
};

export default function StatusBadge({
  tone = 'neutral',
  size = 'md',
  dot = false,
  icon = null,
  children,
  className,
}) {
  const toneClass = TONE_CLASSES[tone] || TONE_CLASSES.neutral;
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium ring-1 ring-inset',
        toneClass,
        sizeClass,
        className,
      )}
    >
      {dot ? (
        <span className={cn('h-1.5 w-1.5 rounded-full', {
          'bg-slate-500': tone === 'neutral',
          'bg-sky-500': tone === 'info',
          'bg-emerald-500': tone === 'success',
          'bg-amber-500': tone === 'warning',
          'bg-rose-500': tone === 'danger',
          'bg-violet-500': tone === 'accent',
        })} />
      ) : null}
      {icon}
      {children}
    </span>
  );
}
