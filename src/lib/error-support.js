// What a user reads when something fails. Every text shown to the user is Hebrew
// (docs/project-rules/20, "The product speaks Hebrew"). API codes stay stable English on the error
// (error.code, error.apiCode, resolveApiErrorMessage) for consumers that branch on them.

// Hebrew messages for API codes. Add a code here when the server starts returning it.
export const API_ERROR_MESSAGES = {
  admin_or_owner_required: 'נדרשות הרשאות מנהל או בעלים.',
  cannot_delete_committed_workspace: 'לא ניתן למחוק סביבת ייבוא שכבר יובאו ממנה רשומות למערכת.',
  cancel_instance_requires_dedicated_action: 'ביטול שיעור נעשה דרך "בטל שיעור" ולא דרך העריכה.',
  capacity_exceeded: 'השיעור מלא — אין מקום פנוי למשתתף/ת נוסף/ת.',
  failed_to_load_lesson_history: 'טעינת היסטוריית השיעור נכשלה. נסו שוב.',
  admin_required: 'נדרשות הרשאות מנהל.',
  client_profile_not_found: 'הלקוח לא נמצא.',
  database_error: 'אירעה שגיאה בגישה לנתונים. נסו שוב.',
  document_not_found: 'המסמך לא נמצא.',
  employee_not_found: 'העובד לא נמצא.',
  failed_to_load_settings: 'טעינת ההגדרות נכשלה. נסו שוב.',
  failed_to_verify_membership: 'לא הצלחנו לבדוק את ההרשאות שלכם כרגע. נסו שוב.',
  forbidden: 'אין לכם הרשאה לבצע את הפעולה.',
  form_not_found: 'הטופס לא נמצא.',
  form_not_published: 'הטופס עדיין לא פורסם.',
  form_not_session_report: 'הטופס שהוגדר לשירות זה אינו טופס מסוג דוח מפגש.',
  internal_error: 'אירעה שגיאה פנימית. נסו שוב.',
  internal_server_error: 'אירעה שגיאה פנימית. נסו שוב.',
  invalid_date: 'התאריך אינו תקין.',
  invalid_date_range: 'טווח התאריכים אינו תקין.',
  invalid_email: 'כתובת האימייל אינה תקינה.',
  invalid_json_body: 'הבקשה אינה תקינה.',
  invalid_org_id: 'הארגון שנבחר אינו תקין.',
  invalid_or_expired_token: 'ההתחברות פגה. התחברו מחדש ונסו שוב.',
  invalid_phone: 'מספר הטלפון אינו תקין.',
  invalid_report_form_id: 'טופס הדיווח שנבחר אינו תקין.',
  invalid_service_id: 'השירות שנבחר אינו תקין.',
  invalid_status: 'הסטטוס שנבחר אינו תקין.',
  invalid_student_id: 'התלמיד שנבחר אינו תקין.',
  invalid_token: 'ההתחברות פגה. התחברו מחדש ונסו שוב.',
  invite_not_found: 'ההזמנה לא נמצאה.',
  invitation_not_pending: 'ההזמנה כבר טופלה.',
  lesson_cancelled: 'השיעור בוטל.',
  lesson_charge_reversal_must_use_calendar: 'חיוב שיעור מתעדכן דרך שינוי סטטוס השיעור ביומן. עדכנו את הנוכחות או הביטול שם כדי לשמור על התאמה בין היומן ללדר.',
  lesson_instance_not_found: 'השיעור לא נמצא.',
  lesson_not_started: 'לא ניתן לתעד דיווח עבור שיעור שטרם התחיל.',
  lesson_template_not_found: 'התבנית לא נמצאה.',
  method_not_allowed: 'הפעולה אינה נתמכת במסך הזה.',
  missing_bearer: 'ההתחברות פגה. התחברו מחדש ונסו שוב.',
  missing_bearer_token: 'ההתחברות פגה. התחברו מחדש ונסו שוב.',
  missing_email: 'חסרה כתובת אימייל.',
  missing_employee_id: 'חסר עובד לביצוע הפעולה.',
  missing_instance_id: 'חסר שיעור לביצוע הפעולה.',
  missing_org_id: 'חסר ארגון לביצוע הפעולה.',
  missing_orgid: 'חסר ארגון לביצוע הפעולה.',
  missing_service_id: 'חסר שירות לביצוע הפעולה.',
  missing_updates: 'לא נשלחו שינויים לעדכון.',
  not_a_member: 'אין לכם גישה לארגון הזה.',
  participant_did_not_attend: 'לא ניתן לתעד דיווח עבור תלמיד שלא הגיע לשיעור.',
  participant_not_found: 'המשתתף לא נמצא.',
  permission_denied: 'אין לכם הרשאה לבצע את הפעולה.',
  report_already_exists: 'כבר קיים דיווח עבור שיעור זה.',
  report_form_not_published: 'טופס הדיווח של השירות עדיין לא פורסם.',
  report_has_documentation: 'קיים דיווח מתועד לשיעור הזה. יש למחוק או לבטל את הדיווח לפני ביצוע הפעולה.',
  report_locked: 'הדיווח נעול ולא ניתן לעריכה.',
  report_not_found: 'הדיווח לא נמצא.',
  server_misconfigured: 'המערכת לא מוגדרת כראוי. פנו לתמיכה.',
  service_has_no_report_form: 'לשירות זה לא הוגדר טופס דיווח.',
  session_reports_disabled: 'תכונת דיווחי המפגשים אינה פעילה עבור הארגון שלכם.',
  storage_disconnected: 'חיבור האחסון מנותק.',
  storage_not_configured: 'האחסון עדיין לא הוגדר.',
  student_not_found: 'התלמיד לא נמצא.',
  table_not_found: 'חסרה טבלת נתונים. יש להריץ את סקריפט ההתקנה.',
  user_not_found: 'המשתמש לא נמצא.',
};

export const DEFAULT_SERVER_ERROR_MESSAGE = 'הפעולה נכשלה. נסו שוב בעוד כמה דקות.';
export const DEFAULT_REQUEST_ERROR_MESSAGE = 'הפעולה לא הושלמה. בדקו את הפרטים ונסו שוב.';

const HEBREW_LETTER = /[\u0590-\u05FF]/;

function isHebrewText(value) {
  return typeof value === 'string' && HEBREW_LETTER.test(value);
}

function defaultMessageForStatus(status) {
  return Number(status) >= 500 || !Number(status) ? DEFAULT_SERVER_ERROR_MESSAGE : DEFAULT_REQUEST_ERROR_MESSAGE;
}

function payloadCode(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return payload.message || payload.error || payload.details || payload.description || payload.title || '';
}

/** The dedicated Hebrew message for an API code from API_ERROR_MESSAGES, or ''. */
function mappedMessage(code) {
  if (typeof code !== 'string' || !code.trim()) return '';
  const trimmed = code.trim();
  return Object.prototype.hasOwnProperty.call(API_ERROR_MESSAGES, trimmed) ? API_ERROR_MESSAGES[trimmed] : '';
}

/** The marker a server adds (withUserMessage in api/_shared/org-bff.js) to approve its message. */
export const USER_MESSAGE_KIND = 'user';

/**
 * Server text that may be shown as it is. An explicit marker decides, not the status, the field or
 * the characters: only a 4xx response whose body carries `message_kind: 'user'` (set by the server's
 * withUserMessage). Any other server text (an unmarked 4xx `message`, which may be a forwarded
 * exception; any 5xx text; `details`, `description`, `title`) is never shown, even when it contains
 * Hebrew. A marked message must still be Hebrew prose, not a code.
 */
function serverPublicMessage(payload, status) {
  if (!(Number(status) >= 400 && Number(status) < 500)) return '';
  if (!payload || typeof payload !== 'object' || payload.message_kind !== USER_MESSAGE_KIND) return '';
  const value = payload.message;
  if (typeof value !== 'string' || !value.trim() || API_CODE_SHAPE.test(value.trim())) return '';
  return isHebrewText(value) ? value.trim() : '';
}

const API_CODE_SHAPE = /^[a-z][a-z0-9_]*$/;

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

const API_CODE = /^[a-z][a-z0-9_]*$/;

export const NETWORK_ERROR_MESSAGE = 'לא הצלחנו להתחבר לשרת. בדקו את החיבור לאינטרנט ונסו שוב.';
export const GENERAL_ERROR_MESSAGE = 'הפעולה נכשלה.';

/**
 * The public, stable API code of a response: a snake_case value of `message`, `error` or `code` only.
 * Free text (details, descriptions, provider or DB messages) is never treated as a code.
 */
export function publicErrorCodeFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  for (const value of [payload.message, payload.error, payload.code]) {
    if (typeof value === 'string' && API_CODE.test(value.trim())) return value.trim();
  }
  return '';
}

/** The public API code carried by a caught error, or ''. */
export function publicErrorCode(error) {
  if (!error || typeof error !== 'object') return '';
  if (typeof error.publicCode === 'string' && API_CODE.test(error.publicCode)) return error.publicCode;
  return publicErrorCodeFromPayload(error.data);
}

function httpStatusOf(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

/** True for a request that never got a server response (offline, DNS, CORS, connection reset). */
export function isNetworkError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.isNetworkError === true) return true;
  if (httpStatusOf(error)) return false;
  const message = typeof error.message === 'string' ? error.message : '';
  return error.name === 'TypeError' && /failed to fetch|networkerror|load failed|network request failed/i.test(message);
}

/** An error for a request that got no server response. It has no status and no codes. */
export function createNetworkError(cause) {
  /** @type {any} */
  const error = new Error(NETWORK_ERROR_MESSAGE);
  error.isNetworkError = true;
  error.occurredAt = new Date().toISOString();
  if (cause) error.cause = cause;
  return error;
}

/** @param {any} error */
function stampApiError(error, payload, status) {
  error.status = status;
  error.occurredAt = error.occurredAt || new Date().toISOString();
  const publicCode = publicErrorCodeFromPayload(payload);
  if (publicCode) error.publicCode = publicCode;
  return error;
}

export function createSupportAwareApiError(payload, status, fallback = '') {
  const errorId = extractSupportCode(payload);
  const message = buildApiErrorMessage(payload, status, fallback);

  const error = stampApiError(new Error(message), payload, status);

  if (payload && typeof payload === 'object') {
    error.data = payload;
  }

  // error.code / error.apiCode keep their historical meaning (the first text field of the payload)
  // for consumers that branch on them. The public code shown to users is error.publicCode.
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

/** Adds the fields that describeError reads to an error built elsewhere (api-client). */
export function decorateErrorForDisplay(error, payload, status) {
  return stampApiError(error, payload, status);
}

/**
 * error.message for an API error. It matches buildUserErrorMessage, with one exception kept for
 * compatibility: an unmapped snake_case code on a 4xx stays as the message, because existing
 * consumers branch on error.message. Display such errors through resolveUserErrorMessage.
 */
export function buildApiErrorMessage(payload, status, fallback = '') {
  const code = payloadCode(payload);
  if (Number(status) < 500 && !extractSupportCode(payload) && typeof code === 'string'
    && API_CODE.test(code.trim()) && !mappedMessage(code)) {
    return code.trim();
  }
  return buildUserErrorMessage(payload, status, fallback);
}

function withReference(message, publicCode, status) {
  if (publicCode) return `${message} (${publicCode})`;
  if (status) return `${message} (HTTP ${status})`;
  return message;
}

/**
 * The message shown to the user for an API response, as one string:
 * - a known code (API_ERROR_MESSAGES), or the Hebrew `message` of a 4xx response: that text;
 * - anything else: the Hebrew fallback or a general Hebrew message, followed by the public code in
 *   parentheses, or by "(HTTP <status>)" when there is only a status. Nothing is invented.
 * A saved support code is a separate field, appended as "קוד תמיכה: …"; it never replaces the
 * public code in the title.
 */
export function buildUserErrorMessage(payload, status, fallback = '') {
  const numericStatus = Number(status);
  const httpStatus = Number.isInteger(numericStatus) && numericStatus >= 100 ? numericStatus : null;
  const publicCode = publicErrorCodeFromPayload(payload);
  const title = mappedMessage(publicCode)
    || serverPublicMessage(payload, httpStatus)
    || withReference(isHebrewText(fallback) ? fallback : defaultMessageForStatus(status), publicCode, httpStatus);
  const errorId = extractSupportCode(payload);
  return errorId ? `${title} קוד תמיכה: ${errorId}` : title;
}

/**
 * Attaches the failed action and a Hebrew fallback message to a caught error, so that whatever
 * finally displays it (ErrorMessageText, ErrorDetails, toast.apiError) shows and copies the same
 * wording. Returns the same error object; a non-object is wrapped in an Error.
 */
export function withErrorContext(error, { action = '', fallback = '' } = {}) {
  /** @type {any} */
  const target = error && typeof error === 'object' ? error : new Error(typeof error === 'string' ? error : '');
  if (action) target.displayAction = action;
  if (fallback) target.displayFallback = fallback;
  return target;
}

/**
 * Everything the UI shows about a caught error, and nothing more. The same fields are used for the
 * on-screen details and for the text copied for support, so the user sees what they send.
 * It never carries the request or response body, user data, tokens, stacks or DB/provider text.
 *
 * @param {any} error
 * @param {{ fallback?: string, action?: string, occurredAt?: string }} [options]
 * @returns {{ message: string, specific: boolean, network: boolean, action: string,
 *   occurredAt: string, status: number|null, publicCode: string, supportCode: string }}
 */
export function describeError(error, { fallback: givenFallback = '', action: givenAction = '', occurredAt = '' } = {}) {
  const fallback = givenFallback || (typeof error?.displayFallback === 'string' ? error.displayFallback : '');
  const action = givenAction || (typeof error?.displayAction === 'string' ? error.displayAction : '');
  const network = isNetworkError(error);
  const status = network ? null : httpStatusOf(error);
  const publicCode = network ? '' : publicErrorCode(error);
  const supportCode = network ? '' : extractSupportCode(error);
  const when = occurredAt || (typeof error?.occurredAt === 'string' ? error.occurredAt : '') || new Date().toISOString();
  const base = { network, action: isHebrewText(action) ? action : '', occurredAt: when, status, publicCode, supportCode };

  if (network) {
    return { ...base, message: NETWORK_ERROR_MESSAGE, specific: false };
  }
  // Shown as it is only from a trusted source: our own code map, a 4xx `message` from the server,
  // or an error our own app threw (no HTTP status and no response data).
  const isApiError = Boolean(status) || Boolean(error?.data) || Boolean(supportCode);
  const specific = mappedMessage(publicCode)
    || mappedMessage(typeof error?.code === 'string' && API_CODE.test(error.code) ? error.code : '')
    || serverPublicMessage(error?.data, status)
    || (!isApiError && isHebrewText(error?.message) ? stripSupportCode(error.message) : '');
  if (specific) {
    return { ...base, message: specific, specific: true };
  }
  const general = isHebrewText(fallback) ? fallback : (status ? defaultMessageForStatus(status) : GENERAL_ERROR_MESSAGE);
  return { ...base, message: withReference(general, publicCode, status), specific: false };
}

/**
 * The message to show for any caught error, as one string. A saved support code is appended as
 * "קוד תמיכה: …" so the existing alert and toast helpers can lift it into their code chip.
 */
export function resolveUserErrorMessage(error, fallback = '') {
  const details = describeError(error, { fallback });
  return details.supportCode ? `${details.message} קוד תמיכה: ${details.supportCode}` : details.message;
}

export const ERROR_DETAIL_LABELS = {
  action: 'פעולה',
  occurredAt: 'זמן',
  status: 'סטטוס HTTP',
  publicCode: 'קוד שגיאה',
  supportCode: 'קוד תמיכה',
};

/**
 * The rows shown under "פירוט השגיאה" and copied for support, in a fixed order. Only fields that
 * were received are listed. `formatTime` turns the ISO time into the org's local time for display.
 */
export function errorDetailRows(details, { formatTime = (iso) => iso } = {}) {
  const rows = [];
  if (details?.action) rows.push({ key: 'action', label: ERROR_DETAIL_LABELS.action, value: details.action });
  if (details?.occurredAt) rows.push({ key: 'occurredAt', label: ERROR_DETAIL_LABELS.occurredAt, value: formatTime(details.occurredAt) });
  if (details?.status) rows.push({ key: 'status', label: ERROR_DETAIL_LABELS.status, value: String(details.status) });
  if (details?.publicCode) rows.push({ key: 'publicCode', label: ERROR_DETAIL_LABELS.publicCode, value: details.publicCode });
  if (details?.supportCode) rows.push({ key: 'supportCode', label: ERROR_DETAIL_LABELS.supportCode, value: details.supportCode });
  return rows;
}

/** The text copied by "העתקה לשליחה לתמיכה": the message and exactly the rows shown on screen. */
export function formatErrorDetailsForCopy(details, options = {}) {
  const lines = ['פרטי שגיאה לתמיכה', `הודעה: ${details?.message || GENERAL_ERROR_MESSAGE}`];
  for (const row of errorDetailRows(details, options)) lines.push(`${row.label}: ${row.value}`);
  return lines.join('\n');
}
