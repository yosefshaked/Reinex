import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils.js';

/**
 * Visual-only rendering of a single question field, mirroring NewSessionForm styles.
 * All controls are disabled; no state or handlers.
 */
export default function QuestionFieldPreview({
  type = 'text',
  label = 'שאלת דוגמה',
  required = false,
  placeholder = '',
  options = [
    { value: 'opt_1', label: 'אופציה 1' },
    { value: 'opt_2', label: 'אופציה 2' },
    { value: 'opt_3', label: 'אופציה 3' },
  ],
  range = { min: 1, max: 5, step: 1 },
}) {
  const id = 'preview-field';

  if (type === 'textarea') {
    return (
      <div className="space-y-xs" dir="rtl">
        <Label htmlFor={id} className="block text-right">
          {label}
          {required ? ' *' : ''}
        </Label>
        <Textarea id={id} rows={4} placeholder={placeholder} disabled className="bg-white" />
      </div>
    );
  }

  if (type === 'text') {
    return (
      <div className="space-y-xs" dir="rtl">
        <Label htmlFor={id} className="block text-right">
          {label}
          {required ? ' *' : ''}
        </Label>
        <Input id={id} placeholder={placeholder} disabled />
      </div>
    );
  }

  if (type === 'number') {
    return (
      <div className="space-y-xs" dir="rtl">
        <Label htmlFor={id} className="block text-right">
          {label}
          {required ? ' *' : ''}
        </Label>
        <Input id={id} type="number" disabled />
      </div>
    );
  }

  if (type === 'date') {
    return (
      <div className="space-y-xs" dir="rtl">
        <Label htmlFor={id} className="block text-right">
          {label}
          {required ? ' *' : ''}
        </Label>
        <Input id={id} type="date" disabled />
      </div>
    );
  }

  if (type === 'select') {
    return (
      <div className="space-y-xs" dir="rtl">
        <Label className="block text-right">
          {label}
          {required ? ' *' : ''}
        </Label>
        <select
          className="w-full rounded-lg border border-border bg-white p-sm text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          disabled
          defaultValue=""
        >
          <option value="" disabled>
            בחרו אפשרות
          </option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (type === 'radio' || type === 'buttons') {
    const isButtonStyle = type === 'buttons';
    const selected = options[1]?.value; // show a selected sample
    return (
      <div className="space-y-xs" dir="rtl">
        <Label className="block text-right">
          {label}
          {required ? ' *' : ''}
        </Label>
        <div
          className={cn('gap-2', isButtonStyle ? 'flex flex-wrap' : 'space-y-2')}
          role="radiogroup"
          aria-required={required}
        >
          {options.map((option) => {
            const checked = option.value === selected;
            const labelClass = cn(
              'flex items-center gap-xs text-sm transition-all',
              isButtonStyle
                ? cn(
                    'cursor-not-allowed rounded-lg border-2 px-md py-sm font-medium shadow-sm',
                    checked
                      ? 'border-primary bg-primary text-white shadow-md'
                      : 'border-neutral-300 bg-white text-foreground'
                  )
                : cn(
                    'cursor-not-allowed rounded-lg border px-sm py-xs',
                    checked
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-white text-foreground'
                  )
            );
            return (
              <label key={option.value} className={labelClass} aria-disabled="true">
                <input
                  type="radio"
                  name="preview-radio"
                  value={option.value}
                  defaultChecked={checked}
                  disabled
                  className={cn('h-4 w-4', isButtonStyle && 'sr-only')}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  if (type === 'scale') {
    const min = typeof range?.min === 'number' ? range.min : 0;
    const max = typeof range?.max === 'number' ? range.max : 5;
    const step = typeof range?.step === 'number' && range.step > 0 ? range.step : 1;
    const sliderValue = Math.round((min + max) / 2);
    return (
      <div className="space-y-2" dir="rtl">
        <Label className="block text-right">
          {label}
          {required ? ' *' : ''}
        </Label>
        <div className="flex items-center gap-sm">
          <span className="text-xs text-neutral-500">{min}</span>
          <input type="range" min={min} max={max} step={step} defaultValue={sliderValue} disabled className="flex-1" />
          <span className="text-xs text-neutral-500">{max}</span>
        </div>
        <div className="text-xs text-neutral-600">ערך שנבחר: {sliderValue}</div>
      </div>
    );
  }

  // Fallback: text
  return (
    <div className="space-y-xs" dir="rtl">
      <Label className="block text-right">
        {label}
        {required ? ' *' : ''}
      </Label>
      <Input disabled />
    </div>
  );
}
