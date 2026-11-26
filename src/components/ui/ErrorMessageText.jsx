
import ErrorDetails from '@/components/ui/ErrorDetails.jsx';
import ErrorSupportCode from '@/components/ui/ErrorSupportCode.jsx';
import { describeError, resolveDisplayErrorMessage } from '@/lib/error-support.js';
import { cn } from '@/lib/utils.js';

/**
 * A failed action's message, its saved support code, and, with `showDetails`, "פירוט השגיאה" and
 * "העתקה לשליחה לתמיכה" (docs/project-rules/20, "Showing an error"). Pass the caught error object,
 * not a string, so its status and codes reach the details; `fallback` and `action` give the wording
 * for this screen.
 */
export default function ErrorMessageText({
  error = null,
  fallback = '',
  action = '',
  showDetails = false,
  className = '',
  supportClassName = '',
  children = null,
  as = 'p',
  ...props
}) {
  const MessageComponent = as;
  const details = showDetails && error && typeof error === 'object' ? describeError(error, { fallback, action }) : null;
  const message = children || (details ? details.message : resolveDisplayErrorMessage(error, fallback));

  return (
    <>
      {message ? (
        <MessageComponent className={cn(className)} {...props}>
          {message}
        </MessageComponent>
      ) : null}
      <ErrorSupportCode error={error || children} className={supportClassName} />
      {details ? <ErrorDetails details={details} message={typeof message === 'string' ? message : ''} /> : null}
    </>
  );
}
