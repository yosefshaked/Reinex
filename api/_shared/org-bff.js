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
  // Azure Functions v3 auto-parses JSON bodies into req.body as a plain object.
  // Guard against Buffer/Uint8Array instances which pass typeof === 'object'
  // but are NOT already-parsed JSON (can happen with certain Node versions).
  const body = req?.body;
  if (
    body &&
    typeof body === 'object' &&
    !Buffer.isBuffer(body) &&
    !(body instanceof Uint8Array)
  ) {
    return body;
  }

  // Resolve raw string: Buffer → utf8 string, or req.rawBody as fallback.
  let rawString = null;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    try { rawString = Buffer.from(body).toString('utf8'); } catch { /* noop */ }
  } else if (typeof body === 'string') {
    rawString = body;
  } else if (typeof req?.rawBody === 'string') {
    rawString = req.rawBody;
  }

  if (!rawString) {
    return {};
  }

  try {
    return JSON.parse(rawString);
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
// System Admin Guard (MFA + is_system_admin flag)
// ---------------------------------------------------------------------------

/**
 * Decodes a JWT payload without signature verification.
 * Signature trust is established by the preceding `supabase.auth.getUser(token)` call.
 * @param {string} token
 * @returns {Record<string, unknown> | null}
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Verifies that the request comes from a system admin with MFA (AAL2).
 *
 * Checks (in order):
 * 1. Valid Bearer token → `supabase.auth.getUser()` (server-side verification).
 * 2. JWT `aal` claim must be `aal2` (TOTP/MFA completed).
 * 3. `profiles.is_system_admin` must be `true` (set only via direct DB access).
 *
 * On failure a structured error is thrown (callers should catch and respond 403).
 * Every attempt (success or failure) is logged to `audit_log`.
 *
 * @param {import('express').Request} req  - Azure Function HTTP request
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - service_role client
 * @param {{ token: string }} authorization - result of resolveBearerAuthorization(req)
 * @param {object} [options]
 * @param {object} [options.context] - Azure Function context (for context.log)
 * @returns {Promise<{ userId: string, email: string }>}
 */
export async function ensureSystemAdmin(req, supabase, authorization, options = {}) {
  const { context } = options;
  const token = authorization?.token;

  if (!token) {
    throw Object.assign(new Error('missing_bearer_token'), { statusCode: 401 });
  }

  // 1. Verify token server-side
  let user;
  try {
    const result = await supabase.auth.getUser(token);
    if (result.error || !result.data?.user?.id) {
      throw new Error('invalid_token');
    }
    user = result.data.user;
  } catch {
    await logAdminAttempt(supabase, { userId: null, success: false, reason: 'invalid_token', context });
    throw Object.assign(new Error('invalid_or_expired_token'), { statusCode: 401 });
  }

  const userId = user.id;
  const email = user.email || '';

  // 2. Check AAL2 (MFA/TOTP verified)
  const jwtPayload = decodeJwtPayload(token);
  const aal = jwtPayload?.aal || 'aal1';

  if (aal !== 'aal2') {
    await logAdminAttempt(supabase, { userId, email, success: false, reason: 'mfa_required', context });
    throw Object.assign(new Error('mfa_required'), { statusCode: 403 });
  }

  // 3. Verify is_system_admin flag in profiles (service_role bypasses RLS)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('is_system_admin')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    context?.log?.error?.('ensureSystemAdmin: profile lookup failed', { message: profileError.message, userId });
    await logAdminAttempt(supabase, { userId, email, success: false, reason: 'profile_lookup_error', context });
    throw Object.assign(new Error('authorization_check_failed'), { statusCode: 500 });
  }

  if (!profile?.is_system_admin) {
    await logAdminAttempt(supabase, { userId, email, success: false, reason: 'not_system_admin', context });
    throw Object.assign(new Error('forbidden'), { statusCode: 403 });
  }

  // All checks passed — do not log success here; callers log their own
  // specific actions (impersonation_started, settings_changed, etc.).
  // Logging every successful read would flood the audit log with noise.
  return { userId, email };
}

/**
 * Writes a system-admin access attempt to audit_log.
 * Failures are swallowed (audit logging must not break the auth flow).
 */
async function logAdminAttempt(supabase, { userId, email, success, reason, context }) {
  try {
    await supabase.from('audit_log').insert({
      actor_user_id: userId || null,
      actor_email: email || null,
      event_type: success ? 'system_admin.access_granted' : 'system_admin.access_denied',
      action_category: 'security',
      retention_category: 'critical',
      resource_type: 'system_admin',
      details: reason ? { reason } : null,
    });
  } catch (err) {
    context?.log?.warn?.('ensureSystemAdmin: audit log insert failed', { message: err?.message });
  }
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
