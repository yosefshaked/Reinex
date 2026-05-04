/**
 * Drift Check Validator — runs before every org-purge prepare call.
 *
 * Implements checks C1–C7 defined in:
 *   implementations/admin-page/org-nuke/README.md  Section 5
 *
 * The validator does NOT drive deletion order — it only gates the prepare step.
 * All seven checks run even when earlier ones fail, so the caller gets a
 * complete picture of all drift issues in one response.
 *
 * Catalog queries (C1–C5) use Supabase JS client.schema('information_schema').
 * If information_schema is not accessible via PostgREST, those checks degrade
 * gracefully to warnings rather than hard failures — this is intentional so the
 * operator is never silently blocked by a configuration gap.
 *
 * Usage:
 *   const result = await runDriftChecks(client, orgId, { forceSkipBackupCheck: false });
 *   if (!result.passed) return respond(context, 400, { error: 'DRIFT_CHECK_FAILED', checks: result.blocking });
 */

import {
  MANIFEST_TABLE_SET,
  PLATFORM_TABLES,
  PURGE_MANIFEST,
  EXPECTED_CASCADE_TABLES,
  RETENTION_TABLE_NAMES,
  MANIFEST_VERSION,
} from './purge-manifest.js';

// The 30-day backup guard window (check C7).
const BACKUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Run all seven drift checks against the live database.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client  Service-role client.
 * @param {string} orgId  UUID of the org to be purged.
 * @param {{ forceSkipBackupCheck?: boolean }} [options]
 * @returns {Promise<DriftCheckResult>}
 *
 * @typedef {Object} DriftCheckResult
 * @property {boolean}  passed       - True only when no blocking checks fired.
 * @property {Object[]} blocking     - Checks that must be resolved before execute.
 * @property {Object[]} warnings     - Non-blocking issues (C3 FK drift, catalog unavailable).
 * @property {Object}   rowCounts    - Preflight row counts keyed by table name (C6).
 * @property {string|null} orgName   - Resolved org name (null if org not found).
 * @property {string}   manifestVersion
 */
export async function runDriftChecks(client, orgId, options = {}) {
  const { forceSkipBackupCheck = false } = options;

  const blocking = [];
  const warnings = [];
  let rowCounts = {};
  let orgName = null;

  // ── C7 / org existence: always run first (cheapest check, also confirms org exists)
  const c7Result = await checkC7BackupGuard(client, orgId, forceSkipBackupCheck);
  orgName = c7Result.orgName;
  if (c7Result.blocking) {
    blocking.push(c7Result.issue);
  }

  // If org doesn't exist at all, abort remaining checks (all would be meaningless).
  if (c7Result.orgNotFound) {
    return { passed: false, blocking, warnings, rowCounts, orgName: null, manifestVersion: MANIFEST_VERSION };
  }

  // ── Run catalog checks C1–C5 in parallel (all read-only, independent).
  const [c1Result, c2Result, c3Result, c4Result, c5Result] = await Promise.all([
    checkC1CoverageGap(client),
    checkC2ManifestGhost(client),
    checkC3FkDrift(client),
    checkC4RetentionCascadeRisk(client),
    checkC5StorageHandlerIntegrity(client),
  ]);

  if (c1Result.blocking) blocking.push(c1Result.issue);
  if (c1Result.warning) warnings.push(c1Result.warning);

  if (c2Result.blocking) blocking.push(c2Result.issue);
  if (c2Result.warning) warnings.push(c2Result.warning);

  // C3 is always a warning (never blocking).
  if (c3Result.warnings.length > 0) warnings.push(...c3Result.warnings);
  if (c3Result.catalogUnavailable) warnings.push(c3Result.catalogUnavailable);

  if (c4Result.blocking) blocking.push(c4Result.issue);
  if (c4Result.warning) warnings.push(c4Result.warning);

  if (c5Result.blocking) blocking.push(c5Result.issue);
  if (c5Result.warning) warnings.push(c5Result.warning);

  // ── C6: Preflight row counts (never blocking, runs regardless of earlier results).
  rowCounts = await checkC6PreflightCounts(client, orgId);

  const passed = blocking.length === 0;
  return { passed, blocking, warnings, rowCounts, orgName, manifestVersion: MANIFEST_VERSION };
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual check implementations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * C1 — Coverage gap.
 * Every table in public schema with an org_id column that has an FK to
 * organizations must appear in the manifest (or in PLATFORM_TABLES).
 *
 * Implementation: query information_schema.columns for org_id columns,
 * then cross-reference with information_schema.key_column_usage and
 * information_schema.referential_constraints to confirm FK target is organizations.
 * All joins are done in JavaScript to avoid multi-table PostgREST queries.
 */
async function checkC1CoverageGap(client) {
  try {
    const is = client.schema('information_schema');

    // Step 1: Get all FK constraints in public schema on org_id.
    const { data: kcuRows, error: e1 } = await is
      .from('key_column_usage')
      .select('table_name, constraint_name')
      .eq('table_schema', 'public')
      .eq('column_name', 'org_id');

    if (e1) throw e1;

    // Step 2: Get all referential constraints whose referenced table is 'organizations'.
    const { data: ccuRows, error: e2 } = await is
      .from('constraint_column_usage')
      .select('constraint_name, table_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'organizations');

    if (e2) throw e2;

    // Build a set of constraint names that point to organizations.
    const orgFkConstraintNames = new Set(ccuRows.map(r => r.constraint_name));

    // Build a set of table names that have an FK from org_id to organizations.
    const tablesWithOrgFk = new Set(
      kcuRows
        .filter(r => orgFkConstraintNames.has(r.constraint_name))
        .map(r => r.table_name)
    );

    // Any table with org_id + org FK that is NOT in manifest AND NOT in platform list
    // is a coverage gap.
    const allKnown = new Set([...MANIFEST_TABLE_SET, ...PLATFORM_TABLES.keys()]);
    const missingFromManifest = [...tablesWithOrgFk].filter(t => !allKnown.has(t));

    if (missingFromManifest.length > 0) {
      return {
        blocking: true,
        issue: {
          check: 'C1_COVERAGE_GAP',
          message: 'Tables exist in the DB with an org_id FK to organizations but are not in the purge manifest.',
          missing_from_manifest: missingFromManifest,
          action: 'Add these tables to purge-manifest.js and update the README before proceeding.',
        },
      };
    }

    return { blocking: false };
  } catch (err) {
    // information_schema not accessible via PostgREST — degrade to warning.
    return {
      blocking: false,
      warning: {
        check: 'C1_CATALOG_UNAVAILABLE',
        message: 'Could not query information_schema to verify manifest coverage. ' +
          'Ensure information_schema is exposed via PostgREST or accept this risk manually.',
        detail: err?.message,
      },
    };
  }
}

/**
 * C2 — Manifest ghost.
 * Every table listed in the manifest must physically exist in the DB.
 *
 * Implementation: query information_schema.tables for all public tables,
 * then diff against MANIFEST_TABLE_SET. Tables in manifest but not in DB
 * are ghosts (schema was changed without updating the manifest).
 */
async function checkC2ManifestGhost(client) {
  try {
    const is = client.schema('information_schema');

    const { data: tables, error } = await is
      .from('tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_type', 'BASE TABLE');

    if (error) throw error;

    const dbTableSet = new Set(tables.map(r => r.table_name));
    const missingFromDb = [...MANIFEST_TABLE_SET].filter(t => !dbTableSet.has(t));

    if (missingFromDb.length > 0) {
      return {
        blocking: true,
        issue: {
          check: 'C2_MANIFEST_GHOST',
          message: 'Tables in the purge manifest do not exist in the live database.',
          missing_from_db: missingFromDb,
          action: 'Remove these tables from purge-manifest.js (and README) if they were dropped, ' +
            'or restore the migration if they should exist.',
        },
      };
    }

    return { blocking: false };
  } catch (err) {
    return {
      blocking: false,
      warning: {
        check: 'C2_CATALOG_UNAVAILABLE',
        message: 'Could not query information_schema.tables to verify manifest ghost check.',
        detail: err?.message,
      },
    };
  }
}

/**
 * C3 — FK behaviour audit (warning only, never blocks).
 * For tables in EXPECTED_CASCADE_TABLES, verify delete_rule is still 'CASCADE'.
 * For RETENTION_TABLE_NAMES, verify delete_rule is NOT 'CASCADE'.
 *
 * Returns warnings[] rather than a single blocking issue.
 */
async function checkC3FkDrift(client) {
  try {
    const is = client.schema('information_schema');

    // Get delete_rule for all FK constraints where org_id → organizations.
    const { data: kcuRows, error: e1 } = await is
      .from('key_column_usage')
      .select('table_name, constraint_name')
      .eq('table_schema', 'public')
      .eq('column_name', 'org_id');

    if (e1) throw e1;

    const { data: ccuRows, error: e2 } = await is
      .from('constraint_column_usage')
      .select('constraint_name, table_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'organizations');

    if (e2) throw e2;

    const { data: refCons, error: e3 } = await is
      .from('referential_constraints')
      .select('constraint_name, constraint_schema, delete_rule');

    if (e3) throw e3;

    const orgFkConstraintNames = new Set(ccuRows.map(r => r.constraint_name));
    const deleteRuleByConstraint = Object.fromEntries(refCons.map(r => [r.constraint_name, r.delete_rule]));

    // Build a map: tableName → delete_rule for org_id FKs targeting organizations.
    const tableDeleteRule = {};
    for (const kcu of kcuRows) {
      if (orgFkConstraintNames.has(kcu.constraint_name)) {
        tableDeleteRule[kcu.table_name] = deleteRuleByConstraint[kcu.constraint_name] ?? 'UNKNOWN';
      }
    }

    const warnings = [];

    // Expected CASCADE tables that have changed away from CASCADE.
    for (const table of EXPECTED_CASCADE_TABLES) {
      const rule = tableDeleteRule[table];
      if (rule && rule !== 'CASCADE') {
        warnings.push({
          check: 'C3_FK_DRIFT',
          severity: 'warning',
          table,
          expected_delete_rule: 'CASCADE',
          actual_delete_rule: rule,
          message: `${table}.org_id FK was expected to be ON DELETE CASCADE but is now ${rule}. ` +
            'Review whether the manifest phase order needs adjusting.',
        });
      }
    }

    return { warnings };
  } catch (err) {
    return {
      warnings: [],
      catalogUnavailable: {
        check: 'C3_CATALOG_UNAVAILABLE',
        severity: 'warning',
        message: 'Could not verify FK delete rules (C3). Accept risk or expose information_schema via PostgREST.',
        detail: err?.message,
      },
    };
  }
}

/**
 * C4 — Retention table cascade risk (blocking).
 * None of the platform/retention tables (audit_log, impersonation_sessions, email_log)
 * should have ON DELETE CASCADE on their org_id FK to organizations.
 * If they do, deleting the org row would silently destroy audit trail data.
 * (With the tombstone strategy the org row is never deleted, but this check
 *  remains as a defence-in-depth guard against future schema accidents.)
 */
async function checkC4RetentionCascadeRisk(client) {
  try {
    const is = client.schema('information_schema');

    const { data: kcuRows, error: e1 } = await is
      .from('key_column_usage')
      .select('table_name, constraint_name')
      .eq('table_schema', 'public')
      .in('table_name', RETENTION_TABLE_NAMES);

    if (e1) throw e1;
    if (!kcuRows || kcuRows.length === 0) return { blocking: false };

    const constraintNames = kcuRows.map(r => r.constraint_name);

    const { data: refCons, error: e2 } = await is
      .from('referential_constraints')
      .select('constraint_name, delete_rule')
      .in('constraint_name', constraintNames)
      .eq('delete_rule', 'CASCADE');

    if (e2) throw e2;

    if (refCons && refCons.length > 0) {
      const cascadeConstraintNames = new Set(refCons.map(r => r.constraint_name));
      const affectedTables = kcuRows
        .filter(r => cascadeConstraintNames.has(r.constraint_name))
        .map(r => r.table_name);

      return {
        blocking: true,
        issue: {
          check: 'C4_RETENTION_CASCADE_RISK',
          message: 'Retention-class tables have acquired ON DELETE CASCADE on their org_id FK. ' +
            'This would destroy audit/compliance records if the org row were ever deleted.',
          affected: affectedTables,
          action: 'Change the FK delete action on these tables from CASCADE to SET NULL or RESTRICT, ' +
            'then re-run the migration.',
        },
      };
    }

    return { blocking: false };
  } catch (err) {
    return {
      blocking: false,
      warning: {
        check: 'C4_CATALOG_UNAVAILABLE',
        message: 'Could not verify retention table FK actions (C4).',
        detail: err?.message,
      },
    };
  }
}

/**
 * C5 — Storage handler integrity (blocking).
 * Verifies that public."Documents" exists and has a `path` column of type text.
 * If the column is missing or renamed, the storage handler (phase 8) cannot run.
 */
async function checkC5StorageHandlerIntegrity(client) {
  try {
    const is = client.schema('information_schema');

    const { data, error } = await is
      .from('columns')
      .select('column_name, data_type')
      .eq('table_schema', 'public')
      .eq('table_name', 'Documents')
      .eq('column_name', 'path');

    if (error) throw error;

    if (!data || data.length === 0) {
      return {
        blocking: true,
        issue: {
          check: 'C5_STORAGE_HANDLER_BROKEN',
          message: 'public."Documents" does not have a `path` column. ' +
            'The storage cleanup handler (phase 8) cannot run.',
          action: 'Restore the `path` column on "Documents" or update the storage handler to use the new column name.',
        },
      };
    }

    const pathCol = data[0];
    if (pathCol.data_type !== 'text') {
      return {
        blocking: true,
        issue: {
          check: 'C5_STORAGE_HANDLER_BROKEN',
          message: `public."Documents".path has unexpected data type '${pathCol.data_type}' (expected 'text').`,
          action: 'Review the storage handler to ensure it can read storage paths from this column type.',
        },
      };
    }

    return { blocking: false };
  } catch (err) {
    return {
      blocking: false,
      warning: {
        check: 'C5_CATALOG_UNAVAILABLE',
        message: 'Could not verify Documents.path column via information_schema (C5). ' +
          'Storage handler integrity is unconfirmed.',
        detail: err?.message,
      },
    };
  }
}

/**
 * C6 — Preflight row counts (never blocking).
 * Counts all rows for the target org in every manifest table.
 * Uses parallel queries for throughput — 46 tables run concurrently.
 *
 * For the `organizations` table the filter is `WHERE id = $orgId`.
 * For all other tables the filter is `WHERE org_id = $orgId`.
 *
 * Returns an object keyed by table name with row counts.
 * Failed individual counts are recorded as -1 (never block the purge).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} orgId
 * @returns {Promise<Record<string, number>>}
 */
async function checkC6PreflightCounts(client, orgId) {
  const counts = await Promise.all(
    PURGE_MANIFEST.map(async entry => {
      try {
        const filterCol = entry.orgIdColumn; // 'org_id' or 'id'
        const { count, error } = await client
          .from(entry.pgName)
          .select('*', { count: 'exact', head: true })
          .eq(filterCol, orgId);

        if (error) {
          console.error(`[drift-check C6] count error on ${entry.table}:`, error.message);
          return [entry.table, -1];
        }
        return [entry.table, count ?? 0];
      } catch (err) {
        console.error(`[drift-check C6] unexpected error on ${entry.table}:`, err?.message);
        return [entry.table, -1];
      }
    })
  );

  return Object.fromEntries(counts);
}

/**
 * C7 — Backup guard (blocking unless forceSkipBackupCheck is true).
 * Verifies:
 *   1. The org exists.
 *   2. A backup was created within the last 30 days.
 *
 * Also resolves the org name for use in the prepare response.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} orgId
 * @param {boolean} forceSkipBackupCheck
 * @returns {Promise<{ orgNotFound: boolean, orgName: string|null, blocking: boolean, issue?: Object }>}
 */
async function checkC7BackupGuard(client, orgId, forceSkipBackupCheck) {
  const { data: org, error } = await client
    .from('organizations')
    .select('id, name, slug, backup_history')
    .eq('id', orgId)
    .maybeSingle();

  if (error) {
    console.error('[drift-check C7] org query error:', error.message);
    // Treat as not found to abort early and surface a meaningful error.
    return { orgNotFound: true, orgName: null, blocking: true, issue: {
      check: 'C7_ORG_QUERY_ERROR',
      message: 'Failed to query the organizations table.',
      detail: error.message,
    }};
  }

  if (!org) {
    return { orgNotFound: true, orgName: null, blocking: true, issue: {
      check: 'C7_ORG_NOT_FOUND',
      message: `Organization with id '${orgId}' does not exist.`,
    }};
  }

  // Org is already a tombstone — refuse to re-purge.
  if (typeof org.name === 'string' && org.name.startsWith('PURGED:')) {
    return { orgNotFound: false, orgName: org.name, blocking: true, issue: {
      check: 'C7_ORG_ALREADY_PURGED',
      message: 'This organization has already been purged (tombstone record detected).',
      tombstone_name: org.name,
    }};
  }

  if (forceSkipBackupCheck) {
    return { orgNotFound: false, orgName: org.name, blocking: false };
  }

  const backupHistory = Array.isArray(org.backup_history) ? org.backup_history : [];
  const completedBackups = backupHistory
    .filter((entry) => entry && entry.type === 'backup' && entry.status === 'completed')
    .map((entry) => {
      const rawTimestamp = entry.timestamp || entry.created_at || null;
      const timestampMs = rawTimestamp ? new Date(rawTimestamp).getTime() : 0;
      return {
        rawTimestamp,
        timestampMs,
      };
    })
    .filter((entry) => Number.isFinite(entry.timestampMs) && entry.timestampMs > 0)
    .sort((a, b) => b.timestampMs - a.timestampMs);

  const now = Date.now();
  const recentBackup = completedBackups.find((entry) => now - entry.timestampMs <= BACKUP_MAX_AGE_MS);

  if (!recentBackup) {
    const lastEntry = completedBackups[0] ?? null;
    return {
      orgNotFound: false,
      orgName: org.name,
      blocking: true,
      issue: {
        check: 'C7_NO_RECENT_BACKUP',
        message: 'No backup found within the last 30 days for this organization.',
        last_backup_at: lastEntry?.rawTimestamp ?? null,
        hint: 'Create a backup first, or pass force_skip_backup_check: true in the request body to bypass (explicit acknowledgement required).',
      },
    };
  }

  return { orgNotFound: false, orgName: org.name, blocking: false };
}
