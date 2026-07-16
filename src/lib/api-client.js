import { getAuthClient } from '@/lib/supabase-manager.js';

const ACTIVE_ORG_STORAGE_KEY = 'active_org_id';
const COMMON_API_ERROR_MESSAGES = {
  admin_or_owner_required: 'נדרשות הרשאות מנהל או בעלים.',
  cannot_delete_committed_workspace: 'לא ניתן למחוק סביבת ייבוא שכבר יובאו ממנה רשומות למערכת.',
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

function getActiveOrgId() {
  try {
    return window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

async function resolveBearerToken() {
  const authClient = getAuthClient();
  const { data, error } = await authClient.auth.getSession();

  if (error) {
    throw new Error('Authentication token not found.');
  }

  const token = data?.session?.access_token || null;

  if (!token) {
    throw new Error('Authentication token not found.');
  }

  return token;
}

function resolveTokenFromOverrides(session, accessToken) {
  const overrideToken = typeof accessToken === 'string' && accessToken.trim()
    ? accessToken.trim()
    : null;
  if (overrideToken) {
    return { token: overrideToken, source: 'accessToken' };
  }

  const sessionToken = session?.access_token;
  if (typeof sessionToken === 'string' && sessionToken.trim()) {
    return { token: sessionToken.trim(), source: 'session' };
  }

  return { token: null, source: 'none' };
}

function createAuthorizationHeaders(customHeaders = {}, bearer, { includeJsonContentType = false, orgId = '' } = {}) {
  const headers = includeJsonContentType
    ? { 'Content-Type': 'application/json', ...customHeaders }
    : { ...customHeaders };

  headers.Authorization = bearer;
  headers.authorization = bearer;
  headers['X-Supabase-Authorization'] = bearer;
  headers['x-supabase-authorization'] = bearer;
  headers['x-supabase-auth'] = bearer;

  if (orgId) {
    headers['x-org-id'] = orgId;
  }

  return headers;
}

function buildApiErrorMessage(payload, status, fallback = 'An API error occurred') {
  const errorId = payload?.error_id || payload?.support_code || '';
  if (status >= 500 && errorId) {
    return `הפעולה נכשלה. קוד תמיכה: ${errorId}`;
  }
  const code = payload?.message || payload?.error || payload?.details || payload?.description || payload?.title || '';
  return COMMON_API_ERROR_MESSAGES[code] || code || fallback;
}

function decorateApiError(error, payload, status) {
  error.status = status;
  if (payload) {
    error.data = payload;
  }
  const code = payload?.message || payload?.error || payload?.details || payload?.description || payload?.title || null;
  if (code) {
    error.code = code;
    error.apiCode = code;
  }
  const errorId = payload?.error_id || payload?.support_code || null;
  if (errorId) {
    error.error_id = errorId;
    error.supportCode = errorId;
  }
  return error;
}

export async function authenticatedFetch(path, { session: _session, accessToken: _accessToken, ...options } = {}) {
  const resolved = resolveTokenFromOverrides(_session, _accessToken);
  const token = resolved.token || await resolveBearerToken();
  const bearer = `Bearer ${token}`;
  const orgId = getActiveOrgId();

  const { headers: customHeaders = {}, body, params, ...rest } = options;
  const headers = createAuthorizationHeaders(customHeaders, bearer, { includeJsonContentType: true, orgId });

  let requestBody = body;
  if (requestBody && typeof requestBody === 'object' && !(requestBody instanceof FormData)) {
    requestBody = JSON.stringify(requestBody);
  }

  const normalizedPath = String(path || '')
    .replace(/^\/+/, '')
    .replace(/^api\//, '');

  let url = `/api/${normalizedPath}`;
  if (params && typeof params === 'object') {
    const searchParams = new URLSearchParams();
    for (const [key, rawValue] of Object.entries(params)) {
      if (!key) continue;
      if (rawValue === null || typeof rawValue === 'undefined') continue;
      if (Array.isArray(rawValue)) {
        for (const entry of rawValue) {
          if (entry === null || typeof entry === 'undefined') continue;
          searchParams.append(key, String(entry));
        }
        continue;
      }
      searchParams.set(key, String(rawValue));
    }
    const query = searchParams.toString();
    if (query) {
      url += (url.includes('?') ? '&' : '?') + query;
    }
  }

  const response = await fetch(url, {
    ...rest,
    headers,
    body: requestBody,
  });

  let payload = null;
  const contentType = response.headers?.get?.('content-type') || response.headers?.get?.('Content-Type') || '';
  const isJson = typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
  if (isJson) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw decorateApiError(
      new Error(buildApiErrorMessage(payload, response.status)),
      payload,
      response.status,
    );
  }

  return payload;
}

export async function authenticatedFetchBlob(path, { session: _session, accessToken: _accessToken, ...options } = {}) {
  const resolved = resolveTokenFromOverrides(_session, _accessToken);
  const token = resolved.token || await resolveBearerToken();
  const bearer = `Bearer ${token}`;
  const orgId = getActiveOrgId();

  const { headers: customHeaders = {}, params, ...rest } = options;
  const headers = createAuthorizationHeaders(customHeaders, bearer, { includeJsonContentType: false, orgId });

  const normalizedPath = String(path || '')
    .replace(/^\/+/, '')
    .replace(/^api\//, '');

  let url = `/api/${normalizedPath}`;
  if (params && typeof params === 'object') {
    const searchParams = new URLSearchParams();
    for (const [key, rawValue] of Object.entries(params)) {
      if (!key) continue;
      if (rawValue === null || typeof rawValue === 'undefined') continue;
      if (Array.isArray(rawValue)) {
        for (const entry of rawValue) {
          if (entry === null || typeof entry === 'undefined') continue;
          searchParams.append(key, String(entry));
        }
        continue;
      }
      searchParams.set(key, String(rawValue));
    }
    const query = searchParams.toString();
    if (query) {
      url += (url.includes('?') ? '&' : '?') + query;
    }
  }

  const response = await fetch(url, {
    ...rest,
    headers,
  });

  if (!response.ok) {
    let payload = null;
    try {
      const text = await response.text();
      payload = JSON.parse(text);
    } catch {
      // Ignore parse errors
    }
    throw decorateApiError(
      new Error(buildApiErrorMessage(payload, response.status)),
      payload,
      response.status,
    );
  }

  return response.blob();
}

export async function authenticatedFetchText(path, { session: _session, accessToken: _accessToken, ...options } = {}) {
  const resolved = resolveTokenFromOverrides(_session, _accessToken);
  const token = resolved.token || await resolveBearerToken();
  const bearer = `Bearer ${token}`;
  const orgId = getActiveOrgId();

  const { headers: customHeaders = {}, params, ...rest } = options;
  const headers = createAuthorizationHeaders(customHeaders, bearer, { includeJsonContentType: false, orgId });

  const normalizedPath = String(path || '')
    .replace(/^\/+/, '')
    .replace(/^api\//, '');

  let url = `/api/${normalizedPath}`;
  if (params && typeof params === 'object') {
    const searchParams = new URLSearchParams();
    for (const [key, rawValue] of Object.entries(params)) {
      if (!key) continue;
      if (rawValue === null || typeof rawValue === 'undefined') continue;
      if (Array.isArray(rawValue)) {
        for (const entry of rawValue) {
          if (entry === null || typeof entry === 'undefined') continue;
          searchParams.append(key, String(entry));
        }
        continue;
      }
      searchParams.set(key, String(rawValue));
    }
    const query = searchParams.toString();
    if (query) {
      url += (url.includes('?') ? '&' : '?') + query;
    }
  }

  const response = await fetch(url, {
    ...rest,
    headers,
  });

  const text = await response.text();

  if (!response.ok) {
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // ignore JSON parsing failures
    }

    throw decorateApiError(
      new Error(buildApiErrorMessage(payload, response.status)),
      payload,
      response.status,
    );
  }

  return text;
}
