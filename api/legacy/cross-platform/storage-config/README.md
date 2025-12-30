# Storage Configuration Module

Cross-system storage profile management for organizations.

## Purpose

Provides a single source of truth for each organization's storage configuration,
supporting both BYOS (Bring Your Own Storage) and Managed Storage modes.

## Storage Modes

### BYOS (Bring Your Own Storage)
Customer provides their own S3-compatible storage credentials:
- AWS S3
- Cloudflare R2
- Azure Blob Storage (S3-compatible endpoint)
- Google Cloud Storage (S3-compatible endpoint)
- Any S3-compatible provider

### Managed Storage
Platform hosts storage for the customer (paid add-on):
- Assigned namespace/bucket
- Managed retention policies
- Platform-controlled access

## Data Structure

```json
{
  "mode": "byos" | "managed",
  "byos": {
    "provider": "s3" | "azure" | "gcs" | "r2" | "generic",
    "endpoint": "https://...",
    "region": "us-east-1",
    "bucket": "bucket-name",
    "access_key_id": "encrypted-key",
    "secret_access_key": "encrypted-secret",
    "validated_at": "2025-11-22T10:30:00Z"
  },
  "managed": {
    "namespace": "org-abc-123",
    "active": true,
    "created_at": "2025-11-22T10:30:00Z"
  },
  "updated_at": "2025-11-22T10:30:00Z",
  "updated_by": "user-uuid"
}
```

## API

### `validateStorageProfile(profile)`
Validates a storage profile structure and required fields.

Returns: `{ valid: boolean, errors: string[] }`

### `validateByosCredentials(byosConfig)`
Validates BYOS configuration fields (provider, endpoint, bucket, keys).

Returns: `{ valid: boolean, errors: string[] }`

### `validateManagedConfig(managedConfig)`
Validates managed storage configuration (namespace, active status).

Returns: `{ valid: boolean, errors: string[] }`

### `normalizeStorageProfile(rawProfile)`
Normalizes and sanitizes a storage profile, ensuring consistent structure.

Returns: Normalized profile object or null

## Security

- BYOS credentials must be encrypted before storage
- Validation does NOT test actual connectivity (that's provider-specific)
- Only validates structure and required fields
- Access control enforced at API layer (admin/owner only)

## Usage

```javascript
import { validateStorageProfile, validateByosCredentials } from '../cross-platform/storage-config/index.js';

const profile = { mode: 'byos', byos: {...} };
const result = validateStorageProfile(profile);
if (!result.valid) {
  return { errors: result.errors };
}
```

## System Integration

All systems (TutTiud, Farm Management, etc.) must:
1. Read storage profile from `org_settings.storage_profile`
2. Validate profile before use
3. Route file operations based on mode
4. Handle missing/invalid profiles with clear error states
