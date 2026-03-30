const ACTION_LABELS_HE = {
  // Calendar
  'template.created': 'נוצרה תבנית חדשה',
  'template.updated': 'עודכנה תבנית קיימת',
  'template.deactivated': 'תבנית הושבתה',
  'template.reactivated': 'תבנית הופעלה מחדש',
  'template.override_created': 'נוצרה החרגת תבנית',
  'template.override_deleted': 'החרגת תבנית בוטלה',
  'calendar.generation_dry_run': 'בוצעה בדיקת יצירת מופעים',
  'calendar.generation_applied': 'נוצרו מופעים ביומן',
  'student.lessons_bulk_cancelled': 'בוטלו שיעורים לתלמיד',

  // Students
  'student.created': 'נוצר תלמיד חדש',
  'student.updated': 'פרטי תלמיד עודכנו',
  'student.deleted': 'תלמיד נמחק',
  'student.lesson_attendance_restored': 'שוחזרה נוכחות תלמיד',
  'students.bulk_update': 'בוצע עדכון מרובה לתלמידים',
  'status.changed': 'שינוי סטטוס תלמיד',

  // Instructors
  'instructor.created': 'נוצר מדריך חדש',
  'instructor.updated': 'פרטי מדריך עודכנו',
  'instructor.deleted': 'מדריך נמחק',

  // Membership / Invitations
  'member.invited': 'נשלחה הזמנה לחבר צוות',
  'member.linked_to_employee': 'חבר ארגון שויך לעובד קיים',
  'member.removed': 'חבר צוות הוסר מהארגון',
  'member.role_changed': 'תפקיד חבר צוות שונה',
  'invitation.revoked': 'הזמנה בוטלה',

  // Storage
  'storage.configured': 'אחסון הארגון הוגדר',
  'storage.updated': 'הגדרות האחסון עודכנו',
  'storage.disconnected': 'האחסון נותק',
  'storage.reconnected': 'האחסון חובר מחדש',
  'storage.grace_period_started': 'החל מצב חסד לאחסון',
  'storage.files_deleted': 'נמחקו קבצים עקב סיום תקופת חסד',
  'storage.bulk_download': 'בוצעה הורדה מרוכזת של קבצים',
  'storage.migrated_to_byos': 'האחסון הוסב ל-BYOS',

  // Files / Documents
  'file.uploaded': 'הועלה קובץ חדש',
  'file.deleted': 'קובץ נמחק',
  'files.bulk_downloaded': 'בוצעה הורדה מרוכזת של קבצים',
  'document.updated': 'פרטי מסמך עודכנו',

  // Sessions
  'session.created': 'נוצר דיווח חדש',
  'session.resolved': 'דיווח טופל',
  'session.deleted': 'דיווח נמחק',

  // Backup
  'backup.created': 'נוצר גיבוי חדש',
  'backup.restored': 'בוצע שחזור מגיבוי',

  // Settings / Permissions
  'settings.updated': 'הגדרות הארגון עודכנו',
  'logo.updated': 'לוגו הארגון עודכן',
  'permission.enabled': 'הרשאה הופעלה',
  'permission.disabled': 'הרשאה הושבתה',

  // Legacy uppercase variants
  STUDENT_CREATED: 'נוצר תלמיד חדש',
  STUDENT_UPDATED: 'פרטי תלמיד עודכנו',
  STUDENT_DELETED: 'תלמיד נמחק',
  STATUS_CHANGED: 'שינוי סטטוס תלמיד',
  GUARDIAN_CREATED: 'נוסף אפוטרופוס',
  GUARDIAN_UPDATED: 'פרטי אפוטרופוס עודכנו',
  GUARDIAN_DELETED: 'אפוטרופוס נמחק',
  DOCUMENT_UPLOADED: 'הועלה מסמך',
  DOCUMENT_DELETED: 'מסמך נמחק',
  LESSON_ASSIGNED: 'שיעור שובץ',
  LESSON_CANCELLED: 'שיעור בוטל',
  ENROLLMENT_CREATED: 'נוצרה הרשמה',
  ENROLLMENT_DELETED: 'הרשמה בוטלה',
  TEMPLATE_CREATED: 'נוצרה תבנית חדשה',
  TEMPLATE_UPDATED: 'עודכנה תבנית קיימת',

  // Forms
  'form_template.created': 'נוצר טופס חדש',
  'form_template.updated': 'טופס עודכן',
  'form_template.deleted': 'טופס הושבת',
};

const CATEGORY_LABELS_HE = {
  calendar: 'לוח שנה',
  storage: 'אחסון',
  backup: 'גיבוי',
  settings: 'הגדרות',
  students: 'תלמידים',
  files: 'מסמכים',
  sessions: 'מפגשים',
  session: 'מפגשים',
  membership: 'חברות בארגון',
  permissions: 'הרשאות',
  instructors: 'מדריכים',
  forms: 'טפסים',
};

const DETAIL_LABELS_HE = {
  student_id: 'תלמיד',
  student_name: 'שם תלמיד',
  guardian_id: 'מזהה אפוטרופוס',
  guardian: 'אפוטרופוס',
  instructor_employee_id: 'מדריך',
  service_id: 'שירות',
  form_template_id: 'טופס',
  new_version: 'גרסה חדשה',
  template_version: 'גרסת טופס',
  valid_from: 'מתאריך',
  valid_until: 'עד תאריך',
  duration_minutes: 'משך',
  day_of_week: 'יום בשבוע',
  time_of_day: 'שעה',
  grace_period_days: 'ימי חסד',
  grace_ends_at: 'סיום תקופת חסד',
  storage_mode: 'מצב אחסון',
  role: 'תפקיד',
  status: 'סטטוס',
  participant_status: 'סטטוס השתתפות',
  lesson_status: 'סטטוס שיעור',
  previous: 'לפני',
  next: 'אחרי',
  requested: 'התבקש',
  success: 'הצליח',
  action: 'פעולה',
  error: 'שגיאה',
  mode: 'מצב',
  default_notification_method: 'שיטת התראה ברירת מחדל',
  notification_method: 'שיטת התראה',
  updated_fields: 'שדות שעודכנו',
  guardian_change: 'שינוי אפוטרופוס',
  relationship: 'מערכת יחסים',
  reject_reason: 'סיבת דחייה',
  cancelled_count: 'כמות שבוטלה',
  instance_count: 'כמות מופעים',
  from_date: 'מתאריך',
  billing_amount_reversed: 'סכום שהוחזר לתלמיד',
  instructor_earning_removed: 'סכום שהוסר משכר מדריך',
  instructor_attendance_worked_minutes: 'דקות נוכחות מדריך לאחר השחזור',
  hmo_task_resolved: 'משימת תביעה טופלה',
  previous_status: 'סטטוס קודם',
  next_status: 'סטטוס חדש',
  impacts: 'השפעות',
  projected: 'חיזוי',
};

const VALUE_LABELS_BY_KEY = {
  relationship: {
    father: 'אב',
    mother: 'אם',
    guardian: 'אפוטרופוס',
    grandparent: 'סב/סבתא',
    other: 'אחר',
  },
  default_notification_method: {
    whatsapp: 'וואטסאפ',
    email: 'אימייל',
    sms: 'SMS',
    phone: 'טלפון',
    none: 'ללא',
  },
  notification_method: {
    whatsapp: 'וואטסאפ',
    email: 'אימייל',
    sms: 'SMS',
    phone: 'טלפון',
    none: 'ללא',
  },
  action: {
    unchanged: 'ללא שינוי',
    updated: 'עודכן',
    linked: 'שויך',
    cleared: 'הוסר',
    update_failed: 'כשל בעדכון',
    insert_failed: 'כשל בשיוך',
    delete_failed: 'כשל בהסרה',
    created: 'נוצר',
    deleted: 'נמחק',
    resolved: 'טופל',
  },
  mode: {
    assign_existing: 'שיוך לתלמיד קיים',
    create_and_assign: 'יצירה ושיוך לתלמיד',
    reject_loose_report: 'דחיית דיווח',
  },
  status: {
    scheduled: 'מתוכנן',
    completed: 'הושלם',
    cancelled_student: 'בוטל על ידי תלמיד',
    cancelled_clinic: 'בוטל על ידי קליניקה',
    no_show: 'לא הגיע',
    active: 'פעיל',
    inactive: 'לא פעיל',
    pending: 'ממתין',
    revoked: 'בוטל',
  },
  role: {
    owner: 'בעלים',
    admin: 'מנהל',
    office: 'משרד',
    member: 'חבר צוות',
    system_admin: 'מנהל מערכת',
  },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeActionToken(actionType) {
  return String(actionType || '').trim();
}

function humanizeToken(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDateLikeString(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsedDate = new Date(`${trimmed}T00:00:00`);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toLocaleDateString('he-IL');
    }
  }

  // ISO-ish datetime
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString('he-IL');
    }
  }

  return '';
}

function shortId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= 18) return raw;
  return `${raw.slice(0, 8)}...${raw.slice(-6)}`;
}

function tryParseStructuredString(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  // Convert pseudo-json fragments like: next::{...},previous::{...}
  const pseudoJson = trimmed.replace(/([A-Za-z_][\w]*)::/g, '"$1":');
  if (pseudoJson !== trimmed) {
    const wrapped = pseudoJson.trim().startsWith('{') ? pseudoJson : `{${pseudoJson}}`;
    try {
      return JSON.parse(wrapped);
    } catch {
      return null;
    }
  }

  return null;
}

function translateEnumValue(rawValue, key) {
  const normalizedKey = String(key || '').trim().toLowerCase();
  const normalizedValue = String(rawValue || '').trim().toLowerCase();
  if (!normalizedValue) return '';

  const byKey = VALUE_LABELS_BY_KEY[normalizedKey];
  if (byKey && byKey[normalizedValue]) {
    return byKey[normalizedValue];
  }

  return '';
}

function formatValueInternal(value, key, depth, seen, resolvers) {
  if (value === null || typeof value === 'undefined') {
    return '—';
  }

  if (typeof value === 'boolean') {
    return value ? 'כן' : 'לא';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '—';

    const translatedEnum = translateEnumValue(trimmed, key);
    if (translatedEnum) return translatedEnum;

    const parsedFromString = tryParseStructuredString(trimmed);
    if (parsedFromString && depth < 3) {
      return formatValueInternal(parsedFromString, key, depth + 1, seen, resolvers);
    }

    const dateLike = formatDateLikeString(trimmed);
    if (dateLike) return dateLike;

    if ((String(key || '').endsWith('_id') || String(key || '').toLowerCase() === 'id') && UUID_PATTERN.test(trimmed)) {
      const resolver = resolvers?.[String(key || '')];
      if (resolver) {
        const resolved = resolver(trimmed);
        if (resolved) return resolved;
      }
      return shortId(trimmed);
    }

    return trimmed;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '—';

    if (String(key || '') === 'updated_fields') {
      return value.map((item) => getAuditDetailLabel(item)).join(', ');
    }

    if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      return value.map((item) => formatValueInternal(item, key, depth + 1, seen, resolvers)).join(', ');
    }

    if (depth >= 2) {
      return `${value.length} פריטים`;
    }

    return value
      .map((item, idx) => `${idx + 1}) ${formatValueInternal(item, key, depth + 1, seen, resolvers)}`)
      .join(' ; ');
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '...';
    }
    seen.add(value);

    const entries = Object.entries(value).filter(([childKey, childValue]) => {
      if (childValue === null || typeof childValue === 'undefined') return false;
      // Skip _id UUID fields only if there is no resolver that can give a human-readable name
      if ((childKey.endsWith('_id') || childKey === 'id') && typeof childValue === 'string' && UUID_PATTERN.test(childValue.trim())) {
        const resolver = resolvers?.[childKey];
        if (resolver && resolver(childValue.trim())) return true;
        return false;
      }
      return true;
    });
    if (entries.length === 0) {
      return '—';
    }

    if (depth >= 2) {
      return entries
        .slice(0, 4)
        .map(([childKey, childValue]) => `${getAuditDetailLabel(childKey)}: ${formatValueInternal(childValue, childKey, depth + 1, seen, resolvers)}`)
        .join(' | ');
    }

    return entries
      .map(([childKey, childValue]) => `${getAuditDetailLabel(childKey)}: ${formatValueInternal(childValue, childKey, depth + 1, seen, resolvers)}`)
      .join(' | ');
  }

  return String(value);
}

export function getAuditActionLabel(actionType) {
  const raw = normalizeActionToken(actionType);
  if (!raw) return 'פעולה';

  const lower = raw.toLowerCase();
  const underscoreToDot = lower.replace(/_/g, '.');

  return (
    ACTION_LABELS_HE[raw] ||
    ACTION_LABELS_HE[raw.toUpperCase()] ||
    ACTION_LABELS_HE[lower] ||
    ACTION_LABELS_HE[underscoreToDot] ||
    humanizeToken(raw)
  );
}

export function getAuditCategoryLabel(category) {
  const raw = String(category || '').trim().toLowerCase();
  return CATEGORY_LABELS_HE[raw] || humanizeToken(raw) || '';
}

export function getAuditDetailLabel(key) {
  const raw = String(key || '').trim();
  if (!raw) return '';
  return DETAIL_LABELS_HE[raw] || humanizeToken(raw);
}

export function getAuditActionVariant(actionType) {
  const normalized = normalizeActionToken(actionType).toLowerCase().replace(/_/g, '.');
  if (!normalized) return 'outline';

  if (/(delete|cancel|revoke|disconnect|disable|remove)/.test(normalized)) {
    return 'destructive';
  }

  if (/(create|invite|upload|configure|reactivate|enable)/.test(normalized)) {
    return 'secondary';
  }

  return 'default';
}

export function formatAuditDetailValue(value, key = '', resolvers = {}) {
  return formatValueInternal(value, key, 0, new WeakSet(), resolvers);
}
