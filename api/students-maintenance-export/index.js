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
  resolveTenantClient,
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
  1: 'ראשון',
  2: 'שני',
  3: 'שלישי',
  4: 'רביעי',
  5: 'חמישי',
  6: 'שישי',
  7: 'שבת',
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
    return respond(context, 401, { message: 'missing bearer token' });
  }

  const authResult = await supabase.auth.getUser(authorization.token);
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(null);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
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

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const { data: students, error: studentsError } = await tenantClient
    .from('Students')
    .select(
      'id, name, national_id, contact_name, contact_phone, assigned_instructor_id, default_service, default_day_of_week, default_session_time, notes, tags, is_active',
    )
    .order('name', { ascending: true });

  if (studentsError) {
    context.log?.error?.('students-maintenance-export failed to fetch students', { message: studentsError.message, orgId });
    return respond(context, 500, { message: 'failed_to_fetch_students' });
  }

  context.log?.info?.('Fetched students', {
    orgId,
    count: students?.length,
    isArray: Array.isArray(students),
    firstStudent: students?.[0] ? Object.keys(students[0]) : null,
  });

  const { data: instructors, error: instructorsError } = await tenantClient
    .from('Instructors')
    .select('id, name, email, is_active');

  if (instructorsError) {
    context.log?.error?.('students-maintenance-export failed to fetch instructors', { message: instructorsError.message, orgId });
    return respond(context, 500, { message: 'failed_to_fetch_instructors' });
  }

  // Fetch student tags for name lookup
  const { data: tagsSettings } = await tenantClient
    .from('Settings')
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

  let filteredStudents = students;

  // Apply filter if specified
  if (filter === 'problematic' && Array.isArray(students)) {
    const activeInstructorIds = new Set(
      instructors.filter(i => i.is_active !== false).map(i => i.id)
    );
    
    // Build schedule conflict detection map: instructor_id -> day_of_week -> time -> [student_ids]
    const scheduleMap = new Map();
    for (const student of students) {
      // Only count active students for schedule conflicts
      if (student.is_active === false ||
          !student.assigned_instructor_id || 
          student.default_day_of_week == null || 
          !student.default_session_time) {
        continue;
      }
      
      const instructorId = student.assigned_instructor_id;
      const day = student.default_day_of_week;
      const time = student.default_session_time;
      
      if (!scheduleMap.has(instructorId)) {
        scheduleMap.set(instructorId, new Map());
      }
      const instructorSchedule = scheduleMap.get(instructorId);
      
      if (!instructorSchedule.has(day)) {
        instructorSchedule.set(day, new Map());
      }
      const daySchedule = instructorSchedule.get(day);
      
      if (!daySchedule.has(time)) {
        daySchedule.set(time, []);
      }
      daySchedule.get(time).push(student.id);
    }
    
    // Find students with schedule conflicts (same instructor, day, and time)
    const studentsWithConflicts = new Set();
    const conflictReasons = new Map(); // student_id -> reason
    for (const instructorSchedule of scheduleMap.values()) {
      for (const daySchedule of instructorSchedule.values()) {
        for (const studentIds of daySchedule.values()) {
          if (studentIds.length > 1) {
            // Multiple students scheduled at same time with same instructor
            for (const studentId of studentIds) {
              studentsWithConflicts.add(studentId);
              conflictReasons.set(studentId, 'התנגשות בלוח זמנים');
            }
          }
        }
      }
    }
    
    // Build reasons map for all problematic students
    const problemReasons = new Map();
    
    filteredStudents = students.filter(student => {
      const reasons = [];
      
      // Missing national ID
      if (!student.national_id) {
        reasons.push('חסר תעודת זהות');
      }
      
      // Inactive or missing instructor
      if (!student.assigned_instructor_id) {
        reasons.push('חסר מדריך');
      } else if (!activeInstructorIds.has(student.assigned_instructor_id)) {
        reasons.push('מדריך לא פעיל');
      }
      
      // Schedule conflict with another student
      if (studentsWithConflicts.has(student.id)) {
        reasons.push('התנגשות בלוח זמנים');
      }
      
      if (reasons.length > 0) {
        problemReasons.set(student.id, reasons.join(', '));
        return true;
      }
      
      return false;
    });
    
    // Store problem reasons for later use in row mapping
    filteredStudents.problemReasons = problemReasons;
  } else if (filter === 'custom' && Array.isArray(students)) {
    const filterReasons = new Map();
    
    filteredStudents = students.filter(student => {
      const reasons = [];
      
      // Filter by instructor
      if (instructorIds.length > 0 && !instructorIds.includes(student.assigned_instructor_id)) {
        return false;
      }
      if (instructorIds.length > 0) {
        const instructorName = instructorLookup.get(student.assigned_instructor_id) || 'מדריך לא ידוע';
        reasons.push(`מדריך: ${instructorName}`);
      }
      
      // Filter by tags (student must have at least one matching tag)
      if (tagIds.length > 0) {
        const studentTags = Array.isArray(student.tags) ? student.tags : [];
        const matchingTags = tagIds.filter(tagId => studentTags.includes(tagId));
        if (matchingTags.length === 0) return false;
        
        const tagNames = matchingTags.map(tagId => tagLookup.get(tagId) || tagId).join(', ');
        reasons.push(`תגית: ${tagNames}`);
      }
      
      // Filter by day
      if (dayFilter != null && student.default_day_of_week !== dayFilter) {
        return false;
      }
      if (dayFilter != null) {
        const dayName = DAYS_OF_WEEK_HEBREW[dayFilter] || dayFilter;
        reasons.push(`יום: ${dayName}`);
      }
      
      if (reasons.length > 0) {
        filterReasons.set(student.id, reasons.join(', '));
      }
      
      return true;
    });
    
    // Store filter reasons for later use in row mapping
    filteredStudents.filterReasons = filterReasons;
  }

  const rows = Array.isArray(filteredStudents)
    ? filteredStudents.map((student) => {
        const tagIds = Array.isArray(student?.tags) ? student.tags.filter(Boolean) : [];
        // Convert tag IDs to tag names using lookup map
        const tags = tagIds.map(tagId => tagLookup.get(tagId) || tagId);
        
        // Determine extraction reason based on filter type
        let extractionReason = '';
        if (filter === 'problematic' && filteredStudents.problemReasons) {
          extractionReason = filteredStudents.problemReasons.get(student.id) || '';
        } else if (filter === 'custom' && filteredStudents.filterReasons) {
          extractionReason = filteredStudents.filterReasons.get(student.id) || '';
        }
        // For 'all' exports, leave extraction_reason empty
        
        // Format phone number with leading zero
        // Prefix with = to force Excel to treat as text and preserve leading zero
        let phoneNumber = student.contact_phone || '';
        if (phoneNumber && !phoneNumber.startsWith('0') && phoneNumber.length === 9) {
          phoneNumber = '0' + phoneNumber;
        }
        // Add ="..." to force text format in Excel
        if (phoneNumber) {
          phoneNumber = `="${phoneNumber}"`;
        }
        
        // Format time (remove timezone, show HH:MM)
        let sessionTime = student.default_session_time || '';
        if (sessionTime) {
          // Handle formats like "16:00:00+00" or "16:00:00"
          sessionTime = sessionTime.split('+')[0].split(':').slice(0, 2).join(':');
        }
        
        // Convert day number to Hebrew day name
        const dayOfWeek = student.default_day_of_week != null
          ? DAYS_OF_WEEK_HEBREW[student.default_day_of_week] || ''
          : '';
        
        return {
          extraction_reason: extractionReason,
          system_uuid: student.id || '',
          name: student.name || '',
          national_id: student.national_id || '',
          contact_name: student.contact_name || '',
          contact_phone: phoneNumber,
          assigned_instructor_name: instructorLookup.get(student.assigned_instructor_id) || '',
          default_service: student.default_service || '',
          default_day_of_week: dayOfWeek,
          default_session_time: sessionTime,
          notes: student.notes || '',
          tags: tags.join('; '),
          is_active: student.is_active === false ? 'לא' : 'כן',
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