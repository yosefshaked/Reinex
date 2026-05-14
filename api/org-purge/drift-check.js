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
 * Catalog queries (C1–C5) use the live DB RPC public.schema_introspection_v1(),
 * which reads pg_catalog directly inside Postgres and returns a snapshot of the
 * public schema. This avoids PostgREST's schema exposure limits while still
 * validating the real deployed Supabase schema.
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
import { findLatestCompletedBackup } from '../_shared/backup-history.js';
import { getStorageDriver } from '../cross-platform/storage-drivers/index.js';

// The 30-day backup guard window (check C7).
const BACKUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

async function loadCatalogSnapshot(client) {
  const { data, error } = await client.rpc('schema_introspection_v1');
  if (error) throw error;
  if (!data || typeof data !== 'object') {
    throw new Error('schema_introspection_v1 returned no usable snapshot');
  }
  return data;
}

function normalizeConstraintIdentifier(value) {
  return String(value || '').replace(/"/g, '').trim().toLowerCase();
}

function parseForeignKeyConstraint(constraint) {
  if (!constraint || constraint.type !== 'f' || typeof constraint.definition !== 'string') {
    return null;
  }

  const definition = normalizeConstraintIdentifier(constraint.definition);
  const match = definition.match(
    /foreign key\s*\(([^)]+)\)\s*references\s+((?:[a-z0-9_]+\.)?[a-z0-9_]+)\s*\(([^)]+)\)(?:\s+on delete\s+([a-z ]+?))?(?:\s+on update|$)/i
  );

  if (!match) return null;

  const sourceColumns = match[1].split(',').map((item) => normalizeConstraintIdentifier(item));
  const referencedTarget = normalizeConstraintIdentifier(match[2]);
  const referencedColumns = match[3].split(',').map((item) => normalizeConstraintIdentifier(item));
  const deleteRule = (match[4] || 'NO ACTION').trim().toUpperCase();

  const referencedTable = referencedTarget.includes('.')
    ? referencedTarget.split('.').pop()
    : referencedTarget;

  return {
    table: constraint.table,
    sourceColumns,
    referencedTable,
    referencedColumns,
    deleteRule,
  };
}

function getOrgForeignKeys(snapshot) {
  const constraints = Array.isArray(snapshot?.constraints) ? snapshot.constraints : [];
  return constraints
    .map(parseForeignKeyConstraint)
    .filter((constraint) => (
      constraint
      && constraint.sourceColumns.length === 1
      && constraint.sourceColumns[0] === 'org_id'
      && constraint.referencedTable === 'organizations'
      && constraint.referencedColumns.length === 1
      && constraint.referencedColumns[0] === 'id'
    ));
}

/**
 * Run all seven drift checks against the live database.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client  Service-role client.
 * @param {string} orgId  UUID of the org to be purged.
 * @param {{ forceSkipBackupCheck?: boolean, env?: Object, backupStorageDriver?: Object, verifyBackupStorage?: boolean }} [options]
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
  const {
    forceSkipBackupCheck = false,
    env = null,
    backupStorageDriver = null,
    verifyBackupStorage = true,
  } = options;

  const blocking = [];
  const warnings = [];
  let rowCounts = {};
  let orgName = null;

  // ── C7 / org existence: always run first (cheapest check, also confirms org exists)
  const c7Result = await checkC7BackupGuard(client, orgId, forceSkipBackupCheck, {
    env,
    backupStorageDriver,
    verifyBackupStorage,
  });
  orgName = c7Result.orgName;
  if (c7Result.blocking) {
    blocking.push(c7Result.issue);
  }

  // If org doesn't exist at all, abort remaining checks (all would be meaningless).
  if (c7Result.orgNotFound) {
    return { passed: false, blocking, warnings, rowCounts, orgName: null, manifestVersion: MANIFEST_VERSION };
  }

  // ── Run catalog checks C1–C5 in parallel (all read-only, independent).
  let catalogSnapshot = null;
  let catalogError = null;
  try {
    catalogSnapshot = await loadCatalogSnapshot(client);
  } catch (err) {
    catalogError = err;
  }

  const [c1Result, c2Result, c3Result, c4Result, c5Result] = await Promise.all([
    checkC1CoverageGap(catalogSnapshot, catalogError),
    checkC2ManifestGhost(catalogSnapshot, catalogError),
    checkC3FkDrift(catalogSnapshot, catalogError),
    checkC4RetentionCascadeRisk(catalogSnapshot, catalogError),
    checkC5StorageHandlerIntegrity(catalogSnapshot, catalogError),
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
 * Implementation: read the live public-schema snapshot from schema_introspection_v1()
 * and inspect FK constraints targeting organizations(id).
 */
async function checkC1CoverageGap(snapshot, catalogError) {
  try {
    if (catalogError) throw catalogError;

    const tablesWithOrgFk = new Set(getOrgForeignKeys(snapshot).map((constraint) => constraint.table));

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
    return {
      blocking: false,
      warning: {
        check: 'C1_CATALOG_UNAVAILABLE',
        message: 'Could not query the live schema snapshot to verify manifest coverage. ' +
          'Ensure schema_introspection_v1 exists in the deployed database or accept this risk manually.',
        detail: err?.message,
      },
    };
  }
}

/**
 * C2 — Manifest ghost.
 * Every table listed in the manifest must physically exist in the DB.
 *
 * Implementation: diff the manifest against the live table list from
 * schema_introspection_v1(). Tables in manifest but not in DB are ghosts.
 */
async function checkC2ManifestGhost(snapshot, catalogError) {
  try {
    if (catalogError) throw catalogError;

    const tables = Array.isArray(snapshot?.tables) ? snapshot.tables : [];
    const dbTableSet = new Set(tables.map((table) => table.name));
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
        message: 'Could not query the live schema snapshot to verify manifest ghost check.',
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
async function checkC3FkDrift(snapshot, catalogError) {
  try {
    if (catalogError) throw catalogError;

    const tableDeleteRule = Object.fromEntries(
      getOrgForeignKeys(snapshot).map((constraint) => [constraint.table, constraint.deleteRule])
    );

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
        message: 'Could not verify FK delete rules (C3). Accept risk or ensure schema_introspection_v1 is deployed.',
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
async function checkC4RetentionCascadeRisk(snapshot, catalogError) {
  try {
    if (catalogError) throw catalogError;

    const affectedTables = getOrgForeignKeys(snapshot)
      .filter((constraint) => RETENTION_TABLE_NAMES.includes(constraint.table) && constraint.deleteRule === 'CASCADE')
      .map((constraint) => constraint.table);

    if (affectedTables.length > 0) {

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
async function checkC5StorageHandlerIntegrity(snapshot, catalogError) {
  try {
    if (catalogError) throw catalogError;

    const tables = Array.isArray(snapshot?.tables) ? snapshot.tables : [];
    const documentsTable = tables.find((table) => table.name === 'Documents');
    const pathCol = Array.isArray(documentsTable?.columns)
      ? documentsTable.columns.find((column) => column.name === 'path')
      : null;

    if (!pathCol) {
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

    if (pathCol.type !== 'text') {
      return {
        blocking: true,
        issue: {
          check: 'C5_STORAGE_HANDLER_BROKEN',
          message: `public."Documents".path has unexpected data type '${pathCol.type}' (expected 'text').`,
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
        message: 'Could not verify Documents.path column via the live schema snapshot (C5). ' +
          'Storage handler integrity is unconfirmed.',
        detail: err?.message,
      },
    };
  }
}

/**
 * C6 — Preflight row counts (never blocking).
 * Counts all rows for the target org in every manifest table.
 * Uses parallel queries for throughput — all manifest tables run concurrently.
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
 *   2. A completed managed backup was recorded within the last 30 days.
 *   3. The recorded encrypted backup object still exists in managed storage.
 *
 * Also resolves the org name for use in the prepare response.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} orgId
 * @param {boolean} forceSkipBackupCheck
 * @param {{ env?: Object, backupStorageDriver?: Object, verifyBackupStorage?: boolean }} [options]
 * @returns {Promise<{ orgNotFound: boolean, orgName: string|null, blocking: boolean, issue?: Object }>}
 */
async function checkC7BackupGuard(client, orgId, forceSkipBackupCheck, options = {}) {
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

  const { latest: lastEntry, recent: recentBackup } = findLatestCompletedBackup(org.backup_history, {
    orgId,
    maxAgeMs: BACKUP_MAX_AGE_MS,
  });

  if (!recentBackup) {
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

  const verifyBackupStorage = options.verifyBackupStorage !== false;
  if (verifyBackupStorage) {
    const filename = recentBackup.filename;
    try {
      const storageDriver = options.backupStorageDriver || getStorageDriver('managed', null, options.env || {});
      if (!storageDriver || typeof storageDriver.listByPrefix !== 'function') {
        throw new Error('backup_storage_driver_missing_list_support');
      }

      const backupPrefix = `backups/${orgId}/`;
      const backupFiles = await storageDriver.listByPrefix(backupPrefix);
      const matchingFile = (Array.isArray(backupFiles) ? backupFiles : []).find((file) => file?.key === filename);

      if (!matchingFile || Number(matchingFile.size || 0) <= 0) {
        return {
          orgNotFound: false,
          orgName: org.name,
          blocking: true,
          issue: {
            check: 'C7_BACKUP_FILE_MISSING',
            message: 'The latest recent backup is recorded in backup_history, but the encrypted backup file is missing from managed storage.',
            last_backup_at: recentBackup.rawTimestamp ?? null,
            filename,
            hint: 'Run a fresh backup before purging, or pass force_skip_backup_check: true in the request body to bypass (explicit acknowledgement required).',
          },
        };
      }
    } catch (storageError) {
      return {
        orgNotFound: false,
        orgName: org.name,
        blocking: true,
        issue: {
          check: 'C7_BACKUP_STORAGE_UNVERIFIED',
          message: 'The recent backup could not be verified against managed storage.',
          last_backup_at: recentBackup.rawTimestamp ?? null,
          filename,
          detail: storageError?.message || 'backup_storage_verification_failed',
          hint: 'Fix managed backup storage configuration or run a fresh backup, then retry prepare. Use force_skip_backup_check only with explicit risk acceptance.',
        },
      };
    }
  }

  return { orgNotFound: false, orgName: org.name, blocking: false };
}
