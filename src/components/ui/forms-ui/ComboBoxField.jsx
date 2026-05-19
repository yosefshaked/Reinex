import React from 'react';
import FormField from './FormField';
import ComboBoxInput from '@/components/ui/ComboBoxInput';

export default function ComboBoxField({
  id,
  name,
  label,
  value,
  onChange,
  onOptionSelect,
  options = [],
  placeholder,
  required = false,
  disabled = false,
  description = '',
  error = '',
  dir = 'rtl',
  emptyMessage = 'לא נמצאו תוצאות',
  emptyText,
  allowCustomValue = true,
  className,
}) {
  const resolvedEmptyMessage = emptyText || emptyMessage;

  return (
    <FormField id={id} label={label} required={required} description={description} error={error}>
      <ComboBoxInput
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        onOptionSelect={onOptionSelect}
        options={options}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        dir={dir}
        emptyMessage={resolvedEmptyMessage}
        allowCustomValue={allowCustomValue}
        className={className}
      />
    </FormField>
  );
}
