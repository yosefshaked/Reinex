/* eslint-env node */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { withOrgScope } from './org-bff.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Platform/control tables are intentionally excluded from tenant backups.
// Update this set whenever platform tables are added in src/lib/setup-sql.js.
const SYSTEM_TABLES = new Set([
  'organizations',
  'profiles',
  'org_memberships',
  'org_invitations',
  'permission_registry',
  'active_routing',
  'audit_log',
  'impersonation_sessions',
  'admin_data',
  'error_events',
  'email_log',
]);

/**
 * Read the server-managed backup encryption key from env.
 */
export function keyFromEnv(env = process.env ?? {}) {
  const hex = env?.BACKUP_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('BACKUP_ENCRYPTION_KEY missing or invalid - must be 64 hex chars');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt JSON data with server-managed key
 * @param {object} data - Plain JS object to encrypt
 * @param {object} env - Environment variables
 * @returns {Promise<Buffer>} - Encrypted buffer
 */
export async function encryptBackup(data, env = process.env ?? {}) {
  const jsonString = JSON.stringify(data);
  const compressed = await gzipAsync(Buffer.from(jsonString, 'utf8'));
  
  const key = keyFromEnv(env);
  const iv = randomBytes(IV_LENGTH);
  
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Format: [iv][authTag][encrypted]
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt backup file with server-managed key
 * @param {Buffer} encryptedData - Encrypted buffer
 * @param {object} env - Environment variables
 * @returns {Promise<object>} - Decrypted JSON object
 */
export async function decryptBackup(encryptedData, env = process.env ?? {}) {
  if (!Buffer.isBuffer(encryptedData) || encryptedData.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('invalid_backup_format');
  }

  const iv = encryptedData.subarray(0, IV_LENGTH);
  const authTag = encryptedData.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = encryptedData.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  
  const key = keyFromEnv(env);
  
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const decompressed = await gunzipAsync(decrypted);
  
  return JSON.parse(decompressed.toString('utf8'));
}

/**
 * Tenant backup allow-list, ordered parent-first for restore.
 * Includes all org-scoped business tables from setup-sql.js and excludes
 * control/system/auth-managed tables such as organizations, profiles,
 * org_memberships, audit_log, and the other platform-only tables.
 */
export const EXPORT_TABLES = [
  'Settings',
  'Services',
  'Employees',
  'hmo_providers',
  'guardians',
  'client_profiles',
  'payroll_runs',
  'claim_batches',
  'dashboard_tasks',
  'forms',
  'shared_form_blocks',
  'Documents',
  'instructor_profiles',
  'instructor_service_capabilities',
  'RateHistory',
  'hmo_provider_tracks',
  'client_guardians',
  'students',
  'form_shared_block_links',
  'employee_attendance_records',
  'employee_leave_entries',
  'employee_leave_days',
  'employee_leave_balance_events',
  'finance_corrections',
  'otp_challenges',
  'form_submissions',
  'hmo_authorizations',
  'waiting_list_entries',
  'commitments',
  'ledger_transactions',
  'lesson_templates',
  'lesson_template_overrides',
  'lesson_template_participants',
  'lesson_instances',
  'lesson_participants',
  'lesson_earnings',
  'grace_cancellation_requests',
  'instance_locks',
  'participant_locks',
  'calendar_instance_corrections',
  'ledger_accounts',
  'hmo_invoice_batches',
  'hmo_invoice_batch_items',
];

async function assertBackupTableCoverage(tenantClient) {
  const { data: liveTableRows, error: liveTablesError } = await tenantClient
    .rpc('get_public_base_tables');

  if (liveTablesError) {
    throw new Error(`Backup aborted: get_public_base_tables RPC failed: ${liveTablesError.message}`);
  }

  if (!Array.isArray(liveTableRows)) {
    throw new Error('Backup aborted: get_public_base_tables RPC returned an invalid payload');
  }

  const livePublicTables = new Set(
    (liveTableRows || [])
      .map((row) => row?.table_name)
      .filter((tableName) => typeof tableName === 'string' && tableName.length > 0)
  );

  const liveTenantTableSet = new Set(
    [...livePublicTables].filter((tableName) => !SYSTEM_TABLES.has(tableName))
  );

  const backupTableSet = new Set(EXPORT_TABLES);
  const missingFromBackup = [...liveTenantTableSet]
    .filter((tableName) => !backupTableSet.has(tableName))
    .sort((a, b) => a.localeCompare(b));

  if (missingFromBackup.length > 0) {
    throw new Error(
      `Backup aborted: the following tables exist in the schema but are not included in the backup list: [${missingFromBackup.join(', ')}]. Update exportTenantData in backup-utils.js to include them.`
    );
  }

  const missingFromLive = EXPORT_TABLES
    .filter((tableName) => !liveTenantTableSet.has(tableName))
    .sort((a, b) => a.localeCompare(b));

  if (missingFromLive.length > 0) {
    console.warn(
      `[backup] The backup table list includes tables that are missing from the live schema (likely pending migration): [${missingFromLive.join(', ')}]`
    );
  }
}

/**
 * Export all tenant tables to a structured manifest
 *
 * @param {object} tenantClient - Supabase server-role client using ensureMembership or org mapping
 * @returns {Promise<object>} - Backup manifest
 */
export async function exportTenantData(tenantClient, orgId) {
  await assertBackupTableCoverage(tenantClient);

  const manifest = {
    version: '2.0',
    schema_version: 'reinex_v2',
    org_id: orgId,
    exported_at: new Date().toISOString(),
    tables: {},
    metadata: {
      total_records: 0,
    },
  };

  for (const table of EXPORT_TABLES) {
    try {
      const { data, error } = await withOrgScope(tenantClient, table, orgId).select('*');

      if (error) {
        throw new Error(`Failed to export ${table}: ${error.message}`);
      }

      manifest.tables[table] = data || [];
      manifest.metadata.total_records += (data || []).length;
    } catch (err) {
      // Log but continue with other tables
      manifest.tables[table] = [];
      manifest.metadata[`${table}_error`] = err.message;
    }
  }

  return manifest;
}

/**
 * Validate backup manifest structure
 * @param {object} manifest - Parsed backup JSON
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateBackupManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, error: 'invalid_manifest' };
  }

  if (!manifest.version || !manifest.org_id || !manifest.tables) {
    return { valid: false, error: 'missing_required_fields' };
  }

  if (manifest.version !== '2.0') {
    return { valid: false, error: 'unsupported_manifest_version' };
  }

  return { valid: true };
}

/**
 * Restore data from backup manifest into tenant DB
 * @param {object} tenantClient - Supabase tenant client
 * @param {object} manifest - Validated backup manifest
 * @param {object} options - { clearExisting: boolean }
 * @returns {Promise<{ restored: number, errors: array }>}
 */
export async function restoreTenantData(tenantClient, manifest, { clearExisting = false } = {}) {
  const results = {
    restored: 0,
    errors: [],
  };

  const tablesToRestore = EXPORT_TABLES;

  for (const table of tablesToRestore) {
    const rows = manifest.tables[table] || [];
    if (!rows.length) continue;

    try {
      if (clearExisting) {
        const { error: deleteError } = await withOrgScope(tenantClient, table, manifest.org_id).delete();

        if (deleteError) {
          results.errors.push({ table, operation: 'clear', message: deleteError.message });
          continue;
        }
      }

      const { error: insertError } = await withOrgScope(tenantClient, table, manifest.org_id)
        .upsert(rows, { onConflict: 'id' });

      if (insertError) {
        results.errors.push({ table, operation: 'upsert', message: insertError.message });
      } else {
        results.restored += rows.length;
      }
    } catch (err) {
      results.errors.push({ table, operation: 'restore', message: err.message });
    }
  }

  return results;
}
