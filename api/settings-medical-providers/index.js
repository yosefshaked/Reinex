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
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import { HMO_PAYMENT_MODES, loadHmoProviders } from '../_shared/hmo.js';
import { coerceAgorot } from '../_shared/currency.js';

const MAX_BODY_BYTES = 48 * 1024;

function normalizeTrackPayload(body = {}) {
  const paymentMode = normalizeString(body?.payment_mode).toLowerCase();
  return {
    provider_id: normalizeString(body?.provider_id),
    service_id: normalizeString(body?.service_id),
    name: normalizeString(body?.name),
    payment_mode: HMO_PAYMENT_MODES.has(paymentMode) ? paymentMode : '',
    default_customer_charge_amount: coerceAgorot(body?.default_customer_charge_amount),
    default_insurer_claim_amount: coerceAgorot(body?.default_insurer_claim_amount),
    default_workflow_notes: normalizeString(body?.default_workflow_notes) || '',
    is_active: body?.is_active !== false,
    metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  };
}

async function respondWithProviders(context, tenantClient) {
  const providers = await loadHmoProviders(tenantClient);
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

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  if (method === 'GET') {
    try {
      return await respondWithProviders(context, tenantClient);
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

      const { data, error } = await tenantClient
        .from('hmo_providers')
        .insert(payload)
        .select('id, name, is_active, metadata, created_at, updated_at')
        .maybeSingle();

      if (error) {
        if (error.code === '23505') {
          return respond(context, 409, { message: 'provider_already_exists' });
        }
        throw error;
      }

      const providers = await loadHmoProviders(tenantClient);
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
      if (!Number.isFinite(track.default_customer_charge_amount) || track.default_customer_charge_amount < 0) {
        return respond(context, 400, { message: 'invalid_default_customer_charge_amount' });
      }
      if (!Number.isFinite(track.default_insurer_claim_amount) || track.default_insurer_claim_amount < 0) {
        return respond(context, 400, { message: 'invalid_default_insurer_claim_amount' });
      }

      const { data, error } = await tenantClient
        .from('hmo_provider_tracks')
        .insert({
          id: normalizeString(body?.id) || randomUUID(),
          ...track,
        })
        .select('id, provider_id, service_id, name, payment_mode, default_customer_charge_amount, default_insurer_claim_amount, default_workflow_notes, is_active, metadata, created_at, updated_at')
        .maybeSingle();

      if (error) {
        if (error.code === '23505') {
          return respond(context, 409, { message: 'track_already_exists' });
        }
        throw error;
      }

      const providers = await loadHmoProviders(tenantClient);
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

      const { data, error } = await tenantClient
        .from('hmo_providers')
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

      const providers = await loadHmoProviders(tenantClient);
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

      const { data, error } = await tenantClient
        .from('hmo_provider_tracks')
        .update({
          ...track,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('id, provider_id, service_id, name, payment_mode, default_customer_charge_amount, default_insurer_claim_amount, default_workflow_notes, is_active, metadata, created_at, updated_at')
        .maybeSingle();

      if (error) {
        throw error;
      }
      if (!data) {
        return respond(context, 404, { message: 'track_not_found' });
      }

      const providers = await loadHmoProviders(tenantClient);
      return respond(context, 200, { providers, updated: data });
    }

    if (method === 'DELETE' && entity === 'provider') {
      const id = normalizeString(body?.id);
      if (!id) {
        return respond(context, 400, { message: 'missing_provider_id' });
      }

      const [{ data: trackRows, error: trackError }, { data: authRows, error: authError }, { data: commitmentRows, error: commitmentError }] = await Promise.all([
        tenantClient.from('hmo_provider_tracks').select('id').eq('provider_id', id).limit(1),
        tenantClient.from('hmo_authorizations').select('id').eq('provider_id', id).limit(1),
        tenantClient.from('commitments').select('id').eq('hmo_provider_id', id).limit(1),
      ]);

      if (trackError && trackError.code !== '42P01') throw trackError;
      if (authError && authError.code !== '42P01') throw authError;
      if (commitmentError && commitmentError.code !== '42P01') throw commitmentError;
      if ((trackRows || []).length > 0 || (authRows || []).length > 0 || (commitmentRows || []).length > 0) {
        return respond(context, 409, { message: 'provider_in_use' });
      }

      const { data, error } = await tenantClient
        .from('hmo_providers')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return respond(context, 404, { message: 'provider_not_found' });
      }

      const providers = await loadHmoProviders(tenantClient);
      return respond(context, 200, { providers, deleted: { id } });
    }

    if (method === 'DELETE' && entity === 'track') {
      const id = normalizeString(body?.id);
      if (!id) {
        return respond(context, 400, { message: 'missing_track_id' });
      }

      const [{ data: authRows, error: authError }, { data: commitmentRows, error: commitmentError }] = await Promise.all([
        tenantClient.from('hmo_authorizations').select('id').eq('provider_track_id', id).limit(1),
        tenantClient.from('commitments').select('id').eq('hmo_provider_track_id', id).limit(1),
      ]);

      if (authError && authError.code !== '42P01') throw authError;
      if (commitmentError && commitmentError.code !== '42P01') throw commitmentError;
      if ((authRows || []).length > 0 || (commitmentRows || []).length > 0) {
        return respond(context, 409, { message: 'track_in_use' });
      }

      const { data, error } = await tenantClient
        .from('hmo_provider_tracks')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return respond(context, 404, { message: 'track_not_found' });
      }

      const providers = await loadHmoProviders(tenantClient);
      return respond(context, 200, { providers, deleted: { id } });
    }

    return respond(context, 400, { message: 'invalid_entity' });
  } catch (error) {
    context.log?.error?.('settings-medical-providers: request failed', { message: error?.message, code: error?.code });
    return respond(context, 500, { message: error?.code === '42P01' ? 'schema_upgrade_required' : 'failed_to_manage_providers' });
  }
}
