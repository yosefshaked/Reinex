/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantPublicClient,
} from '../_shared/org-bff.js';

function classifyTenantDbError(error, { resource, operation } = {}) {
  const message = typeof error?.message === 'string' ? error.message : null;
  const code = typeof error?.code === 'string' ? error.code : null;
  const details = typeof error?.details === 'string' ? error.details : null;
  const hint = typeof error?.hint === 'string' ? error.hint : null;

  const text = `${code || ''} ${message || ''} ${details || ''}`.toLowerCase();
  const looksLikeMissingTable =
    code === '42P01' ||
    code === 'PGRST205' ||
    text.includes('schema cache') ||
    text.includes('does not exist') ||
    text.includes('could not find the table');

  if (looksLikeMissingTable) {
    return {
      status: 424,
      body: {
        error: 'schema_upgrade_required',
        message: 'Tenant scheduling schema is missing or incomplete.',
        details: {
          resource: resource || null,
          operation: operation || null,
          code,
          message,
          details,
          hint,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: 'database_error',
      message: message || 'Tenant database query failed.',
      details: {
        resource: resource || null,
        operation: operation || null,
        code,
        details,
        hint,
      },
    },
  };
}

function isMissingTenantTableError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const code = typeof error?.code === 'string' ? error.code : '';
  const details = typeof error?.details === 'string' ? error.details : '';
  const text = `${code} ${message} ${details}`.toLowerCase();

  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    text.includes('schema cache') ||
    text.includes('does not exist') ||
    text.includes('could not find the table')
  );
}

function buildSuggestedEmployee(user) {
  const email = normalizeString(user?.email);
  const meta = user?.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};

  const fullName = normalizeString(meta.full_name || meta.name);
  const fallbackName = fullName || (email ? email.split('@')[0] : 'Employee');

  return {
    name: fallbackName,
    email: email || null,
    first_name: normalizeString(meta.first_name) || null,
    last_name: normalizeString(meta.last_name) || null,
  };
}

function pickEmployeeWriteFields(input, fallback = {}) {
  const result = {};

  const name = normalizeString(input?.name) || normalizeString(fallback?.name);
  const employeeId = normalizeString(input?.employee_id ?? input?.employeeId) || normalizeString(fallback?.employee_id);

  if (name) result.name = name;
  if (employeeId) result.employee_id = employeeId;

  const phone = normalizeString(input?.phone);
  if (phone) result.phone = phone;

  const email = normalizeString(input?.email) || normalizeString(fallback?.email);
  if (email) result.email = email;

  const firstName = normalizeString(input?.first_name ?? input?.firstName);
  if (firstName) result.first_name = firstName;

  const lastName = normalizeString(input?.last_name ?? input?.lastName);
  if (lastName) result.last_name = lastName;

  const middleName = normalizeString(input?.middle_name ?? input?.middleName);
  if (middleName) result.middle_name = middleName;

  // Optional metadata passthrough (must remain an object)
  if (input?.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
    result.metadata = input.metadata;
  }

  return result;
}

function buildDefaultEmployeeId(userId) {
  const short = normalizeString(userId).slice(0, 8) || 'unknown';
  return `user-${short}`;
}

async function loadEmployeeById(tenantClient, id) {
  let result = await tenantClient.from('Employees').select('*').eq('id', id).maybeSingle();
  if (result.error && isMissingTenantTableError(result.error)) {
    result = await tenantClient.from('employees').select('*').eq('id', id).maybeSingle();
  }
  return result;
}

export default async function (context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  const supabase = createSupabaseAdminClient(adminConfig);

  const authorization = resolveBearerAuthorization(req);
  const orgId = resolveOrgId(req);

  if (!authorization?.token) {
    return respond(context, 401, { error: 'missing_auth' });
  }

  if (!orgId) {
    return respond(context, 400, { error: 'missing_org_id' });
  }

  const authResult = await supabase.auth.getUser(authorization.token);
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { error: 'invalid_token' });
  }

  const user = authResult.data.user;
  const userId = user.id;

  const membership = await ensureMembership(supabase, orgId, userId);
  if (!membership) {
    return respond(context, 403, { error: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantPublicClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const method = String(req.method || 'GET').toLowerCase();

  if (method === 'get') {
    const { data: existing, error: readError } = await loadEmployeeById(tenantClient, userId);
    if (readError) {
      context.log.error('Failed to load employee profile', readError);
      const classified = classifyTenantDbError(readError, { resource: 'Employees', operation: 'select' });
      return respond(context, classified.status, classified.body);
    }

    if (!existing) {
      return respond(context, 200, {
        exists: false,
        data: null,
        suggested: buildSuggestedEmployee(user),
      });
    }

    return respond(context, 200, { exists: true, data: existing });
  }

  if (method !== 'post' && method !== 'put') {
    return respond(context, 405, { error: 'method_not_allowed' });
  }

  const body = parseRequestBody(req);
  const suggested = buildSuggestedEmployee(user);

  // Check existence
  const { data: existing, error: existingError } = await loadEmployeeById(tenantClient, userId);
  if (existingError) {
    context.log.error('Failed to check employee profile', existingError);
    const classified = classifyTenantDbError(existingError, { resource: 'Employees', operation: 'select' });
    return respond(context, classified.status, classified.body);
  }

  if (!existing) {
    // For first-time creation we can safely fill from suggested defaults.
    const insertCandidate = pickEmployeeWriteFields(body, suggested);

    if (!insertCandidate.employee_id) {
      insertCandidate.employee_id = buildDefaultEmployeeId(userId);
    }

    if (!insertCandidate.name) {
      return respond(context, 400, { error: 'missing_name' });
    }

    if (!insertCandidate.employee_id) {
      return respond(context, 400, { error: 'missing_employee_id' });
    }

    const insertPayload = {
      id: userId,
      ...insertCandidate,
      is_active: true,
    };

    let { data: created, error: createError } = await tenantClient
      .from('Employees')
      .insert(insertPayload)
      .select('*')
      .single();

    if (createError && isMissingTenantTableError(createError)) {
      ({ data: created, error: createError } = await tenantClient
        .from('employees')
        .insert(insertPayload)
        .select('*')
        .single());
    }

    if (createError) {
      context.log.error('Failed to create employee profile', createError);
      const classified = classifyTenantDbError(createError, { resource: 'Employees', operation: 'insert' });
      return respond(context, classified.status, classified.body);
    }

    return respond(context, 201, { exists: true, data: created, created: true });
  }

  // For updates, only apply fields explicitly provided by the user.
  // This prevents a boot-time POST/PUT from overwriting names with email defaults.
  const updateCandidate = pickEmployeeWriteFields(body, {});
  if (Object.keys(updateCandidate).length === 0) {
    return respond(context, 200, { exists: true, data: existing, updated: false });
  }

  let { data: updated, error: updateError } = await tenantClient
    .from('Employees')
    .update(updateCandidate)
    .eq('id', userId)
    .select('*')
    .single();

  if (updateError && isMissingTenantTableError(updateError)) {
    ({ data: updated, error: updateError } = await tenantClient
      .from('employees')
      .update(updateCandidate)
      .eq('id', userId)
      .select('*')
      .single());
  }

  if (updateError) {
    context.log.error('Failed to update employee profile', updateError);
    const classified = classifyTenantDbError(updateError, { resource: 'Employees', operation: 'update' });
    return respond(context, classified.status, classified.body);
  }

  return respond(context, 200, { exists: true, data: updated, updated: true });
}
