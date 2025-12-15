# Storage System Deployment Guide

## Overview
This guide covers deploying the complete storage management system including disconnect, grace period, cleanup, bulk download, and audit logging features.

## Prerequisites
- Supabase project with control database access
- Azure Functions deployment
- Admin access to control DB SQL Editor
- **For managed storage**: Cloudflare R2 bucket with the following environment variables:
  - `SYSTEM_R2_ENDPOINT` - R2 S3-compatible endpoint URL
  - `SYSTEM_R2_ACCESS_KEY` - R2 access key ID
  - `SYSTEM_R2_SECRET_KEY` - R2 secret access key
  - `SYSTEM_R2_BUCKET_NAME` - R2 bucket name
  - `SYSTEM_R2_PUBLIC_URL` - (Optional) Custom domain URL for public file access (e.g., `https://files.yourdomain.com`)
    - If not set, presigned URLs will use the R2 endpoint directly
    - Recommended for production to provide branded, user-friendly download URLs
    - Configure a custom domain in Cloudflare R2 settings and point it to your bucket
    - Example: Instead of `https://account-id.r2.cloudflarestorage.com/bucket/file.pdf`, users see `https://files.yourdomain.com/file.pdf`

## Deployment Steps

### 1. Deploy Control DB Schema Changes

Run these scripts in your Supabase control database SQL Editor **in order**:

#### Step 1.1: Permission Registry Updates
```sql
-- File: scripts/control-db-permissions-table.sql
-- Adds storage_grace_period_days permission (default 30 days)
```

This script adds the configurable grace period setting to the permission registry.

#### Step 1.2: Storage Grace Period Column
```sql
-- File: scripts/control-db-storage-grace-period.sql
-- Adds storage_grace_ends_at column to org_settings
-- Creates index for efficient expired org lookups
```

This allows tracking when grace periods expire for automatic cleanup.

#### Step 1.3: Audit Log System
```sql
-- File: scripts/control-db-audit-log.sql
-- Creates audit_log table with RLS policies
-- Adds log_audit_event() helper function
-- Sets up 7-year retention for compliance
```

**Important**: This script has been fixed to use `public.org_memberships` table (not `org_members`).

### 2. Verify Schema Deployment

After running the scripts, verify the changes:

```sql
-- Check that storage_grace_ends_at column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'org_settings' 
  AND column_name = 'storage_grace_ends_at';

-- Check audit_log table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name = 'audit_log';

-- Check permission registry has grace period setting
SELECT key, default_value, description 
FROM public.permission_registry 
WHERE key = 'storage_grace_period_days';
```

Expected results:
- `storage_grace_ends_at` column of type `timestamp with time zone`
- `audit_log` table exists
- Permission with key `storage_grace_period_days` exists with default value `30`

### 3. Deploy API Endpoints

Deploy the following new/updated API endpoints to Azure Functions:

#### New Endpoints:
- `/api/storage-start-grace-period` - Starts grace period countdown
- `/api/storage-cleanup-expired` - Cleanup job for expired grace periods
- `/api/storage-bulk-download` - ZIP download of all files

#### Updated Endpoints:
- `/api/org-settings-storage` - Added DELETE method for disconnect

All endpoints include comprehensive audit logging.

### 4. Configure Azure Functions Timer Trigger

Set up automatic cleanup job to run daily:

**Option A: Using `function.json`**

Create or update `api/storage-cleanup-expired/function.json`:

```json
{
  "bindings": [
    {
      "authLevel": "function",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["post"]
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    },
    {
      "name": "timerTrigger",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 0 2 * * *",
      "runOnStartup": false
    }
  ]
}
```

**Option B: Using Azure Portal**

1. Navigate to Azure Functions → Your Function App
2. Find `storage-cleanup-expired` function
3. Add a new Timer Trigger binding:
   - Schedule: `0 0 2 * * *` (2 AM UTC daily)
   - Run on startup: No

The cron expression `0 0 2 * * *` means:
- Second: 0
- Minute: 0
- Hour: 2 (2 AM)
- Day of month: * (every day)
- Month: * (every month)
- Day of week: * (every day)

### 5. Test the System

#### Test Storage Disconnect
```bash
# As admin/owner, disconnect storage
POST /api/org-settings-storage
{
  "orgId": "your-org-id"
}
# Method: DELETE
```

#### Test Grace Period Start
```bash
# Start grace period
POST /api/storage-start-grace-period
{
  "orgId": "your-org-id"
}
```

#### Test Bulk Download
```bash
# Download all files as ZIP
POST /api/storage-bulk-download
{
  "orgId": "your-org-id"
}
```

#### Verify Audit Logs
```sql
-- Check recent audit events
SELECT 
  performed_at,
  user_email,
  action_type,
  action_category,
  details
FROM public.audit_log
WHERE org_id = 'your-org-id'
ORDER BY performed_at DESC
LIMIT 20;
```

Expected audit events:
- `storage.configured` - When storage is set up
- `storage.disconnected` - When storage is manually disconnected
- `storage.grace_period_started` - When grace period begins
- `storage.files_deleted` - When cleanup job runs
- `storage.bulk_download` - When files are downloaded

### 6. Monitor Cleanup Job

Check Azure Functions logs to verify the timer trigger is working:

1. Azure Portal → Function App → Monitoring → Logs
2. Filter by function name: `storage-cleanup-expired`
3. Look for daily executions at 2 AM UTC

Expected log entries:
```
storage-cleanup-expired: function started
storage-cleanup-expired: Found X organizations with expired grace periods
storage-cleanup-expired: Deleted Y files for org Z
storage-cleanup-expired: Cleanup completed successfully
```

### 7. Configure Grace Period Duration (Optional)

To change the default 30-day grace period:

```sql
-- Update the permission registry default
UPDATE public.permission_registry
SET default_value = '60'::jsonb  -- Change to 60 days
WHERE key = 'storage_grace_period_days';

-- Or set per-organization override
UPDATE public.org_settings
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'::jsonb),
  '{storage_grace_period_days}',
  '90'::jsonb  -- 90 days for this specific org
)
WHERE org_id = 'specific-org-id';
```

## Rollback Procedure

If you need to roll back the changes:

### 1. Remove Timer Trigger
Remove the timer trigger from Azure Functions to stop automatic cleanup.

### 2. Rollback Database Changes (Optional)
```sql
-- Remove audit_log table (WARNING: loses audit history)
DROP TABLE IF EXISTS public.audit_log CASCADE;

-- Remove grace period column (WARNING: loses grace period tracking)
ALTER TABLE public.org_settings DROP COLUMN IF EXISTS storage_grace_ends_at;

-- Remove permission (WARNING: resets to hardcoded defaults)
DELETE FROM public.permission_registry 
WHERE key = 'storage_grace_period_days';
```

**Warning**: Rolling back database changes will lose important compliance data. Only do this if absolutely necessary.

### 3. Revert API Endpoints
Redeploy previous versions of the API endpoints.

## Troubleshooting

### Audit logs not appearing
- Verify RLS policies allow user to read logs
- Check that `public.org_memberships` table exists (not `org_members`)
- Verify service role key is configured correctly

### Grace period not starting
- Check user has admin/owner role
- Verify `storage_grace_period_days` exists in permission_registry
- Check control DB connection settings

### Cleanup job not running
- Verify timer trigger is configured and enabled
- Check Azure Functions logs for errors
- Ensure service role key has permission to delete from storage

### Bulk download fails
- Verify storage driver implements `getFile()` method
- Check storage credentials are valid
- Ensure tenant DB has file metadata

### Files not being deleted after grace period
- Verify cleanup job is running (check logs)
- Check `storage_grace_ends_at` is set correctly
- For BYOS: Files should NOT be deleted (user owns storage)
- For managed: Verify R2 credentials and permissions

## Security Considerations

1. **Audit Log Access**: Only organization members can read their own org's logs
2. **Service Role**: Required for audit log writes and cleanup operations
3. **Admin Only**: Disconnect, grace period start, and bulk download require admin/owner role
4. **File Deletion**: Only managed storage files are deleted; BYOS files are untouched
5. **Data Ownership**: User's tenant database metadata is never deleted by system

## Compliance Notes

- Audit logs retained for 7 years by default (configurable via `expires_at`)
- All storage operations are logged for legal compliance
- Grace period provides users time to migrate data
- Bulk download enables data portability
- System respects data ownership (user's DB vs your R2)

## Next Steps

After successful deployment:

1. **Email Notifications**: Add email notifications for grace period milestones
2. **Admin UI**: Build UI to view audit logs
3. **BYOS Migration Assistant**: Guide users through managed → BYOS migration
4. **Storage Analytics**: Dashboard showing storage usage and costs
5. **Automated Reports**: Compliance reports for legal/audit purposes
