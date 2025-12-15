import React from 'react';
import { cn } from '@/lib/utils';

export default function Logo({ className = '', showText = true }) {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow ring-1 ring-slate-100">
        <img
          src="/icon.svg"
          alt="TutTiud"
          className="h-8 w-8 object-contain"
        />
      </span>
      {showText ? (
        <span className="text-2xl font-bold text-slate-900">TutTiud</span>
      ) : null}
    </span>
  );
}
