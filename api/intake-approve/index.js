/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import {
  ensureMembership,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
  UUID_PATTERN,
} from '../_shared/org-bff.js';

function normalizeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value).trim();
}

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

function resolveStudentId(body) {
  const candidate = normalizeString(body?.student_id || body?.studentId || body?.id);
  if (candidate && UUID_PATTERN.test(candidate)) {
    return candidate;
  }
  return '';
}

function buildAgreementPayload(raw, userId) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const acknowledged = Boolean(raw.acknowledged || raw.confirmed || raw.checked);
  if (!acknowledged) {
    return null;
  }
  const statement = normalizeString(raw.statement || raw.text || raw.label);
  const clientTimestamp = normalizeString(raw.acknowledged_at || raw.confirmed_at || raw.timestamp);
  return {
    acknowledged: true,
    statement: statement || null,
    client_acknowledged_at: clientTimestamp || null,
    by: userId,
    at: new Date().toISOString(),
  };
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
    context.log?.error?.('intake-approve missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('intake-approve failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const body = parseJsonBodyWithLimit(req, 16 * 1024, { mode: 'observe', context, endpoint: 'intake-approve' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  const studentId = resolveStudentId(body);
  if (!studentId) {
    return respond(context, 400, { message: 'invalid_student_id' });
  }

  const agreement = buildAgreementPayload(body?.agreement, authResult.data.user.id);
  if (!agreement) {
    return respond(context, 400, { message: 'invalid_agreement' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, authResult.data.user.id);
  } catch (membershipError) {
    context.log?.error?.('intake-approve failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId: authResult.data.user.id,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const { data: student, error: studentError } = await tenantClient
    .from('Students')
    .select('id, assigned_instructor_id, metadata')
    .eq('id', studentId)
    .maybeSingle();

  if (studentError) {
    if (isSchemaError(studentError)) {
      const schemaResponse = buildSchemaResponse(studentError);
      return respond(context, schemaResponse.status, schemaResponse.body);
    }
    context.log?.error?.('intake-approve failed to load student', { message: studentError.message });
    return respond(context, 500, { message: 'failed_to_load_student' });
  }

  if (!student) {
    return respond(context, 404, { message: 'student_not_found' });
  }

  if (!student.assigned_instructor_id) {
    return respond(context, 409, { message: 'assigned_instructor_required' });
  }

  if (student.assigned_instructor_id !== authResult.data.user.id) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const existingMetadata = student.metadata && typeof student.metadata === 'object' ? student.metadata : {};
  const updatedMetadata = {
    ...existingMetadata,
    last_approval: {
      ...(existingMetadata.last_approval && typeof existingMetadata.last_approval === 'object'
        ? existingMetadata.last_approval
        : {}),
      at: new Date().toISOString(),
      by: authResult.data.user.id,
      agreement,
    },
  };

  const { data, error } = await tenantClient
    .from('Students')
    .update({
      needs_intake_approval: false,
      metadata: updatedMetadata,
    })
    .eq('id', studentId)
    .select()
    .maybeSingle();

  if (error) {
    if (isSchemaError(error)) {
      const schemaResponse = buildSchemaResponse(error);
      return respond(context, schemaResponse.status, schemaResponse.body);
    }
    context.log?.error?.('intake-approve failed to update student', { message: error.message });
    return respond(context, 500, { message: 'failed_to_update_student' });
  }

  if (!data) {
    return respond(context, 404, { message: 'student_not_found' });
  }

  return respond(context, 200, { status: 'approved', student: data });
}
