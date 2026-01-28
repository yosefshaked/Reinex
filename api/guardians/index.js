import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { resolveTenantClient, ensureMembership, readEnv, respond } from '../_shared/org-bff.js';
import { validateIsraeliPhone, coerceOptionalString, coerceOptionalEmail } from '../_shared/student-validation.js';

/**
 * Guardians API - Manage legal guardians/parents
 * 
 * GET    /api/guardians          - List all guardians for organization
 * POST   /api/guardians          - Create new guardian
 * PUT    /api/guardians/:id      - Update guardian
 * DELETE /api/guardians/:id      - Delete guardian (requires no linked students)
 */
export default async function handler(context, req) {
  // Read environment and get Supabase admin config
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('[guardians] Missing Supabase admin credentials');
    return respond(context, 500, { error: 'server_misconfigured' });
  }

  // Extract auth token
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { error: 'missing_auth' });
  }
  const token = authorization.token;

  // Create Supabase admin client for control DB with cache control
  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } }
  });

  // Verify user
  let authResult;
  try {
    authResult = await supabase.auth.getUser(token);
  } catch (authError) {
    context.log?.error?.('guardians auth.getUser failed', { message: authError.message });
    return respond(context, 401, { message: 'invalid_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    context.log.warn('[guardians] Invalid token');
    return respond(context, 401, { error: 'invalid_token' });
  }
  const userId = authResult.data.user.id;

  // Get org_id from query or body
  const orgId = req.query.org_id || req.body?.org_id;
  if (!orgId) {
    return respond(context, 400, { error: 'missing_org_id' });
  }

  // Verify user is a member of the organization
  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('guardians ensureMembership failed', {
      message: membershipError.message,
      userId,
      orgId
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    context.log.warn('[guardians] User not a member of organization', { userId, orgId });
    return respond(context, 403, { error: 'not_a_member' });
  }

  // Get tenant client (env already loaded at top)
  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const method = req.method;
  const guardianId = context.bindingData?.id;

  try {
    if (method === 'GET') {
      return await handleGet(context, tenantClient);
    } else if (method === 'POST') {
      return await handlePost(context, req, tenantClient, userId);
    } else if (method === 'PUT' && guardianId) {
      return await handlePut(context, req, tenantClient, guardianId, userId);
    } else if (method === 'DELETE' && guardianId) {
      return await handleDelete(context, tenantClient, guardianId);
    } else {
      return respond(context, 405, { error: 'method_not_allowed' });
    }
  } catch (error) {
    context.log.error('[guardians] Handler error:', error);
    return respond(context, 500, { error: 'internal_server_error', message: error.message });
  }
}

/**
 * GET /api/guardians - List all guardians
 */
async function handleGet(context, tenantClient) {
  const { data, error } = await tenantClient
    .from('guardians')
    .select('*')
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true });

  if (error) {
    context.log.error('[guardians/GET] Query error:', error);
    return respond(context, 500, { error: 'database_error', message: error.message });
  }

  return respond(context, 200, { guardians: data || [] });
}

/**
 * POST /api/guardians - Create new guardian
 */
async function handlePost(context, req, tenantClient, userId) {
  const body = req.body || {};

  // Required fields
  const firstName = coerceOptionalString(body.first_name);
  const lastName = coerceOptionalString(body.last_name);
  const phone = coerceOptionalString(body.phone);

  if (!firstName || !lastName) {
    return respond(context, 400, { error: 'missing_required_fields', message: 'First name and last name are required' });
  }

  if (!phone) {
    return respond(context, 400, { error: 'missing_phone', message: 'Phone number is required' });
  }

  // Validate phone
  if (!validateIsraeliPhone(phone)) {
    return respond(context, 400, { error: 'invalid_phone', message: 'Invalid Israeli phone number' });
  }

  // Optional fields
  const email = coerceOptionalEmail(body.email);
  const relationship = coerceOptionalString(body.relationship);

  const payload = {
    first_name: firstName,
    last_name: lastName,
    phone: phone,
    email: email,
    relationship: relationship,
    metadata: {
      created_by: userId,
      created_at: new Date().toISOString(),
    },
  };

  const { data, error } = await tenantClient
    .from('guardians')
    .insert(payload)
    .select()
    .single();

  if (error) {
    context.log.error('[guardians/POST] Insert error:', error);
    return respond(context, 500, { error: 'database_error', message: error.message });
  }

  context.log.info('[guardians/POST] Guardian created:', data.id);
  return respond(context, 201, { guardian: data });
}

/**
 * PUT /api/guardians/:id - Update guardian
 */
async function handlePut(context, req, tenantClient, guardianId, userId) {
  const body = req.body || {};
  const updates = {};

  // Allow updating name, phone, email, relationship
  if (body.first_name !== undefined) {
    const firstName = coerceOptionalString(body.first_name);
    if (!firstName) {
      return respond(context, 400, { error: 'invalid_first_name' });
    }
    updates.first_name = firstName;
  }

  if (body.last_name !== undefined) {
    const lastName = coerceOptionalString(body.last_name);
    if (!lastName) {
      return respond(context, 400, { error: 'invalid_last_name' });
    }
    updates.last_name = lastName;
  }

  if (body.phone !== undefined) {
    const phone = coerceOptionalString(body.phone);
    if (!phone) {
      return respond(context, 400, { error: 'phone_required' });
    }
    if (!validateIsraeliPhone(phone)) {
      return respond(context, 400, { error: 'invalid_phone' });
    }
    updates.phone = phone;
  }

  if (body.email !== undefined) {
    updates.email = coerceOptionalEmail(body.email);
  }

  if (body.relationship !== undefined) {
    updates.relationship = coerceOptionalString(body.relationship);
  }

  if (Object.keys(updates).length === 0) {
    return respond(context, 400, { error: 'no_updates' });
  }

  // Add metadata
  updates.metadata = {
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await tenantClient
    .from('guardians')
    .update(updates)
    .eq('id', guardianId)
    .select()
    .single();

  if (error) {
    context.log.error('[guardians/PUT] Update error:', error);
    return respond(context, 500, { error: 'database_error', message: error.message });
  }

  if (!data) {
    return respond(context, 404, { error: 'guardian_not_found' });
  }

  context.log.info('[guardians/PUT] Guardian updated:', guardianId);
  return respond(context, 200, { guardian: data });
}

/**
 * DELETE /api/guardians/:id - Delete guardian
 */
async function handleDelete(context, tenantClient, guardianId) {
  // Check if guardian has students
  const { data: students, error: checkError } = await tenantClient
    .from('students')
    .select('id')
    .eq('guardian_id', guardianId)
    .limit(1);

  if (checkError) {
    context.log.error('[guardians/DELETE] Check error:', checkError);
    return respond(context, 500, { error: 'database_error' });
  }

  if (students && students.length > 0) {
    return respond(context, 400, { 
      error: 'guardian_has_students', 
      message: 'Cannot delete guardian with students. Reassign students first.' 
    });
  }

  // Hard delete
  const { data, error } = await tenantClient
    .from('guardians')
    .delete()
    .eq('id', guardianId)
    .select()
    .single();

  if (error) {
    context.log.error('[guardians/DELETE] Delete error:', error);
    return respond(context, 500, { error: 'database_error', message: error.message });
  }

  if (!data) {
    return respond(context, 404, { error: 'guardian_not_found' });
  }

  context.log.info('[guardians/DELETE] Guardian deleted:', guardianId);
  return respond(context, 200, { success: true });
}
