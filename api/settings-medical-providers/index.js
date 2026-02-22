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

const SETTINGS_KEY = 'medical_providers';

function createProviderId() {
  if (typeof randomUUID === 'function') {
    try {
      return randomUUID();
    } catch {
      // fall through to fallback
    }
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeProviderEntries(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }

  const normalized = [];
  const seen = new Set();

  for (const entry of candidate) {
    if (!entry) {
      continue;
    }

    if (typeof entry === 'object') {
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (id && name && !seen.has(id)) {
        seen.add(id);
        normalized.push({ id, name });
      }
      continue;
    }

    if (typeof entry === 'string') {
      const value = entry.trim();
      if (value && !seen.has(value)) {
        seen.add(value);
        normalized.push({ id: value, name: value });
      }
    }
  }

  return normalized;
}

async function loadExistingProviders(tenantClient) {
  const { data, error } = await tenantClient
    .from('Settings')
    .select('settings_value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  const payload = data?.settings_value ?? [];
  return normalizeProviderEntries(Array.isArray(payload) ? payload : payload?.providers);
}

export default async function (context, req) {
  context.log?.info?.('settings-medical-providers: request received', { method: req.method });

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('settings-medical-providers: missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('settings-medical-providers: missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('settings-medical-providers: failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    context.log?.warn?.('settings-medical-providers: token did not resolve to user');
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET,POST' });
  }

  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, 16 * 1024, { mode: 'observe', context, endpoint: 'settings-medical-providers' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, authResult.data.user.id);
  } catch (membershipError) {
    context.log?.error?.('settings-medical-providers: failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId: authResult.data.user.id,
    });
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
      const providers = await loadExistingProviders(tenantClient);
      return respond(context, 200, { providers }, { 'Cache-Control': 'no-store' });
    } catch (error) {
      context.log?.error?.('settings-medical-providers: failed to load providers', { message: error?.message });
      return respond(context, 500, { message: 'failed_to_load_providers' });
    }
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const nameInput = normalizeString(body?.name);
  if (!nameInput) {
    return respond(context, 400, { message: 'missing_provider_name' });
  }
  if (nameInput.length > 120) {
    return respond(context, 400, { message: 'provider_name_too_long' });
  }

  let existingProviders;
  try {
    existingProviders = await loadExistingProviders(tenantClient);
  } catch (error) {
    context.log?.error?.('settings-medical-providers: failed to load providers before insert', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_load_providers' });
  }

  const duplicate = existingProviders.find((provider) => provider.name.toLowerCase() === nameInput.toLowerCase());
  if (duplicate) {
    return respond(context, 409, { message: 'provider_already_exists', duplicate: duplicate });
  }

  const newProvider = { id: createProviderId(), name: nameInput };
  const updated = [...existingProviders, newProvider];

  const { error: upsertError } = await tenantClient
    .from('Settings')
    .upsert({ key: SETTINGS_KEY, settings_value: updated }, { onConflict: 'key' });

  if (upsertError) {
    context.log?.error?.('settings-medical-providers: failed to save provider', { message: upsertError.message });
    return respond(context, 500, { message: 'failed_to_save_provider' });
  }

  try {
    const refreshed = await loadExistingProviders(tenantClient);
    return respond(context, 200, { providers: refreshed, created: newProvider });
  } catch (error) {
    context.log?.warn?.('settings-medical-providers: provider saved but reload failed', { message: error?.message });
    return respond(context, 200, { providers: updated, created: newProvider });
  }
}
