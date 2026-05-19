/* eslint-env node */
import { randomBytes } from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { readSupabaseAdminConfig, createSupabaseAdminClient } from '../_shared/supabase-admin.js';
import { decryptByosConfig, encryptByosConfig } from '../_shared/storage-encryption.js';
import {
  getEncryptionConfig,
  getEncryptionKeyCandidates,
  ensureSystemAdmin,
  getEncryptionSecretMetadata,
  parseRequestBody,
  readEnv,
  respond,
} from '../_shared/org-bff.js';

function normalizeAction(req, method) {
  const queryAction = typeof req?.query?.action === 'string' ? req.query.action.trim() : '';
  if (queryAction) {
    return queryAction;
  }

  if (method !== 'POST') {
    return '';
  }

  const body = parseRequestBody(req);
  return typeof body?.action === 'string' ? body.action.trim() : '';
}

function runEncryptionSanityCheck(env) {
  const encryptionConfig = getEncryptionConfig(env);
  if (!encryptionConfig.current) {
    throw new Error('current_encryption_secret_missing');
  }

  const currentCandidate = getEncryptionKeyCandidates({
    SECURITY_ENCRYPTION_SECRET: encryptionConfig.current,
  })[0];

  if (!currentCandidate?.key) {
    throw new Error('current_encryption_key_derivation_failed');
  }

  const randomProbe = randomBytes(24).toString('hex');
  const encrypted = encryptByosConfig(
    {
      access_key_id: randomProbe,
      secret_access_key: randomProbe,
    },
    currentCandidate.key,
  );
  const decrypted = decryptByosConfig(encrypted, currentCandidate.key);

  const matches =
    decrypted?.access_key_id === randomProbe &&
    decrypted?.secret_access_key === randomProbe;

  return {
    success: matches,
    checkedAt: new Date().toISOString(),
  };
}

function normalizeHostFromRequest(req) {
  const headers = req?.headers ?? {};
  const rawHost =
    headers['x-forwarded-host'] ||
    headers['x-original-host'] ||
    headers.host ||
    '';

  return String(rawHost).trim().toLowerCase().replace(/:\d+$/, '');
}

function classifyFromHostname(hostname) {
  if (!hostname) {
    return '';
  }

  if (hostname.includes('thepcrunners.com')) {
    return 'production';
  }

  if (hostname === 'localhost' || hostname.startsWith('127.0.0.1')) {
    return 'local';
  }

  if (hostname.includes('.azurestaticapps.net')) {
    const firstLabel = hostname.split('.')[0] || '';
    return /-\d+$/.test(firstLabel) ? 'preview' : 'production';
  }

  if (hostname.includes('.azurewebsites.net')) {
    return 'cloud';
  }

  return '';
}

function resolveRuntimeEnvironment(env, req) {
  const hostFromRequest = normalizeHostFromRequest(req);
  const hostClassification = classifyFromHostname(hostFromRequest);
  if (hostClassification) {
    return hostClassification;
  }

  const configured = String(env?.AZURE_FUNCTIONS_ENVIRONMENT || '').trim();
  if (configured) {
    const normalized = configured.toLowerCase();
    if (normalized === 'production') {
      return 'production';
    }
    return configured;
  }

  const hasAzureRuntimeMarkers = Boolean(
    env?.WEBSITE_HOSTNAME ||
      env?.WEBSITE_SITE_NAME ||
      env?.WEBSITE_INSTANCE_ID ||
      env?.FUNCTIONS_EXTENSION_VERSION,
  );

  return hasAzureRuntimeMarkers ? 'cloud' : 'local';
}

export default async function systemHealth(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('admin/system-health: missing Supabase admin credentials');
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
  } catch (err) {
    const status = err.statusCode || 403;
    return respond(context, status, { message: err.message || 'forbidden' });
  }

  const action = normalizeAction(req, method);
  if (action === 'sanity-check') {
    try {
      const sanity = runEncryptionSanityCheck(env);
      if (!sanity.success) {
        return respond(context, 500, {
          success: false,
          message: 'encryption_sanity_check_failed',
          checked_at: sanity.checkedAt,
        });
      }

      return respond(context, 200, {
        success: true,
        message: 'encryption_sanity_check_passed',
        checked_at: sanity.checkedAt,
      });
    } catch (error) {
      context.log?.error?.('admin/system-health: sanity check failed', {
        message: error?.message,
        userId: admin.userId,
      });
      return respond(context, 500, {
        success: false,
        message: 'encryption_sanity_check_failed',
      });
    }
  }

  const encryptionMeta = getEncryptionSecretMetadata(env);

  let dbStatus = 'unknown';
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1);
    dbStatus = error ? 'degraded' : 'healthy';
  } catch {
    dbStatus = 'unreachable';
  }

  return respond(context, 200, {
    status: dbStatus,
    environment: resolveRuntimeEnvironment(env, req),
    admin: { userId: admin.userId, email: admin.email },
    encryption: {
      current_hash: encryptionMeta.currentHash,
      previous_hash: encryptionMeta.previousHash,
      is_rotation_active: Boolean(encryptionMeta.currentHash && encryptionMeta.previousHash),
    },
    timestamp: new Date().toISOString(),
  });
}
