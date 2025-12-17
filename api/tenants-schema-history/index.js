/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  isValidOrgId,
  readEnv,
  respond,
} from '../_shared/org-bff.js';

import { fetchSchemaMigrationHistory } from '../_shared/schema-migrations/audit-store.js';

export default async function tenantsSchemaHistory(context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_auth' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);
  const authResult = await supabase.auth.getUser(authorization.token);
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_token' });
  }

  const tenantId = String(req.params?.tenantId || '').trim();
  if (!isValidOrgId(tenantId)) {
    return respond(context, 400, { message: 'invalid_tenant_id' });
  }

  const userId = authResult.data.user.id;
  let role;
  try {
    role = await ensureMembership(supabase, tenantId, userId);
  } catch (error) {
    context.log?.error?.('tenants-schema-history failed to verify membership', { message: error?.message, tenantId, userId });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const history = await fetchSchemaMigrationHistory(supabase, tenantId, 25);
  if (history.error) {
    return respond(context, 500, { message: 'failed_to_load_history' });
  }

  return respond(context, 200, { history: history.data });
}
