# Backup Cooldown Override

## Overview
The backup system enforces a 7-day cooldown between backups. This can be overridden on a **one-time basis** for a specific organization when an immediate backup is needed.

## How It Works
1. Set `backup_cooldown_override = true` in the control database
2. The next backup will be allowed even if within the 7-day cooldown period
3. **After a successful backup, the flag is automatically reset to `false`**
4. Normal 7-day cooldown resumes from the new backup timestamp

## Enabling the One-Time Override

To allow an immediate backup for a specific organization:

```sql
-- Enable one-time cooldown override
UPDATE org_settings
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'::jsonb),
  '{backup_cooldown_override}',
  'true'::jsonb
)
WHERE org_id = 'your-org-id-here';
```

## Verifying the Setting

```sql
-- Check current override status
SELECT 
  org_id,
  permissions->>'backup_cooldown_override' as cooldown_override,
  permissions->>'backup_local_enabled' as backup_enabled,
  (backup_history->-1)->>'timestamp' as last_backup_time
FROM org_settings
WHERE org_id = 'your-org-id-here';
```

## Manually Resetting (if needed)

If you need to cancel the override before it's used:

```sql
-- Manually reset the override flag
UPDATE org_settings
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'::jsonb),
  '{backup_cooldown_override}',
  'false'::jsonb
)
WHERE org_id = 'your-org-id-here';
```

## Notes

- **One-time use**: The override is automatically cleared after a successful backup
- The override only bypasses the cooldown if one is active (i.e., last backup < 7 days ago)
- The override does not affect the permission check (`backup_local_enabled` must still be `true`)
- All backups are logged in `backup_history` with details about whether the override was used
- After the override is consumed, the normal 7-day cooldown applies from the **new** backup timestamp
- This is intended for emergency or testing situations only
