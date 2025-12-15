import React from 'react';
import FormField from './FormField';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function SelectField({
  id,
  label,
  value,
  onChange,
  onOpenChange, // Mobile fix: track Select open/close state
  options = [],
  placeholder = 'בחר אפשרות',
  required = false,
  disabled = false,
  description = '',
  error = '',
  className,
}) {
  return (
    <FormField id={id} label={label} required={required} description={description} error={error}>
      <Select
        value={value}
        onValueChange={onChange}
        onOpenChange={onOpenChange}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger id={id} className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}
