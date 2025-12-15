import React from 'react';
import FormField from './FormField';
import { Input } from '@/components/ui/input';

export default function TextField({
  id,
  name,
  label,
  value,
  onChange,
  onBlur,
  type = 'text',
  placeholder,
  required = false,
  disabled = false,
  description = '',
  error = '',
  className,
  dir = 'rtl',
  inputMode,
  list,
}) {
  return (
    <FormField id={id} label={label} required={required} description={description} error={error}>
      <Input
        id={id}
        name={name}
        type={type}
        dir={dir}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={className}
        inputMode={inputMode}
        list={list}
      />
    </FormField>
  );
}
