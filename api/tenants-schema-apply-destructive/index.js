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

import {
  fetchSchemaMigrationAudit,
  updateSchemaMigrationAudit,
  hashSnapshot,
} from '../_shared/schema-migrations/audit-store.js';
import { applyDestructivePatch } from '../_shared/schema-migrations/executor.js';
import { SCHEMA_MIGRATION_BOOTSTRAP_SQL } from '../_shared/schema-migrations/bootstrap-sql.js';

const REQUIRED_PHRASE = 'ALLOW DESTRUCTIVE CHANGES';

export default async function tenantsSchemaApplyDestructive(context, req) {
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
    context.log?.error?.('tenants-schema-apply-destructive failed to verify membership', { message: error?.message, tenantId, userId });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const body = parseRequestBody(req);
  const planId = String(body?.plan_id || '').trim();
  const confirmationPhrase = String(body?.confirmationPhrase || '').trim();

  if (!planId) {
    return respond(context, 400, { message: 'missing_plan_id' });
  }

  if (confirmationPhrase !== REQUIRED_PHRASE) {
    return respond(context, 400, { message: 'confirmation_phrase_mismatch' });
  }

  const planRecord = await fetchSchemaMigrationAudit(supabase, planId);
  if (planRecord.error || !planRecord.data) {
    return respond(context, 404, { message: 'plan_not_found' });
  }

  if (planRecord.data.tenant_id !== tenantId) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const artifacts = planRecord.data.patch_plan_json?.artifacts;
  const manualSql = artifacts?.manual_sql || '';

  const tenantClientResult = await resolveTenantPublicClient(context, supabase, env, tenantId);
  if (tenantClientResult.error) {
    return respond(context, tenantClientResult.error.status, tenantClientResult.error.body);
  }

  const applied = await applyDestructivePatch({
    tenantClient: tenantClientResult.client,
    manualSql,
    confirmationPhrase,
  });

  if (applied.error?.code === 'schema_executor_not_available') {
    return respond(context, 424, {
      message: 'schema_executor_not_available',
      hint: 'Run the bootstrap SQL once on the tenant database (Supabase SQL Editor), then retry.',
      bootstrap_sql: SCHEMA_MIGRATION_BOOTSTRAP_SQL,
    });
  }

  if (applied.error) {
    await updateSchemaMigrationAudit(supabase, planId, {
      status: 'failed',
      approved_by_user_id: userId,
      approval_method: 'apply_destructive',
      approval_phrase: confirmationPhrase,
      executed_result_json: { error: applied.error.message },
    });

    return respond(context, 500, { message: 'apply_destructive_failed', error: applied.error.message });
  }

  const afterSnapshotHash = applied.snapshot ? hashSnapshot(applied.snapshot) : null;

  await updateSchemaMigrationAudit(supabase, planId, {
    status: 'applied',
    approved_by_user_id: userId,
    approval_method: 'apply_destructive',
    approval_phrase: confirmationPhrase,
    executed_sql_manual: manualSql,
    executed_result_json: applied.execution,
    db_snapshot_hash_after: afterSnapshotHash,
    db_snapshot_after: applied.snapshot,
  });

  return respond(context, 200, {
    plan_id: planId,
    status: 'applied',
    execution: applied.execution,
    db_snapshot_hash_after: afterSnapshotHash,
  });
}
