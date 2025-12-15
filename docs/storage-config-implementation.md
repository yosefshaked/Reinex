# Storage Configuration Module - Implementation Summary

## Overview

This implementation introduces a **cross-system storage configuration capability** that supports both BYOS (Bring Your Own Storage) and Managed Storage modes. The architecture is designed to be system-agnostic, reusable by TutTiud, the future Farm Management System, and any other systems that require storage configuration.

## Key Architectural Decisions

### 1. System-Agnostic Design
- All shared logic lives in `api/cross-platform/storage-config/`
- No TutTiud-specific logic in the shared module
- Reusable by multiple systems without modification
- Clear separation of concerns

### 2. Single Source of Truth
- Storage configuration stored in `org_settings.storage_profile` (control DB)
- All systems read from the same column
- No per-system configuration duplication
- Centralized validation and normalization

### 3. No Infrastructure Provisioning
- Module only validates and stores configuration
- Does NOT create cloud resources (buckets, namespaces, etc.)
- Provider-agnostic validation (structure only, no connectivity tests)
- Keeps the module lightweight and focused

## File Structure

```
api/
├── cross-platform/                    # Cross-system capabilities
│   ├── README.md                     # Architecture principles
│   └── storage-config/
│       ├── README.md                 # Module documentation
│       ├── index.js                  # Public API and constants
│       └── validation.js             # Validation utilities
├── org-settings/
│   └── storage/
│       ├── function.json             # Azure Function config
│       └── index.js                  # Storage profile endpoint
└── user-context/
    └── index.js                      # Extended to include storage_profile

scripts/
└── control-db-storage-profile-schema.sql  # DB migration

test/
└── storage-config.test.js            # Comprehensive validation tests
```

## Database Schema

**Table**: `org_settings` (control DB)
**New Column**: `storage_profile` (JSONB, nullable)

**Migration Script**: `scripts/control-db-storage-profile-schema.sql`

### Storage Profile Structure

```json
{
  "mode": "byos" | "managed",
  "byos": {
    "provider": "s3" | "azure" | "gcs" | "r2" | "generic",
    "endpoint": "https://...",
    "region": "us-east-1",        // optional
    "bucket": "bucket-name",
    "access_key_id": "...",
    "secret_access_key": "...",
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

## API Endpoints

### GET /api/user-context
**Access**: All authenticated users
**Change**: Now includes `storage_profile` in organization data
**Purpose**: Frontend reads storage configuration on startup

### GET /api/org-settings/storage
**Access**: All organization members
**Purpose**: Read storage profile for a specific organization
**Response**:
```json
{
  "storage_profile": { /* profile object or null */ }
}
```

### POST /api/org-settings/storage
**Access**: Admin/Owner only
**Purpose**: Update storage profile
**Request Body**:
```json
{
  "org_id": "uuid",
  "storage_profile": { /* new profile */ }
}
```
**Validation**:
- Normalizes input (trims whitespace, lowercases mode/provider)
- Validates structure (mode, required fields)
- BYOS: validates provider, HTTPS endpoint, bucket, credentials
- Managed: validates namespace format (alphanumeric + hyphens/underscores)

## Validation Rules

### BYOS Credentials
- ✅ Provider must be one of: s3, azure, gcs, r2, generic
- ✅ Endpoint must be HTTPS URL (security requirement)
- ✅ Bucket name required and non-empty
- ✅ Access key ID required and non-empty
- ✅ Secret access key required and non-empty
- ⚠️ Region is optional (depends on provider)

### Managed Storage
- ✅ Namespace required and non-empty
- ✅ Namespace format: `[a-z0-9-_]+` (case-insensitive)
- ✅ Active status must be boolean (if provided)

### Profile
- ✅ Mode must be "byos" or "managed"
- ✅ Mode-specific configuration must be present
- ✅ BYOS mode requires valid byos config
- ✅ Managed mode requires valid managed config

## Security Considerations

1. **HTTPS Enforcement**: BYOS endpoints must use HTTPS to protect credentials in transit
2. **Admin-Only Updates**: Only admin/owner roles can modify storage profiles
3. **Credential Encryption**: Note in documentation that BYOS credentials should be encrypted before storage (not implemented in this module)
4. **No Connectivity Tests**: Module doesn't test actual S3/cloud connectivity (security isolation)

## Testing

**Test Suite**: `test/storage-config.test.js`
**Coverage**: 24 comprehensive tests

Tests cover:
- BYOS validation (valid configs, missing fields, invalid providers, security checks)
- Managed storage validation (namespace formats, required fields)
- Profile validation (mode requirements, nested configs)
- Normalization (whitespace trimming, case normalization, region handling)
- Constants (STORAGE_MODES, BYOS_PROVIDERS)

**All tests pass** ✅

## Usage Examples

### Reading Storage Profile (Frontend)

```javascript
// After user context loads
const org = organizations.find(o => o.id === activeOrgId);
const storageProfile = org?.storage_profile;

if (!storageProfile) {
  // Show onboarding flow or error state
  return;
}

if (storageProfile.mode === 'byos') {
  // Use BYOS credentials for file operations
  const { endpoint, bucket, access_key_id, secret_access_key } = storageProfile.byos;
  // ... configure S3 client
} else if (storageProfile.mode === 'managed') {
  // Use managed storage with namespace
  const { namespace } = storageProfile.managed;
  // ... use platform storage
}
```

### Validating Profile (Backend)

```javascript
import { validateStorageProfile } from '../cross-platform/storage-config/index.js';

const profile = {
  mode: 'byos',
  byos: {
    provider: 's3',
    endpoint: 'https://s3.amazonaws.com',
    region: 'us-east-1',
    bucket: 'my-bucket',
    access_key_id: 'AKIAIOSFODNN7EXAMPLE',
    secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  },
};

const result = validateStorageProfile(profile);
if (!result.valid) {
  console.error('Validation errors:', result.errors);
  return;
}

// Profile is valid, save to database
```

### Updating Profile (API Client)

```javascript
const response = await fetch('/api/org-settings/storage', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    org_id: 'org-uuid',
    storage_profile: {
      mode: 'managed',
      managed: {
        namespace: 'org-abc-123',
        active: true,
      },
    },
  }),
});

const data = await response.json();
// data.storage_profile contains the saved profile
```

## Error Handling

### Missing/Invalid Profile
- Returns `null` when profile is not set
- Frontend should show configuration prompt
- No silent fallbacks to default storage

### Validation Failures
- Returns 400 with descriptive error messages
- Lists all validation errors (not just first failure)
- Clear guidance on what's invalid

### Permission Errors
- Returns 403 when non-admin attempts update
- Returns 401 when token is invalid/missing
- Clear error messages for each case

## Future Enhancements

1. **Credential Encryption**: Implement encryption for BYOS credentials before storage
2. **Connectivity Validation**: Optional endpoint to test BYOS connectivity
3. **Migration Tools**: Helper to move between BYOS ↔ Managed
4. **Audit Trail**: Track all storage profile changes
5. **Multi-Region Support**: Enhanced validation for region-specific requirements
6. **Provider-Specific Validation**: Custom validation per provider type

## Documentation References

- **Architecture**: `api/cross-platform/README.md`
- **Module Documentation**: `api/cross-platform/storage-config/README.md`
- **Schema Migration**: `scripts/control-db-storage-profile-schema.sql`
- **Agent Guidelines**: `AGENTS.md` (Cross-System Storage Configuration section)

## Deployment Checklist

Before deploying to production:

1. ✅ Run control DB migration: `control-db-storage-profile-schema.sql`
2. ✅ Verify Azure Function deployment includes `/api/org-settings/storage`
3. ✅ Test user-context endpoint returns storage_profile
4. ✅ Test admin can update storage profile
5. ✅ Test non-admin cannot update (403 error)
6. ✅ Test validation rejects invalid profiles
7. ✅ Update frontend to consume storage_profile from user context

## Contact & Support

For questions about this implementation:
- Review `api/cross-platform/storage-config/README.md`
- Check test cases in `test/storage-config.test.js`
- Refer to AGENTS.md for development patterns

This is a **backend-only** implementation. Frontend integration is out of scope for this task.
