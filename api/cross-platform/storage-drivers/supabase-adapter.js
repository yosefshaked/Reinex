/* eslint-env node */
/**
 * Supabase Storage Adapter
 * 
 * Supports Supabase Storage for BYOS configurations.
 * Note: This is for BYOS mode only. Managed mode uses R2.
 */

import { createClient } from '@supabase/supabase-js';

/**
 * Create Supabase Storage driver
 * 
 * @param {Object} config - Supabase configuration
 * @param {string} config.projectUrl - Supabase project URL
 * @param {string} config.serviceKey - Supabase service role key
 * @param {string} config.bucket - Storage bucket name
 * @returns {Object} Storage driver with upload and delete methods
 */
export function createSupabaseDriver(config) {
  const { projectUrl, serviceKey, bucket } = config;

  if (!projectUrl || !serviceKey || !bucket) {
    throw new Error('Supabase driver requires projectUrl, serviceKey, and bucket');
  }

  // Create a new Supabase client for this BYOS configuration
  const supabase = createClient(projectUrl, serviceKey, {
    auth: {
      persistSession: false,
    },
  });

  return {
    /**
     * Upload file to Supabase Storage
     * 
     * @param {string} path - File path within bucket
     * @param {Buffer} buffer - File data
     * @param {string} contentType - MIME type
     * @returns {Promise<Object>} Upload result with url
     */
    async upload(path, buffer, contentType) {
      const { data: _data, error } = await supabase.storage
        .from(bucket)
        .upload(path, buffer, {
          contentType: contentType || 'application/octet-stream',
          cacheControl: '3600',
          upsert: false,
        });

      if (error) {
        throw new Error(`Supabase upload failed: ${error.message}`);
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(path);

      return { url: urlData.publicUrl };
    },

    /**
     * Delete file from Supabase Storage
     * 
     * @param {string} path - File path within bucket
     * @returns {Promise<void>}
     */
    async delete(path) {
      const { error } = await supabase.storage
        .from(bucket)
        .remove([path]);

      if (error) {
        throw new Error(`Supabase delete failed: ${error.message}`);
      }
    },

    /**
     * Get driver type
     */
    getType() {
      return 'supabase';
    },
  };
}
