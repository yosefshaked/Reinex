/* eslint-env node */
import { randomUUID } from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { logAuditEvent, logSystemAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { readEnv, respond as _respond, isAdminRole } from '../_shared/org-bff.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { findAuthUserByEmail } from '../_shared/auth-users.js';
import { buildPublicAppHashRouteUrl, normalizeAbsoluteRedirectUrl } from '../_shared/public-app-url.js';
import { deliverInvitationEmail } from '../_shared/invitation-email.js';

const STATUS_PENDING = 'pending';
const STATUS_ACCEPTED = 'accepted';
const STATUS_REVOKED = 'revoked';
const STATUS_DECLINED = 'declined';
const STATUS_EXPIRED = 'expired';
const STATUS_FAILED = 'failed';
const DEFAULT_INVITATION_TTL_DAYS = 3;

function resolveUserFullName(user) {
  if (!user || typeof user !== 'object') {
    return '';
  }
  const metadata = user.user_metadata ?? {};
  const candidates = [metadata.full_name, metadata.fullName, metadata.name];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  if (typeof user.email === 'string' && user.email.trim()) {
    return user.email.trim();
  }
  return '';
}

function resolveAdminConfig(context) {
  return readSupabaseAdminConfig(readEnv(context));
}

function getAdminClient(context) {
  const config = resolveAdminConfig(context);
  if (!config.supabaseUrl || !config.serviceRoleKey) {
    return { client: null, error: new Error('missing_admin_credentials') };
  }
  return { client: createSupabaseAdminClient(config), error: null };
}

function respond(context, status, body, extraHeaders = {}) {
  return _respond(context, status, body, { 'Cache-Control': 'no-store', ...extraHeaders });
}

function parseRestSegments(context) {
  const raw = context?.bindingData?.restOfPath;
  if (typeof raw !== 'string' || !raw.trim()) {
    return [];
  }
  return raw
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function normalizeUuid(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  return emailPattern.test(trimmed) ? trimmed : null;
}

function normalizeRedirectUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeExpirationInput(value) {
  if (value === undefined || value === null || value === '') {
    return { value: null, valid: true };
  }
  if (value instanceof Date) {
    return { value: value.toISOString(), valid: true };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return { value: parsed.toISOString(), valid: true };
    }
    return { value: null, valid: false };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return { value: null, valid: true };
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return { value: parsed.toISOString(), valid: true };
    }
    return { value: null, valid: false };
  }
  return { value: null, valid: false };
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

function shouldSendAuthInviteEmail(authUser) {
  if (!authUser?.id) {
    return true;
  }
  return !authUser.email_confirmed_at;
}

function sanitizeInvitation(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    status: row.status,
    invitedBy: row.invited_by ?? null,
    createdAt: row.created_at ?? null,
    expiresAt: row.expires_at ?? null,
  };
}

function stripEmployeeInvitationPending(metadata, invitationId) {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata }
    : {};
  const pending = base.invitation_pending && typeof base.invitation_pending === 'object' && !Array.isArray(base.invitation_pending)
    ? base.invitation_pending
    : null;

  if (!pending) {
    return base;
  }

  const matchesInvitation = !invitationId || pending.invitation_id === invitationId;
  if (!matchesInvitation) {
    return base;
  }

  delete base.invitation_pending;
  return base;
}

async function findEmployeeByPendingInvitation(supabase, orgId, invitation) {
  const invitationId = invitation?.id || null;
  const invitationToken = invitation?.token || null;
  if (!orgId || (!invitationId && !invitationToken)) {
    return null;
  }

  const pendingByIdFilter = invitationId
    ? { invitation_pending: { invitation_id: invitationId } }
    : null;
  const pendingByTokenFilter = invitationToken
    ? { invitation_pending: { invitation_token: invitationToken } }
    : null;

  const attempts = [pendingByIdFilter, pendingByTokenFilter].filter(Boolean);
  for (const filter of attempts) {
    const result = await supabase
      .from('Employees')
      .select('id, org_id, user_id, email, metadata, first_name, last_name')
      .eq('org_id', orgId)
      .contains('metadata', filter)
      .limit(1)
      .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    if (result.data) {
      return result.data;
    }
  }

  return null;
}

async function finalizeEmployeeInvitationLink(context, supabase, invitation, authUser) {
  const employee = await findEmployeeByPendingInvitation(supabase, invitation.org_id, invitation);
  if (!employee?.id) {
    return { linked: false, employeeId: null };
  }

  if (employee.user_id && employee.user_id !== authUser.id) {
    const error = new Error('employee already linked to another user');
    error.statusCode = 409;
    error.code = 'employee_already_linked';
    error.employeeId = employee.id;
    throw error;
  }

  const nextMetadata = stripEmployeeInvitationPending(employee.metadata, invitation.id);
  const updateResult = await supabase
    .from('Employees')
    .update({
      user_id: authUser.id,
      email: invitation.email,
      metadata: nextMetadata,
    })
    .eq('org_id', invitation.org_id)
    .eq('id', employee.id)
    .select('id, user_id')
    .maybeSingle();

  if (updateResult.error) {
    context.log?.error?.('invitations failed to finalize employee link', {
      invitationId: invitation.id,
      employeeId: employee.id,
      message: updateResult.error.message,
    });
    const error = new Error('failed to link employee');
    error.statusCode = 500;
    error.code = 'failed_to_link_employee';
    throw error;
  }

  return { linked: true, employeeId: employee.id };
}

async function getAuthenticatedUser(context, req, supabase) {
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    respond(context, 401, { message: 'missing bearer' });
    return null;
  }
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.warn?.('invitations failed to validate bearer token', { message: error?.message });
    respond(context, 401, { message: 'invalid or expired token' });
    return null;
  }
  if (authResult.error || !authResult.data?.user?.id) {
    respond(context, 401, { message: 'invalid or expired token' });
    return null;
  }
  const user = authResult.data.user;
  return {
    id: user.id,
    email: typeof user.email === 'string' ? user.email.toLowerCase() : null,
  };
}

async function requireAdminForOrg(context, supabase, orgId, userId) {
  const membershipResult = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipResult.error) {
    context.log?.error?.('invitations failed to load membership', {
      orgId,
      userId,
      message: membershipResult.error.message,
    });
    respond(context, 500, { message: 'failed to verify membership' });
    return null;
  }

  if (!membershipResult.data || !isAdminRole(membershipResult.data.role)) {
    respond(context, 403, { message: 'forbidden' });
    return null;
  }

  return membershipResult.data.role;
}

async function fetchOrganization(context, supabase, orgId) {
  const orgResult = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();

  if (orgResult.error) {
    context.log?.error?.('invitations failed to load organization', {
      orgId,
      message: orgResult.error.message,
    });
    respond(context, 500, { message: 'failed to load organization' });
    return null;
  }

  if (!orgResult.data) {
    respond(context, 404, { message: 'organization not found' });
    return null;
  }

  return orgResult.data;
}

async function findExistingMemberByEmail(supabase, orgId, email) {
  let authUser = null;
  try {
    authUser = await findAuthUserByEmail(supabase, email);
  } catch (error) {
    return { error };
  }

  if (!authUser?.id) {
    return { userId: null };
  }

  const membershipResult = await supabase
    .from('org_memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (membershipResult.error) {
    return { error: membershipResult.error };
  }

  if (membershipResult.data) {
    return { userId: authUser.id };
  }
  return { userId: null };
}

async function findPendingInvitation(supabase, orgId, email) {
  const invitationResult = await supabase
    .from('org_invitations')
    .select('id, status, expires_at')
    .eq('org_id', orgId)
    .eq('email', email)
    .in('status', [STATUS_PENDING])
    .maybeSingle();

  if (invitationResult.error) {
    return { error: invitationResult.error };
  }

  if (!invitationResult.data) {
    return { invitation: null };
  }

  return { invitation: invitationResult.data };
}

async function markInvitationExpired(supabase, invitationId) {
  if (!invitationId) {
    return;
  }
  await supabase
    .from('org_invitations')
    .update({ status: STATUS_EXPIRED })
    .eq('id', invitationId);
}

async function logInvitationExpired({ supabase, invitation, actor = null, reason = 'expired' }) {
  if (!invitation?.id) {
    return;
  }

  const details = {
    invited_email: invitation.email ?? null,
    expires_at: invitation.expires_at ?? null,
    reason,
  };

  if (actor?.userId) {
    await logAuditEvent(supabase, {
      orgId: invitation.org_id,
      userId: actor.userId,
      userEmail: actor.userEmail || '',
      userRole: actor.userRole || 'system',
      actionType: AUDIT_ACTIONS.INVITATION_EXPIRED,
      actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
      resourceType: 'invitation',
      resourceId: invitation.id,
      details,
    });
    return;
  }

  await logSystemAuditEvent(supabase, {
    orgId: invitation.org_id,
    actionType: AUDIT_ACTIONS.INVITATION_EXPIRED,
    actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
    resourceType: 'invitation',
    resourceId: invitation.id,
    details,
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

  const metadataResult = await supabase.auth.admin.updateUserById(authUser.id, {
    user_metadata: nextMetadata,
  });

  if (metadataResult.error) {
    throw metadataResult.error;
  }
}

async function rotatePendingInvitation(supabase, invitationId, updates) {
  const result = await supabase
    .from('org_invitations')
    .update({
      ...updates,
      status: STATUS_PENDING,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invitationId)
    .select('id, token, email, status, invited_by, created_at, expires_at, org_id')
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data ?? null;
}

async function handleCreateInvitation(context, req, supabase) {
  const authUser = await getAuthenticatedUser(context, req, supabase);
  if (!authUser) {
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const orgId = normalizeUuid(body.orgId ?? body.org_id ?? body.organizationId);
  const email = normalizeEmail(body.email);
  const resendPending = normalizeBoolean(body.resendPending ?? body.resend_pending ?? body.resend);
  
  // Client can optionally provide explicit expiration, or we calculate it smartly
  let expiresAt = null;
  const clientExpiration = body.expiresAt ?? body.expires_at;
  if (clientExpiration !== undefined && clientExpiration !== null && clientExpiration !== '') {
    const expiration = normalizeExpirationInput(clientExpiration);
    if (!expiration.valid) {
      respond(context, 400, { message: 'invalid expiration' });
      return;
    }
    expiresAt = expiration.value;
  }

  // If client didn't provide a redirect, default to the site's complete-registration route
  const env = readEnv(context);
  const providedRedirect = normalizeAbsoluteRedirectUrl(body.redirectTo ?? body.redirect_to)
    || normalizeRedirectUrl(body.redirectTo ?? body.redirect_to);
  const defaultRedirect = buildPublicAppHashRouteUrl(req, env, '/complete-registration', { fallback: 'https://reinex.thepcrunners.com' });
  const redirectTo = providedRedirect || defaultRedirect;
  const emailData = body.emailData && typeof body.emailData === 'object' ? { ...body.emailData } : {};

  if (!orgId) {
    respond(context, 400, { message: 'missing orgId' });
    return;
  }

  if (!email) {
    respond(context, 400, { message: 'invalid email' });
    return;
  }

  const organization = await fetchOrganization(context, supabase, orgId);
  if (!organization) {
    return;
  }

  const role = await requireAdminForOrg(context, supabase, orgId, authUser.id);
  if (!role) {
    return;
  }

  if (expiresAt === null) {
    expiresAt = new Date(Date.now() + DEFAULT_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  }

  const { error: memberLookupError, userId: existingUserId } = await findExistingMemberByEmail(supabase, orgId, email);
  if (memberLookupError) {
    context.log?.error?.('invitations failed to verify member by email', {
      orgId,
      email,
      message: memberLookupError.message,
    });
    respond(context, 500, { message: 'failed to verify member' });
    return;
  }

  if (existingUserId) {
    respond(context, 409, { message: 'user already a member' });
    return;
  }

  let existingAuthUser = null;
  try {
    existingAuthUser = await findAuthUserByEmail(supabase, email);
  } catch (error) {
    context.log?.error?.('Failed to check for existing user via auth admin lookup', {
      orgId,
      email,
      message: error.message,
    });
    respond(context, 500, { message: 'Failed to verify auth user.' });
    return;
  }

  const authUserExists = Boolean(existingAuthUser?.id);
  const sendAuthInviteEmail = shouldSendAuthInviteEmail(existingAuthUser);
  let deliveryProvider = sendAuthInviteEmail ? null : 'none';
  let fallbackUsed = false;

  const { error: pendingError, invitation: pendingInvitation } = await findPendingInvitation(supabase, orgId, email);
  if (pendingError) {
    context.log?.error?.('invitations failed to verify pending invitation', {
      orgId,
      email,
      message: pendingError.message,
    });
    respond(context, 500, { message: 'failed to check pending invitations' });
    return;
  }

  if (pendingInvitation) {
    if (isExpiredTimestamp(pendingInvitation.expires_at)) {
      await markInvitationExpired(supabase, pendingInvitation.id);
      await logInvitationExpired({
        supabase,
        invitation: { ...pendingInvitation, org_id: orgId, email },
        actor: { userId: authUser.id, userEmail: authUser.email || '', userRole: role },
        reason: 'expired_before_reinvite',
      });
    } else {
      if (!resendPending) {
        respond(context, 409, {
          message: 'invitation already pending',
          canResend: true,
          invitationId: pendingInvitation.id,
          expiresAt: pendingInvitation.expires_at ?? null,
        });
        return;
      }
    }
  }

  const baseInvitationPayload = {
    org_id: orgId,
    email,
    invited_by: authUser.id,
    status: STATUS_PENDING,
    expires_at: expiresAt,
  };

  const redirectUrl = redirectTo || null;
  const invitationId = pendingInvitation?.id || randomUUID();
  const invitationToken = randomUUID();

  if (sendAuthInviteEmail) {
    const inviterResult = await supabase.auth.admin.getUserById(authUser.id);
    if (inviterResult.error || !inviterResult.data?.user) {
      context.log?.error?.('invitations failed to load inviter profile', {
        orgId,
        invitedBy: authUser.id,
        message: inviterResult.error?.message ?? 'inviter not found',
      });
      respond(context, 500, { message: 'failed to personalize invitation email' });
      return;
    }

    const inviterName = resolveUserFullName(inviterResult.data.user) || null;
    const inviteMetadata = {
      ...emailData,
      orgId,
      orgName: organization.name ?? null,
      organization_name: organization.name ?? null,
      inviter_name: inviterName,
      invitationId,
      invitation_id: invitationId,
      invitationToken,
      invitation_token: invitationToken,
    };

    if (authUserExists) {
      try {
        await updateAuthUserInvitationMetadata(supabase, existingAuthUser, inviteMetadata);
      } catch (metadataError) {
        context.log?.error?.('invitations failed to update auth user metadata before resend', {
          orgId,
          email,
          invitationId,
          message: metadataError.message,
        });
        await logAuditEvent(supabase, {
          orgId,
          userId: authUser.id,
          userEmail: authUser.email || '',
          userRole: role,
          actionType: AUDIT_ACTIONS.INVITATION_SEND_FAILED,
          actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
          resourceType: 'invitation',
          resourceId: invitationId,
          details: {
            invited_email: email,
            stage: 'update_auth_metadata',
            reason: metadataError.message,
          },
        });
        respond(context, 500, { message: 'failed to prepare invitation email' });
        return;
      }
    }

    try {
      const deliveryResult = await deliverInvitationEmail({
        supabase,
        env,
        context,
        email,
        redirectTo: redirectUrl || undefined,
        invitationToken,
        inviteMetadata,
        inviterName,
        organizationName: organization.name ?? null,
        expiresAt,
      });
      deliveryProvider = deliveryResult.deliveryProvider;
      fallbackUsed = Boolean(deliveryResult.fallbackUsed);
    } catch (inviteResultError) {
      context.log?.error?.('invitations failed to send email invite', {
        orgId,
        email,
        invitationId,
        message: inviteResultError.message,
      });
      await logAuditEvent(supabase, {
        orgId,
        userId: authUser.id,
        userEmail: authUser.email || '',
        userRole: role,
        actionType: AUDIT_ACTIONS.INVITATION_SEND_FAILED,
        actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
        resourceType: 'invitation',
        resourceId: invitationId,
        details: {
          invited_email: email,
          stage: 'send_auth_email',
          reason: inviteResultError.message,
        },
      });
      respond(context, 502, { message: 'failed to send invitation email' });
      return;
    }
  }

  let persistedInvitation = null;
  if (resendPending && pendingInvitation?.id) {
    try {
      persistedInvitation = await rotatePendingInvitation(supabase, pendingInvitation.id, {
        invited_by: authUser.id,
        token: invitationToken,
        expires_at: expiresAt,
      });
    } catch (rotationError) {
      context.log?.error?.('invitations failed to rotate pending invitation', {
        orgId,
        email,
        invitationId,
        message: rotationError.message,
      });
      await logAuditEvent(supabase, {
        orgId,
        userId: authUser.id,
        userEmail: authUser.email || '',
        userRole: role,
        actionType: AUDIT_ACTIONS.INVITATION_SEND_FAILED,
        actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
        resourceType: 'invitation',
        resourceId: invitationId,
        details: {
          invited_email: email,
          stage: 'rotate_pending_invitation',
          reason: rotationError.message,
        },
      });
      respond(context, 500, { message: 'failed to update invitation' });
      return;
    }
  } else {
    const insertResult = await supabase
      .from('org_invitations')
      .insert({ ...baseInvitationPayload, id: invitationId, token: invitationToken })
      .select('id, token, email, status, invited_by, created_at, expires_at, org_id')
      .maybeSingle();

    if (insertResult.error || !insertResult.data) {
      context.log?.error?.('invitations failed to persist invitation after email send', {
        orgId,
        email,
        invitationId,
        message: insertResult.error?.message,
      });
      await logAuditEvent(supabase, {
        orgId,
        userId: authUser.id,
        userEmail: authUser.email || '',
        userRole: role,
        actionType: AUDIT_ACTIONS.INVITATION_SEND_FAILED,
        actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
        resourceType: 'invitation',
        resourceId: invitationId,
        details: {
          invited_email: email,
          stage: 'persist_invitation',
          reason: insertResult.error?.message || 'missing invitation row',
        },
      });
      respond(context, 500, { message: 'failed to create invitation' });
      return;
    }
    persistedInvitation = insertResult.data;
  }

  respond(context, resendPending ? 200 : 201, {
    invitation: sanitizeInvitation(persistedInvitation),
    userExists: authUserExists,
    resent: Boolean(resendPending),
    emailSent: sendAuthInviteEmail,
    deliveryProvider,
    usedEmailFallback: fallbackUsed,
  });

  // Audit log: invitation created
  await logAuditEvent(supabase, {
    orgId,
    userId: authUser.id,
    userEmail: authUser.email || '',
    userRole: role,
    actionType: resendPending ? AUDIT_ACTIONS.INVITATION_RESENT : AUDIT_ACTIONS.MEMBER_INVITED,
    actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
    resourceType: 'invitation',
    resourceId: invitationId,
    details: {
      invited_email: email,
      expires_at: expiresAt,
      invitation_token_rotated: Boolean(resendPending),
      delivery_provider: deliveryProvider,
      used_email_fallback: fallbackUsed,
    },
  });
}

async function handleListPending(context, req, supabase) {
  const authUser = await getAuthenticatedUser(context, req, supabase);
  if (!authUser) {
    return;
  }
  const orgId = normalizeUuid(req.query?.orgId ?? req.query?.org_id ?? req.body?.orgId);
  if (!orgId) {
    respond(context, 400, { message: 'missing orgId' });
    return;
  }
  const role = await requireAdminForOrg(context, supabase, orgId, authUser.id);
  if (!role) {
    return;
  }
  const selectResult = await supabase
    .from('org_invitations')
    .select('id, org_id, email, status, invited_by, created_at, expires_at')
    .eq('org_id', orgId)
    .eq('status', STATUS_PENDING)
    .order('created_at', { ascending: false });

  if (selectResult.error) {
    context.log?.error?.('invitations failed to list pending invitations', {
      orgId,
      message: selectResult.error.message,
    });
    respond(context, 500, { message: 'failed to list invitations' });
    return;
  }

  const invitations = [];
  if (Array.isArray(selectResult.data)) {
    for (const invitation of selectResult.data) {
      if (isExpiredTimestamp(invitation.expires_at)) {
        await markInvitationExpired(supabase, invitation.id);
        await logInvitationExpired({
          supabase,
          invitation,
          actor: { userId: authUser.id, userEmail: authUser.email || '', userRole: role },
          reason: 'expired_while_listing',
        });
        continue;
      }
      const sanitized = sanitizeInvitation(invitation);
      if (sanitized) {
        invitations.push(sanitized);
      }
    }
  }

  respond(context, 200, { invitations });
}

async function loadInvitationById(context, supabase, invitationId) {
  const result = await supabase
    .from('org_invitations')
    .select('*')
    .eq('id', invitationId)
    .maybeSingle();

  if (result.error) {
    context.log?.error?.('invitations failed to load by id', {
      invitationId,
      message: result.error.message,
    });
    respond(context, 500, { message: 'failed to load invitation' });
    return null;
  }

  if (!result.data) {
    respond(context, 404, { message: 'invitation not found' });
    return null;
  }

  return result.data;
}

async function handleGetByToken(context, supabase, token) {
  if (!token) {
    respond(context, 400, { message: 'missing token' });
    return;
  }

  const result = await supabase
    .from('org_invitations')
    .select('id, org_id, email, status, created_at, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (result.error) {
    context.log?.error?.('invitations failed to load by token', {
      token,
      message: result.error.message,
    });
    respond(context, 500, { message: 'failed to load invitation' });
    return;
  }

  if (!result.data) {
    respond(context, 404, { message: 'invitation not found' });
    return;
  }

  const invitation = result.data;
  let resolvedStatus = invitation.status || STATUS_PENDING;

  if (resolvedStatus === STATUS_PENDING && isExpiredTimestamp(invitation.expires_at)) {
    await markInvitationExpired(supabase, invitation.id);
    await logInvitationExpired({
      supabase,
      invitation,
      reason: 'expired_on_token_lookup',
    });
    resolvedStatus = STATUS_EXPIRED;
  }

  const organization = await fetchOrganization(context, supabase, invitation.org_id);
  if (!organization) {
    return;
  }

  // Enrich with auth state (exists + email_confirmed) using RPC
  let authState = null;
  try {
    const { data: stateData, error: stateError } = await supabase.rpc('user_verification_state', {
      user_email: String(invitation.email || '').toLowerCase(),
    });
    if (!stateError && stateData) {
      // Function returns a single row/table or JSON depending on implementation. Normalize both.
      if (Array.isArray(stateData) && stateData.length) {
        const row = stateData[0];
        authState = {
          exists: !!(row.exists ?? row.user_exists),
          emailConfirmed: !!row.email_confirmed,
          lastSignInAt: row.last_sign_in_at ?? null,
        };
      } else if (typeof stateData === 'object') {
        authState = {
          exists: !!(stateData.exists ?? stateData.user_exists),
          emailConfirmed: !!stateData.email_confirmed,
          lastSignInAt: stateData.last_sign_in_at ?? null,
        };
      }
    }
  } catch (e) {
    context.log?.warn?.('invitations could not load auth state via rpc', { email: invitation.email, message: e?.message });
  }

  respond(context, 200, {
    invitation: {
      id: invitation.id,
      orgId: invitation.org_id,
      orgName: organization.name ?? null,
      email: invitation.email,
      status: resolvedStatus,
      createdAt: invitation.created_at ?? null,
      expiresAt: invitation.expires_at ?? null,
      auth: authState,
    },
  });
}

async function acceptInvitation(context, req, supabase, invitationId) {
  const authUser = await getAuthenticatedUser(context, req, supabase);
  if (!authUser) {
    return;
  }

  const invitation = await loadInvitationById(context, supabase, invitationId);
  if (!invitation) {
    return;
  }

  if (invitation.status !== STATUS_PENDING) {
    respond(context, 409, { message: `invitation ${invitation.status}` });
    return;
  }

  if (isExpiredTimestamp(invitation.expires_at)) {
    await markInvitationExpired(supabase, invitation.id);
    await logInvitationExpired({
      supabase,
      invitation,
      actor: { userId: authUser.id, userEmail: authUser.email || '', userRole: 'invitee' },
      reason: 'expired_on_accept',
    });
    respond(context, 410, { message: 'invitation expired' });
    return;
  }

  const userEmail = authUser.email;
  if (!userEmail || userEmail !== invitation.email.toLowerCase()) {
    respond(context, 403, { message: 'email mismatch' });
    return;
  }

  let employeeLinkResult = { linked: false, employeeId: null };
  try {
    employeeLinkResult = await finalizeEmployeeInvitationLink(context, supabase, invitation, authUser);
  } catch (error) {
    if (error?.statusCode === 409) {
      respond(context, 409, { message: error.code || 'employee already linked' });
      return;
    }
    context.log?.error?.('invitations failed to finalize employee link before accept', {
      invitationId,
      employeeId: error?.employeeId || null,
      message: error?.message,
    });
    respond(context, 500, { message: error?.code || 'failed to link employee' });
    return;
  }

  const membershipResult = await supabase
    .from('org_memberships')
    .upsert({ org_id: invitation.org_id, user_id: authUser.id, role: 'member' }, { onConflict: 'org_id,user_id' })
    .select('id')
    .maybeSingle();

  if (membershipResult.error) {
    context.log?.error?.('invitations failed to insert membership', {
      invitationId,
      message: membershipResult.error.message,
    });
    respond(context, 500, { message: 'failed to add membership' });
    return;
  }

  const updateResult = await supabase
    .from('org_invitations')
    .update({ status: STATUS_ACCEPTED })
    .eq('id', invitation.id);

  if (updateResult.error) {
    context.log?.error?.('invitations failed to mark accepted', {
      invitationId,
      message: updateResult.error.message,
    });
    respond(context, 500, { message: 'failed to update invitation' });
    return;
  }

  respond(context, 200, {
    message: 'invitation accepted',
    employeeLinked: employeeLinkResult.linked,
    employeeId: employeeLinkResult.employeeId,
  });
  await logAuditEvent(supabase, {
    orgId: invitation.org_id,
    userId: authUser.id,
    userEmail: authUser.email || '',
    userRole: 'invitee',
    actionType: AUDIT_ACTIONS.INVITATION_ACCEPTED,
    actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
    resourceType: 'invitation',
    resourceId: invitation.id,
    details: {
      invited_email: invitation.email,
      employee_linked: employeeLinkResult.linked,
      employee_id: employeeLinkResult.employeeId,
    },
  });
}

async function declineInvitation(context, req, supabase, invitationId) {
  const authUser = await getAuthenticatedUser(context, req, supabase);
  if (!authUser) {
    return;
  }

  const invitation = await loadInvitationById(context, supabase, invitationId);
  if (!invitation) {
    return;
  }

  if (invitation.status !== STATUS_PENDING) {
    respond(context, 409, { message: `invitation ${invitation.status}` });
    return;
  }

  if (!authUser.email || authUser.email !== invitation.email.toLowerCase()) {
    respond(context, 403, { message: 'email mismatch' });
    return;
  }

  const updateResult = await supabase
    .from('org_invitations')
    .update({ status: STATUS_DECLINED })
    .eq('id', invitation.id);

  if (updateResult.error) {
    context.log?.error?.('invitations failed to decline', {
      invitationId,
      message: updateResult.error.message,
    });
    respond(context, 500, { message: 'failed to update invitation' });
    return;
  }

  respond(context, 200, { message: 'invitation declined' });
  await logAuditEvent(supabase, {
    orgId: invitation.org_id,
    userId: authUser.id,
    userEmail: authUser.email || '',
    userRole: 'invitee',
    actionType: AUDIT_ACTIONS.INVITATION_DECLINED,
    actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
    resourceType: 'invitation',
    resourceId: invitation.id,
    details: { invited_email: invitation.email },
  });
}

async function revokeInvitation(context, req, supabase, invitationId) {
  const authUser = await getAuthenticatedUser(context, req, supabase);
  if (!authUser) {
    return;
  }

  const invitation = await loadInvitationById(context, supabase, invitationId);
  if (!invitation) {
    return;
  }

  const role = await requireAdminForOrg(context, supabase, invitation.org_id, authUser.id);
  if (!role) {
    return;
  }

  if (invitation.status !== STATUS_PENDING) {
    respond(context, 409, { message: `invitation ${invitation.status}` });
    return;
  }

  const updateResult = await supabase
    .from('org_invitations')
    .update({ status: STATUS_REVOKED })
    .eq('id', invitation.id);

  if (updateResult.error) {
    context.log?.error?.('invitations failed to revoke', {
      invitationId,
      message: updateResult.error.message,
    });
    respond(context, 500, { message: 'failed to revoke invitation' });
    return;
  }

  respond(context, 200, { message: 'invitation revoked' });

  // Audit log: invitation revoked
  await logAuditEvent(supabase, {
    orgId: invitation.org_id,
    userId: authUser.id,
    userEmail: authUser.email || '',
    userRole: role,
    actionType: AUDIT_ACTIONS.INVITATION_REVOKED,
    actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
    resourceType: 'invitation',
    resourceId: invitationId,
    details: { invited_email: invitation.email },
  });
}

async function handleCheckAuth(context, req, supabase) {
  const authUser = await getAuthenticatedUser(context, req, supabase);
  if (!authUser) {
    return;
  }

  const email = normalizeEmail(req.query?.email ?? req.body?.email);
  if (!email) {
    respond(context, 400, { message: 'missing email' });
    return;
  }

  // For now, require admin role in at least one org to prevent arbitrary email lookups
  // Could be tightened further to require admin role in a specific org
  const membershipResult = await supabase
    .from('org_memberships')
    .select('role')
    .eq('user_id', authUser.id)
    .in('role', ['admin', 'owner'])
    .limit(1)
    .maybeSingle();

  if (membershipResult.error || !membershipResult.data) {
    respond(context, 403, { message: 'admin role required' });
    return;
  }

  let authState = null;
  try {
    const { data: stateData, error: stateError } = await supabase.rpc('user_verification_state', {
      user_email: email,
    });
    if (stateError) {
      throw stateError;
    }
    if (stateData) {
      if (Array.isArray(stateData) && stateData.length) {
        const row = stateData[0];
        authState = {
          exists: !!(row.exists ?? row.user_exists),
          emailConfirmed: !!row.email_confirmed,
          lastSignInAt: row.last_sign_in_at ?? null,
        };
      } else if (typeof stateData === 'object') {
        authState = {
          exists: !!(stateData.exists ?? stateData.user_exists),
          emailConfirmed: !!stateData.email_confirmed,
          lastSignInAt: stateData.last_sign_in_at ?? null,
        };
      }
    }
  } catch (error) {
    context.log?.error?.('invitations failed to check auth state', {
      email,
      message: error.message,
    });
    respond(context, 500, { message: 'failed to check auth state' });
    return;
  }

  if (!authState) {
    respond(context, 500, { message: 'failed to resolve auth state' });
    return;
  }

  respond(context, 200, { email, auth: authState });
}

export default async function (context, req) {
  const { client: supabase, error } = getAdminClient(context);
  if (!supabase || error) {
    context.log?.error?.('invitations missing admin credentials');
    respond(context, 500, { message: 'server_misconfigured' });
    return;
  }

  const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET';
  const segments = parseRestSegments(context);

  if (method === 'POST' && segments.length === 0) {
    await handleCreateInvitation(context, req, supabase);
    return;
  }

  if (method === 'GET' && segments.length === 0) {
    await handleListPending(context, req, supabase);
    return;
  }

  if (method === 'GET' && segments.length === 2 && segments[0] === 'token') {
    await handleGetByToken(context, supabase, segments[1]);
    return;
  }

  if (method === 'GET' && segments.length === 1 && segments[0] === 'check-auth') {
    await handleCheckAuth(context, req, supabase);
    return;
  }

  if (method === 'POST' && segments.length === 2 && segments[1] === 'accept') {
    const invitationId = normalizeUuid(segments[0]);
    if (!invitationId) {
      respond(context, 400, { message: 'invalid invitation id' });
      return;
    }
    await acceptInvitation(context, req, supabase, invitationId);
    return;
  }

  if (method === 'POST' && segments.length === 2 && segments[1] === 'decline') {
    const invitationId = normalizeUuid(segments[0]);
    if (!invitationId) {
      respond(context, 400, { message: 'invalid invitation id' });
      return;
    }
    await declineInvitation(context, req, supabase, invitationId);
    return;
  }

  if (method === 'DELETE' && segments.length === 1) {
    const invitationId = normalizeUuid(segments[0]);
    if (!invitationId) {
      respond(context, 400, { message: 'invalid invitation id' });
      return;
    }
    await revokeInvitation(context, req, supabase, invitationId);
    return;
  }

  respond(context, 404, { message: 'not found' });
}
