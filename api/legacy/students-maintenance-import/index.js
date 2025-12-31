/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
  UUID_PATTERN,
} from '../_shared/org-bff.js';
import {
  coerceBooleanFlag,
  coerceDayOfWeek,
  coerceNationalId,
  coerceOptionalText,
  coerceSessionTime,
  coerceTags,
  validateIsraeliPhone,
} from '../_shared/student-validation.js';
import { parseCsv } from '../_shared/csv.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

const ID_COLUMN_CANDIDATES = ['system_uuid', 'student_id', 'id', 'מזהה מערכת (uuid)', 'מזהה מערכת'];
const IGNORED_COLUMNS = ['extraction_reason', 'סיבת ייצוא']; // Columns to skip during import
const CLEAR_SENTINEL = 'CLEAR'; // Special value to explicitly clear optional fields
const MAX_ROWS = 2000;

function normalizeTagsForCsv(raw) {
  if (typeof raw !== 'string') {
    return raw;
  }
  return raw.replace(/[;|]/g, ',');
}

function normalizeTimeForComparison(time) {
  if (!time) return null;
  if (typeof time !== 'string') return time;
  
  // Normalize time format for comparison: extract HH:MM without timezone
  // Handles: "16:30:00", "16:30:00+00", "16:30:00Z", "16:30", etc.
  const timeOnly = time.split('+')[0].split('Z')[0];
  const parts = timeOnly.split(':');
  
  // Return HH:MM format (with leading zeros)
  if (parts.length >= 2) {
    const hours = parts[0].padStart(2, '0');
    const minutes = parts[1].padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  
  return time;
}

function addIfChanged(updates, key, newValue, existingValue) {
  const current = existingValue === undefined || existingValue === null ? null : existingValue;
  const desired = newValue === undefined || newValue === null ? null : newValue;
  
  // For time fields, normalize both sides before comparison
  let currentCompare = current;
  let desiredCompare = desired;
  if (key === 'default_session_time') {
    currentCompare = normalizeTimeForComparison(current);
    desiredCompare = normalizeTimeForComparison(desired);
  }
  
  if (JSON.stringify(currentCompare) !== JSON.stringify(desiredCompare)) {
    updates[key] = newValue;
  }
}

function shouldClearField(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim().toUpperCase();
  return trimmed === CLEAR_SENTINEL || trimmed === '-';
}

function isEmptyCell(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function formatFailure({ lineNumber, studentId, name, code, message }) {
  return {
    line_number: lineNumber,
    student_id: studentId,
    name,
    code,
    message,
  };
}

export default async function handler(context, req) {
  const env = readEnv(context);
  const supabaseAdminConfig = readSupabaseAdminConfig(env);

  if (!supabaseAdminConfig.supabaseUrl || !supabaseAdminConfig.serviceRoleKey) {
    context.log?.error?.('students-maintenance-import missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(supabaseAdminConfig);

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer token' });
  }

  const authResult = await supabase.auth.getUser(authorization.token);
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  const csvText = normalizeString(body?.csv_text);
  if (!csvText) {
    return respond(context, 400, { message: 'missing_csv' });
  }

  // Support dry-run mode for preview
  const dryRun = body?.dry_run === true;
  const excludedIds = Array.isArray(body?.excluded_ids) ? body.excluded_ids : [];

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('students-maintenance-import failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const parsed = parseCsv(csvText);
  if (!parsed.columns.length || !parsed.rows.length) {
    return respond(context, 400, { message: 'empty_csv' });
  }

  if (parsed.rows.length > MAX_ROWS) {
    return respond(context, 400, { message: 'too_many_rows', limit: MAX_ROWS });
  }

  // Optional tag mappings: { "unmatched_tag_name": "target_tag_id" }
  // We parse first, then validate against catalog after it's loaded.
  const tagMappings = new Map();
  if (body?.tag_mappings && typeof body.tag_mappings === 'object') {
    for (const [unmatchedName, targetTagId] of Object.entries(body.tag_mappings)) {
      if (typeof targetTagId === 'string' && UUID_PATTERN.test(targetTagId)) {
        const normalized = normalizeString(unmatchedName);
        if (normalized) {
          tagMappings.set(normalized.toLowerCase(), targetTagId);
        }
      }
    }
  }

  const idColumn = parsed.columns.find((col) => ID_COLUMN_CANDIDATES.includes(col.toLowerCase()));
  if (!idColumn) {
    return respond(context, 400, { message: 'missing_id_column' });
  }

  // Validate column names - detect unrecognized columns to help users catch typos
  const COLUMN_MAPPING = {
    // UUID columns
    'system_uuid': 'מזהה מערכת',
    'student_id': 'מזהה מערכת',
    'id': 'מזהה מערכת',
    'מזהה מערכת (uuid)': 'מזהה מערכת',
    'מזהה מערכת': 'מזהה מערכת',
    // Name
    'name': 'שם התלמיד',
    'student_name': 'שם התלמיד',
    'שם התלמיד': 'שם התלמיד',
    // National ID
    'national_id': 'מספר זהות',
    'nationalid': 'מספר זהות',
    'מספר זהות': 'מספר זהות',
    // Contact name
    'contact_name': 'שם איש קשר',
    'contactname': 'שם איש קשר',
    'שם איש קשר': 'שם איש קשר',
    // Contact phone
    'contact_phone': 'טלפון',
    'contactphone': 'טלפון',
    'טלפון': 'טלפון',
    // Instructor
    'assigned_instructor_name': 'שם מדריך',
    'assigned_instructor': 'שם מדריך',
    'instructor_name': 'שם מדריך',
    'instructor': 'שם מדריך',
    'שם מדריך': 'שם מדריך',
    // Service
    'default_service': 'שירות ברירת מחדל',
    'service': 'שירות ברירת מחדל',
    'שירות ברירת מחדל': 'שירות ברירת מחדל',
    // Day
    'default_day_of_week': 'יום ברירת מחדל',
    'day': 'יום ברירת מחדל',
    'יום ברירת מחדל': 'יום ברירת מחדל',
    // Time
    'default_session_time': 'שעת מפגש ברירת מחדל',
    'session_time': 'שעת מפגש ברירת מחדל',
    'sessiontime': 'שעת מפגש ברירת מחדל',
    'שעת מפגש ברירת מחדל': 'שעת מפגש ברירת מחדל',
    // Notes
    'notes': 'הערות',
    'הערות': 'הערות',
    // Tags
    'tags': 'תגיות',
    'tag_ids': 'תגיות',
    'תגיות': 'תגיות',
    // Active status
    'is_active': 'פעיל',
    'active': 'פעיל',
    'status': 'פעיל',
    'פעיל': 'פעיל',
    // Export metadata (can be safely ignored)
    'extraction_reason': null,
    'סיבת ייצוא': null,
  };

  const unrecognizedColumns = parsed.columns.filter(
    (col) => !Object.prototype.hasOwnProperty.call(COLUMN_MAPPING, col.toLowerCase())
  );

  if (unrecognizedColumns.length > 0) {
    // Get unique Hebrew names for all valid columns (excluding nulls and duplicates)
    const validHebrewNames = [...new Set(
      Object.values(COLUMN_MAPPING).filter(name => name !== null)
    )].sort();
    
    const invalidColumnsList = unrecognizedColumns.join(', ');
    const validColumnsList = validHebrewNames.join(', ');
    
    return respond(context, 400, {
      code: 'unrecognized_columns',
      message: `ערך "${invalidColumnsList}" אינו חוקי`,
      columns: unrecognizedColumns,
      hint: `ערכים חוקיים: ${validColumnsList}`,
    });
  }

  const stagedRows = parsed.rows.map((row, index) => ({
    lineNumber: index + 2, // account for header
    studentId: normalizeString(row[idColumn]),
    raw: row,
  }));

  const validIds = Array.from(new Set(stagedRows
    .map((entry) => entry.studentId)
    .filter((id) => id && UUID_PATTERN.test(id))));

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  // Fetch all instructors for name matching
  const { data: instructors, error: instructorsError } = await tenantClient
    .from('Instructors')
    .select('id, name, email, is_active');

  if (instructorsError) {
    context.log?.error?.('students-maintenance-import failed to fetch instructors', { message: instructorsError.message, orgId });
    return respond(context, 500, { message: 'failed_to_fetch_instructors' });
  }

  // Create instructor lookup maps (by name and by ID)
  const instructorByName = new Map();
  const instructorById = new Map();
  const activeInstructorNames = [];

  for (const instructor of instructors || []) {
    if (!instructor?.id) continue;
    instructorById.set(instructor.id, instructor);
    
    const name = normalizeString(instructor.name) || normalizeString(instructor.email);
    if (name) {
      instructorByName.set(name.toLowerCase(), instructor);
      if (instructor.is_active !== false) {
        activeInstructorNames.push(name);
      }
    }
  }

  // Fetch student tags for name-to-ID lookup
  const { data: tagsSettings } = await tenantClient
    .from('Settings')
    .select('settings_value')
    .eq('key', 'student_tags')
    .maybeSingle();

  const tagByName = new Map();
  const tagById = new Map();
  if (tagsSettings?.settings_value) {
    const tags = Array.isArray(tagsSettings.settings_value) ? tagsSettings.settings_value : [];
    for (const tag of tags) {
      if (tag?.id && tag?.name) {
        tagById.set(tag.id, tag);
        tagByName.set(normalizeString(tag.name).toLowerCase(), tag.id);
      }
    }
  }

  // Validate tag mappings against catalog to prevent typos from persisting unknown IDs
  if (tagMappings.size > 0) {
    const invalidMappings = [];
    for (const [nameKey, targetTagId] of tagMappings.entries()) {
      if (!tagById.has(targetTagId)) {
        invalidMappings.push({ source: nameKey, target: targetTagId });
      }
    }
    if (invalidMappings.length > 0) {
      return respond(context, 400, {
        code: 'invalid_tag_mappings',
        message: 'Mappings must point to existing tags.',
        invalid_mappings: invalidMappings,
        available_tags: Array.from(tagById.values()).map(tag => ({ id: tag.id, name: tag.name })),
      });
    }
  }

  let existingStudents = [];
  if (validIds.length > 0) {
    const { data, error: fetchError } = await tenantClient
      .from('Students')
      .select('*')
      .in('id', validIds);

    if (fetchError) {
      context.log?.error?.('students-maintenance-import failed to fetch students', { message: fetchError.message, orgId });
      return respond(context, 500, { message: 'failed_to_fetch_students' });
    }

    existingStudents = data || [];
  }

  const existingMap = new Map();
  for (const student of existingStudents || []) {
    if (student?.id) {
      existingMap.set(student.id, student);
    }
  }

  // First pass: collect all unmatched tag names across all rows
  const unmatchedTags = new Set();
  for (const entry of stagedRows) {
    const { raw } = entry;
    const tagsInput = normalizeTagsForCsv(raw?.tags ?? raw?.Tags ?? raw?.['תגיות']);
    const tags = coerceTags(tagsInput);
    if (tags.valid && tags.value) {
      for (const tagName of tags.value) {
        const tagId = tagByName.get(normalizeString(tagName).toLowerCase());
        if (!tagId) {
          unmatchedTags.add(tagName);
        }
      }
    }
  }

  // If there are unmatched tags, return them for user mapping
  if (unmatchedTags.size > 0) {
    return respond(context, 400, {
      code: 'unmatched_tags',
      message: 'חלק מהתוויות בקובץ CSV לא נמצאו בקטלוג. אנא מפה אותן לתוויות קיימות.',
      unmatched_tags: Array.from(unmatchedTags),
      available_tags: Array.from(tagById.values()).map(tag => ({ id: tag.id, name: tag.name })),
    });
  }

  const failures = [];
  const candidates = [];

  for (const entry of stagedRows) {
    const { lineNumber, studentId, raw } = entry;
    if (!studentId || !UUID_PATTERN.test(studentId)) {
      failures.push(formatFailure({
        lineNumber,
        studentId,
        name: normalizeString(raw?.name) || '',
        code: 'invalid_student_id',
        message: 'שורת ה-CSV חסרה מזהה תלמיד חוקי.',
      }));
      continue;
    }

    const existing = existingMap.get(studentId);
    if (!existing) {
      failures.push(formatFailure({
        lineNumber,
        studentId,
        name: normalizeString(raw?.name) || '',
        code: 'student_not_found',
        message: 'התלמיד לא נמצא במערכת.',
      }));
      continue;
    }

    const updates = {};
    const displayName = normalizeString(raw?.name ?? raw?.['שם התלמיד']) || existing.name || '';

    const name = normalizeString(raw?.name ?? raw?.['שם התלמיד']);
    if (name) {
      addIfChanged(updates, 'name', name, existing.name);
    }

    const nationalIdRaw = raw?.national_id ?? raw?.NationalId ?? raw?.nationalId ?? raw?.['מספר זהות'];
    const national = coerceNationalId(nationalIdRaw);
    if (national.provided) {
      if (!national.valid) {
        failures.push(formatFailure({
          lineNumber,
          studentId,
          name: displayName,
          code: 'invalid_national_id',
          message: `ערך "${nationalIdRaw}" אינו חוקי עבור מספר זהות. יש להזין 5-12 ספרות.`,
        }));
        continue;
      }
      addIfChanged(updates, 'national_id', national.value, existing.national_id);
    }

    const contactNameRaw = raw?.contact_name ?? raw?.ContactName ?? raw?.contactName ?? raw?.['שם איש קשר'];
    if (!isEmptyCell(contactNameRaw)) {
      if (shouldClearField(contactNameRaw)) {
        addIfChanged(updates, 'contact_name', null, existing.contact_name);
      } else {
        const contactName = coerceOptionalText(contactNameRaw);
        if (contactName.valid && contactName.value !== undefined && contactName.value !== null) {
          addIfChanged(updates, 'contact_name', contactName.value, existing.contact_name);
        }
      }
    }

    const phoneRaw = raw?.contact_phone ?? raw?.phone ?? raw?.contactPhone ?? raw?.['טלפון'];
    const phoneCheck = validateIsraeliPhone(phoneRaw);
    if (!phoneCheck.valid) {
      failures.push(formatFailure({
        lineNumber,
        studentId,
        name: displayName,
        code: 'invalid_contact_phone',
        message: `ערך "${phoneRaw}" אינו חוקי עבור טלפון. דוגמה: 050-1234567 או 0501234567`,
      }));
      continue;
    }
    if (phoneCheck.value !== undefined && phoneCheck.value !== null) {
      addIfChanged(updates, 'contact_phone', phoneCheck.value, existing.contact_phone);
    }

    // Support both instructor UUID and instructor name
    const instructorInput = normalizeString(raw?.assigned_instructor_name ?? raw?.assigned_instructor_id ?? raw?.instructor_id ?? raw?.assignedInstructorId ?? raw?.instructor_name ?? raw?.instructorName ?? raw?.['שם מדריך']);
    
    if (instructorInput) {
      let instructorId = null;
      
      // Try UUID first
      if (UUID_PATTERN.test(instructorInput)) {
        const instructor = instructorById.get(instructorInput);
        if (instructor) {
          instructorId = instructorInput;
        } else {
          failures.push(formatFailure({
            lineNumber,
            studentId,
            name: displayName,
            code: 'instructor_not_found',
            message: `מדריך עם מזהה "${instructorInput}" לא נמצא במערכת.`,
          }));
          continue;
        }
      } else {
        // Try name matching
        const instructor = instructorByName.get(instructorInput.toLowerCase());
        if (instructor) {
          instructorId = instructor.id;
          if (instructor.is_active === false) {
            failures.push(formatFailure({
              lineNumber,
              studentId,
              name: displayName,
              code: 'instructor_inactive',
              message: `המדריך "${instructorInput}" אינו פעיל. מדריכים פעילים: ${activeInstructorNames.slice(0, 5).join(', ')}${activeInstructorNames.length > 5 ? '...' : ''}`,
            }));
            continue;
          }
        } else {
          // Name not found - provide helpful error with available names
          const availableNames = activeInstructorNames.slice(0, 5).join(', ');
          failures.push(formatFailure({
            lineNumber,
            studentId,
            name: displayName,
            code: 'instructor_name_not_found',
            message: `מדריך בשם "${instructorInput}" לא נמצא. מדריכים זמינים: ${availableNames}${activeInstructorNames.length > 5 ? ' ועוד...' : ''}`,
          }));
          continue;
        }
      }
      
      if (instructorId !== undefined) {
        addIfChanged(updates, 'assigned_instructor_id', instructorId, existing.assigned_instructor_id);
      }
    }

    const defaultServiceRaw = raw?.default_service ?? raw?.service ?? raw?.['שירות ברירת מחדל'];
    if (!isEmptyCell(defaultServiceRaw)) {
      if (shouldClearField(defaultServiceRaw)) {
        addIfChanged(updates, 'default_service', null, existing.default_service);
      } else {
        const defaultService = coerceOptionalText(defaultServiceRaw);
        if (defaultService.valid && defaultService.value !== undefined) {
          addIfChanged(updates, 'default_service', defaultService.value, existing.default_service);
        }
      }
    }

    const dayRaw = raw?.default_day_of_week ?? raw?.day ?? raw?.['יום ברירת מחדל'];
    const defaultDay = coerceDayOfWeek(dayRaw);
    if (!defaultDay.valid) {
      failures.push(formatFailure({
        lineNumber,
        studentId,
        name: displayName,
        code: 'invalid_default_day',
        message: `ערך "${dayRaw}" אינו חוקי עבור יום. ערכים חוקיים: ראשון, שני, שלישי, רביעי, חמישי, שישי, שבת (או 1-7)`,
      }));
      continue;
    }
    if (defaultDay.value !== undefined && defaultDay.value !== null) {
      addIfChanged(updates, 'default_day_of_week', defaultDay.value, existing.default_day_of_week);
    }

    const timeRaw = raw?.default_session_time ?? raw?.session_time ?? raw?.sessionTime ?? raw?.['שעת מפגש ברירת מחדל'];
    const defaultTime = coerceSessionTime(timeRaw);
    if (!defaultTime.valid) {
      failures.push(formatFailure({
        lineNumber,
        studentId,
        name: displayName,
        code: 'invalid_default_session_time',
        message: `ערך "${timeRaw}" אינו חוקי עבור שעה. דוגמה: 15:30 או 09:00`,
      }));
      continue;
    }
    if (defaultTime.value !== undefined && defaultTime.value !== null) {
      addIfChanged(updates, 'default_session_time', defaultTime.value, existing.default_session_time);
    }

    const notesRaw = raw?.notes ?? raw?.Notes ?? raw?.['הערות'];
    if (!isEmptyCell(notesRaw)) {
      if (shouldClearField(notesRaw)) {
        addIfChanged(updates, 'notes', null, existing.notes);
      } else {
        const notes = coerceOptionalText(notesRaw);
        if (notes.valid && notes.value !== undefined) {
          addIfChanged(updates, 'notes', notes.value, existing.notes);
        }
      }
    }

    const tagsRaw = raw?.tags ?? raw?.tag_ids ?? raw?.Tags ?? raw?.['תגיות'];
    const tagsInput = normalizeTagsForCsv(tagsRaw);
    const tags = coerceTags(tagsInput);
    if (!tags.valid) {
      failures.push(formatFailure({
        lineNumber,
        studentId,
        name: displayName,
        code: 'invalid_tags',
        message: 'תוויות אינן חוקיות.',
      }));
      continue;
    }
    // Convert tag names to IDs using lookup map, with fallback to user mappings
    if (tags.value !== undefined && tags.value !== null) {
      const tagIds = tags.value
        .map((tagName) => {
          const normalizedName = normalizeString(tagName).toLowerCase();
          // Try direct lookup first
          return tagByName.get(normalizedName) || tagMappings.get(normalizedName) || null;
        })
        .filter(Boolean); // Filter out null values for unmatched tags
      if (tags.value.length > 0 && tagIds.length === 0) {
        // All provided tags were invalid
        failures.push(formatFailure({
          lineNumber,
          studentId,
          name: displayName,
          code: 'invalid_tags',
          message: 'אף תווית מסופקת לא נמצאה בקטלוג התוויות.',
        }));
        continue;
      }
      addIfChanged(updates, 'tags', tagIds.length ? tagIds : null, existing.tags);
    }

    const isActiveRaw = raw?.is_active ?? raw?.active ?? raw?.status ?? raw?.['פעיל'];
    const isActive = coerceBooleanFlag(isActiveRaw, { defaultValue: existing.is_active, allowUndefined: true });
    if (!isActive.valid) {
      failures.push(formatFailure({
        lineNumber,
        studentId,
        name: displayName,
        code: 'invalid_is_active',
        message: `ערך "${isActiveRaw}" אינו חוקי עבור סטטוס. ערכים חוקיים: כן, לא, פעיל, לא פעיל, true, false, 1, 0`,
      }));
      continue;
    }
    if (isActive.provided) {
      addIfChanged(updates, 'is_active', isActive.value, existing.is_active);
    }

    const desiredNationalId = Object.prototype.hasOwnProperty.call(updates, 'national_id')
      ? updates.national_id
      : existing.national_id;
    candidates.push({
      lineNumber,
      studentId,
      displayName,
      updates,
      existing,
      desiredNationalId,
    });
  }

  const nationalConflicts = new Set();
  const nationalMap = new Map();
  for (const candidate of candidates) {
    if (!candidate.desiredNationalId) {
      continue;
    }
    const existing = nationalMap.get(candidate.desiredNationalId);
    if (existing && existing.studentId !== candidate.studentId) {
      nationalConflicts.add(candidate.studentId);
      nationalConflicts.add(existing.studentId);
    } else {
      nationalMap.set(candidate.desiredNationalId, candidate);
    }
  }

  if (nationalConflicts.size > 0) {
    for (const candidate of candidates) {
      if (nationalConflicts.has(candidate.studentId)) {
        failures.push(formatFailure({
          lineNumber: candidate.lineNumber,
          studentId: candidate.studentId,
          name: candidate.displayName,
          code: 'duplicate_national_id_in_file',
          message: 'קיימת התנגשות תעודת זהות בקובץ הייבוא.',
        }));
      }
    }
  }

  const filteredCandidates = candidates.filter((candidate) => !nationalConflicts.has(candidate.studentId));
  const nationalIdsToCheck = Array.from(new Set(
    filteredCandidates
      .filter((candidate) => candidate.desiredNationalId && candidate.desiredNationalId !== candidate.existing.national_id)
      .map((candidate) => candidate.desiredNationalId),
  ));

  if (nationalIdsToCheck.length) {
    const { data: conflicts, error: nationalLookupError } = await tenantClient
      .from('Students')
      .select('id, name, national_id')
      .in('national_id', nationalIdsToCheck);

    if (nationalLookupError) {
      context.log?.error?.('students-maintenance-import failed to validate national ids', { message: nationalLookupError.message, orgId });
      return respond(context, 500, { message: 'failed_to_validate_national_id' });
    }

    const conflictMap = new Map();
    for (const conflict of conflicts || []) {
      if (conflict?.national_id) {
        conflictMap.set(conflict.national_id, conflict);
      }
    }

    for (const candidate of filteredCandidates) {
      if (!candidate.desiredNationalId) continue;
      const conflict = conflictMap.get(candidate.desiredNationalId);
      if (conflict && conflict.id !== candidate.studentId) {
        failures.push(formatFailure({
          lineNumber: candidate.lineNumber,
          studentId: candidate.studentId,
          name: candidate.displayName,
          code: 'duplicate_national_id',
          message: 'תעודת הזהות כבר קיימת אצל תלמיד אחר.',
        }));
      }
    }
  }

  const blockedIds = new Set(failures.map((failure) => failure.student_id));
  let actionableCandidates = filteredCandidates.filter((candidate) => !blockedIds.has(candidate.studentId));

  // In dry-run mode, return preview without applying changes
  if (dryRun) {
    const previews = actionableCandidates.map((candidate) => {
      const { updates, studentId, displayName, existing, lineNumber } = candidate;
      const changes = {};
      
      for (const [field, newValue] of Object.entries(updates || {})) {
        changes[field] = {
          old: existing[field],
          new: newValue,
        };
      }
      
      return {
        student_id: studentId,
        name: displayName,
        line_number: lineNumber,
        changes,
        has_changes: Object.keys(changes).length > 0,
      };
    });
    
    return respond(context, 200, {
      dry_run: true,
      total_rows: stagedRows.length,
      preview_count: previews.length,
      failed_count: failures.length,
      previews,
      failed: failures,
    });
  }

  // Filter out excluded IDs if provided (user deselected some changes)
  if (excludedIds.length > 0) {
    const excludedSet = new Set(excludedIds);
    actionableCandidates = actionableCandidates.filter((candidate) => !excludedSet.has(candidate.studentId));
  }

  const successes = [];
  for (const candidate of actionableCandidates) {
    const { updates, studentId, displayName, existing } = candidate;
    if (!updates || Object.keys(updates).length === 0) {
      // Skip students with no actual changes (don't count as success)
      continue;
    }

    const updatedMetadata = {
      ...(existing.metadata || {}),
      updated_by: userId,
      updated_at: new Date().toISOString(),
      updated_role: role,
    };

    const payload = { ...updates, metadata: updatedMetadata };

    const { error: updateError } = await tenantClient
      .from('Students')
      .update(payload)
      .eq('id', studentId);

    if (updateError) {
      failures.push(formatFailure({
        lineNumber: candidate.lineNumber,
        studentId,
        name: displayName,
        code: 'update_failed',
        message: 'עדכון התלמיד נכשל.',
      }));
      continue;
    }

    successes.push({
      student_id: studentId,
      name: displayName,
      changed_fields: Object.keys(updates),
    });
  }

  // Log bulk update to audit log
  if (successes.length > 0) {
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email,
      userRole: role,
      actionType: AUDIT_ACTIONS.STUDENTS_BULK_UPDATE,
      actionCategory: AUDIT_CATEGORIES.STUDENTS,
      resourceType: 'students_bulk',
      resourceId: orgId,
      details: {
        total_rows: stagedRows.length,
        updated_count: successes.length,
        failed_count: failures.length,
        updated_students: successes.map(s => ({ id: s.student_id, name: s.name, fields: s.changed_fields })),
      },
    });
  }

  return respond(context, 200, {
    total_rows: stagedRows.length,
    updated_count: successes.length,
    failed_count: failures.length,
    updated: successes,
    failed: failures,
  });
}
