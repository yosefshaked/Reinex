import React from 'react';
import FormField from './FormField';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export default function PhoneField({
  id,
  name,
  label,
  value,
  onChange,
  onBlur,
  placeholder = 'הזינו מספר טלפון',
  required = false,
  disabled = false,
  description = 'פורמט: 05X-XXXXXXX או 972-5X-XXXXXXX',
  error = '',
  className,
}) {
  return (
    <FormField id={id} label={label} required={required} description={description} error={error}>
      <Input
        id={id}
        name={name}
        type="tel"
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        dir="ltr"
        className={cn('text-left placeholder:text-right', className)}
      />
    </FormField>
  );
}
