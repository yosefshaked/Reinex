/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, parseRequestBody, readEnv, respond } from '../_shared/org-bff.js';

const FLAG_PREFIX = 'system.flag.';

function normalizeFlagKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-.]/g, '_');
}

function parseIncomingFlags(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }

  return Object.entries(payload)
    .map(([rawKey, rawValue]) => ({
      key: normalizeFlagKey(rawKey),
      enabled: Boolean(rawValue),
    }))
    .filter((entry) => entry.key.length > 0);
}

function toRegistryRowForFlag(flagEntry) {
  const suffix = flagEntry.key;
  const permissionKey = `${FLAG_PREFIX}${suffix}`;
  const label = suffix
    .split(/[_.-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return {
    permission_key: permissionKey,
    display_name_en: label || suffix,
    display_name_he: label || suffix,
    description_en: 'System-level feature flag managed from system admin console.',
    description_he: 'System-level feature flag managed from system admin console.',
    default_value: flagEntry.enabled,
    category: 'system_feature_flags',
    requires_approval: false,
    description: 'Managed by system admin console.',
    updated_at: new Date().toISOString(),
  };
}

function extractFlagsFromRegistry(rows) {
  const flags = {};

  for (const row of rows) {
    const permissionKey = String(row?.permission_key || '');
    if (!permissionKey || !permissionKey.startsWith(FLAG_PREFIX)) {
      continue;
    }

    const key = permissionKey.slice(FLAG_PREFIX.length);
    if (!key) continue;

    flags[key] = Boolean(row?.default_value);
  }

  return flags;
}

export default async function systemAdminGlobalSettings(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-global-settings: missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer_token' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let admin;
  try {
    admin = await ensureSystemAdmin(req, supabase, authorization, { context });
  } catch (error) {
    return respond(context, error?.statusCode || 403, { message: error?.message || 'forbidden' });
  }

  if (method === 'POST') {
    const body = parseRequestBody(req);
    const flags = parseIncomingFlags(body?.flags);

    if (flags.length > 0) {
      const { error } = await supabase
        .from('permission_registry')
        .upsert(flags.map(toRegistryRowForFlag), { onConflict: 'permission_key' });

      if (error) {
        context.log?.error?.('system-admin-global-settings: failed to save', {
          message: error?.message,
          code: error?.code,
          userId: admin.userId,
        });
        return respond(context, 500, { message: 'failed_to_save_settings' });
      }
    }
  }

  const { data, error } = await supabase
    .from('permission_registry')
    .select('permission_key, default_value')
    .like('permission_key', `${FLAG_PREFIX}%`);

  if (error) {
    context.log?.error?.('system-admin-global-settings: failed to fetch', {
      message: error?.message,
      code: error?.code,
      userId: admin.userId,
    });
    return respond(context, 500, { message: 'failed_to_load_settings' });
  }

  const flags = extractFlagsFromRegistry(Array.isArray(data) ? data : []);

  return respond(context, 200, {
    flags,
    requested_at: new Date().toISOString(),
    admin: {
      user_id: admin.userId,
      email: admin.email,
    },
  });
}
