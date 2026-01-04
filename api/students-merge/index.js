/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
  UUID_PATTERN,
} from '../_shared/org-bff.js';
import {
  coerceNationalId,
  coerceOptionalText,
  validateAssignedInstructor,
  validateIsraeliPhone,
} from '../_shared/student-validation.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

function isSchemaError(error) {
  if (!error) {
    return false;
  }
  const code = error.code || error.details;
  if (code === '42703' || code === '42P01') {
    return true;
  }
  const message = String(error.message || error.details || '').toLowerCase();
  return message.includes('column') || message.includes('relation');
}

function buildSchemaResponse(error) {
  return {
    status: 424,
    body: {
      message: 'schema_upgrade_required',
      details: error?.message || 'missing_intake_columns',
      hint: 'Run the latest setup SQL to add intake_responses and needs_intake_approval.',
    },
  };
}

function resolveStudentId(raw) {
  const candidate = normalizeString(raw);
  if (candidate && UUID_PATTERN.test(candidate)) {
    return candidate;
  }
  return '';
}

function normalizeTags(raw) {
  if (!Array.isArray(raw)) {
    return null;
  }
  const sanitized = raw.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean);
  return sanitized.length ? sanitized : null;
}

async function ensureNationalIdAvailable(tenantClient, nationalId, { excludeIds = [] } = {}) {
  if (!nationalId) {
    return { ok: true };
  }

  let query = tenantClient.from('students').select('id').eq('national_id', nationalId);
  for (const id of excludeIds) {
    query = query.neq('id', id);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    return { ok: false, error };
  }
  if (data) {
    return { ok: false, conflictId: data.id };
  }
  return { ok: true };
}

export default async function handler(context, req) {
  const method = String(req.method || 'POST').toUpperCase();
  if (method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'POST' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('students-merge missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('students-merge failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const body = parseJsonBodyWithLimit(req, 32 * 1024, { mode: 'observe', context, endpoint: 'students-merge' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  const sourceStudentId = resolveStudentId(body?.source_student_id || body?.sourceStudentId);
  const targetStudentId = resolveStudentId(body?.target_student_id || body?.targetStudentId);

  if (!sourceStudentId || !targetStudentId) {
    return respond(context, 400, { message: 'invalid_student_id' });
  }

  if (sourceStudentId === targetStudentId) {
    return respond(context, 400, { message: 'duplicate_student_id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, authResult.data.user.id);
  } catch (membershipError) {
    context.log?.error?.('students-merge failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId: authResult.data.user.id,
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

  const { data: sourceStudent, error: sourceError } = await tenantClient
    .from('students')
    .select('*')
    .eq('id', sourceStudentId)
    .maybeSingle();

  if (sourceError) {
    if (isSchemaError(sourceError)) {
      const schemaResponse = buildSchemaResponse(sourceError);
      return respond(context, schemaResponse.status, schemaResponse.body);
    }
    context.log?.error?.('students-merge failed to load source student', { message: sourceError.message });
    return respond(context, 500, { message: 'failed_to_load_source_student' });
  }

  if (!sourceStudent) {
    return respond(context, 404, { message: 'source_student_not_found' });
  }

  const { data: targetStudent, error: targetError } = await tenantClient
    .from('students')
    .select('*')
    .eq('id', targetStudentId)
    .maybeSingle();

  if (targetError) {
    if (isSchemaError(targetError)) {
      const schemaResponse = buildSchemaResponse(targetError);
      return respond(context, schemaResponse.status, schemaResponse.body);
    }
    context.log?.error?.('students-merge failed to load target student', { message: targetError.message });
    return respond(context, 500, { message: 'failed_to_load_target_student' });
  }

  if (!targetStudent) {
    return respond(context, 404, { message: 'target_student_not_found' });
  }

  const fields = body?.fields && typeof body.fields === 'object' ? body.fields : {};

  const nameValue = normalizeString(fields.name);
  if (!nameValue) {
    return respond(context, 400, { message: 'missing_name' });
  }

  const nationalIdResult = coerceNationalId(fields.national_id);
  if (!nationalIdResult.valid) {
    return respond(context, 400, { message: 'invalid_national_id' });
  }

  const contactNameResult = coerceOptionalText(fields.contact_name);
  if (!contactNameResult.valid) {
    return respond(context, 400, { message: 'invalid_contact_name' });
  }

  const contactPhoneResult = validateIsraeliPhone(fields.contact_phone);
  if (!contactPhoneResult.valid) {
    return respond(context, 400, { message: 'invalid_contact_phone' });
  }

  const notesResult = coerceOptionalText(fields.notes);
  if (!notesResult.valid) {
    return respond(context, 400, { message: 'invalid_notes' });
  }

  const { value: instructorId, valid: instructorValid } = validateAssignedInstructor(fields.assigned_instructor_id);
  if (!instructorValid) {
    return respond(context, 400, { message: 'invalid_assigned_instructor' });
  }

  if (nationalIdResult.value) {
    const availability = await ensureNationalIdAvailable(tenantClient, nationalIdResult.value, {
      excludeIds: [sourceStudentId, targetStudentId],
    });
    if (!availability.ok && availability.conflictId) {
      return respond(context, 409, { message: 'duplicate_national_id', student_id: availability.conflictId });
    }
    if (!availability.ok && availability.error) {
      context.log?.error?.('students-merge failed to validate national id', { message: availability.error.message });
      return respond(context, 500, { message: 'failed_to_validate_national_id' });
    }
  }

  const updatedMetadata = {
    ...(targetStudent.metadata && typeof targetStudent.metadata === 'object' ? targetStudent.metadata : {}),
    merged_from: {
      source_id: sourceStudentId,
      merged_at: new Date().toISOString(),
      merged_by: authResult.data.user.id,
    },
    merge_backup: {
      source_student: sourceStudent,
      target_before_merge: targetStudent,
    },
  };

  const updates = {
    name: nameValue,
    national_id: nationalIdResult.value,
    contact_name: contactNameResult.value,
    contact_phone: contactPhoneResult.value,
    assigned_instructor_id: instructorId,
    notes: notesResult.value,
    tags: normalizeTags(fields.tags),
    needs_intake_approval: Boolean(sourceStudent.needs_intake_approval || targetStudent.needs_intake_approval),
    metadata: updatedMetadata,
  };

  if (sourceStudent.intake_responses) {
    if (targetStudent.intake_responses && targetStudent.intake_responses !== sourceStudent.intake_responses) {
      updates.metadata = {
        ...updates.metadata,
        intake_merge_backup: targetStudent.intake_responses,
      };
    }
    updates.intake_responses = sourceStudent.intake_responses;
  }

  const { data: updatedTarget, error: updateError } = await tenantClient
    .from('students')
    .update(updates)
    .eq('id', targetStudentId)
    .select()
    .maybeSingle();

  if (updateError) {
    if (isSchemaError(updateError)) {
      const schemaResponse = buildSchemaResponse(updateError);
      return respond(context, schemaResponse.status, schemaResponse.body);
    }
    context.log?.error?.('students-merge failed to update target', { message: updateError.message });
    return respond(context, 500, { message: 'failed_to_update_target' });
  }

  const { data: deletedSource, error: sourceDeleteError } = await tenantClient
    .from('students')
    .delete()
    .eq('id', sourceStudentId)
    .select()
    .maybeSingle();

  if (sourceDeleteError) {
    if (isSchemaError(sourceDeleteError)) {
      const schemaResponse = buildSchemaResponse(sourceDeleteError);
      return respond(context, schemaResponse.status, schemaResponse.body);
    }
    context.log?.error?.('students-merge failed to delete source', { message: sourceDeleteError.message });
    return respond(context, 500, { message: 'failed_to_delete_source' });
  }

  await logAuditEvent(supabase, {
    orgId,
    userId: authResult.data.user.id,
    userEmail: authResult.data.user.email || '',
    userRole: role,
    actionType: AUDIT_ACTIONS.STUDENT_UPDATED,
    actionCategory: AUDIT_CATEGORIES.STUDENTS,
    resourceType: 'student',
    resourceId: targetStudentId,
    details: {
      merged_from: sourceStudentId,
      fields: Object.keys(fields || {}),
      deleted_source: true,
    },
  });

  return respond(context, 200, {
    status: 'merged',
    target: updatedTarget,
    source: deletedSource,
  });
}
