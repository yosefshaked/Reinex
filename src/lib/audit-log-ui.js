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
  'students.bulk_update': 'בוצע עדכון מרובה לתלמידים',
  'status.changed': 'שינוי סטטוס תלמיד',

  // Instructors
  'instructor.created': 'נוצר מדריך חדש',
  'instructor.updated': 'פרטי מדריך עודכנו',
  'instructor.deleted': 'מדריך נמחק',

  // Membership / Invitations
  'member.invited': 'נשלחה הזמנה לחבר צוות',
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
};

const DETAIL_LABELS_HE = {
  student_id: 'תלמיד',
  student_name: 'שם תלמיד',
  instructor_employee_id: 'מדריך',
  service_id: 'שירות',
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
  default_notification_method: 'שיטת התראה ברירת מחדל',
  notification_method: 'שיטת התראה',
  updated_fields: 'שדות שעודכנו',
  guardian_change: 'שינוי אפוטרופוס',
  reject_reason: 'סיבת דחייה',
  cancelled_count: 'כמות שבוטלה',
  instance_count: 'כמות מופעים',
  from_date: 'מתאריך',
};

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

export function formatAuditDetailValue(value) {
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
    return trimmed || '—';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      return value.map((item) => String(item)).join(', ');
    }
    return JSON.stringify(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
