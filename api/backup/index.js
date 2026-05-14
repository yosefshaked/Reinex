/* eslint-env node */
import { createSingleClient, readEnv, respond } from '../_shared/org-bff.js';
import {
  encryptBackup,
  exportTenantData,
} from '../_shared/backup-utils.js';
import { appendBackupHistory } from '../_shared/backup-history.js';
import { getStorageDriver } from '../cross-platform/storage-drivers/index.js';
import { logSystemAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

const SERVICE_KEY_HEADER = 'x-backup-service-key';
const RETENTION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function getHeaderValue(req, name) {
  const headers = req?.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';
}

function buildBackupFilename(orgId, date = new Date()) {
  return `backups/${orgId}/${date.toISOString().slice(0, 10)}.enc`;
}

function extractBackupDate(key) {
  const match = /^backups\/[^/]+\/(\d{4}-\d{2}-\d{2})\.enc$/i.exec(key || '');
  return match ? match[1] : null;
}

export default async function backupRun(context, req) {
  const env = readEnv(context);

  try {
    const expectedServiceKey = env?.BACKUP_SERVICE_KEY;
    if (!expectedServiceKey) {
      context.log?.error?.('backup-run missing BACKUP_SERVICE_KEY');
      return respond(context, 500, { message: 'server_misconfigured' });
    }

    const suppliedServiceKey = getHeaderValue(req, SERVICE_KEY_HEADER);
    if (!suppliedServiceKey || suppliedServiceKey !== expectedServiceKey) {
      return respond(context, 401, { message: 'unauthorized' });
    }

    const supabase = createSingleClient(env);
    const storageDriver = getStorageDriver('managed', null, env);

    const { data: orgs, error: orgError } = await supabase
      .from('organizations')
      .select('id')
      .order('created_at', { ascending: true });

    if (orgError) {
      context.log?.error?.('backup-run failed to load organizations', { message: orgError.message });
      return respond(context, 500, { message: 'failed_to_load_organizations' });
    }

    const results = {
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    for (const org of orgs || []) {
      const orgId = org?.id;
      if (!orgId) {
        continue;
      }

      const filename = buildBackupFilename(orgId);

      try {
        const manifest = await exportTenantData(supabase, orgId);
        const encrypted = await encryptBackup(manifest, env);

        await storageDriver.upload(filename, encrypted, 'application/octet-stream');

        const historyEntry = {
          type: 'backup',
          status: 'completed',
          timestamp: new Date().toISOString(),
          filename,
          size_bytes: encrypted.length,
          total_records: manifest.metadata.total_records,
        };

        await appendBackupHistory(supabase, orgId, historyEntry);

        await logSystemAuditEvent(supabase, {
          orgId,
          actionType: AUDIT_ACTIONS.BACKUP_CREATED,
          actionCategory: AUDIT_CATEGORIES.BACKUP,
          resourceType: 'backup',
          resourceId: filename,
          details: {
            filename,
            size_bytes: encrypted.length,
            total_records: manifest.metadata.total_records,
          },
          metadata: {
            backup_run: 'nightly',
          },
        });

        results.succeeded += 1;
      } catch (error) {
        context.log?.error?.('backup-run org backup failed', {
          orgId,
          filename,
          message: error?.message || 'backup_failed',
          code: error?.code,
        });

        results.failed += 1;
        results.errors.push({
          org_id: orgId,
          stage: 'backup',
          filename,
          message: error?.message || 'backup_failed',
        });

        try {
          await appendBackupHistory(supabase, orgId, {
            type: 'backup',
            status: 'failed',
            timestamp: new Date().toISOString(),
            filename,
            size_bytes: 0,
            error_message: error?.message || 'unknown_error',
          });
        } catch (historyError) {
          context.log?.error?.('backup-run history append failed', {
            orgId,
            filename,
            message: historyError?.message || 'history_append_failed',
            code: historyError?.code,
          });

          results.errors.push({ org_id: orgId, stage: 'history', message: historyError?.message || 'history_append_failed' });
        }
      }
    }

    try {
      const cutoffDate = new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
      const files = await storageDriver.listByPrefix('backups/');
      const staleFiles = files.filter((file) => {
        const fileDate = extractBackupDate(file.key);
        return fileDate && fileDate < cutoffDate;
      });

      for (const file of staleFiles) {
        try {
          await storageDriver.delete(file.key);
        } catch (deleteError) {
          results.failed += 1;
          results.errors.push({
            stage: 'retention',
            filename: file.key,
            message: deleteError?.message || 'retention_delete_failed',
          });
        }
      }
    } catch (cleanupError) {
      context.log?.error?.('backup-run retention cleanup failed', {
        message: cleanupError?.message || 'retention_cleanup_failed',
        code: cleanupError?.code,
      });

      results.failed += 1;
      results.errors.push({ stage: 'retention', message: cleanupError?.message || 'retention_cleanup_failed' });
    }

    if (results.failed > 0) {
      context.log?.warn?.('backup-run completed with failures', {
        failed: results.failed,
        succeeded: results.succeeded,
        errors: results.errors,
      });
    }

    return respond(context, 200, results, { 'Cache-Control': 'no-store' });
  } catch (error) {
    context.log?.error?.('backup-run crashed', { message: error?.message, stack: error?.stack });
    return respond(context, 500, { message: 'backup_run_failed' });
  }
}
