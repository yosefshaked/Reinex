export const errorCatalog = {
  looseSessions: {
    assign: {
      student_not_found: 'התלמיד לא נמצא במערכת.',
      session_already_assigned: 'הדיווח כבר משויך לתלמיד.',
      session_not_found: 'הדיווח לא נמצא במערכת.',
      failed_to_load_session: 'טעינת הדיווח נכשלה. אנא נסו שוב.',
      failed_to_load_student: 'טעינת התלמיד נכשלה. אנא נסו שוב.',
      failed_to_assign_session: 'שיוך הדיווח נכשל. אנא נסו שוב.',
    },
    create: {
      missing_student_name: 'נא להזין שם תלמיד.',
      invalid_instructor_id: 'מדריך לא חוקי.',
      instructor_not_found: 'המדריך לא נמצא במערכת.',
      instructor_inactive: 'המדריך אינו פעיל. נא לבחור מדריך פעיל.',
      session_already_assigned: 'הדיווח כבר משויך לתלמיד.',
      missing_identity_number: 'נא להזין מספר זהות.',
      duplicate_identity_number: 'מספר זהות כבר קיים במערכת. נא לבחור תלמיד קיים או להזין מספר זהות אחר.',
      failed_to_check_identity_number: 'בדיקת מספר הזהות נכשלה. אנא נסו שוב.',
      failed_to_create_student: 'יצירת התלמיד נכשלה. אנא נסו שוב.',
      failed_to_assign_session: 'שיוך הדיווח נכשל. אנא נסו שוב.',
    },
    reject: {
      missing_reject_reason: 'נא להזין סיבה לדחיית הדיווח.',
      session_not_found: 'הדיווח לא נמצא במערכת.',
      session_already_assigned: 'לא ניתן לדחות דיווח שכבר שויך לתלמיד.',
      failed_to_reject_session: 'דחיית הדיווח נכשלה. אנא נסו שוב.',
    },
  },
};

function resolveMapping(code, contextPath = [], fallback = '') {
  if (!code) return fallback;
  let current = errorCatalog;
  for (const key of contextPath) {
    if (!current || typeof current !== 'object') return fallback;
    current = current[key];
  }
  if (current && typeof current === 'object' && current[code]) {
    return current[code];
  }
  return fallback;
}

export function mapLooseSessionError(code, action, fallback) {
  return resolveMapping(code, ['looseSessions', action], fallback);
}

export function mapErrorMessage(code, { category, action, fallback }) {
  if (!category) return fallback || '';
  const path = action ? [category, action] : [category];
  return resolveMapping(code, path, fallback);
}
