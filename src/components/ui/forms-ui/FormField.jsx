import React from 'react';
import { Label } from '@/components/ui/label';

export default function FormField({
  id,
  label,
  required = false,
  description = '',
  error = '',
  children,
}) {
  const descriptionId = description ? `${id || 'field'}-desc` : undefined;
  const errorId = error ? `${id || 'field'}-err` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  let field = children;
  if (React.isValidElement(children)) {
    field = React.cloneElement(children, {
      'aria-describedby': [children.props?.['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
      'aria-invalid': error ? true : undefined,
      'aria-required': required ? true : undefined,
      id: children.props?.id || id,
    });
  }

  return (
    <div className="space-y-2" dir="rtl">
      {label ? (
        <Label htmlFor={id} className="block text-right">
          {label}
          {required ? ' *' : ''}
        </Label>
      ) : null}
      {field}
      {description ? (
        <p id={descriptionId} className="text-xs text-neutral-500 text-right">{description}</p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-red-600 text-right" role="alert" aria-live="polite">{error}</p>
      ) : null}
    </div>
  );
}
