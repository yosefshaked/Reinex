/* eslint-env node */
import { randomBytes } from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { encryptBackup, exportTenantData } from '../_shared/backup-utils.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

const BACKUP_COOLDOWN_DAYS = 7;

function generateProductKeyPassword(bytes = 10) {
  // bytes*2 hex characters; group into 5 blocks of 4 (e.g., ABCD-EF12-3456-7890-ABCD)
  const hex = randomBytes(bytes).toString('hex').toUpperCase();
  return hex.match(/.{1,4}/g).join('-');
}

function checkBackupPermission(orgSettings) {
  if (!orgSettings || !orgSettings.permissions) {
    return { allowed: false, reason: 'backup_not_configured' };
  }

  const permissions = typeof orgSettings.permissions === 'string'
    ? JSON.parse(orgSettings.permissions)
    : orgSettings.permissions;

  if (!permissions.backup_local_enabled) {
    return { allowed: false, reason: 'backup_not_enabled' };
  }

  return { allowed: true };
}

function checkBackupCooldown(backupHistory, permissions) {
  if (!backupHistory || !Array.isArray(backupHistory) || backupHistory.length === 0) {
    return { allowed: true };
  }

  // Find last successful backup
  const lastBackup = backupHistory
    .filter(entry => entry.type === 'backup' && entry.status === 'completed')
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

  if (!lastBackup) return { allowed: true };

  const lastBackupDate = new Date(lastBackup.timestamp);
  const now = new Date();
  const daysSince = (now - lastBackupDate) / (1000 * 60 * 60 * 24);

  if (daysSince < BACKUP_COOLDOWN_DAYS) {
    // Check for one-time override flag
    if (permissions && permissions.backup_cooldown_override === true) {
      return { allowed: true, overridden: true };
    }
    
    const nextAllowed = new Date(lastBackupDate.getTime() + BACKUP_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    return {
      allowed: false,
      reason: 'backup_cooldown',
      next_allowed_at: nextAllowed.toISOString(),
      days_remaining: Math.ceil(BACKUP_COOLDOWN_DAYS - daysSince),
    };
  }

  return { allowed: true };
}

async function appendBackupHistory(supabase, orgId, entry) {
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

export default async function backup(context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('backup missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('backup missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('backup failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('backup failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  // Check backup permissions
  const { data: orgSettings, error: settingsError } = await supabase
    .from('org_settings')
    .select('permissions, backup_history')
    .eq('org_id', orgId)
    .maybeSingle();

  if (settingsError) {
    context.log?.error?.('backup failed to load org settings', { message: settingsError.message });
    return respond(context, 500, { message: 'failed_to_load_settings' });
  }

  const permissionCheck = checkBackupPermission(orgSettings);
  if (!permissionCheck.allowed) {
    return respond(context, 403, { message: permissionCheck.reason });
  }

  // Parse permissions for cooldown check
  const permissions = typeof orgSettings?.permissions === 'string'
    ? JSON.parse(orgSettings.permissions)
    : orgSettings?.permissions;

  // Check cooldown
  const cooldownCheck = checkBackupCooldown(orgSettings?.backup_history, permissions);
  if (!cooldownCheck.allowed) {
    return respond(context, 429, {
      message: cooldownCheck.reason,
      next_allowed_at: cooldownCheck.next_allowed_at,
      days_remaining: cooldownCheck.days_remaining,
    });
  }

  const wasOverridden = cooldownCheck.overridden === true;

  // Auto-generate a human-friendly password for this backup (looks like a key)
  // Example: ABCD-EF12-3456-7890-ABCD (80 bits of entropy)
  const password = generateProductKeyPassword(10);

  // Get tenant client
  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  try {
    // Export tenant data
    context.log?.info?.('backup: exporting tenant data', { orgId });
    const manifest = await exportTenantData(tenantClient, orgId);

    // Encrypt
    context.log?.info?.('backup: encrypting data', { orgId, records: manifest.metadata.total_records });
    const encrypted = await encryptBackup(manifest, password);

    // Record success
    await appendBackupHistory(supabase, orgId, {
      type: 'backup',
      status: 'completed',
      timestamp: new Date().toISOString(),
      initiated_by: userId,
      size_bytes: encrypted.length,
    });

    // Audit log: backup created
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      userRole: role,
      actionType: AUDIT_ACTIONS.BACKUP_CREATED,
      actionCategory: AUDIT_CATEGORIES.BACKUP,
      resourceType: 'backup',
      resourceId: orgId,
      details: {
        size_bytes: encrypted.length,
        total_records: manifest.metadata.total_records,
        cooldown_override_used: wasOverridden,
      },
    });

    // Clear the override flag if it was used
    if (wasOverridden) {
      const updatedPermissions = { ...permissions, backup_cooldown_override: false };
      await supabase
        .from('org_settings')
        .update({ permissions: updatedPermissions })
        .eq('org_id', orgId);
      context.log?.info?.('backup: cooldown override consumed and cleared', { orgId });
    }

    context.log?.info?.('backup: completed', { orgId, sizeBytes: encrypted.length });

    // Return encrypted file with password
    const filename = `tuttiud-backup-${orgId}-${new Date().toISOString().split('T')[0]}.enc`;
    return respond(context, 200, {
      message: 'backup_completed',
      password, // Auto-generated password the user MUST save
      filename,
      size_bytes: encrypted.length,
      encrypted_file: encrypted.toString('base64'),
    });
  } catch (error) {
    context.log?.error?.('backup: failed', { orgId, message: error?.message });
    
    await appendBackupHistory(supabase, orgId, {
      type: 'backup',
      status: 'failed',
      timestamp: new Date().toISOString(),
      initiated_by: userId,
      error_message: error?.message || 'unknown_error',
    });

    return respond(context, 500, { message: 'backup_failed', error: error?.message });
  }
}
