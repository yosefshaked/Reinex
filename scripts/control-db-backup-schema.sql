-- Control Plane Database Schema Updates for Backup/Restore Feature
-- Version: 2.0
-- Date: 2025-01
-- Description: Adds permissions and backup_history columns to org_settings

-- ============================================================================
-- 1. Add permissions column to org_settings
-- ============================================================================
-- This column stores JSON configuration for feature permissions like:
-- { "backup_local_enabled": true, "backup_oauth_enabled": false, "logo_enabled": true }

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'org_settings'
      AND column_name = 'permissions'
  ) THEN
    ALTER TABLE public.org_settings
      ADD COLUMN permissions jsonb DEFAULT '{}'::jsonb;
    
    RAISE NOTICE 'Added permissions column to org_settings';
  ELSE
    RAISE NOTICE 'Column permissions already exists on org_settings';
  END IF;
END $$;

-- ============================================================================
-- 2. Add backup_history column to org_settings
-- ============================================================================
-- Stores array of backup/restore operations with structure:
-- [
--   {
--     "type": "backup|restore",
--     "status": "completed|failed",
--     "timestamp": "2025-01-15T10:30:00Z",
--     "initiated_by": "user-uuid",
--     "size_bytes": 1024000,
--     "error_message": "optional error text"
--   }
-- ]

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'org_settings'
      AND column_name = 'backup_history'
  ) THEN
    ALTER TABLE public.org_settings
      ADD COLUMN backup_history jsonb DEFAULT '[]'::jsonb;
    
    RAISE NOTICE 'Added backup_history column to org_settings';
  ELSE
    RAISE NOTICE 'Column backup_history already exists on org_settings';
  END IF;
END $$;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON COLUMN public.org_settings.permissions IS 'Feature permission flags (backup_local_enabled, logo_enabled, etc.)';
COMMENT ON COLUMN public.org_settings.backup_history IS 'Array of backup/restore operations with timestamps and status';
