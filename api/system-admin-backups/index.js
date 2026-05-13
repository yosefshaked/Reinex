/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureSystemAdmin,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
} from '../_shared/org-bff.js';
import {
  createSingleClient,
  isValidOrgId,
} from '../_shared/org-bff.js';
import {
  decryptBackup,
  restoreTenantData,
} from '../_shared/backup-utils.js';
import { getStorageDriver } from '../cross-platform/storage-drivers/index.js';
import { logAuditEvent, logSystemAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import backupRun from '../backup/index.js';

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function summarizeBackupHistory(history) {
  const entries = Array.isArray(history) ? history : [];
  const latest = entries.length > 0 ? entries[entries.length - 1] : null;

  return {
    count: entries.length,
    latest: latest
      ? {
          type: latest.type || null,
          status: latest.status || null,
          timestamp: latest.timestamp || null,
          filename: latest.filename || null,
          size_bytes: latest.size_bytes || null,
          total_records: latest.total_records || null,
          error_message: latest.error_message || null,
        }
      : null,
    entries: entries.map((entry) => ({
      type: entry?.type || null,
      status: entry?.status || null,
      timestamp: entry?.timestamp || null,
      filename: entry?.filename || null,
      size_bytes: entry?.size_bytes || null,
      total_records: entry?.total_records || null,
      error_message: entry?.error_message || null,
    })),
  };
}

function summarizeOrganization(row) {
  const permissions = row?.permissions && typeof row.permissions === 'object' ? row.permissions : {};
  const backupHistory = summarizeBackupHistory(row?.backup_history);

  return {
    id: row?.id || null,
    name: row?.name || null,
    slug: row?.slug || null,
    updated_at: row?.updated_at || null,
    backup_local_enabled: Boolean(permissions.backup_local_enabled),
    backup_history_count: backupHistory.count,
    last_backup: backupHistory.latest,
    backup_history: backupHistory.entries,
    permissions,
  };
}

function buildBackupFilenamePrefix(orgId) {
  return `backups/${orgId}/`;
}

async function updateBackupPermission(supabase, orgId, enabled, admin) {
  const { data: orgRow, error: fetchError } = await supabase
    .from('organizations')
    .select('id, name, slug, permissions, backup_history, updated_at')
    .eq('id', orgId)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!orgRow) {
    return null;
  }

  const updatedPermissions = {
    ...(orgRow.permissions && typeof orgRow.permissions === 'object' ? orgRow.permissions : {}),
    backup_local_enabled: enabled,
  };

  const { error: updateError } = await supabase
    .from('organizations')
    .update({
      permissions: updatedPermissions,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orgId);

  if (updateError) {
    throw updateError;
  }

  await logAuditEvent(supabase, {
    orgId,
    userId: admin.userId,
    userEmail: admin.email,
    userRole: 'system_admin',
    actionType: enabled ? AUDIT_ACTIONS.PERMISSION_ENABLED : AUDIT_ACTIONS.PERMISSION_DISABLED,
    actionCategory: AUDIT_CATEGORIES.ADMIN_CONTROL,
    resourceType: 'organization',
    resourceId: orgId,
    details: {
      permission_key: 'backup_local_enabled',
      enabled,
    },
    metadata: {
      source: 'system-admin-backups',
    },
  });

  return summarizeOrganization({ ...orgRow, permissions: updatedPermissions });
}

async function proxyBackupRun(env) {
  const serviceKey = env?.BACKUP_SERVICE_KEY;
  if (!serviceKey) {
    throw new Error('missing_backup_service_key');
  }

  const context = { env, log: console };
  const req = {
    method: 'POST',
    headers: {
      'x-backup-service-key': serviceKey,
    },
    body: {},
  };

  await backupRun(context, req);
  const response = context.res || { status: 500, body: '{}' };

  return {
    status: response.status || 500,
    body: typeof response.body === 'string' ? JSON.parse(response.body) : response.body,
  };
}

async function restoreBackupForOrg(supabase, env, orgId, filename, admin) {
  const storageDriver = getStorageDriver('managed', null, env);
  const prefix = buildBackupFilenamePrefix(orgId);

  if (!filename || !String(filename).startsWith(prefix)) {
    throw new Error('backup_file_must_belong_to_org');
  }

  const encryptedBuffer = await storageDriver.getFile(filename);
  const manifest = await decryptBackup(encryptedBuffer, env);

  if (!manifest || manifest.org_id !== orgId) {
    throw new Error('backup_org_mismatch');
  }

  const restoreResults = await restoreTenantData(createSingleClient(env), manifest, { clearExisting: false });

  await logSystemAuditEvent(supabase, {
    orgId,
    actionType: AUDIT_ACTIONS.BACKUP_RESTORED,
    actionCategory: AUDIT_CATEGORIES.BACKUP,
    resourceType: 'backup',
    resourceId: filename,
    details: {
      filename,
      restored: restoreResults.restored,
      error_count: Array.isArray(restoreResults.errors) ? restoreResults.errors.length : 0,
      admin_override: true,
    },
    metadata: {
      source: 'system-admin-backups',
      admin_user_id: admin.userId,
    },
  });

  return {
    filename,
    restored: restoreResults.restored,
    errors: restoreResults.errors,
  };
}

export default async function systemAdminBackups(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-backups: missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer_token' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let admin;
  try {
    admin = await ensureSystemAdmin(req, supabase, authorization, { context });
  } catch (error) {
    return respond(context, error?.statusCode || 403, { message: error?.message || 'forbidden' });
  }

  if (method === 'GET') {
    const { data, error } = await supabase
      .from('organizations')
      .select('id, name, slug, permissions, backup_history, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      context.log?.error?.('system-admin-backups: failed to load organizations', {
        message: error?.message,
        code: error?.code,
        userId: admin.userId,
      });
      return respond(context, 500, { message: 'failed_to_load_backup_overview' });
    }

    return respond(context, 200, {
      organizations: Array.isArray(data) ? data.map(summarizeOrganization) : [],
      requested_at: new Date().toISOString(),
      admin: {
        user_id: admin.userId,
        email: admin.email,
      },
    });
  }

  if (method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  let body = {};
  try {
    body = parseRequestBody(req);
  } catch {
    return respond(context, 400, { message: 'invalid_json_body' });
  }

  const action = normalizeString(body?.action).toLowerCase();
  const orgId = normalizeString(body?.org_id);
  const filename = normalizeString(body?.filename);
  const enabled = toBoolean(body?.enabled);

  if (action === 'set_backup_local_enabled') {
    if (!isValidOrgId(orgId)) {
      return respond(context, 400, { message: 'org_id_required' });
    }

    try {
      const updated = await updateBackupPermission(supabase, orgId, enabled, admin);
      if (!updated) {
        return respond(context, 404, { message: 'org_not_found' });
      }
      return respond(context, 200, {
        organization: updated,
        requested_at: new Date().toISOString(),
      });
    } catch (error) {
      context.log?.error?.('system-admin-backups: failed to update backup permission', {
        message: error?.message,
        code: error?.code,
        orgId,
        userId: admin.userId,
      });
      return respond(context, 500, { message: 'failed_to_update_backup_setting' });
    }
  }

  if (action === 'run_backup_now') {
    try {
      const result = await proxyBackupRun(env);
      return respond(context, result.status || 200, result.body || { message: 'backup_run_complete' });
    } catch (error) {
      context.log?.error?.('system-admin-backups: backup run proxy failed', {
        message: error?.message,
        userId: admin.userId,
      });
      return respond(context, 500, { message: 'failed_to_run_backup_job' });
    }
  }

  if (action === 'restore_backup') {
    if (!isValidOrgId(orgId) || !filename) {
      return respond(context, 400, { message: 'org_id_and_filename_required' });
    }

    try {
      const result = await restoreBackupForOrg(supabase, env, orgId, filename, admin);
      return respond(context, 200, {
        ...result,
        requested_at: new Date().toISOString(),
      });
    } catch (error) {
      context.log?.error?.('system-admin-backups: restore failed', {
        message: error?.message,
        code: error?.code,
        orgId,
        filename,
        userId: admin.userId,
      });
      return respond(context, 500, { message: 'failed_to_restore_backup' });
    }
  }

  return respond(context, 400, {
    message: 'invalid_action',
    allowed: ['set_backup_local_enabled', 'run_backup_now', 'restore_backup'],
  });
}