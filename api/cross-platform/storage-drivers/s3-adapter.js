/* eslint-env node */
/**
 * S3-Compatible Storage Adapter
 * 
 * Supports AWS S3, Cloudflare R2, and other S3-compatible services.
 * Uses AWS SDK v3 for S3 operations.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Create S3 storage driver
 * 
 * @param {Object} config - S3 configuration
 * @param {string} config.endpoint - S3 endpoint URL (optional for AWS, required for R2/others)
 * @param {string} config.region - AWS region or 'auto' for R2
 * @param {string} config.bucket - Bucket name
 * @param {string} config.accessKeyId - Access key ID
 * @param {string} config.secretAccessKey - Secret access key
 * @param {string} config.publicUrl - Optional public URL base (for R2 custom domains, bypasses presigned URLs)
 * @returns {Object} Storage driver with upload and delete methods
 */
export function createS3Driver(config) {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, publicUrl } = config;

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3 driver requires bucket, accessKeyId, and secretAccessKey');
  }

  // Configure S3 client
  const clientConfig = {
    region: region || 'auto',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  };

  // Add endpoint for R2 or other S3-compatible services
  if (endpoint) {
    clientConfig.endpoint = endpoint;
  }

  const s3Client = new S3Client(clientConfig);

  return {
    /**
     * Upload file to S3-compatible storage
     * 
     * @param {string} path - File path within bucket
     * @param {Buffer} buffer - File data
     * @param {string} contentType - MIME type
     * @returns {Promise<Object>} Upload result with url
     */
    async upload(path, buffer, contentType) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: path,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
      });

      await s3Client.send(command);

      // Construct URL based on endpoint
      let url;
      if (endpoint) {
        // For R2 or custom endpoints
        const baseUrl = endpoint.replace(/\/$/, '');
        url = `${baseUrl}/${bucket}/${path}`;
      } else {
        // For standard AWS S3
        url = `https://${bucket}.s3.${region}.amazonaws.com/${path}`;
      }

      return { url };
    },

    /**
     * Delete file from S3-compatible storage
     * 
     * @param {string} path - File path within bucket
     * @returns {Promise<void>}
     */
    async delete(path) {
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: path,
      });

      await s3Client.send(command);
    },

    /**
     * Get presigned download URL
     * 
     * Strategy:
     * - Preview (inline): Use public URL if available (fast, custom domain)
     * - Download (attachment): Always use presigned URL with Content-Disposition header
     * 
     * @param {string} path - File path within bucket
     * @param {number} expiresIn - URL expiration time in seconds (default: 3600 = 1 hour)
     * @param {string} filename - Optional filename for Content-Disposition header
     * @param {string} dispositionType - 'attachment' (download) or 'inline' (preview) (default: 'attachment')
     * @returns {Promise<string>} Presigned download URL or public URL
     */
    async getDownloadUrl(path, expiresIn = 3600, filename = null, dispositionType = 'attachment') {
      // For preview (inline): use public URL if available (custom domain, fast)
      // For download (attachment): always use presigned URL to force download behavior
      if (dispositionType === 'inline' && publicUrl) {
        const baseUrl = publicUrl.replace(/\/$/, '');
        return `${baseUrl}/${path}`;
      }

      // Generate presigned URL with Content-Disposition header
      // This ensures proper download behavior with correct filename
      // Build Content-Disposition header with filename if provided
      // Use RFC 5987 encoding for non-ASCII filenames (Hebrew, etc.)
      let disposition = dispositionType === 'inline' ? 'inline' : 'attachment';
      if (filename) {
        // ASCII-safe fallback filename
        const asciiFallback = 'document';
        // RFC 5987 encoded filename with UTF-8
        const encodedFilename = encodeURIComponent(filename);
        disposition = `${dispositionType === 'inline' ? 'inline' : 'attachment'}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
      }

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: path,
        ResponseContentDisposition: disposition,
      });

      const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });
      return presignedUrl;
    },

    /**
     * Get file data as Buffer
     * 
     * @param {string} path - File path within bucket
     * @returns {Promise<Buffer>} File data
     */
    async getFile(path) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: path,
      });

      const response = await s3Client.send(command);
      
      // Convert stream to buffer
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      
      return Buffer.concat(chunks);
    },

    /**
     * Delete all files with a given prefix (for bulk cleanup)
     * 
     * @param {string} prefix - Path prefix to delete (e.g., "managed/org-id/")
     * @returns {Promise<number>} Number of files deleted
     */
    async deletePrefix(prefix) {
      let deletedCount = 0;
      let continuationToken = null;

      do {
        // List objects with prefix
        const listCommand = new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });

        const listResponse = await s3Client.send(listCommand);

        if (!listResponse.Contents || listResponse.Contents.length === 0) {
          break;
        }

        // Delete in batches of up to 1000 (S3 limit)
        const objectsToDelete = listResponse.Contents.map(obj => ({ Key: obj.Key }));

        const deleteCommand = new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: objectsToDelete,
            Quiet: true,
          },
        });

        await s3Client.send(deleteCommand);
        deletedCount += objectsToDelete.length;

        continuationToken = listResponse.NextContinuationToken;
      } while (continuationToken);

      return deletedCount;
    },

    /**
     * Get driver type
     */
    getType() {
      return 's3';
    },
  };
}
