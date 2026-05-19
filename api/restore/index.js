/* eslint-env node */
import { createSingleClient, readEnv, respond, resolveOrgId, parseRequestBody, ensureMembership, isAdminRole } from '../_shared/org-bff.js';
import { decryptBackup, validateBackupManifest, restoreTenantData } from '../_shared/backup-utils.js';
import { getStorageDriver } from '../cross-platform/storage-drivers/index.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

function checkRestorePermission(orgSettings) {
  if (!orgSettings || !orgSettings.permissions) {
    return { allowed: false, reason: 'restore_not_configured' };
  }

  const permissions = typeof orgSettings.permissions === 'string'
    ? JSON.parse(orgSettings.permissions)
    : orgSettings.permissions;

  if (!permissions.backup_local_enabled) {
    return { allowed: false, reason: 'restore_not_enabled' };
  }

  return { allowed: true };
}

async function appendRestoreHistory(supabase, orgId, entry) {
  const { data: current } = await supabase
    .from('organizations')
    .select('backup_history')
    .eq('id', orgId)
    .maybeSingle();

  const history = current?.backup_history || [];
  const updated = [...history, entry];

  // Keep only last 100 entries
  const trimmed = updated.slice(-100);

  await supabase
    .from('organizations')
    .update({ backup_history: trimmed })
    .eq('id', orgId);
}

export default async function restore(context, req) {
  const env = readEnv(context);
  const supabase = createSingleClient(env);

  try {
    const body = parseRequestBody(req);
    const orgId = resolveOrgId(req, body);

    if (!orgId) {
      return respond(context, 400, { message: 'invalid_org_id' });
    }

    const authorization = req?.headers?.authorization || req?.headers?.Authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!token) {
      return respond(context, 401, { message: 'missing_bearer' });
    }

    const authResult = await supabase.auth.getUser(token);
    if (authResult.error || !authResult.data?.user?.id) {
      return respond(context, 401, { message: 'invalid_or_expired_token' });
    }

    const userId = authResult.data.user.id;
    const role = await ensureMembership(supabase, orgId, userId);
    if (!role || !isAdminRole(role)) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const { data: orgSettings, error: settingsError } = await supabase
      .from('organizations')
      .select('permissions, backup_history')
      .eq('id', orgId)
      .maybeSingle();

    if (settingsError) {
      context.log?.error?.('restore failed to load org settings', { message: settingsError.message });
      return respond(context, 500, { message: 'failed_to_load_settings' });
    }

    const permissionCheck = checkRestorePermission(orgSettings);
    if (!permissionCheck.allowed) {
      return respond(context, 403, { message: permissionCheck.reason });
    }

    const filename = typeof body?.filename === 'string' ? body.filename.trim() : '';
    if (!filename) {
      return respond(context, 400, { message: 'missing_filename' });
    }

    const expectedPrefix = `backups/${orgId}/`;
    if (!filename.startsWith(expectedPrefix)) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const storageDriver = getStorageDriver('managed', null, env);
    let encryptedBuffer;
    try {
      encryptedBuffer = await storageDriver.getFile(filename);
    } catch (error) {
      context.log?.warn?.('restore backup file not found', { filename, message: error?.message });
      return respond(context, 404, { message: 'backup_not_found' });
    }

    const manifest = await decryptBackup(encryptedBuffer, env);
    const validation = validateBackupManifest(manifest);
    if (!validation.valid) {
      return respond(context, 400, { message: validation.error });
    }

    if (manifest.org_id !== orgId) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const result = await restoreTenantData(supabase, manifest, { clearExisting: false });

    await appendRestoreHistory(supabase, orgId, {
      type: 'restore',
      status: 'completed',
      timestamp: new Date().toISOString(),
      filename,
      source_org_id: manifest.org_id,
      records_restored: result.restored,
    });

    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      userRole: role,
      actionType: AUDIT_ACTIONS.BACKUP_RESTORED,
      actionCategory: AUDIT_CATEGORIES.BACKUP,
      resourceType: 'backup',
      resourceId: filename,
      details: {
        source_org_id: manifest.org_id,
        records_restored: result.restored,
        errors_count: result.errors.length,
      },
    });

    return respond(context, 200, {
      restored: result.restored,
      errors: result.errors,
    });
  } catch (error) {
    context.log?.error?.('restore crashed', { message: error?.message, stack: error?.stack });
    return respond(context, 500, { message: 'restore_failed' });
  }
}
