/* eslint-env node */

export const BACKUP_HISTORY_LIMIT = 100;
export const BACKUP_FILE_PREFIX = 'backups/';
export const BACKUP_FILE_SUFFIX = '.enc';

export function normalizeBackupHistory(history) {
  return Array.isArray(history) ? history.filter((entry) => entry && typeof entry === 'object') : [];
}

export function normalizeBackupTimestamp(entry) {
  const rawTimestamp = entry?.timestamp || entry?.created_at || entry?.exported_at || null;
  const timestampMs = rawTimestamp ? new Date(rawTimestamp).getTime() : 0;

  return {
    rawTimestamp,
    timestampMs: Number.isFinite(timestampMs) && timestampMs > 0 ? timestampMs : 0,
  };
}

export function isManagedBackupFilename(filename, orgId = null) {
  if (typeof filename !== 'string' || !filename) {
    return false;
  }

  const prefix = orgId ? `${BACKUP_FILE_PREFIX}${orgId}/` : BACKUP_FILE_PREFIX;
  if (!filename.startsWith(prefix) || !filename.endsWith(BACKUP_FILE_SUFFIX)) {
    return false;
  }

  return /^backups\/[^/]+\/\d{4}-\d{2}-\d{2}\.enc$/i.test(filename);
}

export function getCompletedBackupEntries(history, { orgId = null } = {}) {
  return normalizeBackupHistory(history)
    .filter((entry) => (
      entry.type === 'backup'
      && entry.status === 'completed'
      && isManagedBackupFilename(entry.filename, orgId)
    ))
    .map((entry) => {
      const { rawTimestamp, timestampMs } = normalizeBackupTimestamp(entry);
      return {
        ...entry,
        rawTimestamp,
        timestampMs,
      };
    })
    .filter((entry) => entry.timestampMs > 0)
    .sort((a, b) => b.timestampMs - a.timestampMs);
}

export function findLatestCompletedBackup(history, { orgId = null, now = Date.now(), maxAgeMs = null } = {}) {
  const completed = getCompletedBackupEntries(history, { orgId });
  const latest = completed[0] ?? null;
  const recent = typeof maxAgeMs === 'number'
    ? completed.find((entry) => now - entry.timestampMs <= maxAgeMs) ?? null
    : latest;

  return {
    completed,
    latest,
    recent,
  };
}

export function summarizeBackupHistory(history) {
  const entries = normalizeBackupHistory(history).map((entry) => ({
    type: entry?.type || null,
    status: entry?.status || null,
    timestamp: entry?.timestamp || entry?.created_at || entry?.exported_at || null,
    filename: entry?.filename || null,
    size_bytes: entry?.size_bytes || null,
    total_records: entry?.total_records || null,
    error_message: entry?.error_message || null,
  }));

  const latest = entries.length > 0 ? entries[entries.length - 1] : null;

  return {
    count: entries.length,
    latest,
    entries,
  };
}

export async function appendBackupHistory(supabase, orgId, entry, { limit = BACKUP_HISTORY_LIMIT } = {}) {
  const { data: current } = await supabase
    .from('organizations')
    .select('backup_history')
    .eq('id', orgId)
    .maybeSingle();

  const history = normalizeBackupHistory(current?.backup_history);
  const updated = [...history, entry].slice(-limit);

  const { error } = await supabase
    .from('organizations')
    .update({ backup_history: updated })
    .eq('id', orgId);

  if (error) {
    throw error;
  }

  return updated;
}
