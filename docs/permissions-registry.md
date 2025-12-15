# Permissions Registry System

## Overview
Centralized permissions management system using a control DB table as the source of truth for all feature flags and their default values.

## Components

### 1. Database Schema (`scripts/control-db-permissions-table.sql`)
- **`permission_registry` table**: Master registry of all available permissions
  - Columns: `permission_key`, `display_name_en`, `display_name_he`, `description_en`, `description_he`, `default_value`, `category`, `requires_approval`
  - Indexed by `category` for filtering
  
- **Database Functions**:
  - `get_default_permissions()`: Returns JSONB object of all permission keys with their default values
  - `initialize_org_permissions(org_id)`: Initializes or returns org permissions, auto-populating from registry defaults if empty/null

### 2. API Utilities (`api/_shared/permissions-utils.js`)
- `getDefaultPermissions(supabaseClient)`: Fetch defaults as key-value object
- `initializeOrgPermissions(supabaseClient, orgId)`: Initialize using DB function
- `ensureOrgPermissions(supabaseClient, orgId)`: Smart helper that checks and initializes if needed
- `getPermissionRegistry(supabaseClient, category?)`: Query full registry with metadata

### 3. API Endpoint (`/api/permissions-registry`)
- `GET /api/permissions-registry`: Query permission metadata
  - Query param `category`: Filter by category (backup, branding, features)
  - Query param `defaults_only=true`: Returns only defaults as JSON object
- Authenticated users can query the registry to build admin UIs

### 4. Frontend Integration (`src/pages/Settings.jsx`)
- Calls `initialize_org_permissions` RPC on Settings page load
- Automatically initializes permissions from registry defaults if org_settings.permissions is null/empty
- Sets `backupEnabled` state based on `backup_local_enabled` permission

## Current Permissions

| Key | Category | Default | Description |
|-----|----------|---------|-------------|
| `backup_local_enabled` | backup | false | Allow encrypted local backups |
| `backup_cooldown_override` | backup | false | One-time 7-day cooldown bypass (auto-resets) |
| `backup_oauth_enabled` | backup | false | Cloud backup to Google Drive/OneDrive/Dropbox |
| `logo_enabled` | branding | false | Custom logo upload |
| `can_reupload_legacy_reports` | features | false | Allow admins/owners to import legacy session records multiple times (new uploads replace previous legacy data) |

## Usage

### Setup
1. Run `scripts/control-db-permissions-table.sql` on control DB
2. Verify `permission_registry` table exists and is populated
3. Test functions: `SELECT get_default_permissions();`

### API Usage
```javascript
import { ensureOrgPermissions } from '../_shared/permissions-utils.js';

// In your API handler
const permissions = await ensureOrgPermissions(supabase, orgId);
if (!permissions?.backup_local_enabled) {
  return respond(context, 403, { message: 'backup_not_enabled' });
}
```

### Frontend Usage
```javascript
// Automatically initializes on Settings page load
const { data: permissions } = await authClient
  .rpc('initialize_org_permissions', { p_org_id: activeOrgId });

// Use permissions
const canBackup = permissions?.backup_local_enabled === true;
```

### Adding New Permissions
1. Insert into `permission_registry` table:
```sql
INSERT INTO permission_registry (
  permission_key, display_name_en, display_name_he,
  description_en, description_he, default_value, category, requires_approval
) VALUES (
  'new_feature_enabled', 'New Feature', 'תכונה חדשה',
  'Description in English', 'תיאור בעברית',
  false, 'features', true
);
```

2. Update AGENTS.md with new permission key
3. Existing orgs will get the new permission on next `initialize_org_permissions` call

## Benefits
- ✅ Single source of truth for all permissions
- ✅ Automatic initialization with defaults
- ✅ Easy to add new permissions without code changes
- ✅ Multilingual support (English + Hebrew)
- ✅ Category-based organization
- ✅ Metadata for building admin UIs
- ✅ Approval workflow support via `requires_approval` flag
