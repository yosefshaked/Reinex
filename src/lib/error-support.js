const SUPPORT_CODE_PATTERN = /\bERR-\d{8}-[A-Z0-9]{6}\b/i;

export function extractSupportCode(errorOrMessage) {
  const direct = errorOrMessage?.error_id || errorOrMessage?.supportCode || errorOrMessage?.support_code;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim().toUpperCase();
  }

  const message = typeof errorOrMessage === 'string'
    ? errorOrMessage
    : typeof errorOrMessage?.message === 'string'
      ? errorOrMessage.message
      : '';
  const match = message.match(SUPPORT_CODE_PATTERN);
  return match ? match[0].toUpperCase() : '';
}

export function stripSupportCode(message) {
  if (typeof message !== 'string' || !message.trim()) {
    return '';
  }
  return message
    .replace(/[\s.]*קוד תמיכה:\s*ERR-\d{8}-[A-Z0-9]{6}[\s.]*/i, '')
    .replace(SUPPORT_CODE_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function resolveDisplayErrorMessage(errorOrMessage, fallback = '') {
  const raw = typeof errorOrMessage === 'string'
    ? errorOrMessage
    : typeof errorOrMessage?.message === 'string'
      ? errorOrMessage.message
      : '';
  return stripSupportCode(raw) || fallback;
}

export function resolveApiErrorMessage(error, fallback = '') {
  if (extractSupportCode(error)) {
    return error?.message || fallback;
  }
  return error?.data?.message
    || error?.data?.error
    || error?.code
    || error?.message
    || fallback;
}

export function createSupportAwareApiError(payload, status, fallback = '') {
  const errorId = extractSupportCode(payload);
  const message = status >= 500 && errorId
    ? `הפעולה נכשלה. קוד תמיכה: ${errorId}`
    : payload?.message || payload?.error || payload?.details || payload?.description || payload?.title || fallback || `HTTP ${status}`;

  const error = new Error(message);
  error.status = status;

  if (payload && typeof payload === 'object') {
    error.data = payload;
  }

  const code = payload?.message || payload?.error || payload?.details || payload?.description || payload?.title || null;
  if (code) {
    error.code = code;
    error.apiCode = code;
  }

  if (errorId) {
    error.error_id = errorId;
    error.supportCode = errorId;
  }

  return error;
}
