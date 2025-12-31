/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  isValidOrgId,
  parseRequestBody,
  readEnv,
  respond,
  resolveTenantPublicClient,
} from '../_shared/org-bff.js';

import { fetchSchemaMigrationAudit } from '../_shared/schema-migrations/audit-store.js';
import { runPlanPreflight } from '../_shared/schema-migrations/executor.js';
import { SCHEMA_MIGRATION_BOOTSTRAP_SQL } from '../_shared/schema-migrations/bootstrap-sql.js';

export default async function tenantsSchemaPreflight(context, req) {
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
    context.log?.error?.('tenants-schema-preflight failed to verify membership', { message: error?.message, tenantId, userId });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const body = parseRequestBody(req);
  const planId = String(body?.plan_id || '').trim();
  if (!planId) {
    return respond(context, 400, { message: 'missing_plan_id' });
  }

  const planRecord = await fetchSchemaMigrationAudit(supabase, planId);
  if (planRecord.error || !planRecord.data) {
    return respond(context, 404, { message: 'plan_not_found' });
  }

  if (planRecord.data.tenant_id !== tenantId) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const tenantClientResult = await resolveTenantPublicClient(context, supabase, env, tenantId);
  if (tenantClientResult.error) {
    return respond(context, tenantClientResult.error.status, tenantClientResult.error.body);
  }

  const diff = planRecord.data.patch_plan_json;
  const preflightResult = await runPlanPreflight({ tenantClient: tenantClientResult.client, diff });

  if (preflightResult.error?.code === 'schema_preflight_not_available') {
    return respond(context, 424, {
      message: 'schema_preflight_not_available',
      hint: 'Run the bootstrap SQL once on the tenant database (Supabase SQL Editor), then retry.',
      bootstrap_sql: SCHEMA_MIGRATION_BOOTSTRAP_SQL,
    });
  }

  if (preflightResult.error) {
    return respond(context, 500, { message: 'preflight_failed', error: preflightResult.error.message });
  }

  return respond(context, 200, {
    plan_id: planId,
    preflight_results: preflightResult.data,
  });
}
