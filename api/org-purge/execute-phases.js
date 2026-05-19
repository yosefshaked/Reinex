/**
 * Execute Phases (M4).
 *
 * Runs the 14-phase manifest deletion sequence for a single org.
 * Phases are executed SEQUENTIALLY — each phase must complete before the next begins,
 * because later phases depend on earlier ones having removed FK-referenced rows.
 *
 * Phase 8 ("Documents") is handed to the storage handler BEFORE the DB rows are deleted.
 * Phase 14.4 ("organizations") issues the tombstone UPDATE — it is never hard-deleted.
 *
 * "Rollback" semantics:
 *   Azure Functions + Supabase JS does NOT support distributed ACID transactions across
 *   all manifest tables. Instead, the manifest is ordered so that each delete is idempotent:
 *   re-running execute on a partially-purged org will skip tables that already have 0 rows
 *   (the .delete().eq() succeeds with count=0, which is fine). This means recovery from
 *   a mid-run crash is: fix the blocker, call execute again.
 *   A true single-transaction rollback is out of scope for v1 (see README Section 1).
 *
 * Returns:
 *   { deletedCounts, tombstonedOrg, phaseErrors }
 *
 * See README Section 3 for the full manifest and phase descriptions.
 */

import { DELETABLE_ENTRIES, TOMBSTONE_ENTRY } from './purge-manifest.js';
import { deleteOrgStorageFiles } from './storage-handler.js';

/**
 * @typedef {Object} ExecutePhasesResult
 * @property {Record<string, number>} deletedCounts   - Rows deleted per table.
 * @property {TombstonedOrg} tombstonedOrg            - Tombstone result for the org row.
 * @property {PhaseError[]}  phaseErrors              - Non-fatal per-table errors logged for diagnostics.
 * @property {import('./storage-handler.js').StorageResult} storage - Storage cleanup result.
 *
 * @typedef {Object} TombstonedOrg
 * @property {string} id
 * @property {string} originalName
 * @property {string} tombstoneName
 * @property {string} tombstoneSlug
 *
 * @typedef {Object} PhaseError
 * @property {string} table
 * @property {string} step
 * @property {string} message
 */

/**
 * Execute all purge phases in order.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client  Service-role client.
 * @param {string} orgId     UUID of the org to purge.
 * @param {string} orgName   Live org name captured at prepare time (used for tombstone).
 * @param {Record<string, string>} env  Azure Function environment (for storage bucket name).
 * @returns {Promise<ExecutePhasesResult>}
 */
export async function executePhases(client, orgId, orgName, env) {
  const deletedCounts = {};
  const phaseErrors = [];
  let storage = { attempted: 0, deleted: 0, failed: 0, failedPaths: [] };

  // ── Phase 1–13 + 14.1–14.3: hard_delete entries ───────────────────────────
  for (const entry of DELETABLE_ENTRIES) {
    // Phase 8.1: run storage cleanup BEFORE deleting DB rows.
    if (entry.phase === 8 && entry.table === 'Documents') {
      storage = await deleteOrgStorageFiles(client, orgId, env);
      // Fall through — DB rows are deleted below regardless of storage outcome.
    }

    try {
      const filterCol = entry.orgIdColumn; // 'org_id' for all DELETABLE_ENTRIES
      const { count, error } = await client
        .from(entry.pgName)
        .delete({ count: 'exact' })
        .eq(filterCol, orgId);

      if (error) {
        console.error(`[execute-phases] delete error on ${entry.table}:`, error.message);
        phaseErrors.push({ table: entry.table, step: entry.step, message: error.message });
        deletedCounts[entry.table] = -1;
      } else {
        deletedCounts[entry.table] = count ?? 0;
      }
    } catch (err) {
      console.error(`[execute-phases] unexpected error on ${entry.table}:`, err?.message);
      phaseErrors.push({ table: entry.table, step: entry.step, message: err?.message ?? 'unknown' });
      deletedCounts[entry.table] = -1;
    }
  }

  // ── Phase 14.4: tombstone the organizations row ────────────────────────────
  const tombstonedOrg = await applyTombstone(client, orgId, orgName, phaseErrors);

  return { deletedCounts, tombstonedOrg, phaseErrors, storage };
}

/**
 * Applies the tombstone UPDATE to the organizations row.
 * Wipes all sensitive columns; preserves id, created_by, created_at.
 * See README Section 14.5 for the exact column contract.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} orgId
 * @param {string} originalName
 * @param {PhaseError[]} phaseErrors  - Mutated in place on error.
 * @returns {Promise<TombstonedOrg>}
 */
async function applyTombstone(client, orgId, originalName, phaseErrors) {
  const tombstoneName = `PURGED: ${originalName}`;
  const tombstoneSlug = `purged-${orgId}`;

  const { error } = await client
    .from(TOMBSTONE_ENTRY.pgName)
    .update({
      name:                  tombstoneName,
      slug:                  tombstoneSlug,
      setup_completed:       false,
      verified_at:           null,
      permissions:           {},
      logo_url:              null,
      storage_profile:       {},
      storage_grace_ends_at: null,
      backup_history:        [],
      policy_links:          null,
      legal_settings:        null,
      metadata:              null,
      updated_at:            new Date().toISOString(),
    })
    .eq('id', orgId);

  if (error) {
    console.error('[execute-phases] tombstone UPDATE failed:', error.message);
    phaseErrors.push({
      table: TOMBSTONE_ENTRY.table,
      step: TOMBSTONE_ENTRY.step,
      message: error.message,
    });
  }

  return {
    id: orgId,
    originalName,
    tombstoneName,
    tombstoneSlug,
  };
}
