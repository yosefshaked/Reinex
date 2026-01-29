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
  coerceIdentityNumber,
  coerceOptionalText,
  coerceTags,
  coerceEmail,
  validateAssignedInstructor,
  validateIsraeliPhone,
  coerceOptionalDate,
  coerceNotificationMethod,
  coerceOptionalNumeric,
  coerceOptionalJsonb,
  coerceOnboardingStatus,
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

  // Assigned Instructor (Optional - for waitlist management)
  const rawInstructor = body?.assigned_instructor_id ?? body?.assignedInstructorId ?? null;
  const { value: instructorId, valid: instructorValid } = validateAssignedInstructor(rawInstructor);
  if (!instructorValid) {
    return { error: 'invalid_assigned_instructor' };
  }

  // Guardian ID (Optional) - Note: Using many-to-many relationship via student_guardians table
  const guardianId = body?.guardian_id ?? body?.guardianId ?? null;
  if (guardianId && typeof guardianId !== 'string') {
    return { error: 'invalid_guardian_id' };
  }
  if (guardianId && !UUID_PATTERN.test(guardianId)) {
    return { error: 'invalid_guardian_id' };
  }

  // Phone validation: required if no guardian
  const phoneResult = validateIsraeliPhone(body?.phone);
  if (!guardianId && !phoneResult.value) {
    return { error: 'phone_required_without_guardian' };
  }
  if (!phoneResult.valid) {
    return { error: 'invalid_phone' };
  }

  const emailResult = coerceEmail(body?.email);
  if (!emailResult.valid) {
    return { error: 'invalid_email' };
  }

  const identityCandidate = body?.identity_number ?? body?.identityNumber ?? body?.national_id ?? body?.nationalId;
  const identityNumberResult = coerceIdentityNumber(identityCandidate);
  if (!identityNumberResult.valid) {
    return { error: 'invalid_identity_number' };
  }
  if (!identityNumberResult.value) {
    return { error: 'missing_identity_number' };
  }

  // New Reinex fields
  const dateOfBirthResult = coerceOptionalDate(body?.date_of_birth ?? body?.dateOfBirth);
  if (!dateOfBirthResult.valid) {
    return { error: 'invalid_date_of_birth' };
  }

  const notificationMethodResult = coerceNotificationMethod(body?.default_notification_method ?? body?.notificationMethod);
  if (!notificationMethodResult.valid) {
    return { error: 'invalid_notification_method' };
  }

  const specialRateResult = coerceOptionalNumeric(body?.special_rate ?? body?.specialRate);
  if (!specialRateResult.valid) {
    return { error: 'invalid_special_rate' };
  }

  const medicalFlagsResult = coerceOptionalJsonb(body?.medical_flags ?? body?.medicalFlags);
  if (!medicalFlagsResult.valid) {
    return { error: 'invalid_medical_flags' };
  }

  const onboardingStatusResult = coerceOnboardingStatus(body?.onboarding_status ?? body?.onboardingStatus);
  if (!onboardingStatusResult.valid) {
    return { error: 'invalid_onboarding_status' };
  }

  const notesInternalResult = coerceOptionalText(body?.notes_internal ?? body?.notesInternal);
  if (!notesInternalResult.valid) {
    return { error: 'invalid_notes_internal' };
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

  return {
    payload: {
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      identity_number: identityNumberResult.value,
      date_of_birth: dateOfBirthResult.value,
      assigned_instructor_id: instructorId,
      phone: phoneResult.value,
      email: emailResult.value,
      default_notification_method: notificationMethodResult.value,
      special_rate: specialRateResult.value,
      medical_flags: medicalFlagsResult.value,
      onboarding_status: onboardingStatusResult.value,
      notes_internal: notesInternalResult.value,
      is_active: isActiveValue,
    },
    guardianId: guardianId, // Return separately for student_guardians insertion
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
    // DEPRECATED: contact_name removed in Reinex - use guardians table instead
    void 0; // No logging in helper function - warn in handler if needed
  }

  if (Object.prototype.hasOwnProperty.call(body, 'contact_phone') || Object.prototype.hasOwnProperty.call(body, 'contactPhone')) {
    // DEPRECATED: contact_phone removed in Reinex - use guardians table instead
    void 0; // No logging in helper function - warn in handler if needed
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

  // Date of birth
  if (Object.prototype.hasOwnProperty.call(body, 'date_of_birth') || Object.prototype.hasOwnProperty.call(body, 'dateOfBirth')) {
    const { value, valid } = coerceOptionalDate(
      Object.prototype.hasOwnProperty.call(body, 'date_of_birth') ? body.date_of_birth : body.dateOfBirth
    );
    if (!valid) {
      return { error: 'invalid_date_of_birth' };
    }
    updates.date_of_birth = value;
    hasAny = true;
  }

  // Notification method
  if (Object.prototype.hasOwnProperty.call(body, 'default_notification_method') || Object.prototype.hasOwnProperty.call(body, 'notificationMethod')) {
    const { value, valid } = coerceNotificationMethod(
      Object.prototype.hasOwnProperty.call(body, 'default_notification_method') ? body.default_notification_method : body.notificationMethod
    );
    if (!valid) {
      return { error: 'invalid_notification_method' };
    }
    updates.default_notification_method = value;
    hasAny = true;
  }

  // Special rate
  if (Object.prototype.hasOwnProperty.call(body, 'special_rate') || Object.prototype.hasOwnProperty.call(body, 'specialRate')) {
    const { value, valid } = coerceOptionalNumeric(
      Object.prototype.hasOwnProperty.call(body, 'special_rate') ? body.special_rate : body.specialRate
    );
    if (!valid) {
      return { error: 'invalid_special_rate' };
    }
    updates.special_rate = value;
    hasAny = true;
  }

  // Medical flags
  if (Object.prototype.hasOwnProperty.call(body, 'medical_flags') || Object.prototype.hasOwnProperty.call(body, 'medicalFlags')) {
    const { value, valid } = coerceOptionalJsonb(
      Object.prototype.hasOwnProperty.call(body, 'medical_flags') ? body.medical_flags : body.medicalFlags
    );
    if (!valid) {
      return { error: 'invalid_medical_flags' };
    }
    updates.medical_flags = value;
    hasAny = true;
  }

  // Onboarding status
  if (Object.prototype.hasOwnProperty.call(body, 'onboarding_status') || Object.prototype.hasOwnProperty.call(body, 'onboardingStatus')) {
    const { value, valid } = coerceOnboardingStatus(
      Object.prototype.hasOwnProperty.call(body, 'onboarding_status') ? body.onboarding_status : body.onboardingStatus
    );
    if (!valid) {
      return { error: 'invalid_onboarding_status' };
    }
    updates.onboarding_status = value;
    hasAny = true;
  }

  // Internal notes (replaces old 'notes' field)
  if (Object.prototype.hasOwnProperty.call(body, 'notes_internal') || Object.prototype.hasOwnProperty.call(body, 'notesInternal')) {
    const { value, valid } = coerceOptionalText(
      Object.prototype.hasOwnProperty.call(body, 'notes_internal') ? body.notes_internal : body.notesInternal
    );
    if (!valid) {
      return { error: 'invalid_notes_internal' };
    }
    updates.notes_internal = value;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'default_service') || Object.prototype.hasOwnProperty.call(body, 'defaultService')) {
    // DEPRECATED: default_service moved to lesson_templates in Reinex
    void 0; // No logging in helper function - warn in handler if needed
  }

  if (Object.prototype.hasOwnProperty.call(body, 'default_day_of_week') || Object.prototype.hasOwnProperty.call(body, 'defaultDayOfWeek')) {
    // DEPRECATED: default_day_of_week moved to lesson_templates in Reinex
    void 0; // No logging in helper function - warn in handler if needed
  }

  if (Object.prototype.hasOwnProperty.call(body, 'default_session_time') || Object.prototype.hasOwnProperty.call(body, 'defaultSessionTime')) {
    // DEPRECATED: default_session_time moved to lesson_templates in Reinex
    void 0; // No logging in helper function - warn in handler if needed
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
      // Log the actual error code for debugging
      context.log?.warn?.('students-list validation failed', { 
        errorCode: normalized.error,
        body: {
          firstName: body?.firstName,
          lastName: body?.lastName,
          identityNumber: body?.identityNumber,
          assignedInstructorId: body?.assignedInstructorId,
          defaultDayOfWeek: body?.defaultDayOfWeek,
          defaultSessionTime: body?.defaultSessionTime,
        }
      });
      
      const message =
        normalized.error === 'missing_first_name'
          ? 'missing first name'
          : normalized.error === 'missing_last_name'
            ? 'missing last name'
          : normalized.error === 'missing_name'
            ? 'missing student name'
            : normalized.error === 'missing_identity_number'
              ? 'missing identity number'
              : normalized.error === 'invalid_identity_number'
                ? 'invalid identity number'
                : normalized.error === 'phone_required_without_guardian'
                  ? 'phone required when no guardian is connected'
                  : normalized.error === 'invalid_phone'
                    ? 'invalid phone'
                    : normalized.error === 'invalid_email'
                      ? 'invalid email'
                      : normalized.error === 'invalid_guardian_id'
                        ? 'invalid guardian id'
                        : normalized.error === 'invalid_assigned_instructor'
                          ? 'invalid assigned instructor id'
                          : normalized.error === 'invalid_date_of_birth'
                            ? 'invalid date of birth'
                            : normalized.error === 'invalid_notification_method'
                              ? 'invalid notification method'
                              : normalized.error === 'invalid_special_rate'
                                ? 'invalid special rate'
                                : normalized.error === 'invalid_medical_flags'
                                  ? 'invalid medical flags'
                                  : normalized.error === 'invalid_onboarding_status'
                                    ? 'invalid onboarding status'
                                    : normalized.error === 'invalid_notes_internal'
                                      ? 'invalid internal notes'
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

    // If guardian provided, create the relationship in student_guardians table
    if (normalized.guardianId) {
      const { error: relationError } = await tenantClient
        .from('student_guardians')
        .insert({
          student_id: data.id,
          guardian_id: normalized.guardianId,
          relationship: 'parent', // Default relationship type
          is_primary: true, // Mark as primary guardian
        });

      if (relationError) {
        context.log?.error?.('students-list failed to create guardian relationship', {
          message: relationError.message,
          studentId: data.id,
          guardianId: normalized.guardianId,
        });
        // Student created but guardian relation failed - log but don't fail the request
        // The student can be edited later to add the guardian
      }
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
