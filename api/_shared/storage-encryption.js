/* eslint-env node */
/**
 * Storage Credentials Encryption
 * 
 * Encrypts and decrypts BYOS storage credentials (access keys, secret keys)
 * before storing in the database.
 * 
 * Uses AES-256-GCM for authenticated encryption.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { resolveEncryptionSecret, deriveEncryptionKey } from './org-bff.js';

/**
 * Encrypt BYOS configuration
 * 
 * IMPORTANT: Uses snake_case field names (access_key_id, secret_access_key)
 * to match the normalized format from normalizeStorageProfile().
 * 
 * @param {Object} byosConfig - BYOS configuration object (normalized format)
 * @param {string} encryptionKey - 32-byte encryption key (Buffer)
 * @returns {Object} Encrypted BYOS configuration
 */
export function encryptByosConfig(byosConfig, encryptionKey) {
  if (!byosConfig || typeof byosConfig !== 'object') {
    throw new Error('Invalid BYOS configuration');
  }

  if (!encryptionKey || encryptionKey.length !== 32) {
    throw new Error('Invalid encryption key: must be 32 bytes');
  }

  // Extract sensitive fields (using snake_case as that's what normalizeStorageProfile returns)
  const { access_key_id, secret_access_key, ...publicFields } = byosConfig;

  // If no sensitive data, return as-is
  if (!access_key_id && !secret_access_key) {
    return byosConfig;
  }

  // Encrypt sensitive credentials
  const sensitiveData = JSON.stringify({ access_key_id, secret_access_key });
  const iv = randomBytes(12); // 96 bits for GCM
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);

  const cipherText = Buffer.concat([
    cipher.update(sensitiveData, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Encode as base64 with format version:mode:iv:authTag:cipherText
  const encryptedCredentials = [
    'v1',
    'gcm',
    iv.toString('base64'),
    authTag.toString('base64'),
    cipherText.toString('base64'),
  ].join(':');

  // Return config with encrypted credentials
  return {
    ...publicFields,
    _encrypted: true,
    _credentials: encryptedCredentials,
  };
}

/**
 * Decrypt BYOS configuration
 * 
 * IMPORTANT: Returns snake_case field names (access_key_id, secret_access_key)
 * to match the normalized format expected by storage drivers.
 * 
 * @param {Object} encryptedConfig - Encrypted BYOS configuration
 * @param {Buffer} encryptionKey - 32-byte encryption key
 * @returns {Object} Decrypted BYOS configuration (snake_case fields)
 */
export function decryptByosConfig(encryptedConfig, encryptionKey) {
  if (!encryptedConfig || typeof encryptedConfig !== 'object') {
    throw new Error('Invalid encrypted configuration');
  }

  // If not encrypted, return as-is
  if (!encryptedConfig._encrypted || !encryptedConfig._credentials) {
    return encryptedConfig;
  }

  if (!encryptionKey || encryptionKey.length !== 32) {
    throw new Error('Invalid encryption key: must be 32 bytes');
  }

  const { _credentials, _encrypted, ...publicFields } = encryptedConfig;

  // Parse encrypted credentials
  const segments = _credentials.split(':');
  if (segments.length !== 5) {
    throw new Error('Invalid encrypted credentials format');
  }

  const [version, mode, ivBase64, authTagBase64, cipherTextBase64] = segments;

  if (version !== 'v1' || mode !== 'gcm') {
    throw new Error('Unsupported encryption format');
  }

  try {
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const cipherText = Buffer.from(cipherTextBase64, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(cipherText),
      decipher.final(),
    ]);

    const sensitiveData = JSON.parse(decrypted.toString('utf8'));

    // Return config with decrypted credentials (snake_case to match normalized format)
    return {
      ...publicFields,
      access_key_id: sensitiveData.access_key_id,
      secret_access_key: sensitiveData.secret_access_key,
    };
  } catch (error) {
    throw new Error(`Failed to decrypt BYOS credentials: ${error.message}`);
  }
}

/**
 * Encrypt entire storage profile before saving to database
 * 
 * @param {Object} storageProfile - Storage profile with BYOS config
 * @param {Object} env - Environment variables
 * @returns {Object} Storage profile with encrypted BYOS credentials
 */
export function encryptStorageProfile(storageProfile, env) {
  if (!storageProfile || storageProfile.mode !== 'byos') {
    return storageProfile;
  }

  if (!storageProfile.byos) {
    return storageProfile;
  }

  const encryptionSecret = resolveEncryptionSecret(env);
  if (!encryptionSecret) {
    throw new Error('Encryption secret not configured');
  }

  const encryptionKey = deriveEncryptionKey(encryptionSecret);
  if (!encryptionKey) {
    throw new Error('Failed to derive encryption key');
  }

  const encryptedByos = encryptByosConfig(storageProfile.byos, encryptionKey);

  return {
    ...storageProfile,
    byos: encryptedByos,
  };
}

/**
 * Decrypt storage profile after loading from database
 * 
 * @param {Object} storageProfile - Encrypted storage profile
 * @param {Object} env - Environment variables
 * @returns {Object} Storage profile with decrypted BYOS credentials
 */
export function decryptStorageProfile(storageProfile, env) {
  if (!storageProfile || storageProfile.mode !== 'byos') {
    return storageProfile;
  }

  if (!storageProfile.byos || !storageProfile.byos._encrypted) {
    return storageProfile;
  }

  const encryptionSecret = resolveEncryptionSecret(env);
  if (!encryptionSecret) {
    throw new Error('Encryption secret not configured');
  }

  const encryptionKey = deriveEncryptionKey(encryptionSecret);
  if (!encryptionKey) {
    throw new Error('Failed to derive encryption key');
  }

  const decryptedByos = decryptByosConfig(storageProfile.byos, encryptionKey);

  return {
    ...storageProfile,
    byos: decryptedByos,
  };
}
