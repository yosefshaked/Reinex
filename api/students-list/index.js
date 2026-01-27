/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminRole,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import {
  coerceBooleanFlag,
  coerceDayOfWeek,
  coerceIdentityNumber,
  coerceOptionalText,
  coerceSessionTime,
  coerceTags,
  coerceEmail,
  validateAssignedInstructor,
  validateIsraeliPhone,
} from '../_shared/student-validation.js';

function extractStudentId(context, req, body) {
  const candidate =
    normalizeString(context?.bindingData?.studentId) ||
    normalizeString(body?.student_id) ||
    normalizeString(body?.studentId);

  if (candidate && UUID_PATTERN.test(candidate)) {
    return candidate;
  }
  return '';
}

async function findStudentByIdentityNumber(tenantClient, identityNumber, { excludeId } = {}) {
  if (!identityNumber) {
    return { data: null, error: null };
  }

  let query = tenantClient
    .from('students')
    .select('id, first_name, last_name, is_active, identity_number')
    .eq('identity_number', identityNumber)
    .limit(1);

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { data, error } = await query.maybeSingle();
  return { data, error };
}

// Removed splitFullName - users now provide first_name, middle_name, last_name directly

function buildStudentPayload(body) {
  const firstName = normalizeString(body?.first_name ?? body?.firstName);
  const middleName = normalizeString(body?.middle_name ?? body?.middleName);
  const lastName = normalizeString(body?.last_name ?? body?.lastName);

  if (!firstName) {
    return { error: 'missing_first_name' };
  }
  if (!lastName) {
    return { error: 'missing_last_name' };
  }

  const phoneResult = validateIsraeliPhone(body?.phone);
  if (!phoneResult.valid) {
    return { error: 'invalid_phone' };
  }

  const emailResult = coerceEmail(body?.email);
  if (!emailResult.valid) {
    return { error: 'invalid_email' };
  }

  const rawInstructor = body?.assigned_instructor_id ?? body?.assignedInstructorId ?? null;
  const { value: instructorId, valid } = validateAssignedInstructor(rawInstructor);

  if (!valid) {
    return { error: 'invalid_assigned_instructor' };
  }

  const contactNameResult = coerceOptionalText(body?.contact_name ?? body?.contactName);
  if (!contactNameResult.valid) {
    return { error: 'invalid_contact_name' };
  }

  const contactPhoneResult = validateIsraeliPhone(body?.contact_phone ?? body?.contactPhone);
  if (!contactPhoneResult.valid) {
    return { error: 'invalid_contact_phone' };
  }

  const defaultServiceResult = coerceOptionalText(body?.default_service ?? body?.defaultService);
  if (!defaultServiceResult.valid) {
    return { error: 'invalid_default_service' };
  }

  const dayResult = coerceDayOfWeek(body?.default_day_of_week ?? body?.defaultDayOfWeek);
  if (!dayResult.valid) {
    return { error: 'invalid_default_day' };
  }

  const sessionTimeResult = coerceSessionTime(body?.default_session_time ?? body?.defaultSessionTime);
  if (!sessionTimeResult.valid) {
    return { error: 'invalid_default_session_time' };
  }

  const notesResult = coerceOptionalText(body?.notes);
  if (!notesResult.valid) {
    return { error: 'invalid_notes' };
  }

  const tagsResult = coerceTags(body?.tags);
  if (!tagsResult.valid) {
    return { error: 'invalid_tags' };
  }

  const isActiveResult = coerceBooleanFlag(body?.is_active ?? body?.isActive, { defaultValue: true });
  if (!isActiveResult.valid) {
    return { error: 'invalid_is_active' };
  }

  const isActiveValue = isActiveResult.provided ? Boolean(isActiveResult.value) : true;

  const identityCandidate = body?.identity_number ?? body?.identityNumber ?? body?.national_id ?? body?.nationalId;
  const identityNumberResult = coerceIdentityNumber(identityCandidate);
  if (!identityNumberResult.valid) {
    return { error: 'invalid_identity_number' };
  }

  // Identity number is required
  if (!identityNumberResult.value) {
    return { error: 'missing_identity_number' };
  }

  return {
    payload: {
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      identity_number: identityNumberResult.value,
      phone: phoneResult.value,
      email: emailResult.value,
      contact_name: contactNameResult.value,
      contact_phone: contactPhoneResult.value,
      assigned_instructor_id: instructorId,
      default_day_of_week: dayResult.value,
      default_session_time: sessionTimeResult.value,
      default_service: defaultServiceResult.value,
      notes: notesResult.value,
      tags: tagsResult.value,
      is_active: isActiveValue,
    },
  };
}

function buildStudentUpdates(body) {
  const updates = {};
  let hasAny = false;
  let intakeNotes;

  if (Object.prototype.hasOwnProperty.call(body, 'first_name') || Object.prototype.hasOwnProperty.call(body, 'firstName')) {
    const firstName = normalizeString(body.first_name ?? body.firstName);
    if (!firstName) {
      return { error: 'invalid_first_name' };
    }
    updates['first_name'] = firstName;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'middle_name') || Object.prototype.hasOwnProperty.call(body, 'middleName')) {
    const middleName = normalizeString(body.middle_name ?? body.middleName);
    updates['middle_name'] = middleName || null;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'last_name') || Object.prototype.hasOwnProperty.call(body, 'lastName')) {
    const lastName = normalizeString(body.last_name ?? body.lastName);
    if (!lastName) {
      return { error: 'invalid_last_name' };
    }
    updates['last_name'] = lastName;
    hasAny = true;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'assigned_instructor_id') ||
    Object.prototype.hasOwnProperty.call(body, 'assignedInstructorId')
  ) {
    const raw = Object.prototype.hasOwnProperty.call(body, 'assigned_instructor_id')
      ? body.assigned_instructor_id
      : body.assignedInstructorId;

    if (raw === null) {
      updates.assigned_instructor_id = null;
      hasAny = true;
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) {
        updates.assigned_instructor_id = null;
        hasAny = true;
      } else if (UUID_PATTERN.test(trimmed)) {
        updates.assigned_instructor_id = trimmed;
        hasAny = true;
      } else {
        return { error: 'invalid_assigned_instructor' };
      }
    } else {
      return { error: 'invalid_assigned_instructor' };
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'contact_name') || Object.prototype.hasOwnProperty.call(body, 'contactName')) {
    const { value, valid } = coerceOptionalText(
      Object.prototype.hasOwnProperty.call(body, 'contact_name') ? body.contact_name : body.contactName,
    );
    if (!valid) {
      return { error: 'invalid_contact_name' };
    }
    updates.contact_name = value;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'contact_phone') || Object.prototype.hasOwnProperty.call(body, 'contactPhone')) {
    const { value, valid } = validateIsraeliPhone(
      Object.prototype.hasOwnProperty.call(body, 'contact_phone') ? body.contact_phone : body.contactPhone,
    );
    if (!valid) {
      return { error: 'invalid_contact_phone' };
    }
    updates.contact_phone = value;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    const { value, valid } = validateIsraeliPhone(body.phone);
    if (!valid) {
      return { error: 'invalid_phone' };
    }
    updates.phone = value;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    const { value, valid } = coerceEmail(body.email);
    if (!valid) {
      return { error: 'invalid_email' };
    }
    updates.email = value;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'default_service') || Object.prototype.hasOwnProperty.call(body, 'defaultService')) {
    const { value, valid } = coerceOptionalText(
      Object.prototype.hasOwnProperty.call(body, 'default_service') ? body.default_service : body.defaultService,
    );
    if (!valid) {
      return { error: 'invalid_default_service' };
    }
    updates.default_service = value;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'default_day_of_week') || Object.prototype.hasOwnProperty.call(body, 'defaultDayOfWeek')) {
    const { value, valid } = coerceDayOfWeek(
      Object.prototype.hasOwnProperty.call(body, 'default_day_of_week') ? body.default_day_of_week : body.defaultDayOfWeek,
    );
    if (!valid) {
      return { error: 'invalid_default_day' };
    }
    updates.default_day_of_week = value;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'default_session_time') || Object.prototype.hasOwnProperty.call(body, 'defaultSessionTime')) {
    const { value, valid } = coerceSessionTime(
      Object.prototype.hasOwnProperty.call(body, 'default_session_time') ? body.default_session_time : body.defaultSessionTime,
    );
    if (!valid) {
      return { error: 'invalid_default_session_time' };
    }
    updates.default_session_time = value;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'tags')) {
    const { value, valid } = coerceTags(body.tags);
    if (!valid) {
      return { error: 'invalid_tags' };
    }
    updates.tags = value;
    hasAny = true;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'is_active') ||
    Object.prototype.hasOwnProperty.call(body, 'isActive')
  ) {
    const source = Object.prototype.hasOwnProperty.call(body, 'is_active') ? body.is_active : body.isActive;
    const { value, valid } = coerceBooleanFlag(source, { defaultValue: true, allowUndefined: false });
    if (!valid) {
      return { error: 'invalid_is_active' };
    }
    updates.is_active = Boolean(value);
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
    const { value, valid } = coerceOptionalText(body.notes);
    if (!valid) {
      return { error: 'invalid_notes' };
    }
    updates.notes = value;
    hasAny = true;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'intake_notes') ||
    Object.prototype.hasOwnProperty.call(body, 'intakeNotes')
  ) {
    const { value, valid } = coerceOptionalText(
      Object.prototype.hasOwnProperty.call(body, 'intake_notes') ? body.intake_notes : body.intakeNotes,
    );
    if (!valid) {
      return { error: 'invalid_notes' };
    }
    intakeNotes = value;
    hasAny = true;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'identity_number') ||
    Object.prototype.hasOwnProperty.call(body, 'identityNumber') ||
    Object.prototype.hasOwnProperty.call(body, 'national_id') ||
    Object.prototype.hasOwnProperty.call(body, 'nationalId')
  ) {
    const source =
      Object.prototype.hasOwnProperty.call(body, 'identity_number')
        ? body.identity_number
        : Object.prototype.hasOwnProperty.call(body, 'identityNumber')
          ? body.identityNumber
          : Object.prototype.hasOwnProperty.call(body, 'national_id')
            ? body.national_id
            : body.nationalId;

    const { value, valid } = coerceIdentityNumber(source);
    if (!valid) {
      return { error: 'invalid_identity_number' };
    }
    updates.identity_number = value;
    hasAny = true;
  }

  if (!hasAny) {
    return { error: 'missing_updates' };
  }

  return { updates, intakeNotes };
}

function determineStatusFilter(query, canViewInactive = true) {
  const status = normalizeString(query?.status);
  if (canViewInactive && status === 'inactive') {
    return 'inactive';
  }
  if (canViewInactive && status === 'all') {
    return 'all';
  }
  if (canViewInactive) {
    const includeInactive = query?.include_inactive ?? query?.includeInactive;
    const includeFlag = coerceBooleanFlag(includeInactive, { defaultValue: false, allowUndefined: true });
    if (includeFlag.valid && includeFlag.value) {
      return 'all';
    }
  }
  return 'active';
}

export default async function handler(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT'].includes(method)) {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET,POST,PUT' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('students-list missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('students-list missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('students-list failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET' ? parseRequestBody(null) : parseRequestBody(req);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('students-list failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const isAdmin = isAdminRole(role);

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  // GET: Fetch students list with role-based filtering
  if (method === 'GET') {
    let instructorsCanViewInactive = true; // Default for admins
    
    // Non-admin users need to check the setting
    if (!isAdmin) {
      try {
        const { data: settingRow, error: settingError } = await tenantClient
          .from('Settings')
          .select('settings_value')
          .eq('key', 'instructors_can_view_inactive_students')
          .maybeSingle();

        if (!settingError && settingRow && typeof settingRow.settings_value === 'boolean') {
          instructorsCanViewInactive = settingRow.settings_value === true;
        } else {
          instructorsCanViewInactive = false;
        }
      } catch (settingsError) {
        context.log?.warn?.('students-list failed to read inactive visibility setting', {
          message: settingsError?.message,
          orgId,
        });
        instructorsCanViewInactive = false;
      }
    }

    let builder = tenantClient
      .from('students')
      .select('*')
      .order('first_name', { ascending: true });

    // Non-admin users (instructors) can only see their assigned students
    if (!isAdmin) {
      builder = builder.eq('assigned_instructor_id', userId);
    } else {
      // Admins can optionally filter by instructor
      const assignedInstructorId = normalizeString(req?.query?.assigned_instructor_id);
      if (assignedInstructorId) {
        // Validate UUID format to prevent information disclosure
        if (!UUID_PATTERN.test(assignedInstructorId)) {
          return respond(context, 400, { message: 'invalid_instructor_id_format' });
        }
        builder = builder.eq('assigned_instructor_id', assignedInstructorId);
      }
    }

    // Status filter
    const statusFilter = determineStatusFilter(req?.query, instructorsCanViewInactive);
    if (statusFilter === 'active') {
      builder = builder.eq('is_active', true);
    } else if (statusFilter === 'inactive') {
      builder = builder.eq('is_active', false);
    }

    builder = builder.or('metadata->intake_dismissal->>active.is.null,metadata->intake_dismissal->>active.neq.true');

    const { data, error } = await builder;

    if (error) {
      context.log?.error?.('students-list failed to fetch roster', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_students' });
    }

    return respond(context, 200, Array.isArray(data) ? data : []);
  }

  // POST and PUT require admin role
  if (!isAdmin) {
    return respond(context, 403, { message: 'forbidden' });
  }

  // POST: Create new student
  if (method === 'POST') {
    const normalized = buildStudentPayload(body);
    if (normalized.error) {
      const message =
        normalized.error === 'missing_name'
          ? 'missing student name'
          : normalized.error === 'missing_identity_number'
            ? 'missing identity number'
          : normalized.error === 'invalid_identity_number'
            ? 'invalid identity number'
          : normalized.error === 'invalid_phone'
            ? 'invalid phone'
          : normalized.error === 'invalid_email'
            ? 'invalid email'
            : normalized.error === 'invalid_assigned_instructor'
              ? 'invalid assigned instructor id'
              : normalized.error === 'invalid_contact_name'
                ? 'invalid contact name'
                : normalized.error === 'invalid_contact_phone'
                  ? 'invalid contact phone'
                  : normalized.error === 'invalid_default_service'
                    ? 'invalid default service'
                    : normalized.error === 'invalid_default_day'
                      ? 'invalid default day of week'
          : normalized.error === 'invalid_default_session_time'
            ? 'invalid default session time'
            : normalized.error === 'invalid_notes'
              ? 'invalid notes'
              : normalized.error === 'invalid_tags'
                ? 'invalid tags'
                : normalized.error === 'invalid_is_active'
                  ? 'invalid is_active flag'
                  : 'invalid payload';
      return respond(context, 400, { message });
    }

    if (normalized.payload.identity_number) {
      const { data: existingByIdentityNumber, error: identityLookupError } = await findStudentByIdentityNumber(
        tenantClient,
        normalized.payload.identity_number,
      );

      if (identityLookupError) {
        context.log?.error?.('students-list failed to check identity number uniqueness', { message: identityLookupError.message });
        return respond(context, 500, { message: 'failed_to_validate_identity_number' });
      }

      if (existingByIdentityNumber) {
        return respond(context, 409, { message: 'duplicate_identity_number', student: existingByIdentityNumber });
      }
    }

    // Build metadata with creator information
    const metadata = {
      created_by: userId,
      created_at: new Date().toISOString(),
      created_role: role,
    };

    const recordToInsert = {
      ...normalized.payload,
      metadata,
    };

    const { data, error } = await tenantClient
      .from('students')
      .insert([recordToInsert])
      .select()
      .single();

    if (error) {
      context.log?.error?.('students-list failed to create student', { message: error.message });
      return respond(context, 500, { message: 'failed_to_create_student' });
    }

    // Audit log: student created
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      userRole: role,
      actionType: AUDIT_ACTIONS.STUDENT_CREATED,
      actionCategory: AUDIT_CATEGORIES.STUDENTS,
      resourceType: 'student',
      resourceId: data.id,
      details: {
        student_name: `${data.first_name} ${data.last_name}`.trim(),
        assigned_instructor_id: data.assigned_instructor_id,
      },
    });

    return respond(context, 201, data);
  }

  // PUT: Update existing student
  const studentId = extractStudentId(context, req, body);
  if (!studentId) {
    return respond(context, 400, { message: 'invalid student id' });
  }

  const normalizedUpdates = buildStudentUpdates(body);
  if (normalizedUpdates.error) {
    const updateMessage =
      normalizedUpdates.error === 'missing_updates'
        ? 'no updatable fields provided'
        : normalizedUpdates.error === 'invalid_identity_number'
          ? 'invalid identity number'
        : normalizedUpdates.error === 'invalid_phone'
          ? 'invalid phone'
        : normalizedUpdates.error === 'invalid_email'
          ? 'invalid email'
        : normalizedUpdates.error === 'invalid_name'
          ? 'invalid name'
          : normalizedUpdates.error === 'invalid_assigned_instructor'
              ? 'invalid assigned instructor id'
              : normalizedUpdates.error === 'invalid_contact_name'
                ? 'invalid contact name'
                : normalizedUpdates.error === 'invalid_contact_phone'
                  ? 'invalid contact phone'
                  : normalizedUpdates.error === 'invalid_default_service'
                    ? 'invalid default service'
                    : normalizedUpdates.error === 'invalid_default_day'
                      ? 'invalid default day of week'
          : normalizedUpdates.error === 'invalid_default_session_time'
            ? 'invalid default session time'
            : normalizedUpdates.error === 'invalid_notes'
              ? 'invalid notes'
              : normalizedUpdates.error === 'invalid_tags'
                ? 'invalid tags'
                : normalizedUpdates.error === 'invalid_is_active'
                  ? 'invalid is_active flag'
                  : 'invalid payload';
    return respond(context, 400, { message: updateMessage });
  }

  // Fetch existing student to compare changes and preserve metadata
  const { data: existingStudent, error: fetchError } = await tenantClient
    .from('students')
    .select('*')
    .eq('id', studentId)
    .maybeSingle();

  if (fetchError) {
    context.log?.error?.('students-list failed to fetch existing student', { message: fetchError.message, studentId });
    return respond(context, 500, { message: 'failed_to_fetch_student' });
  }

  if (!existingStudent) {
    return respond(context, 404, { message: 'student_not_found' });
  }

  if (Object.prototype.hasOwnProperty.call(normalizedUpdates.updates, 'identity_number')) {
    const desiredIdentityNumber = normalizedUpdates.updates.identity_number;

    if (desiredIdentityNumber) {
      const { data: conflict, error: lookupError } = await findStudentByIdentityNumber(tenantClient, desiredIdentityNumber, {
        excludeId: studentId,
      });

      if (lookupError) {
        context.log?.error?.('students-list failed to validate identity number on update', {
          message: lookupError.message,
          studentId,
        });
        return respond(context, 500, { message: 'failed_to_validate_identity_number' });
      }

      if (conflict) {
        return respond(context, 409, { message: 'duplicate_identity_number', student: conflict });
      }
    }
  }

  // Determine which fields actually changed
  const changedFields = [];
  for (const [key, newValue] of Object.entries(normalizedUpdates.updates)) {
    const oldValue = existingStudent[key];
    // Handle null/undefined as equivalent
    const normalizedOld = oldValue === null || oldValue === undefined ? null : oldValue;
    const normalizedNew = newValue === null || newValue === undefined ? null : newValue;
    
    // Deep comparison for objects/arrays, simple comparison for primitives
    if (JSON.stringify(normalizedOld) !== JSON.stringify(normalizedNew)) {
      changedFields.push(key);
    }
  }

  // Build updated metadata preserving existing fields
  const existingMetadata = existingStudent.metadata || {};
  const updatedMetadata = {
    ...existingMetadata,
    updated_by: userId,
    updated_at: new Date().toISOString(),
    updated_role: role,
  };

  const updatesWithMetadata = {
    ...normalizedUpdates.updates,
    metadata: updatedMetadata,
  };

  if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'intakeNotes')) {
    updatesWithMetadata.metadata = {
      ...updatedMetadata,
      intake_notes: normalizedUpdates.intakeNotes,
      intake_notes_updated_at: new Date().toISOString(),
      intake_notes_updated_by: userId,
    };
  }

  const { data, error } = await tenantClient
    .from('students')
    .update(updatesWithMetadata)
    .eq('id', studentId)
    .select()
    .maybeSingle();

  if (error) {
    context.log?.error?.('students-list failed to update student', { message: error.message, studentId });
    return respond(context, 500, { message: 'failed_to_update_student' });
  }

  if (!data) {
    return respond(context, 404, { message: 'student_not_found' });
  }

  // Audit log: student updated
  await logAuditEvent(supabase, {
    orgId,
    userId,
    userEmail: authResult.data.user.email || '',
    userRole: role,
    actionType: AUDIT_ACTIONS.STUDENT_UPDATED,
    actionCategory: AUDIT_CATEGORIES.STUDENTS,
    resourceType: 'student',
    resourceId: studentId,
    details: {
      updated_fields: changedFields,
      student_name: `${data.first_name} ${data.last_name}`.trim(),
    },
  });

  return respond(context, 200, data);
}
