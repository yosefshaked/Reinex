/* eslint-env node */
import { respond, isAdminRole } from '../_shared/org-bff.js';
import { validateStorageProfile } from '../cross-platform/storage-config/index.js';
import { getStorageDriver } from '../cross-platform/storage-drivers/index.js';

/**
 * Test storage connection by attempting to upload and delete a lightweight test file
 * POST /api/storage-test-connection
 * 
 * Body: { storage_profile: { mode, byos?, managed? } }
 * Returns: { success: true } or error details
 */
export default async function handler(context, req) {
  if (req.method !== 'POST') {
    return respond(context, 405, { error: 'method_not_allowed' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return respond(context, 400, { error: 'invalid_json' });
  }

  const { storage_profile: storageProfile } = body;

  if (!storageProfile) {
    return respond(context, 400, { error: 'storage_profile_required' });
  }

  // Validate admin role for test connection
  const adminCheck = await isAdminRole(req);
  if (!adminCheck.authorized) {
    return respond(context, adminCheck.status, { error: adminCheck.error });
  }

  const { orgId } = adminCheck;

  // Validate storage profile structure
  const validation = validateStorageProfile(storageProfile);
  if (!validation.valid) {
    return respond(context, 400, {
      error: 'invalid_storage_profile',
      details: validation.errors,
    });
  }

  const { mode } = storageProfile;

  try {
    // Get environment variables for managed mode
    const env = {
      SYSTEM_R2_ENDPOINT: process.env.SYSTEM_R2_ENDPOINT,
      SYSTEM_R2_ACCESS_KEY: process.env.SYSTEM_R2_ACCESS_KEY,
      SYSTEM_R2_SECRET_KEY: process.env.SYSTEM_R2_SECRET_KEY,
      SYSTEM_R2_BUCKET_NAME: process.env.SYSTEM_R2_BUCKET_NAME,
    };

    // Get configuration based on mode
    let config;
    if (mode === 'managed') {
      config = storageProfile.managed;
    } else if (mode === 'byos') {
      config = storageProfile.byos;
    } else {
      return respond(context, 400, { error: 'invalid_mode', mode });
    }

    // Create storage driver
    const driver = getStorageDriver(mode, config, env);

    // Create test file content (lightweight JSON)
    const testFileName = `test-connection-${orgId}-${Date.now()}.txt`;
    const testContent = `Reinex Storage Connection Test\nOrganization: ${orgId}\nTimestamp: ${new Date().toISOString()}`;
    const testBuffer = Buffer.from(testContent, 'utf-8');

    // Build test path
    const testPath = mode === 'managed'
      ? `managed/${orgId}/_test/${testFileName}`
      : `${orgId}/_test/${testFileName}`;

    // Test 1: Upload file
    context.log(`Testing upload to path: ${testPath}`);
    await driver.uploadFile(testPath, testBuffer, 'text/plain');
    context.log('Upload successful');

    // Test 2: Verify file exists (optional, but confirms upload worked)
    const fileUrl = await driver.getPresignedUrl(testPath, 60); // 1 minute expiry
    if (!fileUrl) {
      throw new Error('Failed to generate presigned URL after upload');
    }
    context.log('Presigned URL generation successful');

    // Test 3: Delete test file (cleanup)
    await driver.deleteFile(testPath);
    context.log('Cleanup successful');

    return respond(context, 200, {
      success: true,
      message: 'Storage connection test passed',
      details: {
        mode,
        provider: mode === 'byos' ? config.provider : 'managed_r2',
        test_path: testPath,
      },
    });
  } catch (error) {
    context.log.error('Storage connection test failed:', error);

    // Provide helpful error messages
    let errorMessage = error.message || 'Unknown error occurred';
    let errorCode = 'connection_test_failed';

    if (errorMessage.includes('credentials')) {
      errorCode = 'invalid_credentials';
      errorMessage = 'Invalid storage credentials. Please verify your access keys.';
    } else if (errorMessage.includes('bucket') || errorMessage.includes('container')) {
      errorCode = 'bucket_not_found';
      errorMessage = 'Storage bucket/container not found. Please verify it exists and is accessible.';
    } else if (errorMessage.includes('endpoint') || errorMessage.includes('ENOTFOUND')) {
      errorCode = 'invalid_endpoint';
      errorMessage = 'Cannot connect to storage endpoint. Please verify the URL.';
    } else if (errorMessage.includes('permission') || errorMessage.includes('Access Denied')) {
      errorCode = 'insufficient_permissions';
      errorMessage = 'Insufficient permissions. Ensure credentials have upload/delete access.';
    }

    return respond(context, 400, {
      error: errorCode,
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}
