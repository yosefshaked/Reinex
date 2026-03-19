-- Control DB: Global Active Routing Table
-- Supports /submit and future easy-access workflows across tenants.

CREATE TABLE IF NOT EXISTS public.active_routing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  category text NOT NULL,
  routing_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb
);

-- Fast JSON lookups (identity, otp, submission id, etc.)
CREATE INDEX IF NOT EXISTS active_routing_routing_info_gin_idx
  ON public.active_routing
  USING GIN (routing_info);

-- Optional supporting indexes for common access patterns
CREATE INDEX IF NOT EXISTS active_routing_category_idx
  ON public.active_routing (category);

CREATE INDEX IF NOT EXISTS active_routing_expires_at_idx
  ON public.active_routing (expires_at)
  WHERE expires_at IS NOT NULL;

-- Security hardening: this table stores sensitive routing and OTP context.
-- Access is intended only through backend code running with service_role.
ALTER TABLE public.active_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_routing FORCE ROW LEVEL SECURITY;

-- Restrict direct table grants for client roles.
REVOKE ALL ON TABLE public.active_routing FROM PUBLIC;
REVOKE ALL ON TABLE public.active_routing FROM anon;
REVOKE ALL ON TABLE public.active_routing FROM authenticated;

-- Ensure service_role can manage routing rows through PostgREST/REST APIs.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.active_routing TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'active_routing'
      AND policyname = 'Only service role can access active routing'
  ) THEN
    CREATE POLICY "Only service role can access active routing"
      ON public.active_routing
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$$;
