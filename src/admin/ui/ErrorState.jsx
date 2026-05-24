import React from 'react';
import { AlertOctagon, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ErrorSupportCode from '@/components/ui/ErrorSupportCode.jsx';
import { resolveDisplayErrorMessage } from '@/lib/error-support.js';
import { cn } from '@/lib/utils';

export default function ErrorState({
  title = 'Something went wrong',
  description = null,
  error = null,
  onRetry = null,
  retryLabel = 'Retry',
  className,
}) {
  const message = resolveDisplayErrorMessage(
    description ||
      (error instanceof Error ? error.message : typeof error === 'string' ? error : null),
    'An unexpected error occurred while loading this view.',
  );
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50/50 p-10 text-center',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-rose-500 shadow-sm ring-1 ring-rose-200">
        <AlertOctagon className="h-6 w-6" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-rose-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-rose-800/80">{message}</p>
      <ErrorSupportCode error={description || error} className="mx-auto text-rose-800" />
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-4">
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
