/* eslint-env node */
import { Buffer } from 'node:buffer';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import { decryptBackup, validateBackupManifest, restoreTenantData } from '../_shared/backup-utils.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

const MAX_BACKUP_SIZE = 100 * 1024 * 1024; // 100 MB

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
    .from('org_settings')
    .select('backup_history')
    .eq('org_id', orgId)
    .maybeSingle();

  const history = current?.backup_history || [];
  const updated = [...history, entry];

  // Keep only last 100 entries
  const trimmed = updated.slice(-100);

  await supabase
    .from('org_settings')
    .update({ backup_history: trimmed })
    .eq('org_id', orgId);
}

export default async function restore(context, req) {
  const startedAt = Date.now();
  context.log?.info?.('restore: request received');
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('restore missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }
  context.log?.info?.('restore: admin credentials present');

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('restore missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }
  context.log?.info?.('restore: bearer token detected');

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('restore failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }
  context.log?.info?.('restore: token validated');

  const userId = authResult.data.user.id;
  const body = parseJsonBodyWithLimit(req, MAX_BACKUP_SIZE, { mode: 'enforce', context, endpoint: 'restore' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }
  context.log?.info?.('restore: org resolved', { orgId });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('restore failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }
  context.log?.info?.('restore: membership verified', { role });

  // Check restore permissions
  context.log?.info?.('restore: fetching org settings (permissions)');
  const { data: orgSettings, error: settingsError } = await supabase
    .from('org_settings')
    .select('permissions')
    .eq('org_id', orgId)
    .maybeSingle();

  if (settingsError) {
    context.log?.error?.('restore failed to load org settings', { message: settingsError.message });
    return respond(context, 500, { message: 'failed_to_load_settings' });
  }
  context.log?.info?.('restore: org settings loaded');

  const permissionCheck = checkRestorePermission(orgSettings);
  if (!permissionCheck.allowed) {
    context.log?.warn?.('restore: permission denied', { reason: permissionCheck.reason });
    return respond(context, 403, { message: permissionCheck.reason });
  }
  context.log?.info?.('restore: permission check passed');

  // Extract encrypted file and password
  const encryptedFile = body?.file; // Base64 or Buffer
  const password = normalizeString(body?.password);
  const clearExisting = Boolean(body?.clear_existing);

  if (!encryptedFile || !password) {
    return respond(context, 400, { message: 'missing_file_or_password' });
  }
  const fileIsBase64 = typeof encryptedFile === 'string';
  context.log?.info?.('restore: received payload', { clearExisting, fileEncoding: fileIsBase64 ? 'base64' : 'buffer' });

  // Convert base64 to Buffer if needed
  let encryptedBuffer;
  if (typeof encryptedFile === 'string') {
    encryptedBuffer = Buffer.from(encryptedFile, 'base64');
  } else if (Buffer.isBuffer(encryptedFile)) {
    encryptedBuffer = encryptedFile;
  } else {
    return respond(context, 400, { message: 'invalid_file_format' });
  }
  context.log?.info?.('restore: encrypted file prepared', { size_bytes: encryptedBuffer?.byteLength ?? encryptedBuffer?.length });

  // Get tenant client
  context.log?.info?.('restore: resolving tenant client');
  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }
  context.log?.info?.('restore: tenant client ready');

  try {
    // Decrypt
    const tDecryptStart = Date.now();
    context.log?.info?.('restore: decrypting backup', { orgId });
    const manifest = await decryptBackup(encryptedBuffer, password);
    const tDecryptMs = Date.now() - tDecryptStart;
    context.log?.info?.('restore: decrypt completed', { orgId, duration_ms: tDecryptMs });

    // Validate
    const tValidateStart = Date.now();
    const validation = validateBackupManifest(manifest);
    if (!validation.valid) {
      context.log?.warn?.('restore: invalid manifest', { orgId, error: validation.error });
      return respond(context, 400, { message: validation.error });
    }
    const tValidateMs = Date.now() - tValidateStart;
    context.log?.info?.('restore: manifest validated', {
      orgId,
      duration_ms: tValidateMs,
      version: manifest?.version,
      schema_version: manifest?.schema_version,
      source_org_id: manifest?.org_id,
      total_records: manifest?.metadata?.total_records,
      tables: Array.isArray(manifest?.tables) ? manifest.tables.length : 0,
    });

    // Warn if restoring from different org
    if (manifest.org_id !== orgId) {
      context.log?.warn?.('restore: cross-org restore', { targetOrg: orgId, sourceOrg: manifest.org_id });
    }

    // Restore
    const tRestoreStart = Date.now();
    context.log?.info?.('restore: restoring data', { orgId, clearExisting, records: manifest.metadata.total_records });
    const result = await restoreTenantData(tenantClient, manifest, { clearExisting });
    const tRestoreMs = Date.now() - tRestoreStart;

    // Record success
    await appendRestoreHistory(supabase, orgId, {
      type: 'restore',
      status: 'completed',
      timestamp: new Date().toISOString(),
      initiated_by: userId,
      source_org_id: manifest.org_id,
      records_restored: result.restored,
    });

    // Audit log: backup restored
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      userRole: role,
      actionType: AUDIT_ACTIONS.BACKUP_RESTORED,
      actionCategory: AUDIT_CATEGORIES.BACKUP,
      resourceType: 'backup',
      resourceId: orgId,
      details: {
        source_org_id: manifest.org_id,
        records_restored: result.restored,
        clear_existing: clearExisting,
        errors_count: result.errors.length,
      },
    });

    const totalMs = Date.now() - startedAt;
    context.log?.info?.('restore: completed', { orgId, restored: result.restored, errors: result.errors.length, duration_ms: { decrypt: tDecryptMs, validate: tValidateMs, restore: tRestoreMs, total: totalMs } });

    return respond(context, 200, {
      message: 'restore_completed',
      restored: result.restored,
      errors: result.errors,
    });
  } catch (error) {
    context.log?.error?.('restore: failed', { orgId, message: error?.message });

    await appendRestoreHistory(supabase, orgId, {
      type: 'restore',
      status: 'failed',
      timestamp: new Date().toISOString(),
      initiated_by: userId,
      error_message: error?.message || 'unknown_error',
    });

    const message = error.message === 'Unsupported state or unable to authenticate data'
      ? 'incorrect_password'
      : 'restore_failed';

    return respond(context, 500, { message, error: error?.message });
  }
}
