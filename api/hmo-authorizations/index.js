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
import {
  HMO_AUTHORIZATION_STATUSES,
  HMO_POST_COVERAGE_POLICIES,
  loadHmoAuthorizations,
  loadHmoTrackMap,
} from '../_shared/hmo.js';
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

function normalizePostCoveragePolicy(value) {
  const normalized = normalizeString(value).toLowerCase();
  return HMO_POST_COVERAGE_POLICIES.has(normalized) ? normalized : '';
}

function authorizationWindowsOverlap(left, right) {
  const leftStart = normalizeOptionalDate(left?.valid_from) || '0001-01-01';
  const leftEnd = normalizeOptionalDate(left?.expires_at) || '9999-12-31';
  const rightStart = normalizeOptionalDate(right?.valid_from) || '0001-01-01';
  const rightEnd = normalizeOptionalDate(right?.expires_at) || '9999-12-31';
  return leftStart <= rightEnd && rightStart <= leftEnd;
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

  const billingService = new BillingLedgerService({ tenantClient: supabase, orgId });

  if (method === 'GET') {
    try {
      const studentId = normalizeString(req?.query?.student_id);
      const serviceId = normalizeString(req?.query?.service_id);
      const activeOnly = String(req?.query?.active_only || '').toLowerCase() === 'true';
      const authorizations = await loadHmoAuthorizations(supabase, {
        orgId,
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

      const trackMap = await loadHmoTrackMap(supabase, [providerTrackId], orgId);
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

      const coveredCustomerChargeAmount = body?.covered_customer_charge_amount == null || body?.covered_customer_charge_amount === ''
        ? coerceAgorot(providerTrack.default_customer_charge_amount)
        : coerceAgorot(body.covered_customer_charge_amount);
      const coveredInsurerClaimAmount = body?.covered_insurer_claim_amount == null || body?.covered_insurer_claim_amount === ''
        ? coerceAgorot(providerTrack.default_insurer_claim_amount)
        : coerceAgorot(body.covered_insurer_claim_amount);
      const postCoveragePolicy = normalizePostCoveragePolicy(body?.post_coverage_policy)
        || normalizePostCoveragePolicy(providerTrack.default_post_coverage_policy)
        || 'service_default';
      const postCoverageCustomerChargeAmount = body?.post_coverage_customer_charge_amount == null || body?.post_coverage_customer_charge_amount === ''
        ? (providerTrack.default_post_coverage_customer_charge_amount == null
          ? null
          : coerceAgorot(providerTrack.default_post_coverage_customer_charge_amount))
        : coerceAgorot(body.post_coverage_customer_charge_amount);

      if (!Number.isFinite(coveredCustomerChargeAmount) || coveredCustomerChargeAmount < 0) {
        return respond(context, 400, { message: 'missing_covered_customer_charge_amount' });
      }
      if (!Number.isFinite(coveredInsurerClaimAmount) || coveredInsurerClaimAmount < 0) {
        return respond(context, 400, { message: 'missing_covered_insurer_claim_amount' });
      }
      if (postCoveragePolicy === 'explicit_customer_charge'
        && (!Number.isFinite(postCoverageCustomerChargeAmount) || postCoverageCustomerChargeAmount < 0)) {
        return respond(context, 400, { message: 'missing_post_coverage_customer_charge_amount' });
      }

      const authorizationId = method === 'PUT' ? normalizeString(body?.id) : '';
      if (method === 'PUT' && !authorizationId) {
        return respond(context, 400, { message: 'missing_authorization_id' });
      }

      const proposedWindow = {
        valid_from: normalizeOptionalDate(body?.valid_from),
        expires_at: normalizeOptionalDate(body?.expires_at),
      };
      if (proposedWindow.valid_from && proposedWindow.expires_at && proposedWindow.valid_from > proposedWindow.expires_at) {
        return respond(context, 400, { message: 'invalid_authorization_window' });
      }
      const overlappingAuthorizations = (await loadHmoAuthorizations(supabase, {
        orgId,
        studentId,
        serviceId: providerTrack.service_id,
        activeOnly: false,
      }))
        .filter((row) => row.status === 'active')
        .filter((row) => row.id !== authorizationId)
        .filter((row) => authorizationWindowsOverlap(row, proposedWindow));
      if (status === 'active' && overlappingAuthorizations.length > 0) {
        return respond(context, 409, { message: 'authorization_overlap_conflict' });
      }

      const payload = {
        student_id: studentId,
        service_id: providerTrack.service_id,
        provider_id: providerId,
        provider_track_id: providerTrackId,
        authorization_reference: normalizeString(body?.authorization_reference) || null,
        authorized_lessons: authorizedLessons,
        valid_from: proposedWindow.valid_from,
        expires_at: proposedWindow.expires_at,
        reminder_date: normalizeOptionalDate(body?.reminder_date),
        covered_customer_charge_amount: coveredCustomerChargeAmount,
        covered_insurer_claim_amount: coveredInsurerClaimAmount,
        post_coverage_policy: postCoveragePolicy,
        post_coverage_customer_charge_amount: postCoveragePolicy === 'explicit_customer_charge'
          ? postCoverageCustomerChargeAmount
          : null,
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
        const { data, error } = await withOrgScope(supabase, 'hmo_authorizations', orgId)
          .update(payload)
          .eq('id', authorizationId)
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
      const [authorizationRow] = await loadHmoAuthorizations(supabase, { orgId, authorizationIds: [savedId] });
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
      const [authorizationRow] = await loadHmoAuthorizations(supabase, { orgId, authorizationIds: [id] });
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
