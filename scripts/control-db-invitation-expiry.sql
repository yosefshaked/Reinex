-- Control DB: Invitation Expiry Configuration
-- Provides a function to read Supabase auth config for OTP expiry settings
-- and calculate invitation expiration timestamps with smart precedence

-- Function to get MAILER_OTP_EXP from Supabase auth config
-- Returns expiry in seconds (Supabase stores as seconds)
CREATE OR REPLACE FUNCTION public.get_auth_otp_expiry_seconds()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  expiry_seconds INTEGER;
BEGIN
  -- Read MAILER_OTP_EXP from auth.config
  -- Default is 86400 seconds (24 hours) if not configured
  SELECT COALESCE(
    (config->'MAILER_OTP_EXP')::text::integer,
    86400
  ) INTO expiry_seconds
  FROM auth.config
  WHERE id = 1  -- Supabase auth config typically uses id=1
  LIMIT 1;
  
  -- If no config row exists, return 24h default
  IF expiry_seconds IS NULL THEN
    expiry_seconds := 86400;
  END IF;
  
  RETURN expiry_seconds;
END;
$$;

-- Function to calculate invitation expiry timestamp with smart precedence
-- Precedence order:
-- 1. permission_registry.invitation_expiry_seconds (if set and > 0)
-- 2. auth.config MAILER_OTP_EXP (read via get_auth_otp_expiry_seconds)
-- 3. Hardcoded 24 hours fallback (86400 seconds)
CREATE OR REPLACE FUNCTION public.calculate_invitation_expiry(org_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  custom_seconds INTEGER;
  auth_seconds INTEGER;
  expiry_seconds INTEGER;
BEGIN
  -- Check for global override in permission_registry (seconds)
  SELECT CASE
           WHEN jsonb_typeof(default_value) = 'number' THEN (default_value)::text::integer
           ELSE NULL
         END
  INTO custom_seconds
  FROM public.permission_registry
  WHERE permission_key = 'invitation_expiry_seconds'
  LIMIT 1;

  -- Use custom seconds if set and valid
  IF custom_seconds IS NOT NULL AND custom_seconds > 0 THEN
    expiry_seconds := custom_seconds;
  ELSE
    -- Fall back to Supabase auth config (seconds)
    auth_seconds := public.get_auth_otp_expiry_seconds();
    expiry_seconds := COALESCE(auth_seconds, 86400);
  END IF;

  -- Return current timestamp + calculated seconds
  RETURN NOW() + (expiry_seconds || ' seconds')::INTERVAL;
END;
$$;

-- Grant execute to authenticated users (BFF endpoints will call this)
GRANT EXECUTE ON FUNCTION public.get_auth_otp_expiry_seconds() TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_invitation_expiry(UUID) TO authenticated;

-- Example usage:
-- SELECT public.calculate_invitation_expiry('your-org-uuid-here');
-- SELECT public.get_auth_otp_expiry_seconds(); -- returns seconds from auth.config
