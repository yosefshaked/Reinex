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

const HEBREW_LETTER = /[֐-׿]/;

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

/** The Hebrew text for a code or server message, or '' when there is none. */
function hebrewForCode(code) {
  if (typeof code !== 'string' || !code.trim()) return '';
  const trimmed = code.trim();
  if (Object.prototype.hasOwnProperty.call(API_ERROR_MESSAGES, trimmed)) return API_ERROR_MESSAGES[trimmed];
  return isHebrewText(trimmed) ? trimmed : '';
}

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
  const message = buildApiErrorMessage(payload, status, fallback);

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

const API_CODE = /^[a-z][a-z0-9_]*$/;

/**
 * error.message for an API error. It matches buildUserErrorMessage, with one exception kept for
 * compatibility: an unmapped snake_case code on a 4xx stays as the message, because existing
 * consumers branch on error.message. Display such errors through resolveUserErrorMessage.
 */
export function buildApiErrorMessage(payload, status, fallback = '') {
  const code = payloadCode(payload);
  if (Number(status) < 500 && !extractSupportCode(payload) && typeof code === 'string'
    && API_CODE.test(code.trim()) && !hebrewForCode(code)) {
    return code.trim();
  }
  return buildUserErrorMessage(payload, status, fallback);
}

/**
 * The message shown to the user for an API response. A 5xx with a support code shows the code; a
 * known code or a Hebrew server message shows that text; anything else (an unmapped code, an English
 * server message, an empty response) shows the Hebrew fallback, or a safe Hebrew default.
 */
export function buildUserErrorMessage(payload, status, fallback = '') {
  const errorId = extractSupportCode(payload);
  if (Number(status) >= 500 && errorId) {
    return `הפעולה נכשלה. קוד תמיכה: ${errorId}`;
  }
  return hebrewForCode(payloadCode(payload))
    || (isHebrewText(fallback) ? fallback : '')
    || defaultMessageForStatus(status);
}

/**
 * The message to show for any caught error. Use this for display; resolveApiErrorMessage returns the
 * API code for consumers that branch on it.
 */
export function resolveUserErrorMessage(error, fallback = '') {
  if (extractSupportCode(error) && isHebrewText(error?.message)) {
    return error.message;
  }
  return hebrewForCode(error?.data?.message)
    || hebrewForCode(error?.data?.error)
    || hebrewForCode(error?.code)
    || hebrewForCode(error?.message)
    || (isHebrewText(fallback) ? fallback : '')
    || defaultMessageForStatus(error?.status);
}
