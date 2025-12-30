/* eslint-env node */
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash, createDecipheriv } from 'node:crypto';
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

export async function ensureMembership(supabase, orgId, userId) {
  const { data, error } = await supabase
    .from('org_memberships')
    .select('role, created_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return data.role || 'member';
}

export async function fetchOrgConnection(supabase, orgId) {
  const [{ data: settings, error: settingsError }, { data: organization, error: orgError }] = await Promise.all([
    supabase
      .from('org_settings')
      .select('supabase_url, anon_key')
      .eq('org_id', orgId)
      .maybeSingle(),
    supabase
      .from('organizations')
      .select('dedicated_key_encrypted')
      .eq('id', orgId)
      .maybeSingle(),
  ]);

  if (settingsError) {
    return { error: settingsError };
  }

  if (orgError) {
    return { error: orgError };
  }

  const supabaseUrl = normalizeString(settings?.supabase_url);
  const anonKey = normalizeString(settings?.anon_key);

  if (!supabaseUrl || !anonKey) {
    return { error: new Error('missing_connection_settings') };
  }

  if (!organization || !organization.dedicated_key_encrypted) {
    return { error: new Error('missing_dedicated_key') };
  }

  return {
    supabaseUrl,
    anonKey,
    encryptedKey: organization.dedicated_key_encrypted,
  };
}

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

export function decryptDedicatedKey(payload, keyBuffer) {
  const normalized = normalizeString(payload);
  if (!normalized || !keyBuffer) {
    return null;
  }

  const segments = normalized.split(':');
  if (segments.length !== 5) {
    return null;
  }

  const [, mode, ivPart, authTagPart, cipherPart] = segments;
  if (mode !== 'gcm') {
    return null;
  }

  try {
    const iv = Buffer.from(ivPart, 'base64');
    const authTag = Buffer.from(authTagPart, 'base64');
    const cipherText = Buffer.from(cipherPart, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function createTenantClient({ supabaseUrl, anonKey, dedicatedKey, schema = 'public' }) {
  if (!supabaseUrl || !anonKey || !dedicatedKey) {
    throw new Error('Missing tenant connection parameters.');
  }

  const normalizedSchema = normalizeString(schema) || 'public';
  const allowedSchemas = new Set(['public']);
  if (!allowedSchemas.has(normalizedSchema)) {
    throw new Error('Invalid tenant schema.');
  }

  // Tenant access uses an "app_user" JWT as Authorization with the tenant project's anon key.
  // This keeps RLS enforced while still allowing the BFF to access the tenant schema.
  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${dedicatedKey}`,
      },
    },
    db: {
      schema: normalizedSchema,
    },
  });
}

export function resolveOrgId(req, body) {
  const query = req?.query ?? {};
  const candidate = body?.org_id || body?.orgId || query.org_id || query.orgId;
  const normalized = normalizeString(candidate);
  return normalized && isValidOrgId(normalized) ? normalized : '';
}

export function buildTenantError(message, status = 500) {
  return { status, body: { message } };
}

export function mapConnectionError(error) {
  const message = error?.message || 'failed_to_load_connection';
  const status = message === 'missing_connection_settings'
    ? 412
    : message === 'missing_dedicated_key'
      ? 428
      : 500;
  return buildTenantError(message, status);
}

export async function resolveTenantClient(context, supabase, env, orgId, options = undefined) {
  const normalizedSchema = normalizeString(options?.schema) || 'public';
  const allowedSchemas = new Set(['public']);
  if (!allowedSchemas.has(normalizedSchema)) {
    return { error: buildTenantError('invalid_tenant_schema', 400) };
  }

  const connectionResult = await fetchOrgConnection(supabase, orgId);
  if (connectionResult.error) {
    return { error: mapConnectionError(connectionResult.error) };
  }

  const encryptionSecret = resolveEncryptionSecret(env);
  const encryptionKey = deriveEncryptionKey(encryptionSecret);

  if (!encryptionKey) {
    context.log?.error?.('tenant connection missing encryption secret');
    return { error: buildTenantError('encryption_not_configured') };
  }

  const dedicatedKey = decryptDedicatedKey(connectionResult.encryptedKey, encryptionKey);
  if (!dedicatedKey) {
    return { error: buildTenantError('failed_to_decrypt_key') };
  }

  try {
    const tenantClient = createTenantClient({
      supabaseUrl: connectionResult.supabaseUrl,
      anonKey: connectionResult.anonKey,
      dedicatedKey,
      schema: normalizedSchema,
    });
    return { client: tenantClient };
  } catch (clientError) {
    context.log?.error?.('tenant connection failed to create client', { message: clientError?.message });
    return { error: buildTenantError('failed_to_connect_tenant') };
  }
}

export function resolveTenantPublicClient(context, supabase, env, orgId) {
  return resolveTenantClient(context, supabase, env, orgId, { schema: 'public' });
}
