/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { readSupabaseAdminConfig, createSupabaseAdminClient } from '../_shared/supabase-admin.js';
import {
  ensureSystemAdmin,
  getEncryptionSecretMetadata,
  readEnv,
  respond,
} from '../_shared/org-bff.js';

export default async function systemHealth(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
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
    environment: env.AZURE_FUNCTIONS_ENVIRONMENT || 'local',
    admin: { userId: admin.userId, email: admin.email },
    encryption: {
      current_hash: encryptionMeta.currentHash,
      previous_hash: encryptionMeta.previousHash,
      is_rotation_active: Boolean(encryptionMeta.currentHash && encryptionMeta.previousHash),
    },
    timestamp: new Date().toISOString(),
  });
}
