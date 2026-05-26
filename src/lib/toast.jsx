import { toast as baseToast } from 'sonner';
import { extractSupportCode, stripSupportCode } from '@/lib/error-support.js';

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
  },
);
