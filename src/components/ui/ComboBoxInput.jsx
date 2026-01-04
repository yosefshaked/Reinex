import React from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown } from 'lucide-react';

/**
 * ComboBoxInput - Input with dropdown suggestions (allows free text + selection from list)
 * Similar to TimePickerInput but generic for any string list
 * 
 * @param {string} id - Input element id
 * @param {string} name - Input name attribute
 * @param {string} value - Current value
 * @param {function} onChange - Callback when value changes (receives string)
 * @param {Array<string>} options - List of suggestion strings
 * @param {boolean} disabled - Whether input is disabled
 * @param {boolean} required - Whether input is required
 * @param {string} placeholder - Placeholder text
 * @param {string} className - Additional CSS classes
 * @param {string} dir - Text direction ('ltr' or 'rtl')
 * @param {string} emptyMessage - Message when no results found
 */
export default function ComboBoxInput({
  id,
  name,
  value = '',
  onChange,
  options = [],
  disabled = false,
  required = false,
  placeholder = 'בחר מהרשימה או הקלד',
  className = '',
  dir = 'rtl',
  emptyMessage = 'לא נמצאו תוצאות'
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState(value);
  const lastCommittedRef = React.useRef(value);

  const normalizedOptions = React.useMemo(() => {
    const normalize = (opt) => {
      if (opt === null || opt === undefined) return '';
      if (typeof opt === 'string') return opt;
      if (typeof opt === 'number' || typeof opt === 'boolean') return String(opt);
      if (typeof opt === 'object') {
        const candidate = opt.label ?? opt.name ?? opt.value;
        if (candidate === null || candidate === undefined) return '';
        return String(candidate);
      }
      return '';
    };

    const list = Array.isArray(options) ? options : [];
    const normalized = list
      .map(normalize)
      .map((s) => String(s || '').trim())
      .filter(Boolean);

    // Keep order, drop duplicates
    const seen = new Set();
    return normalized.filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  }, [options]);

  // Sync displayed text when value changes from outside
  React.useEffect(() => {
    setQuery(value);
    lastCommittedRef.current = value;
  }, [value]);

  // Commit when popover closes and query differs from last committed value
  React.useEffect(() => {
    if (!open && query !== lastCommittedRef.current) {
      const trimmed = String(query || '').trim();
      onChange?.(trimmed);
      lastCommittedRef.current = trimmed;
      setQuery(trimmed);
    }
  }, [open, query, onChange]);

  const filtered = React.useMemo(() => {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return normalizedOptions;
    return normalizedOptions.filter((opt) => opt.toLowerCase().includes(q));
  }, [query, normalizedOptions]);

  const commit = (newValue) => {
    const trimmed = String(newValue || '').trim();
    onChange?.(trimmed);
    lastCommittedRef.current = trimmed;
    setQuery(trimmed);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(query);
    }
    if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <Input
          id={id}
          name={name}
          dir={dir}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Open suggestions while typing without stealing focus (PopoverContent prevents auto-focus)
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          required={required}
          className={className}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${id || name}-list` : undefined}
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="פתח רשימת אפשרויות"
            className="absolute inset-y-0 left-2 flex items-center text-muted-foreground hover:text-foreground pointer-events-auto"
            tabIndex={-1}
            disabled={disabled}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        className="p-0 w-[min(260px,80vw)] max-h-[60vh] overflow-auto"
        align="end"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <ul id={`${id || name}-list`} role="listbox" className="py-1" dir={dir}>
          {filtered.map((option, index) => (
            <li
              key={`${option}::${index}`}
              role="option"
              aria-selected={value === option}
              className="cursor-pointer select-none px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
              onMouseDown={(e) => {
                // Prevent Input blur before we handle selection
                e.preventDefault();
              }}
              onClick={() => {
                commit(option);
              }}
            >
              {option}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
