/* eslint-env node */
/**
 * Azure Blob Storage Adapter
 * 
 * Supports Azure Blob Storage for BYOS configurations.
 */

import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';

/**
 * Create Azure Blob Storage driver
 * 
 * @param {Object} config - Azure configuration
 * @param {string} config.accountName - Azure storage account name
 * @param {string} config.accountKey - Azure storage account key
 * @param {string} config.container - Container name
 * @returns {Object} Storage driver with upload and delete methods
 */
export function createAzureDriver(config) {
  const { accountName, accountKey, container } = config;

  if (!accountName || !accountKey || !container) {
    throw new Error('Azure driver requires accountName, accountKey, and container');
  }

  // Create credentials and service client
  const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
  const blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    sharedKeyCredential
  );

  const containerClient = blobServiceClient.getContainerClient(container);

  return {
    /**
     * Upload file to Azure Blob Storage
     * 
     * @param {string} path - Blob path within container
     * @param {Buffer} buffer - File data
     * @param {string} contentType - MIME type
     * @returns {Promise<Object>} Upload result with url
     */
    async upload(path, buffer, contentType) {
      const blockBlobClient = containerClient.getBlockBlobClient(path);

      await blockBlobClient.upload(buffer, buffer.length, {
        blobHTTPHeaders: {
          blobContentType: contentType || 'application/octet-stream',
        },
      });

      // Return public URL
      const url = blockBlobClient.url;

      return { url };
    },

    /**
     * Delete file from Azure Blob Storage
     * 
     * @param {string} path - Blob path within container
     * @returns {Promise<void>}
     */
    async delete(path) {
      const blockBlobClient = containerClient.getBlockBlobClient(path);
      await blockBlobClient.deleteIfExists();
    },

    /**
     * Get driver type
     */
    getType() {
      return 'azure';
    },
  };
}
