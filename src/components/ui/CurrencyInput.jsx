import React from 'react';
import { Input } from '@/components/ui/input';
import { formatCurrency, toAgorot } from '@/lib/currency.js';

const MAX_AGOROT_DEFAULT = 10_000_000; // ₪100,000

/**
 * A monetary input that stores and emits shekel strings (e.g. "120").
 *
 * The parent is responsible for calling toAgorot(value) before sending to the API —
 * this component intentionally does NOT do the conversion itself so the parent
 * keeps explicit control over what gets submitted.
 *
 * @param {{ value: string, onChange: (v: string) => void, disabled?: boolean,
 *           max?: number, id?: string, className?: string }} props
 */
export default function CurrencyInput({
  value = '',
  onChange,
  disabled = false,
  max = MAX_AGOROT_DEFAULT,
  id,
  className = '',
}) {
  const hasValue = value !== '' && value !== undefined && value !== null;
  const agorot = toAgorot(value);
  const tooLow = hasValue && agorot <= 0;
  const tooHigh = hasValue && agorot > max;
  const isError = tooLow || tooHigh;
  const isValid = hasValue && !isError;

  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          id={id}
          type="number"
          min="0.01"
          step="0.01"
          dir="ltr"
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          disabled={disabled}
          className={[
            'pe-8 text-end',
            isError ? 'border-destructive focus-visible:ring-destructive' : '',
            className,
          ].filter(Boolean).join(' ')}
        />
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 select-none text-sm text-muted-foreground">
          ₪
        </span>
      </div>
      {isValid ? (
        <p className="text-xs text-muted-foreground">{formatCurrency(agorot)}</p>
      ) : null}
      {tooLow ? (
        <p className="text-xs text-destructive">הסכום חייב להיות גדול מאפס</p>
      ) : null}
      {tooHigh ? (
        <p className="text-xs text-destructive">
          הסכום חורג מהמקסימום המותר (₪{(max / 100).toLocaleString('he-IL', { maximumFractionDigits: 0 })})
        </p>
      ) : null}
    </div>
  );
}
