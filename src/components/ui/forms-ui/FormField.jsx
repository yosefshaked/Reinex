import React from 'react';
import ErrorMessageText from '@/components/ui/ErrorMessageText.jsx';
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
    <div className="space-y-2">
      {label ? (
        <Label htmlFor={id} className="block text-start">
          {label}
          {required ? ' *' : ''}
        </Label>
      ) : null}
      {field}
      {description ? (
        <p id={descriptionId} className="text-xs text-neutral-500 text-start">{description}</p>
      ) : null}
      {error ? (
        <ErrorMessageText
          id={errorId}
          error={error}
          className="text-sm text-red-600 text-start"
          supportClassName="text-red-600"
          role="alert"
          aria-live="polite"
        />
      ) : null}
    </div>
  );
}
