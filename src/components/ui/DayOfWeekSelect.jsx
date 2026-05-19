import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DAY_OPTIONS, normalizeDayToken } from '@/lib/day-of-week.js';

export default function DayOfWeekSelect({
  id,
  value,
  onChange,
  disabled,
  required,
  placeholder = 'בחר יום',
  includeAllOption = true,
}) {
  const handleValueChange = (newValue) => {
    if (includeAllOption && newValue === 'all') {
      onChange?.(null);
      return;
    }
    onChange?.(newValue || null);
  };

  const normalizedValue = normalizeDayToken(value);
  const hasSelection = normalizedValue !== null;
  const selectValue = hasSelection ? normalizedValue : includeAllOption ? 'all' : '';

  return (
    <Select
      id={id}
      value={selectValue}
      onValueChange={handleValueChange}
      disabled={disabled}
      required={required}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {includeAllOption && <SelectItem value="all">כל הימים</SelectItem>}
        {DAY_OPTIONS.map((day) => (
          <SelectItem key={day.value} value={day.value}>
            {day.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
