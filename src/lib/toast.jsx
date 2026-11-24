import { toast as baseToast } from 'sonner';
import ErrorDetails from '@/components/ui/ErrorDetails.jsx';
import { describeError, extractSupportCode, stripSupportCode } from '@/lib/error-support.js';

function copySupportCode(code) {
  if (!code) return;
  navigator.clipboard?.writeText?.(code).catch(() => {});
}

function describeSupportCode(description, supportCode) {
  const codeNode = (
    <span className="mt-1 block text-xs font-medium" dir="ltr">
      {supportCode}
    </span>
  );

  if (!description) {
    return (
      <span dir="rtl">
        קוד תמיכה
        {codeNode}
      </span>
    );
  }

  return (
    <span dir="rtl">
      {description}
      {codeNode}
    </span>
  );
}

function withSupportAction(message, data) {
  const supportCode = extractSupportCode(message);
  if (!supportCode) {
    return [message, data];
  }

  const cleanedMessage = stripSupportCode(message) || 'הפעולה נכשלה.';
  const nextData = { ...(data || {}) };
  nextData.description = describeSupportCode(nextData.description, supportCode);
  if (!nextData.action) {
    nextData.action = {
      label: 'העתק קוד',
      onClick: () => copySupportCode(supportCode),
    };
  }
  return [cleanedMessage, nextData];
}

export const toast = Object.assign(
  (message, data) => baseToast(message, data),
  baseToast,
  {
    error(message, data) {
      const [nextMessage, nextData] = withSupportAction(message, data);
      return baseToast.error(nextMessage, nextData);
    },
    /**
     * An error toast built from the caught error itself, so its status and codes reach the UI
     * (docs/project-rules/20, "Showing an error"). It shows the Hebrew message, the saved support
     * code when there is one, "פירוט השגיאה" and "העתקה לשליחה לתמיכה". It stays open until the
     * user closes it, so it cannot vanish while the details are read or copied.
     */
    apiError(error, { action = '', fallback = '', ...data } = {}) {
      const details = describeError(error, { action, fallback });
      return baseToast.error(details.message, {
        duration: Infinity,
        closeButton: true,
        ...data,
        description: (
          <span dir="rtl" className="block">
            {details.supportCode ? (
              <span className="block text-xs font-medium">
                קוד תמיכה: <span dir="ltr">{details.supportCode}</span>
              </span>
            ) : null}
            <ErrorDetails details={details} className="mt-1" />
          </span>
        ),
      });
    },
  },
);
