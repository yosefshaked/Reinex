/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';

/**
 * POST /api/instructors-link-user
 * Links an existing manual employee to a system user by sending an invitation.
 * 
 * Body: { org_id, instructor_id, email }
 * 
 * Process:
 * 1. Verify employee exists and has no user_id
 * 2. Send invitation to email
 * 3. Store invitation_pending metadata
 * 4. When user accepts, the invitation system will link the employee
 */
export default async function (context, req) {
  const method = String(req.method || 'POST').toUpperCase();

  if (method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('instructors-link-user missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('instructors-link-user missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('instructors-link-user failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseJsonBodyWithLimit(req, 96 * 1024, { mode: 'observe', context, endpoint: 'instructors-link-user' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('instructors-link-user failed to verify membership', {
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
  if (!isAdmin) {
    return respond(context, 403, { message: 'admin_required' });
  }

  const instructorId = normalizeString(body?.instructor_id);
  const email = normalizeString(body?.email).toLowerCase();

  if (!instructorId || !email) {
    return respond(context, 400, { message: 'missing_instructor_id_or_email' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  // Verify employee exists and has no user_id
  const { data: employee, error: fetchError } = await tenantClient
    .from('Employees')
    .select('id, user_id, first_name, last_name, email, metadata')
    .eq('id', instructorId)
    .maybeSingle();

  if (fetchError) {
    context.log?.error?.('instructors-link-user failed to fetch employee', { message: fetchError.message });
    return respond(context, 500, { message: 'failed_to_fetch_employee' });
  }

  if (!employee) {
    return respond(context, 404, { message: 'employee_not_found' });
  }

  if (employee.user_id) {
    return respond(context, 400, { message: 'employee_already_linked' });
  }

  // Send invitation
  try {
    const invitationPayload = {
      org_id: orgId,
      email,
      invited_by: userId,
      role: 'member',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      metadata: {
        link_to_employee_id: instructorId,
        employee_name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
      },
    };

    // Create invitation record
    const { error: inviteError } = await supabase
      .from('invitations')
      .insert(invitationPayload);

    if (inviteError) {
      throw new Error(inviteError.message);
    }

    // Send Supabase auth invitation
    const { error: authError } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { org_id: orgId },
      redirectTo: `${process.env.VITE_PUBLIC_APP_URL || process.env.VITE_APP_BASE_URL}/#/complete-registration`,
    });

    if (authError) {
      context.log?.warn?.('instructors-link-user auth invitation failed', { message: authError.message });
    }

    // Update employee metadata to track pending invitation
    const updatedMetadata = {
      ...(employee.metadata || {}),
      invitation_pending: {
        email,
        invited_at: new Date().toISOString(),
        invited_by: userId,
      },
    };

    await tenantClient
      .from('Employees')
      .update({ metadata: updatedMetadata, email })
      .eq('id', instructorId);

    return respond(context, 200, {
      message: 'invitation_sent',
      email,
      employee_id: instructorId,
    });
  } catch (error) {
    context.log?.error?.('instructors-link-user failed to send invitation', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_send_invitation', error: error?.message });
  }
}
