/* eslint-env node */
import { Buffer } from 'node:buffer';

// Utility to estimate bytes for a JSON-serializable value
export function computeApproxEntryBytes(value) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    return typeof s === 'string' ? Buffer.byteLength(s, 'utf8') : 0;
  } catch {
    return 0;
  }
}

// Per-key quotas in bytes (can be environment-driven later)
const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024; // 5 MB default per org/key
const KEY_QUOTAS = {
  session_form_config: 10 * 1024 * 1024, // 10 MB for versioned form histories
  // Add other keys here as needed
};

function getQuotaForKey(key) {
  return KEY_QUOTAS[key] ?? DEFAULT_QUOTA_BYTES;
}

/**
 * Ensure sufficient capacity before appending a new entry to history-like storage.
 * In observe mode: only logs when quota would be exceeded; does not prune or block.
 * In enforce mode (future): prunes oldest entries or archives them.
 *
 * @param {object} context Azure Function context for logging
 * @param {object} tenantClient Supabase tenant client
 * @param {object} params { orgId, key, newEntryBytes, strategy: 'prune' | 'archive' }
 * @param {object} opts { mode: 'observe' | 'enforce' }
 * @returns {Promise<{ allowed: boolean, pruned?: number }>}
 */
export async function ensureCapacity(context, tenantClient, { orgId, key, newEntryBytes, strategy = 'prune' }, { mode = 'observe' } = {}) {
  const quota = getQuotaForKey(key);

  // For now, we compute aggregate from settings_value for simplicity.
  // Future: maintain a cached aggregate size column or trigger-maintained view.
  let currentSize = 0;
  try {
    const { data, error } = await tenantClient
      .from('Settings')
      .select('settings_value')
      .eq('key', key);

    if (error) {
      context.log?.warn?.('history-quota failed to compute current size', { key, message: error.message });
      // On error, allow write in observe mode
      return { allowed: true };
    }

    if (Array.isArray(data)) {
      for (const row of data) {
        currentSize += computeApproxEntryBytes(row.settings_value);
      }
    }
  } catch (err) {
    context.log?.warn?.('history-quota error computing size', { key, message: err?.message });
    return { allowed: true };
  }

  const projectedSize = currentSize + newEntryBytes;
  const wouldExceed = projectedSize > quota;

  if (wouldExceed) {
    const msg = `history-quota [${mode}] key=${key} orgId=${orgId} current=${currentSize} new=${newEntryBytes} projected=${projectedSize} quota=${quota}`;
    if (context.log?.warn) context.log.warn(msg);
    else if (context.log) context.log(msg);
  }

  if (mode === 'observe') {
    // Observe-only: never block
    return { allowed: true };
  }

  // Future enforce mode: if wouldExceed, prune/archive until under quota
  if (wouldExceed) {
    if (strategy === 'prune') {
      // TODO: delete oldest entries until projectedSize <= quota
      // Example:
      // - Query oldest rows by created_at or version
      // - Delete in batch until headroom
      // - Return { allowed: true, pruned: count }
      context.log?.error?.('history-quota enforce mode not yet implemented for prune strategy');
      return { allowed: false };
    }
    if (strategy === 'archive') {
      // TODO: move old entries to archive table or Supabase Storage
      // - Archive oldest to a separate table or JSON in storage
      // - Keep a pointer in Settings (e.g., archived_until timestamp)
      // - Return { allowed: true, archived: count }
      context.log?.error?.('history-quota enforce mode not yet implemented for archive strategy');
      return { allowed: false };
    }
  }

  return { allowed: true };
}
