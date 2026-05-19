/**
 * Storage Handler (M5).
 *
 * Deletes all Supabase Storage files belonging to an org before the "Documents"
 * DB rows are removed in phase 8. Storage cleanup failure NEVER aborts the DB purge —
 * failed paths are surfaced in the execute response for manual reconciliation.
 *
 * See README Section 8 for the full contract and failure policy.
 *
 * Exported:
 *   deleteOrgStorageFiles(client, orgId, env) → StorageResult
 *
 * @typedef {Object} StorageResult
 * @property {number}   attempted    - Number of path values found in the DB.
 * @property {number}   deleted      - Number of paths successfully removed from Storage.
 * @property {number}   failed       - Number of paths that failed to delete.
 * @property {string[]} failedPaths  - Paths that could not be deleted (for reconciliation).
 */

const BATCH_SIZE = 1000; // Supabase Storage batch remove limit

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client  Service-role client.
 * @param {string} orgId   UUID of the org being purged.
 * @param {Record<string, string>} env  Function environment (must contain STORAGE_DOCUMENTS_BUCKET).
 * @returns {Promise<StorageResult>}
 */
export async function deleteOrgStorageFiles(client, orgId, env) {
  const bucketName = env.STORAGE_DOCUMENTS_BUCKET || 'documents';

  // 1. Collect all storage paths for the org from the Documents table.
  const { data: docs, error: fetchError } = await client
    .from('Documents')
    .select('path')
    .eq('org_id', orgId);

  if (fetchError) {
    console.error('[storage-handler] Failed to fetch Documents paths:', fetchError.message);
    // Return a degraded result — the execute phase will still delete the DB rows.
    return { attempted: 0, deleted: 0, failed: 0, failedPaths: [], fetchError: fetchError.message };
  }

  const paths = (docs ?? []).map(d => d.path).filter(p => typeof p === 'string' && p.length > 0);
  const attempted = paths.length;

  if (attempted === 0) {
    return { attempted: 0, deleted: 0, failed: 0, failedPaths: [] };
  }

  // 2. Delete in batches of up to 1 000 paths per Storage API call.
  const failedPaths = [];

  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);
    const { error: removeError } = await client.storage.from(bucketName).remove(batch);

    if (removeError) {
      // Log but never abort — storage failure must not block the DB purge.
      console.error(
        '[storage-handler] batch remove error',
        removeError.message,
        'first_paths:', batch.slice(0, 3),
      );
      failedPaths.push(...batch);
    }
  }

  const deleted = attempted - failedPaths.length;

  return {
    attempted,
    deleted,
    failed: failedPaths.length,
    failedPaths,
  };
}
