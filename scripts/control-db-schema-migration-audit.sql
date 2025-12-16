-- Control DB schema migration audit table
-- Run once against the CONTROL database (Supabase SQL editor).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.schema_migration_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  ssot_version_hash text NOT NULL,
  db_snapshot_hash_before text,
  db_snapshot_hash_after text,

  summary_counts jsonb,
  patch_plan_json jsonb,

  db_snapshot_before jsonb,
  db_snapshot_after jsonb,

  preflight_results jsonb,

  executed_sql_safe text,
  executed_sql_manual text,
  executed_result_json jsonb,

  approved_by_user_id uuid,
  approval_method text,
  approval_phrase text,

  status text NOT NULL
);

CREATE INDEX IF NOT EXISTS schema_migration_audit_tenant_created_idx
  ON public.schema_migration_audit (tenant_id, created_at DESC);

ALTER TABLE public.schema_migration_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role access on schema_migration_audit" ON public.schema_migration_audit;
CREATE POLICY "Allow service role access on schema_migration_audit"
  ON public.schema_migration_audit
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
