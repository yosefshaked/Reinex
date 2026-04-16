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
  withOrgScope,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import BillingLedgerService from '../_shared/BillingLedgerService.js';
import { HMO_AUTHORIZATION_STATUSES, loadHmoAuthorizations, loadHmoTrackMap } from '../_shared/hmo.js';
import { coerceAgorot } from '../_shared/currency.js';

const MAX_BODY_BYTES = 64 * 1024;

function normalizeStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  return HMO_AUTHORIZATION_STATUSES.has(normalized) ? normalized : 'active';
}

function normalizeOptionalDate(value) {
  const normalized = normalizeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
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
  } catch {
    return respond(context, 401, { message: 'invalid or expired token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'hmo-authorizations' });
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  const role = await ensureMembership(supabase, orgId, userId);
  if (!role || !isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const billingService = new BillingLedgerService({ tenantClient: supabase });

  if (method === 'GET') {
    try {
      const studentId = normalizeString(req?.query?.student_id);
      const serviceId = normalizeString(req?.query?.service_id);
      const activeOnly = String(req?.query?.active_only || '').toLowerCase() === 'true';
      const authorizations = await loadHmoAuthorizations(supabase, {
        studentId,
        serviceId,
        activeOnly,
      });
      return respond(context, 200, { authorizations });
    } catch (error) {
      context.log?.error?.('hmo-authorizations failed to load records', { message: error?.message, code: error?.code });
      return respond(context, 500, { message: error?.code === '42P01' ? 'schema_upgrade_required' : 'failed_to_load_hmo_authorizations' });
    }
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  try {
    if (method === 'POST' || method === 'PUT') {
      const studentId = normalizeNullableId(body?.student_id);
      const providerId = normalizeString(body?.provider_id);
      const providerTrackId = normalizeString(body?.provider_track_id);
      const status = normalizeStatus(body?.status);
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

      const trackMap = await loadHmoTrackMap(supabase, [providerTrackId]);
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

      const contractedRateAmount = body?.contracted_rate_amount == null || body?.contracted_rate_amount === ''
        ? coerceAgorot(providerTrack.default_insurer_claim_amount)
        : coerceAgorot(body.contracted_rate_amount);

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
        contracted_rate_amount: contractedRateAmount,
        status,
        notes: normalizeString(body?.notes) || null,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
        updated_at: new Date().toISOString(),
      };

      let savedId = '';
      if (method === 'POST') {
        const { data, error } = await withOrgScope(supabase, 'hmo_authorizations', orgId)
          .insert(payload)
          .select('id')
          .single();
        if (error) {
          throw error;
        }
        savedId = data.id;
      } else {
        const id = normalizeString(body?.id);
        if (!id) {
          return respond(context, 400, { message: 'missing_authorization_id' });
        }

        const { data, error } = await withOrgScope(supabase, 'hmo_authorizations', orgId)
          .update(payload)
          .eq('id', id)
          .select('id')
          .maybeSingle();
        if (error) {
          throw error;
        }
        if (!data) {
          return respond(context, 404, { message: 'authorization_not_found' });
        }
        savedId = data.id;
      }

      await billingService.resyncAuthorizationWindow({
        hmoAuthorizationId: savedId,
        actorUserId: userId,
        reasonCode: method === 'POST' ? 'authorization_created' : 'authorization_updated',
      });
      const [authorizationRow] = await loadHmoAuthorizations(supabase, { authorizationIds: [savedId] });
      return respond(context, method === 'POST' ? 201 : 200, { authorization: authorizationRow });
    }

    if (method === 'DELETE') {
      const id = normalizeString(body?.id);
      if (!id) {
        return respond(context, 400, { message: 'missing_authorization_id' });
      }

      const { data, error } = await withOrgScope(supabase, 'hmo_authorizations', orgId)
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

      await billingService.resyncAuthorizationWindow({
        hmoAuthorizationId: id,
        actorUserId: userId,
        reasonCode: 'authorization_cancelled',
      });
      const [authorizationRow] = await loadHmoAuthorizations(supabase, { authorizationIds: [id] });
      return respond(context, 200, { authorization: authorizationRow, deleted: true });
    }
  } catch (error) {
    context.log?.error?.('hmo-authorizations failed to manage authorization', { message: error?.message, code: error?.code });
    if (error?.code === '23505') {
      return respond(context, 409, { message: 'active_authorization_conflict' });
    }
    return respond(context, 500, { message: error?.code === '42P01' ? 'schema_upgrade_required' : 'failed_to_save_hmo_authorization' });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
