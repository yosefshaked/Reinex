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
  const headers = req?.headers ?? {};
  const candidate =
    body?.org_id || body?.orgId ||
    query.org_id || query.orgId ||
    headers['x-org-id'];
  const normalized = normalizeString(candidate);
  return normalized && isValidOrgId(normalized) ? normalized : '';
}

export function getEncryptionConfig(env = process.env ?? {}) {
  return {
    current: normalizeString(env.SECURITY_ENCRYPTION_SECRET),
    previous: normalizeString(env.SECURITY_ENCRYPTION_SECRET_OLD),
    isProduction: normalizeString(env.AZURE_FUNCTIONS_ENVIRONMENT) === 'Production',
  };
}

/**
 * Returns non-sensitive secret metadata for diagnostics/UI key-version display.
 * Hashes are SHA-256 of the raw secret string and can be safely displayed.
 */
export function getEncryptionSecretMetadata(env = process.env ?? {}) {
  const config = getEncryptionConfig(env);
  return {
    isProduction: config.isProduction,
    currentHash: config.current ? createHash('sha256').update(config.current, 'utf8').digest('hex') : null,
    previousHash: config.previous ? createHash('sha256').update(config.previous, 'utf8').digest('hex') : null,
  };
}

/** @deprecated Kept for compatibility with encryption modules that still call this helper. */
export function resolveEncryptionSecret(env = process.env ?? {}) {
  return getEncryptionConfig(env).current;
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

export function getEncryptionKeyCandidates(env = process.env ?? {}) {
  const { current, previous } = getEncryptionConfig(env);
  const currentKey = deriveEncryptionKey(current);
  const previousKey = deriveEncryptionKey(previous);

  const keys = [];
  if (currentKey) {
    keys.push({ label: 'current', key: currentKey });
  }

  if (previousKey && (!currentKey || !Buffer.from(previousKey).equals(currentKey))) {
    keys.push({ label: 'previous', key: previousKey });
  }

  return keys;
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
