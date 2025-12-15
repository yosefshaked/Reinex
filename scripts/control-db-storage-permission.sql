-- Control DB: Storage Access Permission
-- Defines the storage_access_level permission in the permissions_registry
-- This permission controls access to storage configuration features

-- Insert storage permission definition into permissions_registry
INSERT INTO public.permission_registry (
  permission_key,
  display_name_en,
  display_name_he,
  description_en,
  description_he,
  default_value,
  category,
  requires_approval
) VALUES (
  'storage_access_level',
  'Storage Configuration Access',
  'גישה להגדרות אחסון',
  'Determines if the organization can configure storage and which modes are available. Options: false (locked), "byos_only" (BYOS only), "managed_only" (Managed only), "all" (both modes).',
  'קובע האם הארגון יכול להגדיר אחסון ואילו מצבים זמינים. אפשרויות: false (נעול), "byos_only" (BYOS בלבד), "managed_only" (מנוהל בלבד), "all" (שני המצבים).',
  'false'::jsonb,
  'storage',
  true
) ON CONFLICT (permission_key) DO UPDATE SET
  display_name_en = EXCLUDED.display_name_en,
  display_name_he = EXCLUDED.display_name_he,
  description_en = EXCLUDED.description_en,
  description_he = EXCLUDED.description_he,
  default_value = EXCLUDED.default_value,
  category = EXCLUDED.category,
  requires_approval = EXCLUDED.requires_approval,
  updated_at = NOW();

-- Add helpful comment
COMMENT ON COLUMN public.permission_registry.permission_key IS 
  'Unique identifier for the permission. For storage_access_level, valid values in org_settings.permissions are: false, "byos_only", "managed_only", "all"';
