import React from 'react';
import FormField from './FormField';
import DayOfWeekSelect from '@/components/ui/DayOfWeekSelect';

export default function DayOfWeekField({
  id,
  label,
  value,
  onChange,
  placeholder = 'בחר יום',
  required = false,
  disabled = false,
  description = '',
  error = '',
}) {
  return (
    <FormField id={id} label={label} required={required} description={description} error={error}>
      <DayOfWeekSelect
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        includeAllOption={false}
      />
    </FormField>
  );
}
