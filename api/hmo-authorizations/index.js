/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminOrOffice,
  isAdminRole,
  normalizeNullableId,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import {
  HMO_AUTHORIZATION_STATUSES,
  ensureSystemManagedHmoCommitment,
  loadHmoAuthorizations,
  loadHmoTrackMap,
} from '../_shared/hmo.js';

const MAX_BODY_BYTES = 64 * 1024;

function normalizeStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  return HMO_AUTHORIZATION_STATUSES.has(normalized) ? normalized : '';
}

function normalizeOptionalDate(value) {
  const normalized = normalizeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

async function loadLinkedCommitmentMap(tenantClient, authorizationIds = []) {
  const ids = Array.from(new Set((authorizationIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await tenantClient
    .from('commitments')
    .select('*')
    .in('hmo_authorization_id', ids);

  if (error) {
    if (error.code === '42P01') {
      return new Map();
    }
    throw error;
  }

  return new Map((data || []).map((row) => [row.hmo_authorization_id, row]));
}

async function buildAuthorizationResponse(tenantClient, authorizationIds = []) {
  const authorizations = await loadHmoAuthorizations(tenantClient, { authorizationIds });
  const linkedCommitmentMap = await loadLinkedCommitmentMap(tenantClient, authorizationIds);
  return authorizations.map((row) => ({
    ...row,
    linked_commitment: linkedCommitmentMap.get(row.id) || null,
  }));
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (authError) {
    context.log?.error?.('hmo-authorizations failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'hmo-authorizations' });
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role = null;
  try {
    role = await ensureMembership(supabase, orgId, authResult.data.user.id);
  } catch (membershipError) {
    context.log?.error?.('hmo-authorizations failed to verify membership', { message: membershipError?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  if (method === 'GET') {
    try {
      const studentId = normalizeString(req?.query?.student_id);
      const serviceId = normalizeString(req?.query?.service_id);
      const activeOnly = String(req?.query?.active_only || '').toLowerCase() === 'true';
      const authorizations = await loadHmoAuthorizations(tenantClient, {
        studentId,
        serviceId,
        activeOnly,
      });
      const linkedCommitmentMap = await loadLinkedCommitmentMap(tenantClient, authorizations.map((row) => row.id));
      return respond(context, 200, {
        authorizations: authorizations.map((row) => ({
          ...row,
          linked_commitment: linkedCommitmentMap.get(row.id) || null,
        })),
      });
    } catch (error) {
      context.log?.error?.('hmo-authorizations failed to load records', { message: error?.message, code: error?.code });
      return respond(context, 500, { message: error?.code === '42P01' ? 'schema_upgrade_required' : 'failed_to_load_hmo_authorizations' });
    }
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (method === 'POST' || method === 'PUT') {
    const studentId = normalizeNullableId(body?.student_id);
    const providerId = normalizeString(body?.provider_id);
    const providerTrackId = normalizeString(body?.provider_track_id);
    const status = normalizeStatus(body?.status) || 'active';
    const authorizedLessons = Math.max(0, Math.round(Number(body?.authorized_lessons)));

    if (!studentId) {
      return respond(context, 400, { message: 'missing_student_id' });
    }
    if (!providerId) {
      return respond(context, 400, { message: 'missing_provider_id' });
    }
    if (!providerTrackId) {
      return respond(context, 400, { message: 'missing_provider_track_id' });
    }
    if (!Number.isFinite(Number(body?.authorized_lessons)) || authorizedLessons <= 0) {
      return respond(context, 400, { message: 'invalid_authorized_lessons' });
    }

    const trackMap = await loadHmoTrackMap(tenantClient, [providerTrackId]);
    const providerTrack = trackMap.get(providerTrackId) || null;
    if (!providerTrack) {
      return respond(context, 404, { message: 'provider_track_not_found' });
    }
    if (providerTrack.provider_id !== providerId) {
      return respond(context, 409, { message: 'provider_track_provider_mismatch' });
    }
    if (!providerTrack.service_id) {
      return respond(context, 409, { message: 'provider_track_missing_service' });
    }

    const payload = {
      student_id: studentId,
      service_id: providerTrack.service_id,
      provider_id: providerId,
      provider_track_id: providerTrackId,
      authorization_reference: normalizeString(body?.authorization_reference) || null,
      authorized_lessons: authorizedLessons,
      valid_from: normalizeOptionalDate(body?.valid_from),
      expires_at: normalizeOptionalDate(body?.expires_at),
      reminder_date: normalizeOptionalDate(body?.reminder_date),
      customer_charge_amount_override: body?.customer_charge_amount_override === '' || body?.customer_charge_amount_override == null
        ? null
        : Number(body.customer_charge_amount_override),
      insurer_claim_amount_override: body?.insurer_claim_amount_override === '' || body?.insurer_claim_amount_override == null
        ? null
        : Number(body.insurer_claim_amount_override),
      workflow_notes_override: normalizeString(body?.workflow_notes_override) || null,
      status,
      notes: normalizeString(body?.notes) || null,
      metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      updated_at: new Date().toISOString(),
    };

    if (payload.customer_charge_amount_override != null && (!Number.isFinite(payload.customer_charge_amount_override) || payload.customer_charge_amount_override < 0)) {
      return respond(context, 400, { message: 'invalid_customer_charge_amount_override' });
    }
    if (payload.insurer_claim_amount_override != null && (!Number.isFinite(payload.insurer_claim_amount_override) || payload.insurer_claim_amount_override < 0)) {
      return respond(context, 400, { message: 'invalid_insurer_claim_amount_override' });
    }

    try {
      let data;
      if (method === 'POST') {
        const insertResult = await tenantClient
          .from('hmo_authorizations')
          .insert({
            ...payload,
          })
          .select('id')
          .single();
        if (insertResult.error) {
          throw insertResult.error;
        }
        data = insertResult.data;
      } else {
        const id = normalizeString(body?.id);
        if (!id) {
          return respond(context, 400, { message: 'missing_authorization_id' });
        }

        const updateResult = await tenantClient
          .from('hmo_authorizations')
          .update(payload)
          .eq('id', id)
          .select('id')
          .maybeSingle();
        if (updateResult.error) {
          throw updateResult.error;
        }
        if (!updateResult.data) {
          return respond(context, 404, { message: 'authorization_not_found' });
        }
        data = updateResult.data;
      }

      await ensureSystemManagedHmoCommitment(tenantClient, data.id, authResult.data.user.id);
      const [authorizationRow] = await buildAuthorizationResponse(tenantClient, [data.id]);
      return respond(context, method === 'POST' ? 201 : 200, { authorization: authorizationRow });
    } catch (error) {
      context.log?.error?.('hmo-authorizations failed to save authorization', { message: error?.message, code: error?.code });
      if (error?.code === '23505') {
        return respond(context, 409, { message: 'active_authorization_conflict' });
      }
      return respond(context, 500, { message: error?.code === '42P01' ? 'schema_upgrade_required' : 'failed_to_save_hmo_authorization' });
    }
  }

  if (method === 'DELETE') {
    const id = normalizeString(body?.id);
    if (!id) {
      return respond(context, 400, { message: 'missing_authorization_id' });
    }

    try {
      const { data, error } = await tenantClient
        .from('hmo_authorizations')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) {
        throw error;
      }
      if (!data) {
        return respond(context, 404, { message: 'authorization_not_found' });
      }

      await ensureSystemManagedHmoCommitment(tenantClient, id, authResult.data.user.id);
      const [authorizationRow] = await buildAuthorizationResponse(tenantClient, [id]);
      return respond(context, 200, { authorization: authorizationRow, deleted: true });
    } catch (error) {
      context.log?.error?.('hmo-authorizations failed to cancel authorization', { message: error?.message, code: error?.code });
      return respond(context, 500, { message: error?.code === '42P01' ? 'schema_upgrade_required' : 'failed_to_cancel_hmo_authorization' });
    }
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
