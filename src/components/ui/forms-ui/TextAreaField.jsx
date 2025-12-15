import React from 'react';
import FormField from './FormField';
import { Textarea } from '@/components/ui/textarea';

export default function TextAreaField({
  id,
  name,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  required = false,
  disabled = false,
  description = '',
  error = '',
  className,
  dir = 'rtl',
  rows = 3,
}) {
  return (
    <FormField id={id} label={label} required={required} description={description} error={error}>
      <Textarea
        id={id}
        name={name}
        dir={dir}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={className}
        rows={rows}
      />
    </FormField>
  );
}
