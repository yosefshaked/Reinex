/* eslint-env node */
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { json } from './http.js';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readEnv(context) {
  if (context?.env && typeof context.env === 'object') {
    return context.env;
  }
  return process.env ?? {};
}

export function respond(context, status, body, extraHeaders) {
  const response = json(status, body, extraHeaders);
  context.res = response;
  return response;
}

export function normalizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export function normalizeNullableId(value) {
  const normalized = normalizeString(value);
  if (!normalized || normalized.toLowerCase() === 'null') {
    return '';
  }
  return normalized;
}

export function parseRequestBody(req) {
  if (req?.body && typeof req.body === 'object') {
    return req.body;
  }

  const rawBody = typeof req?.body === 'string'
    ? req.body
    : typeof req?.rawBody === 'string'
      ? req.rawBody
      : null;

  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return {};
  }
}

export function isValidOrgId(value) {
  return UUID_PATTERN.test(value);
}

export function isAdminRole(role) {
  if (!role) {
    return false;
  }
  const normalized = String(role).trim().toLowerCase();
  return normalized === 'admin' || normalized === 'owner';
}

export function isOfficeRole(role) {
  if (!role) {
    return false;
  }
  const normalized = String(role).trim().toLowerCase();
  return normalized === 'office';
}

export function isAdminOrOffice(role) {
  return isAdminRole(role) || isOfficeRole(role);
}

export async function ensureMembership(supabase, orgId, userId) {
  const { data, error } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return data.role || 'member';
}

// ---------------------------------------------------------------------------
// Single-DB Client (replaces the BYOD dual-client pattern)
// ---------------------------------------------------------------------------

let _singletonClient = null;

/**
 * Returns a service_role Supabase client for the single merged database.
 * Re-uses a module-level singleton across invocations in the same process.
 *
 * @param {Record<string, string>} env - Environment variables (or process.env).
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createSingleClient(env) {
  if (_singletonClient) {
    return _singletonClient;
  }

  const supabaseUrl = env.SUPABASE_URL || env.APP_CONTROL_DB_URL || env.APP_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.APP_CONTROL_DB_SERVICE_ROLE_KEY || env.APP_SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  }

  _singletonClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return _singletonClient;
}

/**
 * Returns a scoped query builder that auto-injects org_id on every operation.
 * Drop-in replacement for `client.from(table)`:
 *   withOrgScope(client, 'students', orgId).select('*')
 *   withOrgScope(client, 'students', orgId).insert({ name: 'x' })  // org_id auto-injected
 *   withOrgScope(client, 'students', orgId).update({ name: 'y' }).eq('id', id)
 *   withOrgScope(client, 'students', orgId).delete().eq('id', id)
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} table
 * @param {string} orgId
 */
export function withOrgScope(client, table, orgId) {
  const base = client.from(table);
  return {
    select(...args)       { return base.select(...args).eq('org_id', orgId); },
    insert(data, opts)    {
      const rows = Array.isArray(data)
        ? data.map(r => ({ ...r, org_id: orgId }))
        : { ...data, org_id: orgId };
      return base.insert(rows, opts);
    },
    update(data, opts)    { return base.update(data, opts).eq('org_id', orgId); },
    upsert(data, opts)    {
      const rows = Array.isArray(data)
        ? data.map(r => ({ ...r, org_id: orgId }))
        : { ...data, org_id: orgId };
      return base.upsert(rows, opts);
    },
    delete(opts)          { return base.delete(opts).eq('org_id', orgId); },
  };
}

export function resolveOrgId(req, body) {
  const query = req?.query ?? {};
  const candidate = body?.org_id || body?.orgId || query.org_id || query.orgId;
  const normalized = normalizeString(candidate);
  return normalized && isValidOrgId(normalized) ? normalized : '';
}

// ---------------------------------------------------------------------------
// DEPRECATED — BYOD helpers (will be removed after Step 12 bulk migration)
// Kept temporarily so that un-migrated endpoints continue to work.
// ---------------------------------------------------------------------------

/** @deprecated Use createSingleClient(env) — will be removed after endpoint migration. */
export function buildTenantError(message, status = 500) {
  return { status, body: { message } };
}

/** @deprecated Use createSingleClient(env) — will be removed after endpoint migration. */
export function mapConnectionError(error) {
  const message = error?.message || 'failed_to_load_connection';
  const status = message === 'missing_connection_settings'
    ? 412
    : message === 'missing_dedicated_key'
      ? 428
      : 500;
  return buildTenantError(message, status);
}

/**
 * @deprecated Use createSingleClient(env) — will be removed after endpoint migration.
 * In the merged single-DB, this simply returns the same admin client that was passed in.
 * The encryption/decryption pipeline is bypassed.
 */
// eslint-disable-next-line no-unused-vars
export async function resolveTenantClient(context, supabase, env, orgId) {
  return { client: supabase };
}

/** @deprecated Kept for forms-runtime.js compatibility — will be removed after endpoint migration. */
export function resolveEncryptionSecret(env) {
  const candidates = [
    env.APP_ORG_CREDENTIALS_ENCRYPTION_KEY,
    env.ORG_CREDENTIALS_ENCRYPTION_KEY,
    env.APP_SECRET_ENCRYPTION_KEY,
    env.APP_ENCRYPTION_KEY,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

/** @deprecated Kept for forms-runtime.js compatibility — will be removed after endpoint migration. */
export function deriveEncryptionKey(secret) {
  const normalized = normalizeString(secret);
  if (!normalized) {
    return null;
  }

  let keyBuffer = decodeKeyMaterial(normalized);

  if (keyBuffer.length < 32) {
    keyBuffer = createHash('sha256').update(keyBuffer).digest();
  }

  if (keyBuffer.length > 32) {
    keyBuffer = keyBuffer.subarray(0, 32);
  }

  if (keyBuffer.length < 32) {
    return null;
  }

  return keyBuffer;
}

function decodeKeyMaterial(secret) {
  const attempts = [
    () => Buffer.from(secret, 'base64'),
    () => Buffer.from(secret, 'hex'),
  ];

  for (const attempt of attempts) {
    try {
      const buffer = attempt();
      if (buffer.length) {
        return buffer;
      }
    } catch {
      // ignore and try next format
    }
  }

  return Buffer.from(secret, 'utf8');
}
