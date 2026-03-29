-- Control DB: Storage Grace Period Tracking
-- Adds column to track when storage files should be deleted

-- Add storage_grace_ends_at column to org_settings
ALTER TABLE public.org_settings
ADD COLUMN IF NOT EXISTS storage_grace_ends_at TIMESTAMPTZ;

-- Add index for finding orgs with expired grace periods
CREATE INDEX IF NOT EXISTS idx_org_settings_storage_grace_ends_at 
ON public.org_settings(storage_grace_ends_at) 
WHERE storage_grace_ends_at IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN public.org_settings.storage_grace_ends_at IS 
'Timestamp when storage grace period ends and files should be permanently deleted. 
Set when storage_access_level changes to read_only_grace. 
Null when storage is active or fully disconnected.';
