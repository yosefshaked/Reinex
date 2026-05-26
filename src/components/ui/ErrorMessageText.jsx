import ErrorSupportCode from '@/components/ui/ErrorSupportCode.jsx';
import { resolveDisplayErrorMessage } from '@/lib/error-support.js';
import { cn } from '@/lib/utils.js';

export default function ErrorMessageText({
  error,
  fallback = '',
  className,
  supportClassName,
  children,
  as = 'p',
  ...props
}) {
  const MessageComponent = as;
  const message = children || resolveDisplayErrorMessage(error, fallback);

  return (
    <>
      {message ? (
        <MessageComponent className={cn(className)} {...props}>
          {message}
        </MessageComponent>
      ) : null}
      <ErrorSupportCode error={error || children} className={supportClassName} />
    </>
  );
}
