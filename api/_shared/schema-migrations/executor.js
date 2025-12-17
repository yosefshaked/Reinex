/* eslint-env node */
import { executeSchemaStatements, runPreflightQueries, introspectTenantDb } from './introspection.js';

function splitStatements(sql) {
  const raw = String(sql || '').trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(/;\s*\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.endsWith(';') ? entry : entry + ';'));
}

export function buildPreflightQueries(diff) {
  const queries = Array.isArray(diff?.preflightQueries) ? diff.preflightQueries : [];
  return queries.map((q) => ({ id: q.id, sql: q.sql, description: q.description, risk_level: q.risk_level }));
}

export async function runPlanPreflight({ tenantClient, diff }) {
  const queries = buildPreflightQueries(diff)
    .filter((q) => typeof q.sql === 'string' && q.sql.trim().toUpperCase().startsWith('SELECT'))
    .map((q) => q.sql);

  if (!queries.length) {
    return { data: [], error: null };
  }

  return runPreflightQueries(tenantClient, queries);
}

export async function applySafePatch({ tenantClient, patchSqlSafe }) {
  const statements = splitStatements(patchSqlSafe);
  if (!statements.length) {
    return { execution: { statements: [], message: 'no_safe_changes' }, error: null, snapshot: null };
  }

  const executionResult = await executeSchemaStatements(tenantClient, statements, { allowDestructive: false });
  if (executionResult.error) {
    return { execution: null, error: executionResult.error, snapshot: null };
  }

  const introspected = await introspectTenantDb(tenantClient);
  return {
    execution: executionResult.data,
    error: null,
    snapshot: introspected.data ?? null,
  };
}

export async function applyDestructivePatch({ tenantClient, manualSql, confirmationPhrase }) {
  const statements = splitStatements(manualSql);
  if (!statements.length) {
    return { execution: { statements: [], message: 'no_manual_changes' }, error: null, snapshot: null };
  }

  const executionResult = await executeSchemaStatements(tenantClient, statements, {
    allowDestructive: true,
    confirmationPhrase,
  });

  if (executionResult.error) {
    return { execution: null, error: executionResult.error, snapshot: null };
  }

  const introspected = await introspectTenantDb(tenantClient);
  return {
    execution: executionResult.data,
    error: null,
    snapshot: introspected.data ?? null,
  };
}
