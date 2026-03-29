-- Control Plane Database Schema Updates for Custom Logo Feature
-- Version: 1.0
-- Date: 2025-10
-- Description: Adds logo_url column to org_settings for custom branding

-- ============================================================================
-- 1. Add logo_url column to org_settings
-- ============================================================================
-- This column stores the URL to the organization's custom logo
-- Format: Public image URL (https://example.com/logo.png)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'org_settings'
      AND column_name = 'logo_url'
  ) THEN
    ALTER TABLE public.org_settings
      ADD COLUMN logo_url text DEFAULT NULL;
    
    RAISE NOTICE 'Added logo_url column to org_settings';
  ELSE
    RAISE NOTICE 'Column logo_url already exists on org_settings';
  END IF;
END $$;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON COLUMN public.org_settings.logo_url IS 'Organization custom logo URL (public image URL)';
