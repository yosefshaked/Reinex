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
import { HMO_PAYMENT_MODES, HMO_POST_COVERAGE_POLICIES, loadHmoProviders } from '../_shared/hmo.js';
import { coerceAgorot } from '../_shared/currency.js';

const MAX_BODY_BYTES = 48 * 1024;

function normalizeTrackPayload(body = {}) {
  const paymentMode = normalizeString(body?.payment_mode).toLowerCase();
  const postCoveragePolicy = normalizeString(body?.default_post_coverage_policy).toLowerCase();
  return {
    provider_id: normalizeString(body?.provider_id),
    service_id: normalizeString(body?.service_id),
    name: normalizeString(body?.name),
    payment_mode: HMO_PAYMENT_MODES.has(paymentMode) ? paymentMode : '',
    default_customer_charge_amount: coerceAgorot(body?.default_customer_charge_amount),
    default_insurer_claim_amount: coerceAgorot(body?.default_insurer_claim_amount),
    default_post_coverage_policy: HMO_POST_COVERAGE_POLICIES.has(postCoveragePolicy) ? postCoveragePolicy : '',
    default_post_coverage_customer_charge_amount: body?.default_post_coverage_customer_charge_amount == null || body?.default_post_coverage_customer_charge_amount === ''
      ? null
      : coerceAgorot(body.default_post_coverage_customer_charge_amount),
    default_workflow_notes: normalizeString(body?.default_workflow_notes) || '',
    is_active: body?.is_active !== false,
    metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  };
}

async function respondWithProviders(context, client, orgId) {
  const providers = await loadHmoProviders(client, { orgId });
  return respond(context, 200, { providers }, { 'Cache-Control': 'no-store' });
}

export default async function (context, req) {
  context.log?.info?.('settings-medical-providers: request received', { method: req.method });

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (authError) {
    context.log?.error?.('settings-medical-providers failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET,POST,PUT,DELETE' });
  }

  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'settings-medical-providers' });
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, authResult.data.user.id);
  } catch (membershipError) {
    context.log?.error?.('settings-medical-providers: failed to verify membership', { message: membershipError?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (method === 'GET') {
    try {
      return await respondWithProviders(context, supabase, orgId);
    } catch (error) {
      context.log?.error?.('settings-medical-providers: failed to load providers', { message: error?.message, code: error?.code });
      return respond(context, 500, { message: error?.code === '42P01' ? 'schema_upgrade_required' : 'failed_to_load_providers' });
    }
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const entity = normalizeString(body?.entity).toLowerCase() || 'provider';

  try {
    if (method === 'POST' && entity === 'provider') {
      const name = normalizeString(body?.name);
      if (!name) {
        return respond(context, 400, { message: 'missing_provider_name' });
      }
      if (name.length > 120) {
        return respond(context, 400, { message: 'provider_name_too_long' });
      }

      const payload = {
        id: normalizeString(body?.id) || randomUUID(),
        name,
        is_active: body?.is_active !== false,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      };

      const { data, error } = await withOrgScope(supabase, 'hmo_providers', orgId)
        .insert(payload)
        .select('id, name, is_active, metadata, created_at, updated_at')
        .maybeSingle();

      if (error) {
        if (error.code === '23505') {
          return respond(context, 409, { message: 'provider_already_exists' });
        }
        throw error;
      }

      const providers = await loadHmoProviders(supabase, { orgId });
      return respond(context, 201, { providers, created: data });
    }

    if (method === 'POST' && entity === 'track') {
      const track = normalizeTrackPayload(body);
      if (!track.provider_id) {
        return respond(context, 400, { message: 'missing_provider_id' });
      }
      if (!track.name) {
        return respond(context, 400, { message: 'missing_track_name' });
      }
      if (!track.service_id) {
        return respond(context, 400, { message: 'missing_service_id' });
      }
      if (!track.payment_mode) {
        return respond(context, 400, { message: 'invalid_payment_mode' });
      }
      if (!track.default_post_coverage_policy) {
        return respond(context, 400, { message: 'invalid_default_post_coverage_policy' });
      }
      if (!Number.isFinite(track.default_customer_charge_amount) || track.default_customer_charge_amount < 0) {
        return respond(context, 400, { message: 'invalid_default_customer_charge_amount' });
      }
      if (!Number.isFinite(track.default_insurer_claim_amount) || track.default_insurer_claim_amount < 0) {
        return respond(context, 400, { message: 'invalid_default_insurer_claim_amount' });
      }
      if (track.default_post_coverage_policy === 'explicit_customer_charge'
        && (!Number.isFinite(track.default_post_coverage_customer_charge_amount) || track.default_post_coverage_customer_charge_amount < 0)) {
        return respond(context, 400, { message: 'missing_default_post_coverage_customer_charge_amount' });
      }

      const { data, error } = await withOrgScope(supabase, 'hmo_provider_tracks', orgId)
        .insert({
          id: normalizeString(body?.id) || randomUUID(),
          ...track,
        })
        .select('id, provider_id, service_id, name, payment_mode, default_customer_charge_amount, default_insurer_claim_amount, default_post_coverage_policy, default_post_coverage_customer_charge_amount, default_workflow_notes, is_active, metadata, created_at, updated_at')
        .maybeSingle();

      if (error) {
        if (error.code === '23505') {
          return respond(context, 409, { message: 'track_already_exists' });
        }
        throw error;
      }

      const providers = await loadHmoProviders(supabase, { orgId });
      return respond(context, 201, { providers, created: data });
    }

    if (method === 'PUT' && entity === 'provider') {
      const id = normalizeString(body?.id);
      const name = normalizeString(body?.name);
      if (!id) {
        return respond(context, 400, { message: 'missing_provider_id' });
      }
      if (!name) {
        return respond(context, 400, { message: 'missing_provider_name' });
      }

      const { data, error } = await withOrgScope(supabase, 'hmo_providers', orgId)
        .update({
          name,
          is_active: body?.is_active !== false,
          metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('id, name, is_active, metadata, created_at, updated_at')
        .maybeSingle();

      if (error) {
        throw error;
      }
      if (!data) {
        return respond(context, 404, { message: 'provider_not_found' });
      }

      const providers = await loadHmoProviders(supabase, { orgId });
      return respond(context, 200, { providers, updated: data });
    }

    if (method === 'PUT' && entity === 'track') {
      const id = normalizeString(body?.id);
      if (!id) {
        return respond(context, 400, { message: 'missing_track_id' });
      }
      const track = normalizeTrackPayload(body);
      if (!track.provider_id) {
        return respond(context, 400, { message: 'missing_provider_id' });
      }
      if (!track.name) {
        return respond(context, 400, { message: 'missing_track_name' });
      }
      if (!track.service_id) {
        return respond(context, 400, { message: 'missing_service_id' });
      }
      if (!track.payment_mode) {
        return respond(context, 400, { message: 'invalid_payment_mode' });
      }
      if (!track.default_post_coverage_policy) {
        return respond(context, 400, { message: 'invalid_default_post_coverage_policy' });
      }
      if (track.default_post_coverage_policy === 'explicit_customer_charge'
        && (!Number.isFinite(track.default_post_coverage_customer_charge_amount) || track.default_post_coverage_customer_charge_amount < 0)) {
        return respond(context, 400, { message: 'missing_default_post_coverage_customer_charge_amount' });
      }

      const { data, error } = await withOrgScope(supabase, 'hmo_provider_tracks', orgId)
        .update({
          ...track,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('id, provider_id, service_id, name, payment_mode, default_customer_charge_amount, default_insurer_claim_amount, default_post_coverage_policy, default_post_coverage_customer_charge_amount, default_workflow_notes, is_active, metadata, created_at, updated_at')
        .maybeSingle();

      if (error) {
        throw error;
      }
      if (!data) {
        return respond(context, 404, { message: 'track_not_found' });
      }

      const providers = await loadHmoProviders(supabase, { orgId });
      return respond(context, 200, { providers, updated: data });
    }

    if (method === 'DELETE' && entity === 'provider') {
      const id = normalizeString(body?.id);
      if (!id) {
        return respond(context, 400, { message: 'missing_provider_id' });
      }

      const [{ data: trackRows, error: trackError }, { data: authRows, error: authError }] = await Promise.all([
        withOrgScope(supabase, 'hmo_provider_tracks', orgId).select('id').eq('provider_id', id).limit(1),
        withOrgScope(supabase, 'hmo_authorizations', orgId).select('id').eq('provider_id', id).limit(1),
      ]);

      if (trackError && trackError.code !== '42P01') throw trackError;
      if (authError && authError.code !== '42P01') throw authError;
      if ((trackRows || []).length > 0 || (authRows || []).length > 0) {
        return respond(context, 409, { message: 'provider_in_use' });
      }

      const { data, error } = await withOrgScope(supabase, 'hmo_providers', orgId)
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return respond(context, 404, { message: 'provider_not_found' });
      }

      const providers = await loadHmoProviders(supabase, { orgId });
      return respond(context, 200, { providers, deleted: { id } });
    }

    if (method === 'DELETE' && entity === 'track') {
      const id = normalizeString(body?.id);
      if (!id) {
        return respond(context, 400, { message: 'missing_track_id' });
      }

      const [{ data: authRows, error: authError }] = await Promise.all([
        withOrgScope(supabase, 'hmo_authorizations', orgId).select('id').eq('provider_track_id', id).limit(1),
      ]);

      if (authError && authError.code !== '42P01') throw authError;
      if ((authRows || []).length > 0) {
        return respond(context, 409, { message: 'track_in_use' });
      }

      const { data, error } = await withOrgScope(supabase, 'hmo_provider_tracks', orgId)
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return respond(context, 404, { message: 'track_not_found' });
      }

      const providers = await loadHmoProviders(supabase, { orgId });
      return respond(context, 200, { providers, deleted: { id } });
    }

    return respond(context, 400, { message: 'invalid_entity' });
  } catch (error) {
    context.log?.error?.('settings-medical-providers: request failed', { message: error?.message, code: error?.code });
    return respond(context, 500, { message: error?.code === '42P01' ? 'schema_upgrade_required' : 'failed_to_manage_providers' });
  }
}
