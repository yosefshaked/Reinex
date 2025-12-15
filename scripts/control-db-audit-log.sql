-- Control DB: Audit Log for System and Org Admin Actions
-- Tracks critical actions for legal compliance and dispute resolution

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  user_id UUID NOT NULL,
  user_email TEXT,
  user_role TEXT NOT NULL, -- 'system_admin', 'owner', 'admin', 'member'
  action_type TEXT NOT NULL, -- 'storage.grace_period_started', 'storage.files_deleted', 'storage.migrated_to_byos', etc.
  action_category TEXT NOT NULL, -- 'storage', 'backup', 'permissions', 'membership', etc.
  resource_type TEXT, -- 'storage_profile', 'files', 'permissions', 'org_settings', etc.
  resource_id TEXT, -- ID of affected resource if applicable
  details JSONB, -- Structured details about the action
  metadata JSONB, -- Additional context (IP address, user agent, etc.)
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ -- Optional expiration for log retention policies
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_log_org_id ON public.audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_type ON public.audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_category ON public.audit_log(action_category);
CREATE INDEX IF NOT EXISTS idx_audit_log_performed_at ON public.audit_log(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_expires_at ON public.audit_log(expires_at) WHERE expires_at IS NOT NULL;

-- Composite index for common queries (org + time range)
CREATE INDEX IF NOT EXISTS idx_audit_log_org_time ON public.audit_log(org_id, performed_at DESC);

-- Enable Row Level Security
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only read audit logs for their own organizations
-- (Must verify membership via org_members join)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'audit_log' 
    AND policyname = 'Users can read audit logs for their orgs'
  ) THEN
    CREATE POLICY "Users can read audit logs for their orgs"
      ON public.audit_log
      FOR SELECT
      TO authenticated
      USING (
        org_id IN (
          SELECT org_id FROM public.org_memberships 
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END;
$$;

-- RLS Policy: Only service role can insert/modify audit logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'audit_log' 
    AND policyname = 'Only service role can modify audit logs'
  ) THEN
    CREATE POLICY "Only service role can modify audit logs"
      ON public.audit_log
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$$;

-- Helper function to create audit log entries
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_org_id UUID,
  p_user_id UUID,
  p_user_email TEXT,
  p_user_role TEXT,
  p_action_type TEXT,
  p_action_category TEXT,
  p_resource_type TEXT DEFAULT NULL,
  p_resource_id TEXT DEFAULT NULL,
  p_details JSONB DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO public.audit_log (
    org_id,
    user_id,
    user_email,
    user_role,
    action_type,
    action_category,
    resource_type,
    resource_id,
    details,
    metadata,
    performed_at
  ) VALUES (
    p_org_id,
    p_user_id,
    p_user_email,
    p_user_role,
    p_action_type,
    p_action_category,
    p_resource_type,
    p_resource_id,
    p_details,
    p_metadata,
    NOW()
  )
  RETURNING id INTO log_id;
  
  RETURN log_id;
END;
$$;

-- Comment for documentation
COMMENT ON TABLE public.audit_log IS 
'Audit log for tracking critical system and organization admin actions.
Required for legal compliance and dispute resolution.
Retention: 7 years for compliance (can be configured via expires_at).';

COMMENT ON FUNCTION public.log_audit_event IS 
'Helper function to create audit log entries.
Use this from API endpoints to log admin actions.
Example: SELECT public.log_audit_event(org_id, user_id, email, role, ''storage.grace_period_started'', ''storage'', ''storage_profile'', org_id::text, jsonb_build_object(''grace_days'', 30));';

-- Example audit action types (for reference):
-- Storage actions:
--   - storage.configured (initial setup)
--   - storage.updated (changed mode or credentials)
--   - storage.disconnected (manually disconnected)
--   - storage.grace_period_started (payment lapsed)
--   - storage.files_deleted (grace period expired)
--   - storage.migrated_to_byos (migrated from managed to BYOS)
--   - storage.bulk_download (downloaded all files)
--
-- Permission actions:
--   - permission.enabled (feature enabled)
--   - permission.disabled (feature disabled)
--
-- Membership actions:
--   - member.invited
--   - member.removed
--   - member.role_changed
--
-- Backup actions:
--   - backup.created
--   - backup.restored
