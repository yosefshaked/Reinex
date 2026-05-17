/* eslint-env node */
import Papa from 'papaparse';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  readEnv,
  parseRequestBody,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';

const EXPORT_COLUMNS = [
  'extraction_reason',
  'name',
  'national_id',
  'contact_name',
  'contact_phone',
  'assigned_instructor_name',
  'default_service',
  'default_day_of_week',
  'default_session_time',
  'notes',
  'tags',
  'is_active',
  'system_uuid',
];

const HEBREW_HEADERS = {
  'extraction_reason': 'סיבת ייצוא',
  'system_uuid': 'מזהה מערכת (UUID)',
  'name': 'שם התלמיד',
  'national_id': 'מספר זהות',
  'contact_name': 'שם איש קשר',
  'contact_phone': 'טלפון',
  'assigned_instructor_name': 'שם מדריך',
  'default_service': 'שירות ברירת מחדל',
  'default_day_of_week': 'יום ברירת מחדל',
  'default_session_time': 'שעת מפגש ברירת מחדל',
  'notes': 'הערות',
  'tags': 'תגיות',
  'is_active': 'פעיל',
};

const DAYS_OF_WEEK_HEBREW = {
  sunday: 'ראשון',
  monday: 'שני',
  tuesday: 'שלישי',
  wednesday: 'רביעי',
  thursday: 'חמישי',
  friday: 'שישי',
  saturday: 'שבת',
};

export default async function handler(context, req) {
  const env = readEnv(context);
  const supabaseAdminConfig = readSupabaseAdminConfig(env);

  if (!supabaseAdminConfig.supabaseUrl || !supabaseAdminConfig.serviceRoleKey) {
    context.log?.error?.('students-maintenance-export missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(supabaseAdminConfig);

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const authResult = await supabase.auth.getUser(authorization.token).catch((authError) => {
    context.log?.error?.('students-maintenance-export failed to validate token', { message: authError?.message });
    return { error: authError, data: null };
  });
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(null);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  // Get filter parameter
  const filter = req.query?.filter || null;
  
  // Get custom filter parameters
  const instructorIds = req.query?.instructors?.split(',').filter(Boolean) || [];
  const tagIds = req.query?.tags?.split(',').filter(Boolean) || [];
  const dayFilter = req.query?.day != null ? parseInt(req.query.day, 10) : null;

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('students-maintenance-export failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { data: students, error: studentsError } = await withOrgScope(supabase, 'students', orgId)
    .select(
      'id, notes_internal, client_profile_id, client_profiles!client_profile_id(first_name, middle_name, last_name, identity_number, is_active, tags)',
    )
    .order('first_name', { referencedTable: 'client_profiles', ascending: true });

  if (studentsError) {
    context.log?.error?.('students-maintenance-export failed to fetch students', { message: studentsError.message, orgId });
    return respond(context, 500, { message: 'failed_to_fetch_students' });
  }

  // Fetch active lesson templates via participants to get instructor/day/time per student
  const { data: ltpData } = await withOrgScope(supabase, 'lesson_template_participants', orgId)
    .select('student_id, lesson_templates!inner(instructor_employee_id, day_of_week, time_of_day, is_active)');

  const studentTemplateMap = new Map();
  for (const ltp of ltpData || []) {
    const template = ltp.lesson_templates;
    if (!template?.is_active) continue;
    if (!studentTemplateMap.has(ltp.student_id)) {
      studentTemplateMap.set(ltp.student_id, template);
    }
  }

  context.log?.info?.('Fetched students', {
    orgId,
    count: students?.length,
    isArray: Array.isArray(students),
    firstStudent: students?.[0] ? Object.keys(students[0]) : null,
  });

  const { data: instructors, error: instructorsError } = await withOrgScope(supabase, 'Employees', orgId)
    .select('id, name, email, is_active, employee_type')
    .or('employee_type.is.null,employee_type.eq.instructor');

  if (instructorsError) {
    context.log?.error?.('students-maintenance-export failed to fetch instructors', { message: instructorsError.message, orgId });
    return respond(context, 500, { message: 'failed_to_fetch_instructors' });
  }

  // Fetch student tags for name lookup
  const { data: tagsSettings } = await withOrgScope(supabase, 'Settings', orgId)
    .select('settings_value')
    .eq('key', 'student_tags')
    .maybeSingle();

  const tagLookup = new Map();
  if (tagsSettings?.settings_value) {
    const tags = Array.isArray(tagsSettings.settings_value) ? tagsSettings.settings_value : [];
    for (const tag of tags) {
      if (tag?.id && tag?.name) {
        tagLookup.set(tag.id, tag.name);
      }
    }
  }

  const instructorLookup = new Map();
  if (Array.isArray(instructors)) {
    for (const instructor of instructors) {
      const id = typeof instructor?.id === 'string' ? instructor.id : '';
      if (!id || instructorLookup.has(id)) continue;
      const name = normalizeString(instructor?.name) || normalizeString(instructor?.email) || id;
      instructorLookup.set(id, name);
    }
  }

  // Helper: extract resolved fields for a student from joined data
  function resolveStudent(student) {
    const profile = student.client_profiles || {};
    const template = studentTemplateMap.get(student.id) || {};
    return {
      id: student.id,
      notes_internal: student.notes_internal,
      first_name: profile.first_name,
      middle_name: profile.middle_name,
      last_name: profile.last_name,
      identity_number: profile.identity_number,
      is_active: profile.is_active,
      tags: profile.tags,
      assigned_instructor_id: template.instructor_employee_id,
      default_day_of_week: template.day_of_week,
      default_session_time: template.time_of_day,
    };
  }

  let filteredStudents = students;

  // Apply filter if specified
  if (filter === 'problematic' && Array.isArray(students)) {
    const activeInstructorIds = new Set(
      instructors.filter(i => i.is_active !== false).map(i => i.id)
    );

    // Build schedule conflict map using template data: instructor -> day -> time -> [student_ids]
    const scheduleMap = new Map();
    for (const student of students) {
      const s = resolveStudent(student);
      if (s.is_active === false || !s.assigned_instructor_id || !s.default_day_of_week || !s.default_session_time) continue;
      if (!scheduleMap.has(s.assigned_instructor_id)) scheduleMap.set(s.assigned_instructor_id, new Map());
      const byDay = scheduleMap.get(s.assigned_instructor_id);
      if (!byDay.has(s.default_day_of_week)) byDay.set(s.default_day_of_week, new Map());
      const byTime = byDay.get(s.default_day_of_week);
      if (!byTime.has(s.default_session_time)) byTime.set(s.default_session_time, []);
      byTime.get(s.default_session_time).push(s.id);
    }

    const studentsWithConflicts = new Set();
    for (const byDay of scheduleMap.values()) {
      for (const byTime of byDay.values()) {
        for (const ids of byTime.values()) {
          if (ids.length > 1) ids.forEach(id => studentsWithConflicts.add(id));
        }
      }
    }

    const problemReasons = new Map();
    filteredStudents = students.filter(student => {
      const s = resolveStudent(student);
      const reasons = [];
      if (!s.identity_number) reasons.push('חסר תעודת זהות');
      if (!s.assigned_instructor_id) reasons.push('חסר מדריך');
      else if (!activeInstructorIds.has(s.assigned_instructor_id)) reasons.push('מדריך לא פעיל');
      if (studentsWithConflicts.has(s.id)) reasons.push('התנגשות בלוח זמנים');
      if (reasons.length > 0) { problemReasons.set(s.id, reasons.join(', ')); return true; }
      return false;
    });
    filteredStudents.problemReasons = problemReasons;

  } else if (filter === 'custom' && Array.isArray(students)) {
    const filterReasons = new Map();
    filteredStudents = students.filter(student => {
      const s = resolveStudent(student);
      const reasons = [];
      if (instructorIds.length > 0 && !instructorIds.includes(s.assigned_instructor_id)) return false;
      if (instructorIds.length > 0) reasons.push(`מדריך: ${instructorLookup.get(s.assigned_instructor_id) || 'מדריך לא ידוע'}`);
      if (tagIds.length > 0) {
        const studentTags = Array.isArray(s.tags) ? s.tags : [];
        const matching = tagIds.filter(t => studentTags.includes(t));
        if (matching.length === 0) return false;
        reasons.push(`תגית: ${matching.map(t => tagLookup.get(t) || t).join(', ')}`);
      }
      if (dayFilter != null && s.default_day_of_week !== dayFilter) return false;
      if (dayFilter != null) reasons.push(`יום: ${DAYS_OF_WEEK_HEBREW[dayFilter] || dayFilter}`);
      if (reasons.length > 0) filterReasons.set(s.id, reasons.join(', '));
      return true;
    });
    filteredStudents.filterReasons = filterReasons;
  }

  const rows = Array.isArray(filteredStudents)
    ? filteredStudents.map((student) => {
        const s = resolveStudent(student);
        const tagIdList = Array.isArray(s.tags) ? s.tags.filter(Boolean) : [];
        const tags = tagIdList.map(tagId => tagLookup.get(tagId) || tagId);

        let extractionReason = '';
        if (filter === 'problematic' && filteredStudents.problemReasons) {
          extractionReason = filteredStudents.problemReasons.get(s.id) || '';
        } else if (filter === 'custom' && filteredStudents.filterReasons) {
          extractionReason = filteredStudents.filterReasons.get(s.id) || '';
        }

        let sessionTime = s.default_session_time || '';
        if (sessionTime) sessionTime = sessionTime.split('+')[0].split(':').slice(0, 2).join(':');

        const dayOfWeek = s.default_day_of_week ? (DAYS_OF_WEEK_HEBREW[s.default_day_of_week] || '') : '';
        const fullName = [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ');

        return {
          extraction_reason: extractionReason,
          system_uuid: s.id || '',
          name: fullName,
          national_id: s.identity_number || '',
          contact_name: '',
          contact_phone: '',
          assigned_instructor_name: instructorLookup.get(s.assigned_instructor_id) || '',
          default_service: '',
          default_day_of_week: dayOfWeek,
          default_session_time: sessionTime,
          notes: s.notes_internal || '',
          tags: tags.join('; '),
          is_active: s.is_active === false ? 'לא' : 'כן',
        };
      })
    : [];

  context.log?.info?.('Processed rows', {
    rowsCount: rows.length,
  });

  // Map to Hebrew headers BEFORE unparsing to ensure consistency
  const hebrewRows = rows.map(row => {
    const newRow = {};
    EXPORT_COLUMNS.forEach(col => {
      // Use mapped Hebrew header or fallback to English key
      const header = HEBREW_HEADERS[col] || col;
      newRow[header] = row[col];
    });
    return newRow;
  });

  context.log?.info?.('Mapped to Hebrew headers', {
    hebrewRowsCount: hebrewRows.length,
  });

  // Use papaparse to generate CSV
  // quotes: true forces quoting all fields, which helps Excel parse correctly
  const csvContent = Papa.unparse(hebrewRows, {
    header: true,
    newline: '\r\n', // Windows line endings for Excel
    quotes: true,
  });
  
  // Add UTF-8 BOM for proper Excel encoding of Hebrew characters
  const utf8Bom = '\uFEFF';
  const csvWithBom = utf8Bom + csvContent;
  
  // Convert to Buffer to ensure proper UTF-8 encoding
  const buffer = Buffer.from(csvWithBom, 'utf8');

  context.log?.info?.('Generated CSV export', {
    orgId,
    rowCount: hebrewRows.length,
    bufferLength: buffer.length,
    contentType: 'text/csv; charset=utf-8',
  });

  const response = {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="student-data-maintenance.csv"',
    },
    body: buffer,
    isRaw: true,
  };
  
  context.res = response;
  return response;
}