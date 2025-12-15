import React from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

function generateTimeOptions() {
  const times = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const hourStr = String(hour).padStart(2, '0');
      const minuteStr = String(minute).padStart(2, '0');
      const timeValue = `${hourStr}:${minuteStr}:00`;
      const timeLabel = `${hourStr}:${minuteStr}`;
      times.push({ value: timeValue, label: timeLabel });
    }
  }
  return times;
}

const TIME_OPTIONS = generateTimeOptions();

function toLabelFromValue(v) {
  if (!v) return '';
  // incoming value shape is HH:MM:SS — show HH:MM
  return String(v).slice(0, 5);
}

function toValueFromLabel(label) {
  if (!label) return '';
  return `${label}:00`;
}

function normalizeTimeInputToLabel(input) {
  if (!input) return '';
  const s = String(input).trim();
  // If already HH:MM, validate and return
  if (/^\d{1,2}:\d{1,2}$/.test(s)) {
    const [h, m] = s.split(':').map((t) => parseInt(t, 10));
    if (Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      // Snap minutes to nearest 15 (00, 15, 30, 45). Handle overflow.
      let snapped = Math.round(m / 15) * 15;
      let hh = h;
      if (snapped === 60) {
        if (hh === 23) {
          // Cap at the last valid slot for the day
          snapped = 45;
        } else {
          hh += 1;
          snapped = 0;
        }
      }
      return `${String(hh).padStart(2, '0')}:${String(snapped).padStart(2, '0')}`;
    }
    return '';
  }
  // Digits only: H, HH, HMM, HHMM
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 2) {
    const h = Math.min(parseInt(digits, 10), 23);
    if (Number.isNaN(h)) return '';
    // 00 minutes already a valid increment
    return `${String(h).padStart(2, '0')}:00`;
  }
  if (digits.length === 3) {
    const h = Math.min(parseInt(digits.slice(0, 1), 10), 23);
    const m = Math.min(parseInt(digits.slice(1), 10), 59);
    let snapped = Math.round(m / 15) * 15;
    let hh = h;
    if (snapped === 60) {
      if (hh === 23) {
        snapped = 45;
      } else {
        hh += 1;
        snapped = 0;
      }
    }
    return `${String(hh).padStart(2, '0')}:${String(snapped).padStart(2, '0')}`;
  }
  // 4+ digits → take first 2 as hours, next 2 as minutes
  const h = Math.min(parseInt(digits.slice(0, 2), 10), 23);
  const m = Math.min(parseInt(digits.slice(2, 4), 10), 59);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  let snapped = Math.round(m / 15) * 15;
  let hh = h;
  if (snapped === 60) {
    if (hh === 23) {
      snapped = 45;
    } else {
      hh += 1;
      snapped = 0;
    }
  }
  return `${String(hh).padStart(2, '0')}:${String(snapped).padStart(2, '0')}`;
}

export default function TimePickerInput({ id, name, value, onChange, disabled, required, placeholder = 'בחר שעה', className, dir = 'rtl' }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState(toLabelFromValue(value));
  const lastCommittedRef = React.useRef(toLabelFromValue(value));
  const selectedRef = React.useRef(null);
  const hintRef = React.useRef(null);

  // Sync displayed text when value changes from outside
  React.useEffect(() => {
    const lbl = toLabelFromValue(value);
    setQuery(lbl);
    lastCommittedRef.current = lbl;
  }, [value]);

  const displayValue = toLabelFromValue(value);

  // Always show the full list; do not filter while typing. We'll scroll to the selected item instead.
  const options = TIME_OPTIONS;
  const highlightLabel = React.useMemo(() => normalizeTimeInputToLabel(query), [query]);

  const commit = (label) => {
    const lbl = normalizeTimeInputToLabel(label);
    if (!lbl) return; // do nothing on invalid
    const newValue = toValueFromLabel(lbl);
    onChange?.(newValue);
    lastCommittedRef.current = lbl;
    setQuery(lbl);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(query);
    }
  };

  // Commit when popover closes and query differs from last committed
  React.useEffect(() => {
    if (!open && query !== lastCommittedRef.current) {
      const lbl = normalizeTimeInputToLabel(query);
      if (lbl) {
        const newValue = toValueFromLabel(lbl);
        onChange?.(newValue);
        lastCommittedRef.current = lbl;
        setQuery(lbl);
      }
    }
  }, [open, query, onChange]);

  // When the popover opens, scroll the current selection into view
  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        // Prefer scrolling to the selected row; otherwise, scroll to hint
        const target = selectedRef.current || hintRef.current;
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ block: 'center' });
        }
      });
    }
  }, [open, displayValue, highlightLabel]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <Input
          id={id}
          name={name}
          dir={dir}
          inputMode="numeric"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          required={required}
          className={cn(dir === 'rtl' ? 'text-right' : 'text-left', 'placeholder:text-right', className)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${id || name}-time-list` : undefined}
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="פתח רשימת שעות"
            className="absolute inset-y-0 left-2 flex items-center text-muted-foreground hover:text-foreground pointer-events-auto"
            tabIndex={-1}
            disabled={disabled}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        className="p-0 w-[260px] max-h-60 overflow-auto"
        align="end"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <ul id={`${id || name}-time-list`} role="listbox" className="py-1" dir={dir}>
          {options.map((time) => {
            const isSelected = displayValue === time.label;
            const isHint = !isSelected && highlightLabel === time.label;
            return (
              <li
                key={time.value}
                role="option"
                aria-selected={isSelected}
                className={cn(
                  "cursor-pointer select-none px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground",
                  isSelected && "bg-accent text-accent-foreground",
                  isHint && "bg-accent/10"
                )}
                ref={isSelected ? selectedRef : isHint ? hintRef : null}
                onMouseDown={(e) => {
                  // Prevent Input blur before we handle selection
                  e.preventDefault();
                }}
                onClick={() => {
                  setQuery(time.label);
                  commit(time.label);
                }}
              >
                {time.label}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
