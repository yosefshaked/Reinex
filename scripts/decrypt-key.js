#!/usr/bin/env node
import { createHash, createDecipheriv } from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * Decrypts the dedicated key stored in the database
 * Usage: node scripts/decrypt-key.js <encrypted_value> <encryption_secret>
 * 
 * Example:
 *   node scripts/decrypt-key.js "v1:gcm:ZFcLkiasmHaA1eRLaeBCwQI1d33Zh/Q==" "your-encryption-key-here"
 */

function normalizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function decodeKeyMaterial(secret) {
  const attempts = [
    () => Buffer.from(secret, 'base64'),
    () => Buffer.from(secret, 'hex'),
  ];

  for (const attempt of attempts) {
    try {
      const buffer = attempt();
      if (buffer.length) {
        return buffer;
      }
    } catch {
      // ignore and try next format
    }
  }

  return Buffer.from(secret, 'utf8');
}

function deriveEncryptionKey(secret) {
  const normalized = normalizeString(secret);
  if (!normalized) {
    return null;
  }

  let keyBuffer = decodeKeyMaterial(normalized);

  if (keyBuffer.length < 32) {
    keyBuffer = createHash('sha256').update(keyBuffer).digest();
  }

  if (keyBuffer.length > 32) {
    keyBuffer = keyBuffer.subarray(0, 32);
  }

  if (keyBuffer.length < 32) {
    return null;
  }

  return keyBuffer;
}

function decryptDedicatedKey(payload, keyBuffer) {
  const normalized = normalizeString(payload);
  if (!normalized || !keyBuffer) {
    return null;
  }

  const segments = normalized.split(':');
  if (segments.length !== 5) {
    console.error('❌ Invalid format - expected 5 parts separated by colons');
    console.error(`   Got ${segments.length} parts`);
    return null;
  }

  const [version, mode, ivPart, authTagPart, cipherPart] = segments;
  
  if (version !== 'v1') {
    console.error(`❌ Invalid version: ${version} (expected v1)`);
    return null;
  }
  
  if (mode !== 'gcm') {
    console.error(`❌ Invalid mode: ${mode} (expected gcm)`);
    return null;
  }

  try {
    const iv = Buffer.from(ivPart, 'base64');
    const authTag = Buffer.from(authTagPart, 'base64');
    const cipherText = Buffer.from(cipherPart, 'base64');
    
    console.log('📦 Encrypted data info:');
    console.log(`   IV length: ${iv.length} bytes`);
    console.log(`   Auth tag length: ${authTag.length} bytes`);
    console.log(`   Cipher text length: ${cipherText.length} bytes`);
    console.log('');
    
    const decipher = createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('❌ Decryption failed:', error.message);
    return null;
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Usage: node scripts/decrypt-key.js <encrypted_value> <encryption_secret>');
  console.log('');
  console.log('Example:');
  console.log('  node scripts/decrypt-key.js "v1:gcm:ABC123..." "my-encryption-key"');
  console.log('');
  console.log('Get the encrypted value from:');
  console.log('  - Control DB: organizations.dedicated_key_encrypted');
  console.log('  - Or from Application Insights LOG 2 output');
  console.log('');
  console.log('Get the encryption secret from:');
  console.log('  - Azure Static Web App → Configuration → APP_ORG_CREDENTIALS_ENCRYPTION_KEY');
  process.exit(1);
}

const encryptedValue = args[0];
const encryptionSecret = args[1];

console.log('🔐 Starting decryption...');
console.log('');

// Derive encryption key
const encryptionKey = deriveEncryptionKey(encryptionSecret);
if (!encryptionKey) {
  console.error('❌ Failed to derive encryption key from secret');
  process.exit(1);
}

console.log('✅ Encryption key derived successfully');
console.log(`   Key length: ${encryptionKey.length} bytes`);
console.log('');

// Decrypt
const decrypted = decryptDedicatedKey(encryptedValue, encryptionKey);

if (!decrypted) {
  console.error('');
  console.error('❌ Decryption failed!');
  console.error('');
  console.error('Possible causes:');
  console.error('  1. Wrong encryption secret (doesn\'t match the one used during encryption)');
  console.error('  2. Corrupted encrypted data');
  console.error('  3. Encrypted value was truncated');
  process.exit(1);
}

console.log('✅ Decryption successful!');
console.log('');
console.log('📄 Decrypted value:');
console.log('─────────────────────────────────────────────────────────');
console.log(decrypted);
console.log('─────────────────────────────────────────────────────────');
console.log('');
console.log('📊 Analysis:');
console.log(`   Length: ${decrypted.length} characters`);
console.log(`   Starts with: ${decrypted.substring(0, 10)}...`);
console.log(`   Ends with: ...${decrypted.substring(decrypted.length - 10)}`);
console.log(`   Is JWT format: ${decrypted.startsWith('eyJ') && decrypted.split('.').length === 3 ? '✅ Yes' : '❌ No'}`);

if (decrypted.startsWith('eyJ')) {
  const parts = decrypted.split('.');
  console.log(`   JWT parts: ${parts.length}`);
  
  if (parts.length >= 2) {
    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      
      console.log('');
      console.log('🔍 JWT Header:');
      console.log(JSON.stringify(header, null, 2));
      console.log('');
      console.log('🔍 JWT Payload:');
      console.log(JSON.stringify(payload, null, 2));
      
      if (payload.exp) {
        const expDate = new Date(payload.exp * 1000);
        const now = new Date();
        console.log('');
        console.log(`⏰ Expiration: ${expDate.toISOString()}`);
        console.log(`   Status: ${expDate > now ? '✅ Valid' : '❌ Expired'}`);
      }
    } catch (error) {
      void error;
      console.log('   (Could not parse JWT structure)');
    }
  }
}
