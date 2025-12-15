# Storage Drivers Implementation - Technical Guide

## Overview

This document describes the production-ready storage drivers implementation that replaces placeholder code in the student files API. The system now supports:

1. **Managed Storage**: Cloudflare R2 (via environment variables)
2. **BYOS Storage**: AWS S3, Cloudflare R2, Azure Blob, Supabase Storage

## Architecture

### Component Structure

```
api/cross-platform/storage-drivers/
├── index.js           # Driver factory (main entry point)
├── s3-adapter.js      # S3-compatible adapter (AWS, R2, generic)
├── azure-adapter.js   # Azure Blob Storage adapter
└── supabase-adapter.js # Supabase Storage adapter
```

### Driver Interface

All adapters implement a consistent interface:

```javascript
{
  async upload(path, buffer, contentType) -> { url }
  async delete(path) -> void
  getType() -> string
}
```

## Storage Drivers

### 1. S3-Compatible Adapter

**File**: `s3-adapter.js`  
**Function**: `createS3Driver(config)`

**Supports**:
- AWS S3
- Cloudflare R2
- Generic S3-compatible services (Wasabi, MinIO, etc.)

**Configuration**:
```javascript
{
  endpoint: 'https://...',      // Optional for AWS, required for R2/others
  region: 'us-east-1',          // AWS region or 'auto' for R2
  bucket: 'bucket-name',
  accessKeyId: '...',
  secretAccessKey: '...'
}
```

**Implementation Notes**:
- Uses AWS SDK v3 (`@aws-sdk/client-s3`)
- Configures `S3Client` with credentials
- Handles endpoint-based vs region-based URL construction
- R2 requires `region: 'auto'` and explicit endpoint

**URL Generation**:
- With endpoint: `{endpoint}/{bucket}/{path}`
- AWS S3: `https://{bucket}.s3.{region}.amazonaws.com/{path}`

### 2. Azure Blob Storage Adapter

**File**: `azure-adapter.js`  
**Function**: `createAzureDriver(config)`

**Configuration**:
```javascript
{
  accountName: 'mystorageaccount',
  accountKey: '...',
  container: 'container-name'
}
```

**Implementation Notes**:
- Uses `@azure/storage-blob`
- Creates `BlobServiceClient` with shared key credentials
- Uploads with content type headers
- Returns blob public URL
- Uses `deleteIfExists` for safe deletion

### 3. Supabase Storage Adapter

**File**: `supabase-adapter.js`  
**Function**: `createSupabaseDriver(config)`

**Purpose**: BYOS mode only (Managed mode uses R2, not Supabase)

**Configuration**:
```javascript
{
  projectUrl: 'https://xxx.supabase.co',
  serviceKey: '...',            // Service role key
  bucket: 'bucket-name'
}
```

**Implementation Notes**:
- Creates isolated Supabase client
- Does not use app's internal Supabase connection
- Uses storage API for upload/delete
- Returns public URLs via `getPublicUrl()`

## Factory Function

**File**: `api/cross-platform/storage-drivers/index.js`  
**Function**: `getStorageDriver(mode, config, env)`

### Parameters

- `mode`: 'managed' or 'byos'
- `config`: Storage configuration object (for BYOS)
- `env`: Environment variables (for Managed)

### Managed Storage Flow

1. Reads environment variables:
   - `SYSTEM_R2_ENDPOINT`
   - `SYSTEM_R2_ACCESS_KEY`
   - `SYSTEM_R2_SECRET_KEY`
   - `SYSTEM_R2_BUCKET_NAME`

2. Creates S3 driver configured for Cloudflare R2:
   ```javascript
   createS3Driver({
     endpoint: SYSTEM_R2_ENDPOINT,
     region: 'auto',
     bucket: SYSTEM_R2_BUCKET_NAME,
     accessKeyId: SYSTEM_R2_ACCESS_KEY,
     secretAccessKey: SYSTEM_R2_SECRET_KEY
   })
   ```

3. File paths: `managed/{org_id}/{student_id}/{file_id}.ext`

### BYOS Storage Flow

1. Reads `config.provider` to determine storage type

2. Routes to appropriate adapter:
   - `s3`, `aws` → S3 Adapter (AWS S3)
   - `r2` → S3 Adapter (R2 with `region: 'auto'`)
   - `azure` → Azure Adapter
   - `supabase` → Supabase Adapter
   - `generic` → S3 Adapter (generic S3-compatible)

3. File paths: `students/{student_id}/{file_id}.ext`

### Provider Configuration Mapping

The factory normalizes different config field names:

**Azure**:
```javascript
{
  accountName: config.account_name || config.accountName,
  accountKey: config.account_key || config.accountKey,
  container: config.container || config.bucket
}
```

**Supabase**:
```javascript
{
  projectUrl: config.project_url || config.projectUrl || config.endpoint,
  serviceKey: config.service_key || config.serviceKey || config.secret_access_key,
  bucket: config.bucket
}
```

## Student Files API Integration

**File**: `api/student-files/index.js`

### Changes from Placeholder

**Before**:
- `uploadToManaged()` - Supabase storage placeholder
- `uploadToBYOS()` - Mock return values
- `deleteFromManaged()` - Supabase only
- `deleteFromBYOS()` - Console log placeholder

**After**:
- Single driver creation via factory
- Real cloud SDK operations
- Provider-agnostic implementation
- Proper error handling

### Upload Flow

```javascript
// 1. Determine mode and get config
const storageProfile = await fetchStorageProfile(orgId);

// 2. Create driver
const driver = getStorageDriver(
  storageProfile.mode,
  storageProfile.byos,
  env
);

// 3. Upload file
const result = await driver.upload(filePath, buffer, contentType);

// 4. Store metadata
const fileMetadata = {
  id: fileId,
  url: result.url,
  path: filePath,
  storage_provider: storageProfile.mode,
  // ... other fields
};

// 5. Update student record
await updateStudentFiles(studentId, [...currentFiles, fileMetadata]);
```

### Delete Flow

```javascript
// 1. Fetch file metadata from student record
const fileToDelete = student.files.find(f => f.id === fileId);

// 2. Create driver
const driver = getStorageDriver(mode, config, env);

// 3. Delete physical file (best effort)
try {
  await driver.delete(fileToDelete.path);
} catch (error) {
  // Log warning but continue
}

// 4. Update student record (always)
await updateStudentFiles(studentId, files.filter(f => f.id !== fileId));
```

### Path Generation

```javascript
function buildFilePath(mode, orgId, studentId, fileId, extension) {
  if (mode === 'managed') {
    return `managed/${orgId}/${studentId}/${fileId}.${extension}`;
  } else {
    return `students/${studentId}/${fileId}.${extension}`;
  }
}
```

**Managed**: `managed/org-abc/student-123/uuid-456.pdf`  
**BYOS**: `students/student-123/uuid-456.pdf`

## Environment Configuration

### Production Setup (Azure Functions)

1. Navigate to Function App → Configuration → Application Settings

2. Add Managed Storage variables:
   ```
   SYSTEM_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   SYSTEM_R2_ACCESS_KEY=<r2-access-key>
   SYSTEM_R2_SECRET_KEY=<r2-secret-key>
   SYSTEM_R2_BUCKET_NAME=<bucket-name>
   ```

3. Restart Function App

### BYOS Configuration (Per Organization)

Stored in `org_settings.storage_profile.byos`:

**AWS S3 Example**:
```json
{
  "mode": "byos",
  "byos": {
    "provider": "s3",
    "region": "us-east-1",
    "bucket": "my-org-files",
    "access_key_id": "AKIAIOSFODNN7EXAMPLE",
    "secret_access_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
  }
}
```

**Cloudflare R2 Example**:
```json
{
  "mode": "byos",
  "byos": {
    "provider": "r2",
    "endpoint": "https://abc123.r2.cloudflarestorage.com",
    "bucket": "my-org-files",
    "access_key_id": "...",
    "secret_access_key": "..."
  }
}
```

**Azure Blob Example**:
```json
{
  "mode": "byos",
  "byos": {
    "provider": "azure",
    "account_name": "mystorageaccount",
    "account_key": "...",
    "container": "my-org-files"
  }
}
```

**Supabase Example**:
```json
{
  "mode": "byos",
  "byos": {
    "provider": "supabase",
    "project_url": "https://xxx.supabase.co",
    "service_key": "eyJhbGci...",
    "bucket": "my-org-files"
  }
}
```

## Error Handling

### Driver Creation Errors

```javascript
try {
  const driver = getStorageDriver(mode, config, env);
} catch (error) {
  // Possible errors:
  // - "Managed storage requires R2 environment variables"
  // - "BYOS mode requires provider configuration"
  // - "S3 driver requires bucket, accessKeyId, and secretAccessKey"
  // - "Azure driver requires accountName, accountKey, and container"
  // - "Supabase driver requires projectUrl, serviceKey, and bucket"
  // - "Unsupported storage provider: xyz"
}
```

### Upload Errors

```javascript
try {
  await driver.upload(path, buffer, contentType);
} catch (error) {
  // Provider-specific errors:
  // - S3: Invalid credentials, bucket not found, permission denied
  // - Azure: Account not found, invalid key, container not found
  // - Supabase: Project not found, invalid service key, bucket not found
}
```

### Delete Errors

Deletion is best-effort:
- If driver creation fails → log warning, continue DB cleanup
- If physical delete fails → log warning, continue DB cleanup
- Database metadata always removed (prevent orphan entries)

## Security Considerations

### Managed Storage
- Credentials stored in Function App environment (secure)
- Not accessible via database queries
- Namespace isolation: `managed/{org_id}/...`
- Each org's files are completely isolated

### BYOS Storage
- Credentials stored in `org_settings.storage_profile`
- **Should be encrypted at rest** (not yet implemented)
- Organizations control their own buckets
- Access control managed by customer

### File Paths
- Generated file IDs are UUIDs (unguessable)
- Extensions preserved from original filename
- No user-controlled path components

## Testing Guide

### Manual Testing Checklist

**Managed Storage**:
1. ✅ Configure R2 environment variables
2. ✅ Test file upload (verify R2 bucket shows file)
3. ✅ Test file download (verify URL works)
4. ✅ Test file delete (verify removed from R2)
5. ✅ Verify namespace isolation (`managed/{org_id}/...`)

**AWS S3**:
1. ✅ Configure BYOS with S3 provider
2. ✅ Test upload/download/delete
3. ✅ Verify URL format
4. ✅ Check S3 bucket for files

**Cloudflare R2 (BYOS)**:
1. ✅ Configure BYOS with R2 provider
2. ✅ Test upload/download/delete
3. ✅ Verify `region: 'auto'` works
4. ✅ Check R2 dashboard

**Azure Blob**:
1. ✅ Configure BYOS with Azure provider
2. ✅ Test upload/download/delete
3. ✅ Verify container permissions
4. ✅ Check Azure portal

**Supabase Storage**:
1. ✅ Configure BYOS with Supabase provider
2. ✅ Test upload/download/delete
3. ✅ Verify bucket policies
4. ✅ Check Supabase dashboard

**Error Scenarios**:
1. ✅ Missing environment variables (managed)
2. ✅ Invalid credentials (all providers)
3. ✅ Bucket/container not found
4. ✅ Network errors
5. ✅ Permission denied errors

### Test Files

Create test files in `/tmp`:
```bash
echo "Test content" > /tmp/test.txt
dd if=/dev/urandom of=/tmp/large.bin bs=1M count=10  # 10MB file
```

### cURL Examples

**Upload File**:
```bash
curl -X POST https://app.tuttiud.com/api/student-files \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test.txt" \
  -F "student_id=$STUDENT_ID" \
  -F "org_id=$ORG_ID"
```

**Delete File**:
```bash
curl -X DELETE https://app.tuttiud.com/api/student-files \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "org_id": "'$ORG_ID'",
    "student_id": "'$STUDENT_ID'",
    "file_id": "'$FILE_ID'"
  }'
```

## Troubleshooting

### Issue: "Managed storage requires R2 environment variables"

**Cause**: Missing or incomplete R2 configuration in Function App settings

**Solution**:
1. Check Application Settings in Azure Portal
2. Verify all four variables are set:
   - `SYSTEM_R2_ENDPOINT`
   - `SYSTEM_R2_ACCESS_KEY`
   - `SYSTEM_R2_SECRET_KEY`
   - `SYSTEM_R2_BUCKET_NAME`
3. Restart Function App

### Issue: "BYOS mode requires provider configuration"

**Cause**: `storage_profile.byos` is null or missing

**Solution**:
1. Check `org_settings.storage_profile` in database
2. Ensure `byos` object exists with `provider` field
3. Use Settings UI to configure BYOS

### Issue: Upload succeeds but file not visible

**Cause**: Bucket permissions or URL generation issue

**Solution**:
1. Check bucket/container exists
2. Verify public access settings (if applicable)
3. Check logs for actual URL returned
4. Test URL manually in browser

### Issue: Delete succeeds but file still exists

**Cause**: Metadata removed but physical deletion failed

**Solution**:
1. Check API logs for deletion warnings
2. Verify credentials have delete permissions
3. Manually clean up orphaned files if needed
4. This is expected behavior (best-effort deletion)

## Future Enhancements

### Google Cloud Storage
Adapter placeholder exists but not implemented:
```javascript
case 'gcs':
case 'google':
  throw new Error('Google Cloud Storage not yet implemented');
```

**Implementation needed**:
- Add `@google-cloud/storage` dependency
- Create `gcs-adapter.js`
- Update factory to route GCS provider

### Credential Encryption
BYOS credentials currently stored as plaintext in `org_settings`:
- Should be encrypted at rest
- Use Azure Key Vault or similar
- Decrypt only when creating drivers

### Connection Testing
Currently no validation of credentials before save:
- Add test connection endpoint
- Validate credentials on BYOS configuration
- Surface errors to user during setup

### Progress Tracking
Large file uploads have no progress feedback:
- Implement chunked uploads
- WebSocket progress updates
- Resumable uploads for large files

### File Metadata
Current metadata is minimal:
- Add MIME type validation
- Generate thumbnails for images
- Virus scanning integration
- File size limits enforcement

## Conclusion

The storage drivers implementation provides a production-ready, multi-provider file storage system that:

1. ✅ Supports Managed Storage (Cloudflare R2)
2. ✅ Supports BYOS (AWS S3, Azure, R2, Supabase)
3. ✅ Uses real cloud SDKs (not placeholders)
4. ✅ Provides consistent interface across providers
5. ✅ Handles errors gracefully
6. ✅ Maintains proper security boundaries
7. ✅ Is ready for production deployment

The system is extensible for future providers (GCS, etc.) and additional features (encryption, progress tracking, validation).
