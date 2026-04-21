/* eslint-env node */
import { randomUUID } from 'node:crypto';
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
import { findAuthUserByEmail, getAuthUserById } from '../_shared/auth-users.js';
import { buildPublicAppHashRouteUrl } from '../_shared/public-app-url.js';
import { deliverInvitationEmail } from '../_shared/invitation-email.js';
import { buildAccountDisplayName } from '../_shared/account-profile.js';

const DEFAULT_INVITATION_TTL_DAYS = 3;

async function loadEmployee(client, orgId, employeeId) {
  const { data, error } = await withOrgScope(client, 'Employees', orgId)
    .select('id, user_id, first_name, last_name, email, metadata')
    .eq('id', employeeId)
    .maybeSingle();

  return { employee: data, error };
}

async function fetchOrganizationName(supabase, orgId) {
  if (!orgId) {
    return null;
  }

  const { data } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle();

  return data?.name ?? null;
}

async function findExistingMemberByEmail(supabase, orgId, email) {
  let authUser = null;
  try {
    authUser = await findAuthUserByEmail(supabase, email);
  } catch (error) {
    return { error, userId: null };
  }

  if (!authUser?.id) {
    return { error: null, userId: null };
  }

  const membershipResult = await supabase
    .from('org_memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (membershipResult.error) {
    return { error: membershipResult.error, userId: null };
  }

  return { error: null, userId: membershipResult.data?.user_id ?? null };
}

function isExpiredTimestamp(timestamp) {
  if (!timestamp) {
    return false;
  }

  const expiresAt = new Date(timestamp);
  if (Number.isNaN(expiresAt.getTime())) {
    return false;
  }

  return expiresAt.getTime() <= Date.now();
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }
  return false;
}

function shouldSendAuthInviteEmail(authUser) {
  if (!authUser?.id) {
    return true;
  }
  return !authUser.email_confirmed_at;
}

async function findPendingInvitation(supabase, orgId, email) {
  const { data, error } = await supabase
    .from('org_invitations')
    .select('id, status, expires_at')
    .eq('org_id', orgId)
    .eq('email', email)
    .eq('status', 'pending')
    .maybeSingle();

  return { invitation: data, error };
}

async function markInvitationExpired(supabase, invitationId) {
  if (!invitationId) {
    return;
  }

  await supabase
    .from('org_invitations')
    .update({ status: 'expired' })
    .eq('id', invitationId);
}

async function logInvitationExpired(supabase, { invitation, actor, reason = 'expired' }) {
  if (!invitation?.id) {
    return;
  }

  await logAuditEvent(supabase, {
    orgId: invitation.org_id,
    userId: actor.userId,
    userEmail: actor.userEmail || '',
    userRole: actor.userRole || 'system',
    actionType: AUDIT_ACTIONS.INVITATION_EXPIRED,
    actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
    resourceType: 'invitation',
    resourceId: invitation.id,
    details: {
      invited_email: invitation.email ?? null,
      expires_at: invitation.expires_at ?? null,
      reason,
      employee_id: invitation.employee_id ?? null,
    },
  });
}

async function logInvitationSendFailed(supabase, { orgId, actor, invitationId = null, email, employeeId = null, reason, stage }) {
  await logAuditEvent(supabase, {
    orgId,
    userId: actor.userId,
    userEmail: actor.userEmail || '',
    userRole: actor.userRole || 'system',
    actionType: AUDIT_ACTIONS.INVITATION_SEND_FAILED,
    actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
    resourceType: 'invitation',
    resourceId: invitationId,
    details: {
      invited_email: email,
      employee_id: employeeId,
      stage,
      reason,
    },
  });
}

async function updateAuthUserInvitationMetadata(supabase, authUser, invitationMetadata) {
  if (!authUser?.id) {
    return;
  }

  const previousMetadata = authUser.user_metadata && typeof authUser.user_metadata === 'object'
    ? authUser.user_metadata
    : {};
  const nextMetadata = {
    ...previousMetadata,
    ...invitationMetadata,
  };

  const { error } = await supabase.auth.admin.updateUserById(authUser.id, {
    user_metadata: nextMetadata,
  });

  if (error) {
    throw error;
  }
}

async function rotatePendingInvitation(supabase, invitationId, updates) {
  const { data, error } = await supabase
    .from('org_invitations')
    .update({
      ...updates,
      status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', invitationId)
    .select('id, org_id, email, status, token, invited_by, created_at, expires_at')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function sendInvitationFlow({
  context,
  req,
  env,
  supabase,
  authResult,
  role,
  orgId,
  userId,
  employee,
  employeeId,
  email,
  resendPending = false,
}) {
  const { error: existingMemberError, userId: existingMemberUserId } = await findExistingMemberByEmail(supabase, orgId, email);
  if (existingMemberError) {
    throw new Error(`failed_to_verify_existing_member:${existingMemberError.message}`);
  }

  if (existingMemberUserId) {
    return respond(context, 409, { message: 'user_already_member' });
  }

  const { invitation: pendingInvitation, error: pendingInvitationError } = await findPendingInvitation(supabase, orgId, email);
  if (pendingInvitationError) {
    throw new Error(`failed_to_check_pending_invitations:${pendingInvitationError.message}`);
  }

  if (pendingInvitation) {
    if (isExpiredTimestamp(pendingInvitation.expires_at)) {
      await markInvitationExpired(supabase, pendingInvitation.id);
      await logInvitationExpired(supabase, {
        invitation: { ...pendingInvitation, org_id: orgId, email, employee_id: employeeId },
        actor: { userId, userEmail: authResult.data.user.email || '', userRole: role },
        reason: 'expired_before_reinvite',
      });
    } else {
      if (!resendPending) {
        return respond(context, 409, {
          message: 'invitation_already_pending',
          can_resend: true,
          invitation_id: pendingInvitation.id,
          expires_at: pendingInvitation.expires_at ?? null,
        });
      }
    }
  }

  const invitationId = pendingInvitation?.id || randomUUID();
  const invitationToken = randomUUID();
  const expiresAt = new Date(Date.now() + DEFAULT_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const employeeName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
  const inviterName = `${authResult.data.user.user_metadata?.full_name || ''}`.trim() || authResult.data.user.email || '';
  const organizationName = await fetchOrganizationName(supabase, orgId);
  const authInviteRedirect = buildPublicAppHashRouteUrl(req, env, '/complete-registration', { fallback: 'https://reinex.thepcrunners.com' });
  const existingUserRedirect = buildPublicAppHashRouteUrl(req, env, '/accept-invite', { fallback: 'https://reinex.thepcrunners.com' });
  const invitationPayload = {
    id: invitationId,
    org_id: orgId,
    email,
    invited_by: userId,
    role: 'member',
    status: 'pending',
    token: invitationToken,
    expires_at: expiresAt,
  };
  const invitationMetadata = {
    orgId,
    org_id: orgId,
    invitationId,
    invitation_id: invitationId,
    invitationToken,
    invitation_token: invitationToken,
    link_to_employee_id: employeeId,
    employee_name: employeeName,
    inviter_name: inviterName,
    organization_name: organizationName,
    orgName: organizationName,
  };

  let authUser = null;
  try {
    authUser = await findAuthUserByEmail(supabase, email);
  } catch (error) {
    throw new Error(`failed_to_verify_auth_user:${error.message}`);
  }

  const authUserExists = Boolean(authUser?.id);
  const sendAuthInviteEmail = shouldSendAuthInviteEmail(authUser);
  let deliveryProvider = sendAuthInviteEmail ? null : 'none';
  let fallbackUsed = false;

  if (sendAuthInviteEmail) {
    if (authUserExists) {
      try {
        await updateAuthUserInvitationMetadata(supabase, authUser, invitationMetadata);
      } catch (metadataError) {
        await logInvitationSendFailed(supabase, {
          orgId,
          actor: { userId, userEmail: authResult.data.user.email || '', userRole: role },
          invitationId,
          email,
          employeeId,
          stage: 'update_auth_metadata',
          reason: metadataError.message,
        });
        throw metadataError;
      }
    }

    try {
      const deliveryResult = await deliverInvitationEmail({
        supabase,
        env,
        context,
        email,
        redirectTo: authInviteRedirect,
        invitationToken,
        inviteMetadata: invitationMetadata,
        inviterName,
        organizationName,
        expiresAt,
        mode: 'auth_invite',
      });
      deliveryProvider = deliveryResult.deliveryProvider;
      fallbackUsed = Boolean(deliveryResult.fallbackUsed);
    } catch (authError) {
      await logInvitationSendFailed(supabase, {
        orgId,
        actor: { userId, userEmail: authResult.data.user.email || '', userRole: role },
        invitationId,
        email,
        employeeId,
        stage: 'send_auth_email',
        reason: authError.message,
      });
      throw new Error(authError.message);
    }
  } else {
    try {
      const deliveryResult = await deliverInvitationEmail({
        supabase,
        env,
        context,
        email,
        redirectTo: existingUserRedirect,
        invitationToken,
        inviteMetadata: invitationMetadata,
        inviterName,
        organizationName,
        expiresAt,
        mode: 'existing_user_org_invite',
      });
      deliveryProvider = deliveryResult.deliveryProvider;
      fallbackUsed = Boolean(deliveryResult.fallbackUsed);
    } catch (deliveryError) {
      await logInvitationSendFailed(supabase, {
        orgId,
        actor: { userId, userEmail: authResult.data.user.email || '', userRole: role },
        invitationId,
        email,
        employeeId,
        stage: 'send_existing_user_email',
        reason: deliveryError.message,
      });
      throw new Error(deliveryError.message);
    }
  }

  if (resendPending && pendingInvitation?.id) {
    try {
      await rotatePendingInvitation(supabase, pendingInvitation.id, {
        invited_by: userId,
        token: invitationToken,
        expires_at: expiresAt,
      });
    } catch (rotationError) {
      await logInvitationSendFailed(supabase, {
        orgId,
        actor: { userId, userEmail: authResult.data.user.email || '', userRole: role },
        invitationId,
        email,
        employeeId,
        stage: 'rotate_pending_invitation',
        reason: rotationError.message,
      });
      throw rotationError;
    }
  } else {
    const { error: createInvitationError } = await supabase
      .from('org_invitations')
      .insert(invitationPayload);

    if (createInvitationError) {
      await logInvitationSendFailed(supabase, {
        orgId,
        actor: { userId, userEmail: authResult.data.user.email || '', userRole: role },
        invitationId,
        email,
        employeeId,
        stage: 'persist_invitation',
        reason: createInvitationError.message,
      });
      throw new Error(createInvitationError.message);
    }
  }

  const updatedMetadata = {
    ...(employee.metadata && typeof employee.metadata === 'object' ? employee.metadata : {}),
    invitation_pending: {
      email,
      invited_at: new Date().toISOString(),
      invited_by: userId,
      invitation_id: invitationId,
      invitation_token: invitationToken,
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
    actionType: resendPending ? AUDIT_ACTIONS.INVITATION_RESENT : AUDIT_ACTIONS.MEMBER_INVITED,
    actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
    resourceType: 'invitation',
    resourceId: invitationId,
    details: {
      employee_id: employeeId,
      employee_name: employeeName,
      invited_email: email,
      invitation_id: invitationId,
      invitation_token_rotated: Boolean(resendPending),
      link_to_employee_id: employeeId,
      expires_at: expiresAt,
      delivery_provider: deliveryProvider,
      used_email_fallback: fallbackUsed,
    },
  });

  return respond(context, 200, {
    message: resendPending ? 'invitation_resent' : 'invitation_sent',
    email,
    employee_id: employeeId,
    user_exists: Boolean(authUserExists),
    invitation_id: invitationId,
    resent: Boolean(resendPending),
    email_sent: true,
    delivery_provider: deliveryProvider,
    used_email_fallback: fallbackUsed,
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
    .select('id, first_name, last_name')
    .eq('id', memberUserId)
    .maybeSingle();
  const memberAuthUser = await getAuthUserById(supabase, memberUserId).catch(() => null);

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
      member_email: memberAuthUser?.email || null,
      member_name: buildAccountDisplayName({
        profile: memberProfile,
        authUser: memberAuthUser,
        email: memberAuthUser?.email,
      }) || null,
    },
  });

  return respond(context, 200, {
    message: 'member_linked',
    employee: updatedEmployee,
    member: memberProfile
      ? {
        ...memberProfile,
        full_name: buildAccountDisplayName({
          profile: memberProfile,
          authUser: memberAuthUser,
          email: memberAuthUser?.email,
        }) || null,
        email: memberAuthUser?.email || null,
      }
      : { id: memberUserId, role: membership.role, email: memberAuthUser?.email || null },
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
  const resendPending = normalizeBoolean(body?.resend_pending ?? body?.resendPending ?? body?.resend);

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
      req,
      env,
      supabase,
      authResult,
      role,
      orgId,
      userId,
      employee,
      employeeId,
      email,
      resendPending,
    });
  } catch (error) {
    context.log?.error?.('instructors-link-user failed to send invitation', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_send_invitation', error: error?.message });
  }
}
