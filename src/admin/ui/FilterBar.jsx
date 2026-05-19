import React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function FilterBar({
  query = '',
  onQueryChange,
  placeholder = 'Search...',
  onSubmit = null,
  onClear = null,
  chips = null,
  trailing = null,
  children,
  className,
}) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.(query);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2',
        className,
      )}
    >
      <div className="relative flex-1 min-w-[220px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={query}
          onChange={(e) => onQueryChange?.(e.target.value)}
          placeholder={placeholder}
          className="pl-9 pr-8 h-9"
        />
        {query && onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {chips ? <div className="flex items-center gap-1.5">{chips}</div> : null}
      {children}
      <div className="ml-auto flex items-center gap-2">
        {trailing}
        {onSubmit ? (
          <Button type="submit" size="sm" variant="secondary">
            Apply
          </Button>
        ) : null}
      </div>
    </form>
  );
}
