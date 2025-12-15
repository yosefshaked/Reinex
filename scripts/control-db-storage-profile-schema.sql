-- Control Plane Database Schema Updates for Storage Profile Feature
-- Version: 1.0
-- Date: 2025-11
-- Description: Adds storage_profile column to org_settings for cross-system storage configuration

-- ============================================================================
-- 1. Add storage_profile column to org_settings
-- ============================================================================
-- This column stores the organization's storage configuration:
-- {
--   "mode": "byos" | "managed",
--   "byos": {
--     "provider": "s3" | "azure" | "gcs",
--     "endpoint": "https://...",
--     "region": "us-east-1",
--     "bucket": "bucket-name",
--     "access_key_id": "encrypted-key",
--     "secret_access_key": "encrypted-secret",
--     "public_url": "https://files.example.com" (optional, for public CDN/custom domain),
--     "validated_at": "2025-11-22T10:30:00Z"
--   },
--   "managed": {
--     "namespace": "org-abc-123",
--     "active": true,
--     "created_at": "2025-11-22T10:30:00Z"
--   },
--   "updated_at": "2025-11-22T10:30:00Z",
--   "updated_by": "user-uuid"
-- }

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'org_settings'
      AND column_name = 'storage_profile'
  ) THEN
    ALTER TABLE public.org_settings
      ADD COLUMN storage_profile jsonb DEFAULT NULL;
    
    RAISE NOTICE 'Added storage_profile column to org_settings';
  ELSE
    RAISE NOTICE 'Column storage_profile already exists on org_settings';
  END IF;
END $$;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON COLUMN public.org_settings.storage_profile IS 
  'Cross-system storage configuration (BYOS or Managed Storage). Used by TutTiud and future systems for file storage operations. Structure: { mode: "byos"|"managed", byos?: {...}, managed?: {...} }';