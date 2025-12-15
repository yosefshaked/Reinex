import React from 'react';
import FormField from './FormField';
import ComboBoxInput from '@/components/ui/ComboBoxInput';

export default function ComboBoxField({
  id,
  name,
  label,
  value,
  onChange,
  options = [],
  placeholder,
  required = false,
  disabled = false,
  description = '',
  error = '',
  dir = 'rtl',
  emptyMessage = 'לא נמצאו תוצאות',
  className,
}) {
  return (
    <FormField id={id} label={label} required={required} description={description} error={error}>
      <ComboBoxInput
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        dir={dir}
        emptyMessage={emptyMessage}
        className={className}
      />
    </FormField>
  );
}
