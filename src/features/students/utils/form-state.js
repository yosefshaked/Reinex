/**
 * Normalizes a time string to HH:MM:SS format for backend compatibility.
 * Handles various input formats: HH:MM, HH:MM:SS, HH:MM:SS+TZ, or null/undefined.
 * Strips timezone suffixes that PostgreSQL may append.
 * 
 * @param {string|null|undefined} time - Time string to normalize
 * @returns {string|null} Normalized time in HH:MM:SS format or null
 */
function normalizeTimeValue(time) {
  if (!time) return null;
  
  let timeStr = String(time).trim();
  if (!timeStr) return null;
  
  // Strip timezone suffix if present (e.g., "+00", "+00:00", "Z", "+03:00")
  // PostgreSQL may return time with timezone like "18:30:00+00"
  timeStr = timeStr.replace(/([+-]\d{2}:?\d{0,2}|Z)$/, '').trim();
  
  // If already in HH:MM:SS format, return as-is
  if (/^\d{2}:\d{2}:\d{2}$/.test(timeStr)) {
    return timeStr;
  }
  
  // If in HH:MM format, add :00
  if (/^\d{2}:\d{2}$/.test(timeStr)) {
    return `${timeStr}:00`;
  }
  
  // If in H:MM format (single-digit hour), pad and add :00
  if (/^\d{1}:\d{2}$/.test(timeStr)) {
    const [h, m] = timeStr.split(':');
    return `${h.padStart(2, '0')}:${m}:00`;
  }
  
  // If we still have something with colons, try to extract just HH:MM:SS
  const match = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})/);
  if (match) {
    const [, h, m, s] = match;
    return `${h.padStart(2, '0')}:${m}:${s}`;
  }
  
  // Return null if format is completely unrecognized
  return null;
}

/**
 * Creates the initial state object for student forms (add/edit).
 * This is the single source of truth for student form structure.
 * 
 * @param {Object|null|undefined} student - Optional student object to populate the form
 * @returns {Object} Complete form state with all required fields
 */
export function createStudentFormState(student) {
  return {
    firstName: student?.first_name || '',
    middleName: student?.middle_name || '',
    lastName: student?.last_name || '',
    identityNumber: student?.identity_number || student?.national_id || '',
    phone: student?.phone || '',
    email: student?.email || '',
    contactName: student?.contact_name || '',
    contactPhone: student?.contact_phone || '',
    assignedInstructorId: student?.assigned_instructor_id || '',
    defaultService: student?.default_service || '',
    defaultDayOfWeek: student?.default_day_of_week || null,
    defaultSessionTime: normalizeTimeValue(student?.default_session_time),
    notes: student?.notes || '',
    tagId: Array.isArray(student?.tags) && student.tags.length > 0 ? student.tags[0] : '',
    isActive: student?.is_active !== false,
  };
}
