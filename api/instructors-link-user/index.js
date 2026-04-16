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
  withOrgScope,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, logAuditEvent } from '../_shared/audit-log.js';

async function loadEmployee(client, orgId, employeeId) {
  const { data, error } = await withOrgScope(client, 'Employees', orgId)
    .select('id, user_id, first_name, last_name, email, metadata')
    .eq('id', employeeId)
    .maybeSingle();

  return { employee: data, error };
}

async function sendInvitationFlow({
  context,
  supabase,
  authResult,
  role,
  orgId,
  userId,
  employee,
  employeeId,
  email,
}) {
  const invitationPayload = {
    org_id: orgId,
    email,
    invited_by: userId,
    role: 'member',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    metadata: {
      link_to_employee_id: employeeId,
      employee_name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
    },
  };

  const { error: inviteError } = await supabase
    .from('invitations')
    .insert(invitationPayload);

  if (inviteError) {
    throw new Error(inviteError.message);
  }

  const { error: authError } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { org_id: orgId },
    redirectTo: `${process.env.VITE_PUBLIC_APP_URL || process.env.VITE_APP_BASE_URL}/#/complete-registration`,
  });

  if (authError) {
    context.log?.warn?.('instructors-link-user auth invitation failed', { message: authError.message });
  }

  const updatedMetadata = {
    ...(employee.metadata && typeof employee.metadata === 'object' ? employee.metadata : {}),
    invitation_pending: {
      email,
      invited_at: new Date().toISOString(),
      invited_by: userId,
    },
  };

  await withOrgScope(supabase, 'Employees', orgId)
    .update({ metadata: updatedMetadata, email })
    .eq('id', employeeId);

  await logAuditEvent(supabase, {
    orgId,
    userId,
    userEmail: authResult.data.user.email || '',
    userRole: role,
    actionType: AUDIT_ACTIONS.MEMBER_INVITED,
    actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
    resourceType: 'instructor',
    resourceId: employeeId,
    details: {
      employee_id: employeeId,
      employee_name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
      invited_email: email,
    },
  });

  return respond(context, 200, {
    message: 'invitation_sent',
    email,
    employee_id: employeeId,
  });
}

async function directLinkFlow({
  context,
  supabase,
  authResult,
  role,
  orgId,
  userId,
  employee,
  employeeId,
  memberUserId,
}) {
  const { data: membership, error: membershipLookupError } = await supabase
    .from('org_memberships')
    .select('user_id, role')
    .eq('org_id', orgId)
    .eq('user_id', memberUserId)
    .maybeSingle();

  if (membershipLookupError) {
    context.log?.error?.('instructors-link-user failed to verify target member', {
      message: membershipLookupError.message,
      orgId,
      memberUserId,
    });
    return respond(context, 500, { message: 'failed_to_verify_target_member' });
  }

  if (!membership) {
    return respond(context, 404, { message: 'member_not_found_in_org' });
  }

  const { data: conflictingEmployee, error: conflictError } = await withOrgScope(supabase, 'Employees', orgId)
    .select('id')
    .eq('user_id', memberUserId)
    .neq('id', employeeId)
    .maybeSingle();

  if (conflictError) {
    context.log?.error?.('instructors-link-user failed to verify existing employee link', {
      message: conflictError.message,
      orgId,
      memberUserId,
    });
    return respond(context, 500, { message: 'failed_to_verify_existing_link' });
  }

  if (conflictingEmployee) {
    return respond(context, 409, { message: 'member_already_linked' });
  }

  const metadata = {
    ...(employee.metadata && typeof employee.metadata === 'object' ? employee.metadata : {}),
  };
  delete metadata.invitation_pending;

  const { data: updatedEmployee, error: updateError } = await withOrgScope(supabase, 'Employees', orgId)
    .update({
      user_id: memberUserId,
      metadata,
    })
    .eq('id', employeeId)
    .select('id, user_id, first_name, last_name, email')
    .maybeSingle();

  if (updateError || !updatedEmployee) {
    context.log?.error?.('instructors-link-user failed to direct-link employee', {
      message: updateError?.message,
      orgId,
      employeeId,
      memberUserId,
    });
    return respond(context, 500, { message: 'failed_to_link_member_to_employee' });
  }

  const { data: memberProfile } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', memberUserId)
    .maybeSingle();

  await logAuditEvent(supabase, {
    orgId,
    userId,
    userEmail: authResult.data.user.email || '',
    userRole: role,
    actionType: AUDIT_ACTIONS.MEMBER_LINKED_TO_EMPLOYEE,
    actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
    resourceType: 'instructor',
    resourceId: employeeId,
    details: {
      employee_id: employeeId,
      employee_name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
      member_user_id: memberUserId,
      member_email: memberProfile?.email || null,
      member_name: memberProfile?.full_name || null,
    },
  });

  return respond(context, 200, {
    message: 'member_linked',
    employee: updatedEmployee,
    member: memberProfile || { id: memberUserId, role: membership.role },
  });
}

export default async function (context, req) {
  const method = String(req.method || 'POST').toUpperCase();

  if (method !== 'POST' && method !== 'PUT') {
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

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'admin_required' });
  }

  const employeeId = normalizeString(body?.employee_id || body?.instructor_id);
  const email = normalizeString(body?.email).toLowerCase();
  const memberUserId = normalizeString(body?.member_user_id || body?.memberUserId);

  if (!employeeId) {
    return respond(context, 400, { message: 'missing_employee_id' });
  }

  const { employee, error: fetchError } = await loadEmployee(supabase, orgId, employeeId);
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

  if (method === 'PUT') {
    if (!memberUserId) {
      return respond(context, 400, { message: 'missing_member_user_id' });
    }
    return directLinkFlow({
      context,
      supabase,
      authResult,
      role,
      orgId,
      userId,
      employee,
      employeeId,
      memberUserId,
    });
  }

  if (!email) {
    return respond(context, 400, { message: 'missing_email' });
  }

  try {
    return await sendInvitationFlow({
      context,
      supabase,
      authResult,
      role,
      orgId,
      userId,
      employee,
      employeeId,
      email,
    });
  } catch (error) {
    context.log?.error?.('instructors-link-user failed to send invitation', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_send_invitation', error: error?.message });
  }
}
