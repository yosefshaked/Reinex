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

  const guardians = data || [];
  if (!guardians.length) {
    return respond(context, 200, { guardians: [] });
  }

  const guardianIds = guardians.map(guardian => guardian.id);
  const { data: links, error: linksError } = await tenantClient
    .from('student_guardians')
    .select('guardian_id, relationship, is_primary, students(id, first_name, last_name)')
    .in('guardian_id', guardianIds);

  if (linksError) {
    context.log.error('[guardians/GET] student_guardians query error:', linksError);
    return respond(context, 500, { error: 'database_error', message: linksError.message });
  }

  const linksByGuardian = new Map();
  (links || []).forEach(link => {
    if (!linksByGuardian.has(link.guardian_id)) {
      linksByGuardian.set(link.guardian_id, []);
    }
    const student = link.students;
    const studentName = student
      ? `${student.first_name || ''} ${student.last_name || ''}`.trim()
      : null;

    linksByGuardian.get(link.guardian_id).push({
      student_id: student?.id || null,
      student_name: studentName,
      relationship: link.relationship || null,
      is_primary: Boolean(link.is_primary),
    });
  });

  const enriched = guardians.map(guardian => ({
    ...guardian,
    linked_students: linksByGuardian.get(guardian.id) || [],
  }));

  return respond(context, 200, { guardians: enriched });
}

/**
 * POST /api/guardians - Create new guardian
 */
async function handlePost(context, req, tenantClient, userId) {
  const body = req.body || {};

  // Required fields
  const firstNameResult = coerceOptionalString(body.first_name);
  const phoneResult = coerceOptionalString(body.phone);

  if (!firstNameResult.valid || !firstNameResult.value) {
    return respond(context, 400, { error: 'missing_required_fields', message: 'First name is required' });
  }

  if (!phoneResult.valid || !phoneResult.value) {
    return respond(context, 400, { error: 'missing_phone', message: 'Phone number is required for guardians' });
  }

  // Validate phone
  if (!validateIsraeliPhone(phoneResult.value)) {
    return respond(context, 400, { error: 'invalid_phone', message: 'Invalid Israeli phone number' });
  }

  // Optional fields
  const middleNameResult = coerceOptionalString(body.middle_name);
  if (!middleNameResult.valid) {
    return respond(context, 400, { error: 'invalid_middle_name' });
  }

  const lastNameResult = coerceOptionalString(body.last_name);
  if (!lastNameResult.valid) {
    return respond(context, 400, { error: 'invalid_last_name' });
  }

  const emailResult = coerceOptionalEmail(body.email);
  if (!emailResult.valid) {
    return respond(context, 400, { error: 'invalid_email' });
  }

  const payload = {
    first_name: firstNameResult.value,
    middle_name: middleNameResult.value,
    last_name: lastNameResult.value,
    phone: phoneResult.value,
    email: emailResult.value,
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

  // Allow updating name, phone, email
  if (body.first_name !== undefined) {
    const firstNameResult = coerceOptionalString(body.first_name);
    if (!firstNameResult.valid || !firstNameResult.value) {
      return respond(context, 400, { error: 'invalid_first_name' });
    }
    updates.first_name = firstNameResult.value;
  }

  if (body.middle_name !== undefined) {
    const middleNameResult = coerceOptionalString(body.middle_name);
    if (!middleNameResult.valid) {
      return respond(context, 400, { error: 'invalid_middle_name' });
    }
    updates.middle_name = middleNameResult.value;
  }

  if (body.last_name !== undefined) {
    const lastNameResult = coerceOptionalString(body.last_name);
    if (!lastNameResult.valid) {
      return respond(context, 400, { error: 'invalid_last_name' });
    }
    updates.last_name = lastNameResult.value;
  }

  if (body.phone !== undefined) {
    const phoneResult = coerceOptionalString(body.phone);
    if (!phoneResult.valid || !phoneResult.value) {
      return respond(context, 400, { error: 'phone_required', message: 'Phone number cannot be empty' });
    }
    if (!validateIsraeliPhone(phoneResult.value)) {
      return respond(context, 400, { error: 'invalid_phone' });
    }
    updates.phone = phoneResult.value;
  }

  if (body.email !== undefined) {
    const emailResult = coerceOptionalEmail(body.email);
    if (!emailResult.valid) {
      return respond(context, 400, { error: 'invalid_email' });
    }
    updates.email = emailResult.value;
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
  // Check if guardian has students (via junction table per PRD)
  const { data: links, error: checkError } = await tenantClient
    .from('student_guardians')
    .select('id')
    .eq('guardian_id', guardianId)
    .limit(1);

  if (checkError) {
    context.log.error('[guardians/DELETE] Check error:', checkError);
    return respond(context, 500, { error: 'database_error' });
  }

  if (links && links.length > 0) {
    return respond(context, 400, { 
      error: 'guardian_has_students', 
      message: 'Cannot delete guardian with students. Remove student links first.' 
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
