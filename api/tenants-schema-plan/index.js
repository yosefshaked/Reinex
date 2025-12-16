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

import { buildSchemaPlan } from '../_shared/schema-migrations/planner.js';
import { runPlanPreflight } from '../_shared/schema-migrations/executor.js';
import {
  insertSchemaMigrationAudit,
  hashSnapshot,
} from '../_shared/schema-migrations/audit-store.js';
import { SCHEMA_MIGRATION_BOOTSTRAP_SQL } from '../_shared/schema-migrations/bootstrap-sql.js';

export default async function tenantsSchemaPlan(context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('tenants-schema-plan missing Supabase admin credentials');
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
    context.log?.error?.('tenants-schema-plan failed to verify membership', { message: error?.message, tenantId, userId });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const tenantClientResult = await resolveTenantPublicClient(context, supabase, env, tenantId);
  if (tenantClientResult.error) {
    return respond(context, tenantClientResult.error.status, tenantClientResult.error.body);
  }

  const body = parseRequestBody(req);
  const ssotTextOverride = typeof body?.ssotText === 'string' ? body.ssotText : null;

  const plan = await buildSchemaPlan({ tenantClient: tenantClientResult.client, ssotTextOverride });

  if (plan.error) {
    if (plan.error.code === 'schema_introspection_not_available') {
      return respond(context, 424, {
        message: 'schema_introspection_not_available',
        hint: 'Run the bootstrap SQL once on the tenant database (Supabase SQL Editor), then retry.',
        bootstrap_sql: SCHEMA_MIGRATION_BOOTSTRAP_SQL,
        ssot_version_hash: plan.ssotHash,
      });
    }

    context.log?.error?.('tenants-schema-plan failed to build plan', { message: plan.error?.message });
    return respond(context, 500, { message: 'failed_to_build_schema_plan' });
  }

  const preflightResult = await runPlanPreflight({ tenantClient: tenantClientResult.client, diff: plan.diff });

  const record = {
    tenant_id: tenantId,
    created_at: new Date().toISOString(),
    ssot_version_hash: plan.ssotHash,
    db_snapshot_hash_before: plan.dbSnapshotHash,
    summary_counts: plan.diff?.summary ?? null,
    patch_plan_json: {
      plan_id: plan.planId,
      summary: plan.diff?.summary ?? null,
      changes: plan.diff?.changes ?? [],
      preflightQueries: plan.diff?.preflightQueries ?? [],
      artifacts: plan.artifacts,
    },
    db_snapshot_before: plan.dbSnapshot,
    preflight_results: preflightResult.data ?? null,
    approved_by_user_id: null,
    approval_phrase: null,
    status: 'planned',
  };

  const insertResult = await insertSchemaMigrationAudit(supabase, record);
  const auditId = insertResult.id;
  if (insertResult.error) {
    context.log?.warn?.('tenants-schema-plan audit insert failed (continuing without storage)', {
      message: insertResult.error.message,
    });
  }

  const response = {
    plan_id: auditId || plan.planId,
    storage: auditId ? 'control_db' : 'ephemeral',
    ssot_version_hash: plan.ssotHash,
    db_snapshot_hash_before: plan.dbSnapshotHash,
    summary_counts: plan.diff.summary,
    changes: plan.diff.changes,
    patch_sql_safe: plan.artifacts.patch_sql_safe,
    manual_sql: plan.artifacts.manual_sql,
    manual_steps: plan.artifacts.manual_steps,
    preflight_results: preflightResult.data ?? null,
    preflight_error: preflightResult.error ? { message: preflightResult.error.message } : null,
    bootstrap_sql: null,
  };

  if (preflightResult.error?.code === 'schema_preflight_not_available') {
    response.bootstrap_sql = SCHEMA_MIGRATION_BOOTSTRAP_SQL;
  }

  response.db_snapshot_hash_before = response.db_snapshot_hash_before || (plan.dbSnapshot ? hashSnapshot(plan.dbSnapshot) : null);

  return respond(context, 200, response);
}
