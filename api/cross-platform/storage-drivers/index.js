/* eslint-env node */
/**
 * Storage Driver Factory
 * 
 * Creates appropriate storage driver based on mode and configuration.
 * Supports Managed (Cloudflare R2) and BYOS (S3, Azure, Supabase) storage.
 */

import { createS3Driver } from './s3-adapter.js';
import { createAzureDriver } from './azure-adapter.js';
import { createSupabaseDriver } from './supabase-adapter.js';

/**
 * Get storage driver based on mode and configuration
 * 
 * @param {string} mode - Storage mode ('managed' or 'byos')
 * @param {Object} config - Storage configuration
 * @param {Object} env - Environment variables (for managed mode)
 * @returns {Object} Storage driver instance
 */
export function getStorageDriver(mode, config, env = {}) {
  if (mode === 'managed') {
    // Managed storage uses Cloudflare R2 from environment variables
    const {
      SYSTEM_R2_ENDPOINT,
      SYSTEM_R2_ACCESS_KEY,
      SYSTEM_R2_SECRET_KEY,
      SYSTEM_R2_BUCKET_NAME,
      SYSTEM_R2_PUBLIC_URL,
    } = env;

    if (!SYSTEM_R2_ENDPOINT || !SYSTEM_R2_ACCESS_KEY || !SYSTEM_R2_SECRET_KEY || !SYSTEM_R2_BUCKET_NAME) {
      throw new Error('Managed storage requires R2 environment variables (SYSTEM_R2_*)');
    }

    return createS3Driver({
      endpoint: SYSTEM_R2_ENDPOINT,
      region: 'auto',
      bucket: SYSTEM_R2_BUCKET_NAME,
      accessKeyId: SYSTEM_R2_ACCESS_KEY,
      secretAccessKey: SYSTEM_R2_SECRET_KEY,
      publicUrl: SYSTEM_R2_PUBLIC_URL, // Optional: R2 custom domain for public access
    });
  }

  if (mode === 'byos') {
    if (!config || !config.provider) {
      throw new Error('BYOS mode requires provider configuration');
    }

    const provider = config.provider.toLowerCase();

    switch (provider) {
      case 's3':
      case 'aws':
        // AWS S3
        return createS3Driver({
          endpoint: config.endpoint,
          region: config.region || 'us-east-1',
          bucket: config.bucket,
          accessKeyId: config.access_key_id,
          secretAccessKey: config.secret_access_key,
          publicUrl: config.public_url, // Optional: Custom domain/CDN for public access
        });

      case 'r2':
        // Cloudflare R2 (S3-compatible)
        return createS3Driver({
          endpoint: config.endpoint,
          region: 'auto',
          bucket: config.bucket,
          accessKeyId: config.access_key_id,
          secretAccessKey: config.secret_access_key,
          publicUrl: config.public_url, // Optional: R2 custom domain for public access
        });

      case 'azure':
        // Azure Blob Storage
        // Config should have: accountName, accountKey, container
        return createAzureDriver({
          accountName: config.account_name || config.accountName,
          accountKey: config.account_key || config.accountKey,
          container: config.container || config.bucket,
        });

      case 'supabase':
        // Supabase Storage
        // Config should have: projectUrl, serviceKey, bucket
        return createSupabaseDriver({
          projectUrl: config.project_url || config.projectUrl || config.endpoint,
          serviceKey: config.service_key || config.serviceKey || config.secret_access_key,
          bucket: config.bucket,
        });

      case 'gcs':
      case 'google':
        // Future: Google Cloud Storage
        throw new Error('Google Cloud Storage not yet implemented');

      case 'generic':
        // Generic S3-compatible service
        return createS3Driver({
          endpoint: config.endpoint,
          region: config.region || 'us-east-1',
          bucket: config.bucket,
          accessKeyId: config.access_key_id,
          secretAccessKey: config.secret_access_key,
          publicUrl: config.public_url, // Optional: Custom domain/CDN for public access
        });

      default:
        throw new Error(`Unsupported storage provider: ${provider}`);
    }
  }

  throw new Error(`Invalid storage mode: ${mode}`);
}
