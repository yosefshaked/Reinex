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
 * @param {function} onChange - Callback when value changes (receives display string)
 * @param {function} onOptionSelect - Callback when an option is selected (receives normalized option object)
 * @param {Array<string|object>} options - List of suggestion strings or { label, value, searchText }
 * @param {boolean} disabled - Whether input is disabled
 * @param {boolean} required - Whether input is required
 * @param {string} placeholder - Placeholder text
 * @param {string} className - Additional CSS classes
 * @param {string} dir - Text direction ('ltr' or 'rtl')
 * @param {string} emptyMessage - Message when no results found
 * @param {boolean} allowCustomValue - Whether free text is allowed when closing/committing
 */
export default function ComboBoxInput({
  id,
  name,
  value = '',
  onChange,
  onOptionSelect,
  options = [],
  disabled = false,
  required = false,
  placeholder = 'בחר מהרשימה או הקלד',
  className = '',
  dir = 'rtl',
  emptyMessage = 'לא נמצאו תוצאות',
  allowCustomValue = true,
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
        return {
          label: String(candidate),
          value: String(opt.value ?? candidate),
          searchText: String(opt.searchText ?? candidate),
          raw: opt,
        };
      }
      return '';
    };

    const list = Array.isArray(options) ? options : [];
    const normalized = list
      .map((item) => {
        const candidate = normalize(item);

        if (!candidate) return null;
        if (typeof candidate === 'string') {
          const trimmed = candidate.trim();
          if (!trimmed) return null;
          return {
            label: trimmed,
            value: trimmed,
            searchText: trimmed,
            raw: item,
          };
        }

        const label = String(candidate.label || '').trim();
        const optionValue = String(candidate.value || '').trim();
        if (!label || !optionValue) return null;

        return {
          label,
          value: optionValue,
          searchText: String(candidate.searchText || label).toLowerCase(),
          raw: candidate.raw,
        };
      })
      .filter(Boolean);

    // Keep order, drop duplicates
    const seen = new Set();
    return normalized.filter((item) => {
      const key = `${item.value}::${item.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [options]);

  // Sync displayed text when value changes from outside
  React.useEffect(() => {
    setQuery(value);
    lastCommittedRef.current = value;
  }, [value]);

  const filtered = React.useMemo(() => {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return normalizedOptions;
    return normalizedOptions.filter((opt) => {
      const searchText = String(opt.searchText || '').toLowerCase();
      return opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q) || searchText.includes(q);
    });
  }, [query, normalizedOptions]);

  const commitOption = React.useCallback((option) => {
    const optionLabel = String(option?.label || '').trim();
    if (!optionLabel) {
      onChange?.('');
      onOptionSelect?.(null);
      lastCommittedRef.current = '';
      setQuery('');
      setOpen(false);
      return;
    }

    onChange?.(optionLabel);
    onOptionSelect?.(option);
    lastCommittedRef.current = optionLabel;
    setQuery(optionLabel);
    setOpen(false);
  }, [onChange, onOptionSelect]);

  const commit = React.useCallback((newValue) => {
    const trimmed = String(newValue || '').trim();
    const lowerTrimmed = trimmed.toLowerCase();

    const exactMatch = normalizedOptions.find((opt) =>
      opt.label.toLowerCase() === lowerTrimmed || opt.value.toLowerCase() === lowerTrimmed,
    );

    if (exactMatch) {
      commitOption(exactMatch);
      return;
    }

    if (!allowCustomValue) {
      onChange?.('');
      onOptionSelect?.(null);
      lastCommittedRef.current = '';
      setQuery('');
      setOpen(false);
      return;
    }

    onChange?.(trimmed);
    onOptionSelect?.(null);
    lastCommittedRef.current = trimmed;
    setQuery(trimmed);
    setOpen(false);
  }, [allowCustomValue, commitOption, normalizedOptions, onChange, onOptionSelect]);

  // Commit when popover closes and query differs from last committed value
  React.useEffect(() => {
    if (!open && query !== lastCommittedRef.current) {
      commit(query);
    }
  }, [open, query, commit]);

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
            className="absolute inset-y-0 start-2 flex items-center text-muted-foreground hover:text-foreground pointer-events-auto"
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
              key={`${option.value}::${index}`}
              role="option"
              aria-selected={value === option.label}
              className="cursor-pointer select-none px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
              onMouseDown={(e) => {
                // Prevent Input blur before we handle selection
                e.preventDefault();
              }}
              onClick={() => {
                commitOption(option);
              }}
            >
              {option.label}
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
