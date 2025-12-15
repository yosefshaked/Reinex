/* eslint-env node */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Derive a 256-bit key from password using PBKDF2
 */
function deriveKey(password, salt) {
  return createHash('sha256')
    .update(password)
    .update(salt)
    .digest();
}

/**
 * Encrypt JSON data with password protection
 * @param {object} data - Plain JS object to encrypt
 * @param {string} password - User-provided password
 * @returns {Promise<Buffer>} - Encrypted buffer
 */
export async function encryptBackup(data, password) {
  const jsonString = JSON.stringify(data);
  const compressed = await gzipAsync(Buffer.from(jsonString, 'utf8'));
  
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = randomBytes(IV_LENGTH);
  
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Format: [salt][iv][authTag][encrypted]
  return Buffer.concat([salt, iv, authTag, encrypted]);
}

/**
 * Decrypt backup file with password
 * @param {Buffer} encryptedData - Encrypted buffer
 * @param {string} password - User-provided password
 * @returns {Promise<object>} - Decrypted JSON object
 */
export async function decryptBackup(encryptedData, password) {
  const salt = encryptedData.subarray(0, SALT_LENGTH);
  const iv = encryptedData.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = encryptedData.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = encryptedData.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  
  const key = deriveKey(password, salt);
  
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const decompressed = await gunzipAsync(decrypted);
  
  return JSON.parse(decompressed.toString('utf8'));
}

/**
 * Export all tenant tables to a structured manifest
 *
 * Backed up tables and columns (as of 2025-10):
 * - Instructors: id, name, email, phone, is_active, notes, metadata
 * - Students: id, name, contact_info, contact_name, contact_phone, assigned_instructor_id, default_day_of_week, default_session_time, default_service, tags, notes, metadata
 * - SessionRecords: id, date, student_id, instructor_id, service_context, content, created_at, updated_at, deleted, deleted_at, is_legacy, metadata
 * - Settings: id, key, settings_value, metadata
 *
 * @param {object} tenantClient - Supabase tenant client
 * @returns {Promise<object>} - Backup manifest
 */
export async function exportTenantData(tenantClient, orgId) {
  // Only include tables that actually exist in the tuttiud schema
  const tables = ['Students', 'Instructors', 'SessionRecords', 'Settings'];
  const manifest = {
    version: '1.0',
    schema_version: 'tuttiud_v1',
    org_id: orgId,
    exported_at: new Date().toISOString(),
    tables: {},
    metadata: {
      total_records: 0,
    },
  };

  for (const table of tables) {
    try {
      const { data, error } = await tenantClient
        .from(table)
        .select('*');

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

  if (manifest.schema_version !== 'tuttiud_v1') {
    return { valid: false, error: 'unsupported_schema_version' };
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

  // Restore in dependency order: Settings first (no FK deps), then Instructors, then Students (FK to Instructors), then SessionRecords (FK to Students and Instructors)
  const tables = ['Settings', 'Instructors', 'Students', 'SessionRecords'];

  for (const table of tables) {
    const rows = manifest.tables[table] || [];
    if (!rows.length) continue;

    try {
      if (clearExisting) {
        const { error: deleteError } = await tenantClient
          .from(table)
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all

        if (deleteError) {
          results.errors.push({ table, operation: 'clear', message: deleteError.message });
          continue;
        }
      }

      const { error: insertError } = await tenantClient
        .from(table)
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
