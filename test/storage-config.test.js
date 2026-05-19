/* eslint-env node */
/* global process */
/**
 * Storage Configuration Validation Tests
 * 
 * Tests for cross-platform storage profile validation utilities.
 */

import {
  validateByosCredentials,
  validateManagedConfig,
  validateStorageProfile,
  normalizeStorageProfile,
  STORAGE_MODES,
  BYOS_PROVIDERS,
} from '../api/cross-platform/storage-config/index.js';

/**
 * Simple test runner
 */
function test(description, testFn) {
  try {
    testFn();
    console.log(`✓ ${description}`);
  } catch (error) {
    console.error(`✗ ${description}`);
    console.error(`  Error: ${error.message}`);
    process.exitCode = 1;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message || 'Expected condition to be true');
  }
}

function assertFalse(condition, message) {
  if (condition) {
    throw new Error(message || 'Expected condition to be false');
  }
}

// ===== BYOS Validation Tests =====

test('BYOS validation: valid S3 configuration', () => {
  const config = {
    provider: 's3',
    endpoint: 'https://s3.amazonaws.com',
    region: 'us-east-1',
    bucket: 'my-bucket',
    access_key_id: 'AKIAIOSFODNN7EXAMPLE',
    secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  };

  const result = validateByosCredentials(config);
  assertTrue(result.valid, 'Valid S3 config should pass validation');
  assertEqual(result.errors.length, 0, 'Should have no errors');
});

test('BYOS validation: valid R2 configuration', () => {
  const config = {
    provider: 'r2',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    bucket: 'my-r2-bucket',
    access_key_id: 'test-access-key',
    secret_access_key: 'test-secret-key',
  };

  const result = validateByosCredentials(config);
  assertTrue(result.valid, 'Valid R2 config should pass validation');
});

test('BYOS validation: missing provider', () => {
  const config = {
    endpoint: 'https://s3.amazonaws.com',
    bucket: 'my-bucket',
    access_key_id: 'key',
    secret_access_key: 'secret',
  };

  const result = validateByosCredentials(config);
  assertFalse(result.valid, 'Config without provider should fail');
  assertTrue(result.errors.some(e => e.includes('Provider')), 'Should have provider error');
});

test('BYOS validation: invalid provider', () => {
  const config = {
    provider: 'invalid-provider',
    endpoint: 'https://s3.amazonaws.com',
    bucket: 'my-bucket',
    access_key_id: 'key',
    secret_access_key: 'secret',
  };

  const result = validateByosCredentials(config);
  assertFalse(result.valid, 'Invalid provider should fail');
});

test('BYOS validation: missing endpoint', () => {
  const config = {
    provider: 's3',
    bucket: 'my-bucket',
    access_key_id: 'key',
    secret_access_key: 'secret',
  };

  const result = validateByosCredentials(config);
  assertFalse(result.valid, 'Missing endpoint should fail');
  assertTrue(result.errors.some(e => e.includes('Endpoint')), 'Should have endpoint error');
});

test('BYOS validation: invalid endpoint URL', () => {
  const config = {
    provider: 's3',
    endpoint: 'not-a-url',
    bucket: 'my-bucket',
    access_key_id: 'key',
    secret_access_key: 'secret',
  };

  const result = validateByosCredentials(config);
  assertFalse(result.valid, 'Invalid URL should fail');
});

test('BYOS validation: empty bucket name', () => {
  const config = {
    provider: 's3',
    endpoint: 'https://s3.amazonaws.com',
    bucket: '   ',
    access_key_id: 'key',
    secret_access_key: 'secret',
  };

  const result = validateByosCredentials(config);
  assertFalse(result.valid, 'Empty bucket should fail');
});

test('BYOS validation: empty access keys', () => {
  const config = {
    provider: 's3',
    endpoint: 'https://s3.amazonaws.com',
    bucket: 'bucket',
    access_key_id: '',
    secret_access_key: '',
  };

  const result = validateByosCredentials(config);
  assertFalse(result.valid, 'Empty keys should fail');
  assertTrue(result.errors.length >= 2, 'Should have errors for both keys');
});

// ===== Managed Storage Validation Tests =====

test('Managed validation: valid configuration', () => {
  const config = {
    namespace: 'org-abc-123',
    active: true,
  };

  const result = validateManagedConfig(config);
  assertTrue(result.valid, 'Valid managed config should pass');
  assertEqual(result.errors.length, 0, 'Should have no errors');
});

test('Managed validation: missing namespace', () => {
  const config = {
    active: true,
  };

  const result = validateManagedConfig(config);
  assertFalse(result.valid, 'Missing namespace should fail');
  assertTrue(result.errors.some(e => e.includes('Namespace')), 'Should have namespace error');
});

test('Managed validation: invalid namespace characters', () => {
  const config = {
    namespace: 'org@#$%',
    active: true,
  };

  const result = validateManagedConfig(config);
  assertFalse(result.valid, 'Invalid namespace characters should fail');
});

test('Managed validation: valid namespace formats', () => {
  const validNamespaces = ['org-123', 'org_abc', 'ORG-ABC-123', 'test123'];
  
  validNamespaces.forEach(namespace => {
    const result = validateManagedConfig({ namespace, active: true });
    assertTrue(result.valid, `Namespace "${namespace}" should be valid`);
  });
});

// ===== Storage Profile Validation Tests =====

test('Profile validation: valid BYOS profile', () => {
  const profile = {
    mode: 'byos',
    byos: {
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      access_key_id: 'key',
      secret_access_key: 'secret',
    },
  };

  const result = validateStorageProfile(profile);
  assertTrue(result.valid, 'Valid BYOS profile should pass');
});

test('Profile validation: valid Managed profile', () => {
  const profile = {
    mode: 'managed',
    managed: {
      namespace: 'org-123',
      active: true,
    },
  };

  const result = validateStorageProfile(profile);
  assertTrue(result.valid, 'Valid managed profile should pass');
});

test('Profile validation: missing mode', () => {
  const profile = {
    byos: {
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'bucket',
      access_key_id: 'key',
      secret_access_key: 'secret',
    },
  };

  const result = validateStorageProfile(profile);
  assertFalse(result.valid, 'Missing mode should fail');
});

test('Profile validation: invalid mode', () => {
  const profile = {
    mode: 'invalid-mode',
  };

  const result = validateStorageProfile(profile);
  assertFalse(result.valid, 'Invalid mode should fail');
});

test('Profile validation: BYOS mode without config', () => {
  const profile = {
    mode: 'byos',
  };

  const result = validateStorageProfile(profile);
  assertFalse(result.valid, 'BYOS without config should fail');
  assertTrue(result.errors.some(e => e.includes('BYOS configuration')), 'Should have BYOS config error');
});

test('Profile validation: Managed mode without config', () => {
  const profile = {
    mode: 'managed',
  };

  const result = validateStorageProfile(profile);
  assertFalse(result.valid, 'Managed without config should fail');
});

// ===== Normalization Tests =====

test('Normalization: BYOS profile', () => {
  const raw = {
    mode: '  BYOS  ',
    byos: {
      provider: '  S3  ',
      endpoint: '  https://s3.amazonaws.com  ',
      region: '  us-east-1  ',
      bucket: '  my-bucket  ',
      access_key_id: '  key  ',
      secret_access_key: '  secret  ',
    },
    updated_by: 'user-123',
  };

  const normalized = normalizeStorageProfile(raw);
  assertEqual(normalized.mode, 'byos', 'Mode should be lowercased and trimmed');
  assertEqual(normalized.byos.provider, 's3', 'Provider should be lowercased and trimmed');
  assertEqual(normalized.byos.endpoint, 'https://s3.amazonaws.com', 'Endpoint should be trimmed');
  assertEqual(normalized.byos.bucket, 'my-bucket', 'Bucket should be trimmed');
  assertTrue(normalized.updated_at, 'Should have updated_at timestamp');
});

test('Normalization: Managed profile', () => {
  const raw = {
    mode: 'MANAGED',
    managed: {
      namespace: '  org-123  ',
      active: true,
    },
  };

  const normalized = normalizeStorageProfile(raw);
  assertEqual(normalized.mode, 'managed', 'Mode should be lowercased');
  assertEqual(normalized.managed.namespace, 'org-123', 'Namespace should be trimmed');
  assertTrue(normalized.managed.active, 'Active should be preserved');
  assertTrue(normalized.managed.created_at, 'Should have created_at timestamp');
});

test('Normalization: null input', () => {
  const result = normalizeStorageProfile(null);
  assertEqual(result, null, 'Null input should return null');
});

test('Normalization: removes undefined region', () => {
  const raw = {
    mode: 'byos',
    byos: {
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'bucket',
      access_key_id: 'key',
      secret_access_key: 'secret',
      // region is undefined
    },
  };

  const normalized = normalizeStorageProfile(raw);
  assertFalse('region' in normalized.byos, 'Undefined region should be removed');
});

// ===== Constants Tests =====

test('Constants: STORAGE_MODES', () => {
  assertEqual(STORAGE_MODES.BYOS, 'byos', 'BYOS mode constant');
  assertEqual(STORAGE_MODES.MANAGED, 'managed', 'MANAGED mode constant');
});

test('Constants: BYOS_PROVIDERS', () => {
  assertEqual(BYOS_PROVIDERS.S3, 's3', 'S3 provider constant');
  assertEqual(BYOS_PROVIDERS.R2, 'r2', 'R2 provider constant');
  assertEqual(BYOS_PROVIDERS.AZURE, 'azure', 'Azure provider constant');
  assertEqual(BYOS_PROVIDERS.GCS, 'gcs', 'GCS provider constant');
  assertEqual(BYOS_PROVIDERS.GENERIC, 'generic', 'Generic provider constant');
});

// Run all tests
console.log('\n=== Storage Configuration Validation Tests ===\n');
console.log('Running tests...\n');

// Summary
if (process.exitCode === 1) {
  console.log('\n❌ Some tests failed\n');
} else {
  console.log('\n✅ All tests passed\n');
}
