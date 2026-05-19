/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { readEnv, respond as _respond, isAdminRole } from '../_shared/org-bff.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { getAuthUserById } from '../_shared/auth-users.js';
import { splitDisplayName } from '../_shared/account-profile.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';
function getAdminClient(context) {
  const cfg = readSupabaseAdminConfig(readEnv(context));
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { client: null, error: new Error('missing_admin_credentials') };
  return { client: createSupabaseAdminClient(cfg), error: null };
}
function respond(context, status, body, extraHeaders = {}) {
  return _respond(context, status, body, { 'Cache-Control': 'no-store', ...extraHeaders });
}
async function respondTrackedMembershipError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, {
    error,
    metadata,
    orgId: metadata.orgId || null,
    userId: metadata.userId || metadata.actorUserId || null,
  });
}
function parseSegments(context) {
  const raw = context?.bindingData?.restOfPath; if (!raw || typeof raw !== 'string') return [];
  return raw.split('/').map((s)=>s.trim()).filter(Boolean);
}
function normalizeUuid(v){
  if (typeof v !== 'string') return null; const t = v.trim(); if (!t) return null;
  const re=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i; return re.test(t)?t.toLowerCase():null;
}
function normalizeRole(r){
  if (typeof r !== 'string') return null; const t=r.trim().toLowerCase();
  if (t === 'member' || t === 'admin') return t; // owner changes are not supported here
  return null;
}

function normalizeDisplayName(input){
  if (input === undefined) {
    return { provided: false, value: null, error: null };
  }
  const raw = typeof input === 'string' ? input : '';
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return { provided: true, value: null, error: 'invalid_name' };
  }
  if (collapsed.length > 120) {
    return { provided: true, value: null, error: 'name_too_long' };
  }
  return { provided: true, value: collapsed, error: null };
}
async function getAuthUser(context, req, supabase){
  const auth = resolveBearerAuthorization(req);
  if (!auth?.token) { respond(context,401,{message: 'missing_bearer'}); return null; }
  let res; try { res = await supabase.auth.getUser(auth.token); } catch (e) {
    context.log?.warn?.('org-memberships bearer invalid', { message: e?.message });
    respond(context,401,{message: 'invalid_or_expired_token'}); return null;
  }
  if (res.error || !res.data?.user?.id) { respond(context,401,{message: 'invalid_or_expired_token'}); return null; }
  const u=res.data.user; return { id: u.id, email: typeof u.email==='string'?u.email.toLowerCase():null };
}
async function requireActorRole(context, supabase, orgId, userId){
  const result = await supabase.from('org_memberships').select('id, role').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  if (result.error){
    await respondTrackedMembershipError(context,500,'failed_to_verify_membership',result.error,{
      action: 'verify_actor_membership',
      orgId,
      userId,
      table: 'org_memberships',
      operation: 'select',
    });
    return null;
  }
  if (!result.data || !isAdminRole(result.data.role)){ respond(context,403,{message:'forbidden'}); return null; }
  return result.data;
}
async function loadTargetMembership(context, supabase, membershipId){
  const result = await supabase.from('org_memberships').select('id, org_id, user_id, role').eq('id', membershipId).maybeSingle();
  if (result.error){
    await respondTrackedMembershipError(context,500,'failed_to_load_membership',result.error,{
      action: 'load_target_membership',
      membershipId,
      table: 'org_memberships',
      operation: 'select',
    });
    return null;
  }
  if (!result.data){ respond(context,404,{message: 'membership_not_found'}); return null; }
  return result.data;
}

async function handleDelete(context, req, supabase, membershipId){
  const authUser = await getAuthUser(context, req, supabase); if (!authUser) return;
  const target = await loadTargetMembership(context, supabase, membershipId); if (!target) return;
  const actor = await requireActorRole(context, supabase, target.org_id, authUser.id); if (!actor) return;
  const targetRole = (target.role||'member').toLowerCase();
  const actorIsOwner = (actor.role||'member').toLowerCase()==='owner';
  if (targetRole === 'owner'){ respond(context,403,{message: 'cannot_remove_owner'}); return; }
  if (!actorIsOwner && targetRole === 'admin'){ respond(context,403,{message: 'admin_cannot_remove_admin'}); return; }
  if (target.user_id === authUser.id){ respond(context,403,{message: 'cannot_remove_yourself'}); return; }
  const del = await supabase.from('org_memberships').delete().eq('id', membershipId);
  if (del.error){
    await respondTrackedMembershipError(context,500,'failed_to_remove_member',del.error,{
      action: 'remove_member',
      orgId: target.org_id,
      userId: authUser.id,
      membershipId,
      targetUserId: target.user_id,
      targetRole,
      table: 'org_memberships',
      operation: 'delete',
    });
    return;
  }
  
  // Audit log: member removed
  await logAuditEvent(supabase, {
    orgId: target.org_id,
    userId: authUser.id,
    userEmail: authUser.email || '',
    userRole: actor.role,
    actionType: AUDIT_ACTIONS.MEMBER_REMOVED,
    actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
    resourceType: 'membership',
    resourceId: membershipId,
    details: { removed_user_id: target.user_id, removed_role: targetRole },
  });
  
  respond(context,200,{ message: 'removed' });
}

async function handlePatch(context, req, supabase, membershipId){
  const authUser = await getAuthUser(context, req, supabase); if (!authUser) return;
  const body = req.body && typeof req.body==='object' ? req.body : {};
  const role = normalizeRole(body.role ?? body.newRole);
  const hasRoleField = Object.prototype.hasOwnProperty.call(body, 'role') || Object.prototype.hasOwnProperty.call(body, 'newRole');
  const nameInput = body.fullName ?? body.full_name ?? body.name;
  const normalizedName = normalizeDisplayName(nameInput);

  if (hasRoleField && !role){ respond(context,400,{message: 'invalid_role'}); return; }
  if (!role && !normalizedName.provided){ respond(context,400,{message: 'nothing_to_update'}); return; }
  if (normalizedName.error === 'invalid_name'){ respond(context,400,{message: 'name_is_required'}); return; }
  if (normalizedName.error === 'name_too_long'){ respond(context,400,{message: 'name_too_long'}); return; }

  const target = await loadTargetMembership(context, supabase, membershipId); if (!target) return;
  const actor = await requireActorRole(context, supabase, target.org_id, authUser.id); if (!actor) return;

  const targetRole = (target.role||'member').toLowerCase();
  const actorIsOwner = (actor.role||'member').toLowerCase()==='owner';

  if (role){
    if (targetRole === 'owner'){ respond(context,403,{message: 'cannot_change_owner_role'}); return; }
    if (target.user_id === authUser.id){ respond(context,403,{message: 'cannot_change_your_own_role'}); return; }
    if (!actorIsOwner && role === 'admin' && targetRole === 'admin'){
      if (!normalizedName.provided){ respond(context,200,{message:'no-op', role: targetRole}); return; }
    }
    if (!actorIsOwner && targetRole === 'admin' && role === 'member'){ respond(context,403,{message: 'admin_cannot_demote_admin'}); return; }
    if (role !== targetRole){
      const upd = await supabase.from('org_memberships').update({ role }).eq('id', membershipId);
      if (upd.error){
        await respondTrackedMembershipError(context,500,'failed_to_update_role',upd.error,{
          action: 'update_member_role',
          orgId: target.org_id,
          userId: authUser.id,
          membershipId,
          targetUserId: target.user_id,
          oldRole: targetRole,
          newRole: role,
          table: 'org_memberships',
          operation: 'update',
        });
        return;
      }
      
      // Audit log: role changed
      await logAuditEvent(supabase, {
        orgId: target.org_id,
        userId: authUser.id,
        userEmail: authUser.email || '',
        userRole: actor.role,
        actionType: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
        actionCategory: AUDIT_CATEGORIES.MEMBERSHIP,
        resourceType: 'membership',
        resourceId: membershipId,
        details: { target_user_id: target.user_id, old_role: targetRole, new_role: role },
      });
    }
  }

  let profileUpdated = false;
  let accountUpdated = false;

  if (normalizedName.provided){
    if (!target.user_id){ respond(context,400,{message: 'membership_missing_user_id'}); return; }

    let authUserRecord = null;
    let previousMetadata = null;
    try {
      authUserRecord = await getAuthUserById(supabase, target.user_id);
      previousMetadata = authUserRecord?.user_metadata ? { ...authUserRecord.user_metadata } : {};
    } catch (error){
      context.log?.error?.('org-memberships failed to load auth user for name update', { membershipId, userId: target.user_id, message: error?.message });
      await respondTrackedMembershipError(context,500,'failed_to_load_account',error,{
        action: 'load_account_for_name_update',
        orgId: target.org_id,
        userId: authUser.id,
        membershipId,
        targetUserId: target.user_id,
        provider: 'supabase_auth_admin',
      });
      return;
    }

    const nextMetadata = {
      ...previousMetadata,
      full_name: normalizedName.value,
      fullName: normalizedName.value,
      name: normalizedName.value,
    };

    const metadataResult = await supabase.auth.admin.updateUserById(target.user_id, { user_metadata: nextMetadata });
    if (metadataResult.error){
      context.log?.error?.('org-memberships failed to update auth metadata', { membershipId, userId: target.user_id, message: metadataResult.error.message });
      await respondTrackedMembershipError(context,500,'failed_to_update_account_name',metadataResult.error,{
        action: 'update_account_name_metadata',
        orgId: target.org_id,
        userId: authUser.id,
        membershipId,
        targetUserId: target.user_id,
        provider: 'supabase_auth_admin',
      });
      return;
    }
    accountUpdated = true;

    const nameParts = splitDisplayName(normalizedName.value);
    const profilePayload = {
      id: target.user_id,
      first_name: nameParts.firstName,
      last_name: nameParts.lastName,
    };

    const profileUpdate = await supabase
      .from('profiles')
      .upsert(profilePayload, { onConflict: 'id' })
      .select('id')
      .maybeSingle();

    if (profileUpdate.error){
      context.log?.error?.('org-memberships failed to update profile name', { membershipId, userId: target.user_id, message: profileUpdate.error.message });
      // Attempt to revert auth metadata to previous value
      try {
        await supabase.auth.admin.updateUserById(target.user_id, { user_metadata: previousMetadata });
      } catch (revertError){
        context.log?.error?.('org-memberships failed to revert auth metadata after profile error', { membershipId, userId: target.user_id, message: revertError?.message });
      }
      await respondTrackedMembershipError(context,500,'failed_to_update_profile_name',profileUpdate.error,{
        action: 'update_profile_name',
        orgId: target.org_id,
        userId: authUser.id,
        membershipId,
        targetUserId: target.user_id,
        table: 'profiles',
        operation: 'upsert',
      });
      return;
    }

    profileUpdated = true;
  }

  respond(context,200,{ message:'updated', role: role || targetRole, profileUpdated, accountUpdated, name: normalizedName.provided ? normalizedName.value : undefined });
}

export default async function orgMemberships(context, req){
  const { client: supabase, error } = getAdminClient(context);
  if (!supabase || error){ respond(context,500,{message:'server_misconfigured'}); return; }
  attachErrorTracking(context, req, supabase, { metadata: { endpoint: 'org-memberships' } });
  const method = String(req.method||'GET').toUpperCase();
  const segments = parseSegments(context);
  if (segments.length !== 1){ respond(context,404,{message: 'not_found'}); return; }
  const membershipId = normalizeUuid(segments[0]);
  if (!membershipId){ respond(context,400,{message: 'invalid_membership_id'}); return; }
  if (method === 'DELETE'){ await handleDelete(context, req, supabase, membershipId); return; }
  if (method === 'PATCH' || method === 'PUT'){ await handlePatch(context, req, supabase, membershipId); return; }
  respond(context,405,{message: 'method_not_allowed'});
}
