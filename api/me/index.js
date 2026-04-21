/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSingleClient, normalizeString, readEnv, respond } from '../_shared/org-bff.js';
import { coerceIdentityNumber, validateIsraeliPhone } from '../_shared/student-validation.js';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, logAuditEvent } from '../_shared/audit-log.js';
import {
  buildAccountDisplayName,
  buildAccountUserMetadata,
  ensureAccountProfileRow,
  isAccountSetupComplete,
} from '../_shared/account-profile.js';

const PROFILE_SELECT = 'id, first_name, last_name, identity_number, phone, locale, setup_completed_at, account_status, deactivated_at, is_system_admin, can_create_organizations, max_owned_organizations, metadata, created_at, updated_at';
const DEACTIVATION_REASON_CODES = new Set([
  'privacy_concern',
  'no_longer_using',
  'duplicate_account',
  'temporary_break',
  'other',
]);

function parseAction(context) {
  const raw = context?.bindingData?.action;
  return normalizeString(raw).toLowerCase();
}

async function getAuthUser(context, req, supabase) {
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    respond(context, 401, { message: 'missing bearer' });
    return null;
  }

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('me failed to validate token', { message: error?.message });
    respond(context, 401, { message: 'invalid or expired token' });
    return null;
  }

  if (authResult.error || !authResult.data?.user?.id) {
    respond(context, 401, { message: 'invalid or expired token' });
    return null;
  }

  return authResult.data.user;
}

async function resolveActorRole(supabase, req, authUser, profile) {
  if (profile?.is_system_admin) {
    return 'system_admin';
  }

  const orgId = normalizeString(req?.headers?.['x-org-id'] || req?.headers?.['X-Org-Id']);
  if (!orgId) {
    return 'member';
  }

  const { data } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', authUser.id)
    .maybeSingle();

  return data?.role || 'member';
}

function mapAccountResponse(profile, authUser) {
  const displayName = buildAccountDisplayName({
    profile,
    authUser,
    email: authUser?.email,
  });

  return {
    id: profile?.id || authUser?.id || null,
    email: authUser?.email || null,
    display_name: displayName || null,
    first_name: profile?.first_name || '',
    last_name: profile?.last_name || '',
    identity_number: profile?.identity_number || '',
    phone: profile?.phone || '',
    locale: profile?.locale || 'he',
    setup_completed_at: profile?.setup_completed_at || null,
    account_status: profile?.account_status || 'active',
    deactivated_at: profile?.deactivated_at || null,
    can_self_deactivate: !profile?.is_system_admin,
    can_self_reactivate: (profile?.account_status || 'active') === 'disabled',
    needs_setup: !isAccountSetupComplete(profile),
  };
}

async function loadAccountProfile(supabase, authUser) {
  const profile = await ensureAccountProfileRow(supabase, authUser);
  return profile;
}

function parseBody(req) {
  const body = req?.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body;
  }
  return {};
}

function normalizeReasonInput(body) {
  const reasonCode = normalizeString(body?.reason_code || body?.reasonCode).toLowerCase();
  const reasonText = normalizeString(body?.reason_text || body?.reasonText);

  if (!DEACTIVATION_REASON_CODES.has(reasonCode)) {
    return { valid: false, error: 'invalid_reason_code', reasonCode: null, reasonText: null };
  }
  if (reasonCode === 'other' && !reasonText) {
    return { valid: false, error: 'reason_text_required', reasonCode, reasonText: null };
  }
  if (reasonText.length > 500) {
    return { valid: false, error: 'reason_text_too_long', reasonCode, reasonText: null };
  }

  return {
    valid: true,
    reasonCode,
    reasonText: reasonText || null,
  };
}

async function ensureUniqueIdentityNumber(supabase, userId, identityNumber) {
  if (!identityNumber) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, last_name')
    .eq('identity_number', identityNumber)
    .neq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data || null;
}

async function handleGet(context, req, supabase, authUser) {
  const profile = await loadAccountProfile(supabase, authUser);
  return respond(context, 200, {
    account: mapAccountResponse(profile, authUser),
  });
}

async function handlePatch(context, req, supabase, authUser) {
  const body = parseBody(req);
  const firstName = normalizeString(body?.first_name ?? body?.firstName);
  const lastName = normalizeString(body?.last_name ?? body?.lastName);
  const identityResult = coerceIdentityNumber(body?.identity_number ?? body?.identityNumber);
  const phoneResult = validateIsraeliPhone(body?.phone);

  if (!firstName) {
    return respond(context, 400, { message: 'missing_first_name' });
  }
  if (!lastName) {
    return respond(context, 400, { message: 'missing_last_name' });
  }
  if (!identityResult.valid) {
    return respond(context, 400, { message: 'invalid_identity_number' });
  }
  if (!identityResult.value) {
    return respond(context, 400, { message: 'missing_identity_number' });
  }
  if (!phoneResult.valid) {
    return respond(context, 400, { message: 'invalid_phone' });
  }
  if (!phoneResult.value) {
    return respond(context, 400, { message: 'missing_phone' });
  }

  const existingProfile = await loadAccountProfile(supabase, authUser);
  const conflictingProfile = await ensureUniqueIdentityNumber(supabase, authUser.id, identityResult.value);
  if (conflictingProfile) {
    return respond(context, 409, {
      message: 'duplicate_identity_number',
      conflict: {
        id: conflictingProfile.id,
        full_name: [conflictingProfile.first_name, conflictingProfile.last_name].filter(Boolean).join(' ').trim() || null,
      },
    });
  }

  const timestamp = new Date().toISOString();
  const updates = {
    first_name: firstName,
    last_name: lastName,
    identity_number: identityResult.value,
    phone: phoneResult.value,
    locale: existingProfile?.locale || 'he',
    setup_completed_at: existingProfile?.setup_completed_at || timestamp,
    updated_at: timestamp,
  };

  const { error: updateError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', authUser.id);

  if (updateError) {
    context.log?.error?.('me failed to update profile', { message: updateError.message, userId: authUser.id });
    return respond(context, 500, { message: 'failed_to_update_profile' });
  }

  const nextMetadata = buildAccountUserMetadata({
    firstName,
    lastName,
    phone: phoneResult.value,
    existingMetadata: authUser.user_metadata,
    setupCompleted: true,
  });

  const metadataResult = await supabase.auth.admin.updateUserById(authUser.id, {
    user_metadata: nextMetadata,
  });

  if (metadataResult.error) {
    context.log?.error?.('me failed to sync auth metadata', { message: metadataResult.error.message, userId: authUser.id });
    return respond(context, 500, { message: 'failed_to_sync_account_metadata' });
  }

  const updatedAuthUser = metadataResult.data?.user || { ...authUser, user_metadata: nextMetadata };
  const updatedProfile = await loadAccountProfile(supabase, updatedAuthUser);
  const actorRole = await resolveActorRole(supabase, req, updatedAuthUser, updatedProfile);

  await logAuditEvent(supabase, {
    orgId: null,
    userId: authUser.id,
    userEmail: authUser.email || '',
    userRole: actorRole,
    actionType: AUDIT_ACTIONS.ACCOUNT_PROFILE_UPDATED,
    actionCategory: AUDIT_CATEGORIES.ACCOUNT,
    resourceType: 'profile',
    resourceId: authUser.id,
    details: {
      setup_completed: true,
      changed_fields: ['first_name', 'last_name', 'identity_number', 'phone'],
    },
  });

  if (!existingProfile?.setup_completed_at) {
    await logAuditEvent(supabase, {
      orgId: null,
      userId: authUser.id,
      userEmail: authUser.email || '',
      userRole: actorRole,
      actionType: AUDIT_ACTIONS.ACCOUNT_SETUP_COMPLETED,
      actionCategory: AUDIT_CATEGORIES.ACCOUNT,
      resourceType: 'profile',
      resourceId: authUser.id,
      details: {
        completed_at: updatedProfile?.setup_completed_at || timestamp,
      },
    });
  }

  return respond(context, 200, {
    account: mapAccountResponse(updatedProfile, updatedAuthUser),
  });
}

async function resolveLastOwnerBlocker(supabase, userId) {
  const { data: ownerMemberships, error } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .eq('is_active', true);

  if (error) {
    throw error;
  }

  const orgIds = Array.from(new Set((ownerMemberships || []).map((row) => row.org_id).filter(Boolean)));
  for (const orgId of orgIds) {
    const { count, error: countError } = await supabase
      .from('org_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('role', 'owner')
      .eq('is_active', true);

    if (countError) {
      throw countError;
    }

    if ((count || 0) <= 1) {
      return orgId;
    }
  }

  return null;
}

async function handleDeactivate(context, req, supabase, authUser) {
  const body = parseBody(req);
  const reason = normalizeReasonInput(body);
  if (!reason.valid) {
    return respond(context, 400, { message: reason.error });
  }

  const profile = await loadAccountProfile(supabase, authUser);
  const actorRole = await resolveActorRole(supabase, req, authUser, profile);

  if (profile?.is_system_admin) {
    await logAuditEvent(supabase, {
      orgId: null,
      userId: authUser.id,
      userEmail: authUser.email || '',
      userRole: actorRole,
      actionType: AUDIT_ACTIONS.ACCOUNT_DEACTIVATION_BLOCKED,
      actionCategory: AUDIT_CATEGORIES.ACCOUNT,
      resourceType: 'profile',
      resourceId: authUser.id,
      details: { blocker: 'system_admin', reason_code: reason.reasonCode },
    });
    return respond(context, 403, { message: 'system_admin_cannot_self_deactivate' });
  }

  const lastOwnerOrgId = await resolveLastOwnerBlocker(supabase, authUser.id);
  if (lastOwnerOrgId) {
    await logAuditEvent(supabase, {
      orgId: lastOwnerOrgId,
      userId: authUser.id,
      userEmail: authUser.email || '',
      userRole: actorRole,
      actionType: AUDIT_ACTIONS.ACCOUNT_DEACTIVATION_BLOCKED,
      actionCategory: AUDIT_CATEGORIES.ACCOUNT,
      resourceType: 'profile',
      resourceId: authUser.id,
      details: { blocker: 'last_owner', reason_code: reason.reasonCode },
    });
    return respond(context, 403, { message: 'last_owner_cannot_self_deactivate' });
  }

  const timestamp = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      account_status: 'disabled',
      deactivated_at: timestamp,
      updated_at: timestamp,
    })
    .eq('id', authUser.id);

  if (updateError) {
    context.log?.error?.('me failed to deactivate account', { message: updateError.message, userId: authUser.id });
    return respond(context, 500, { message: 'failed_to_deactivate_account' });
  }

  await logAuditEvent(supabase, {
    orgId: null,
    userId: authUser.id,
    userEmail: authUser.email || '',
    userRole: actorRole,
    actionType: AUDIT_ACTIONS.ACCOUNT_DEACTIVATED,
    actionCategory: AUDIT_CATEGORIES.ACCOUNT,
    resourceType: 'profile',
    resourceId: authUser.id,
    details: {
      reason_code: reason.reasonCode,
      reason_text: reason.reasonText,
      initiated_by: 'self',
    },
  });

  const updatedProfile = await loadAccountProfile(supabase, authUser);
  return respond(context, 200, {
    account: mapAccountResponse(updatedProfile, authUser),
  });
}

async function handleReactivate(context, req, supabase, authUser) {
  const profile = await loadAccountProfile(supabase, authUser);
  const actorRole = await resolveActorRole(supabase, req, authUser, profile);

  if ((profile?.account_status || 'active') !== 'disabled') {
    await logAuditEvent(supabase, {
      orgId: null,
      userId: authUser.id,
      userEmail: authUser.email || '',
      userRole: actorRole,
      actionType: AUDIT_ACTIONS.ACCOUNT_REACTIVATION_BLOCKED,
      actionCategory: AUDIT_CATEGORIES.ACCOUNT,
      resourceType: 'profile',
      resourceId: authUser.id,
      details: { blocker: 'account_not_disabled' },
    });
    return respond(context, 409, { message: 'account_not_disabled' });
  }

  const timestamp = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      account_status: 'active',
      deactivated_at: null,
      updated_at: timestamp,
    })
    .eq('id', authUser.id);

  if (updateError) {
    context.log?.error?.('me failed to reactivate account', { message: updateError.message, userId: authUser.id });
    return respond(context, 500, { message: 'failed_to_reactivate_account' });
  }

  await logAuditEvent(supabase, {
    orgId: null,
    userId: authUser.id,
    userEmail: authUser.email || '',
    userRole: actorRole,
    actionType: AUDIT_ACTIONS.ACCOUNT_REACTIVATED,
    actionCategory: AUDIT_CATEGORIES.ACCOUNT,
    resourceType: 'profile',
    resourceId: authUser.id,
    details: {
      initiated_by: 'self',
    },
  });

  const updatedProfile = await loadAccountProfile(supabase, authUser);
  return respond(context, 200, {
    account: mapAccountResponse(updatedProfile, authUser),
  });
}

export default async function me(context, req) {
  const env = readEnv(context);
  const supabase = createSingleClient(env);
  const authUser = await getAuthUser(context, req, supabase);
  if (!authUser) {
    return;
  }

  const method = String(req.method || 'GET').toUpperCase();
  const action = parseAction(context);

  try {
    if (method === 'GET' && !action) {
      return await handleGet(context, req, supabase, authUser);
    }
    if (method === 'PATCH' && !action) {
      return await handlePatch(context, req, supabase, authUser);
    }
    if (method === 'POST' && action === 'deactivate') {
      return await handleDeactivate(context, req, supabase, authUser);
    }
    if (method === 'POST' && action === 'reactivate') {
      return await handleReactivate(context, req, supabase, authUser);
    }

    return respond(context, 405, { message: 'method_not_allowed' });
  } catch (error) {
    context.log?.error?.('me endpoint failed', { message: error?.message, action, method, userId: authUser.id });
    return respond(context, 500, { message: 'failed_to_process_account_request' });
  }
}
