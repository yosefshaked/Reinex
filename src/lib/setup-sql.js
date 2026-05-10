export const SETUP_SQL_SCRIPT = String.raw`-- =================================================================
-- Reinex Tenant Database Setup Script (SSOT)
-- Version: Aligned with Reinex-PRD.md (Therapeutic Riding & Clinic Management System)
-- =================================================================
--
-- This script implements the complete Reinex domain as described in the PRD:
-- 1. Lessons & Scheduling (Templates, Instances, Overrides, Participants)
-- 2. Client Profiles, Students & Guardians
--    - client_profiles is the canonical human/customer root
--    - students is an operational overlay for enrolled/ongoing customers
--    - client_guardians is the canonical guardian linkage table
-- 3. Forms, Submissions, OTP & Routing
--    - form_submissions, otp_challenges, and waiting_list_entries root to client_profile_id
-- 4. Commitments & Consumption (prepaid packages, HMO support; student-only in this phase)
-- 5. Waiting List (with priority, preferences, conflict detection)
-- 6. Instructors, Payroll, Attendance & Leave (Employees, Services, RateHistory, LessonEarnings, Attendance, Leave, Finance Corrections)
-- 7. Settings (cross-feature configuration)
-- 8. Documents (polymorphic file storage)
--
-- Design Notes:
-- - Tenant schema is "public" (product-agnostic, no tuttiud references).
-- - Idempotent DDL: CREATE TABLE/COLUMN IF NOT EXISTS, INSERT...ON CONFLICT DO NOTHING.
-- - Supports weekly generation engine with template versioning and undo capability.
-- - Supports partial attendance (group lessons) via lesson_participants rooted to client_profile_id with optional student_id.
-- - Supports service-per-student pricing overrides and HMO-specific rules via metadata.
-- - RLS enabled on all tables; uniform policies for authenticated users.
-- - Final SELECT prints a dedicated JWT key; replace the placeholder secret first.
--
-- Patch Notes (2026-05-04):
-- - [PRIVACY] Added privacy_status column to students and client_profiles.
--   Values: 'active' (default) | 'anonymized'. Idempotent; uses IF NOT EXISTS guard.
--   Indexes added on (org_id, privacy_status) for fast compliance queries.
--
-- Patch Notes (2026-04-09):
-- - [AGOROT MIGRATION] Converted ALL currency/money columns from numeric to integer (agorot).
--   1 shekel = 100 agorot. Financial values stored as integers (e.g. ₪10.50 = 1050 agorot).
--   Affected: Employees (current_rate, monthly_salary_amount, leave_fixed_day_rate),
--   Services (default_customer_charge_amount), RateHistory (rate),
--   finance_corrections (amount), instructor_service_capabilities (base_rate),
--   lesson_templates (price_override), lesson_participants (price_charged),
--   hmo_provider_tracks (default_customer_charge_amount, default_insurer_claim_amount, default_post_coverage_policy),
--   hmo_authorizations (covered_customer_charge_amount, covered_insurer_claim_amount, post_coverage_policy),
--   commitments (total_amount, default_charge_amount),
--   ledger_transactions (amount), lesson_earnings (rate_used, payout_amount).
--   Non-currency numerics (annual_leave_days, balance_days_delta, pay_fraction,
--   quantity_days) remain as numeric. get_student_remaining_balance() -> bigint.
-- - [SCHEMA] ledger_transactions usage_type DEBIT enum extended: +transfer_debit, +refund.
-- - [RPC] create_commitment_transfer_atomic() — fixes Issue #1 (broken transfer rollback).
-- - [RPC] ensure_hmo_authorization_and_link_commitment() — fixes Issue #2 (non-atomic HMO link).
-- - [RPC] batch_sync_lesson_ledger_entries() — fixes Issue #4 (non-transactional billing sync).
-- - [NOTE] commitments_hmo_authorization_id_uidx already prevents duplicate HMO commitments
--   (Issue #3). Unique constraint on hmo_authorization_id confirmed sufficient.
-- - Safety guardrail exception: column type changes above explicitly approved by project owner.
--
-- Patch Notes (2026-04-07):
-- - Refactored person identity to client_profiles as the canonical root entity
-- - Reduced students to an operational overlay linked by client_profile_id
-- - Replaced student_guardians with client_guardians and migrated links during setup
-- - Rooted waiting_list_entries, form_submissions, otp_challenges, and lesson_participants to client_profile_id
-- - Removed mirrored person/lifecycle columns from students after backfill
-- - Removed client-profile -> students mirror sync triggers after migration
-- - Kept recurring templates / commitments / HMO / current billing student-only in this phase
--
-- Historical Patch Notes (2025-12-15):
-- - Removed Documents.entity_type CHECK constraint (validation in UI layer)
-- - Removed redundant ALTER TABLE ADD COLUMN id statements (id already in CREATE TABLE)
-- - Added lesson_instances.applied_override_id for override traceability
-- - Added operational columns to lesson_participants (attendance/documentation tracking)
-- - Added version/published_at/archived_at to forms for lifecycle management
-- - Added submitted_by_guardian_id/source/locked_at to form_submissions
-- - Added expires_at index to otp_challenges
-- - Fixed RLS policy generation to handle quoted table names (Employees, Services, etc)
--
-- Principle — Lesson Overrides (LOCKED):
-- - Use a single explicit table: public.lesson_template_overrides as the SSOT for template-level, date-specific overrides (cancel/modify).
-- - lesson_instances.applied_override_id MUST reference lesson_template_overrides when an override is applied.
-- - Do NOT replace overrides with lesson_instances.metadata or scattered columns.
-- - Instance-level audit fields may exist for UI visibility, but they do NOT replace lesson_template_overrides.
--
-- Safety Guardrails (SSOT authoring):
-- - Do NOT drop/remove any table (especially lesson_template_overrides) unless explicitly approved.
-- - Do NOT drop columns, rename columns, change column types, or remove SSOT constraints/policies.
-- - Do NOT “simplify” by moving SSOT data into metadata JSON.
-- - Destructive changes are forbidden unless the user explicitly types: "ALLOW DESTRUCTIVE CHANGES".
-- =================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA extensions;

-- =================================================================
-- Roles and Users (Create before policies reference them)
-- =================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user;
  END IF;
END
$$;

-- =================================================================
-- Control / Platform Tables (Shared across all tenants)
-- =================================================================

-- -----------------------------------------------------------------
-- public.organizations (merged with org_settings)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  setup_completed boolean NOT NULL DEFAULT false,
  verified_at timestamptz NULL,
  -- Merged from org_settings
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  logo_url text NULL,
  storage_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_grace_ends_at timestamptz NULL,
  backup_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- General
  policy_links jsonb NULL,
  legal_settings jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);


CREATE INDEX IF NOT EXISTS organizations_slug_idx
  ON public.organizations (slug);

CREATE INDEX IF NOT EXISTS organizations_created_by_idx
  ON public.organizations (created_by);

-- -----------------------------------------------------------------
-- public.profiles (linked to auth.users)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name text NULL,
  last_name text NULL,
  identity_number text NULL,
  avatar_url text NULL,
  phone text NULL,
  locale text NOT NULL DEFAULT 'he',
  setup_completed_at timestamptz NULL,
  account_status text NOT NULL DEFAULT 'active',
  deactivated_at timestamptz NULL,
  is_system_admin boolean NOT NULL DEFAULT false,
  can_create_organizations boolean NOT NULL DEFAULT false,
  max_owned_organizations integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT profiles_account_status_check CHECK (account_status IN ('active', 'disabled')),
  CONSTRAINT profiles_max_owned_organizations_non_negative_check CHECK (
    max_owned_organizations IS NULL OR max_owned_organizations >= 0
  )
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_name text NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS identity_number text NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_create_organizations boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_system_admin boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS max_owned_organizations integer NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz NULL;

UPDATE public.profiles
SET account_status = 'active'
WHERE account_status IS NULL OR btrim(account_status) = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'full_name'
  ) THEN
    UPDATE public.profiles
    SET
      first_name = COALESCE(first_name, NULLIF(split_part(btrim(full_name), ' ', 1), '')),
      last_name = COALESCE(
        last_name,
        NULLIF(
          btrim(
            regexp_replace(
              btrim(full_name),
              '^\S+\s*',
              ''
            )
          ),
          ''
        )
      )
    WHERE full_name IS NOT NULL
      AND btrim(full_name) <> '';
  END IF;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_account_status_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_account_status_check
      CHECK (account_status IN ('active', 'disabled'));
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_max_owned_organizations_non_negative_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_max_owned_organizations_non_negative_check
      CHECK (max_owned_organizations IS NULL OR max_owned_organizations >= 0);
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'full_name'
  ) THEN
    ALTER TABLE public.profiles DROP COLUMN full_name;
  END IF;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_identity_number_unique_idx
  ON public.profiles (identity_number)
  WHERE identity_number IS NOT NULL AND identity_number <> '';


-- -----------------------------------------------------------------
-- public.org_memberships
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.org_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'office', 'instructor', 'member')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE UNIQUE INDEX IF NOT EXISTS org_memberships_org_user_uidx
  ON public.org_memberships (org_id, user_id);

CREATE INDEX IF NOT EXISTS org_memberships_user_idx
  ON public.org_memberships (user_id);

-- -----------------------------------------------------------------
-- public.org_invitations
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.org_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'office', 'instructor', 'member')),
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE INDEX IF NOT EXISTS org_invitations_org_idx
  ON public.org_invitations (org_id, status);

CREATE INDEX IF NOT EXISTS org_invitations_email_idx
  ON public.org_invitations (email, status);

-- -----------------------------------------------------------------
-- public.permission_registry (reference data, not org-scoped)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permission_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_key text NOT NULL UNIQUE,
  display_name_en text NOT NULL,
  display_name_he text NOT NULL,
  description_en text NULL,
  description_he text NULL,
  default_value jsonb NOT NULL DEFAULT 'false'::jsonb,
  category text NOT NULL,
  requires_approval boolean NOT NULL DEFAULT true,
  description text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.permission_registry
  ADD COLUMN IF NOT EXISTS display_name_en text;

ALTER TABLE public.permission_registry
  ADD COLUMN IF NOT EXISTS display_name_he text;

ALTER TABLE public.permission_registry
  ADD COLUMN IF NOT EXISTS description_en text;

ALTER TABLE public.permission_registry
  ADD COLUMN IF NOT EXISTS description_he text;

ALTER TABLE public.permission_registry
  ADD COLUMN IF NOT EXISTS default_value jsonb;

ALTER TABLE public.permission_registry
  ADD COLUMN IF NOT EXISTS requires_approval boolean;

ALTER TABLE public.permission_registry
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'permission_registry'
      AND column_name = 'default_value'
      AND data_type <> 'jsonb'
  ) THEN
    ALTER TABLE public.permission_registry ALTER COLUMN default_value DROP DEFAULT;
    ALTER TABLE public.permission_registry ALTER COLUMN default_value TYPE jsonb USING to_jsonb(default_value);
  END IF;
END;
$$;

UPDATE public.permission_registry
SET
  display_name_en = COALESCE(NULLIF(display_name_en, ''), permission_key),
  display_name_he = COALESCE(NULLIF(display_name_he, ''), permission_key),
  default_value = COALESCE(default_value, 'false'::jsonb),
  category = COALESCE(NULLIF(category, ''), 'features'),
  requires_approval = COALESCE(requires_approval, true),
  updated_at = COALESCE(updated_at, NOW());

ALTER TABLE public.permission_registry
  ALTER COLUMN display_name_en SET NOT NULL,
  ALTER COLUMN display_name_he SET NOT NULL,
  ALTER COLUMN default_value SET DEFAULT 'false'::jsonb,
  ALTER COLUMN default_value SET NOT NULL,
  ALTER COLUMN category SET NOT NULL,
  ALTER COLUMN requires_approval SET DEFAULT true,
  ALTER COLUMN requires_approval SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS permission_registry_category_idx
  ON public.permission_registry (category);


-- -----------------------------------------------------------------
-- public.active_routing
-- Generic routing records for active-org context and anonymous invite/OTP flows.
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.active_routing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'active_org',
  routing_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NULL,
  created_by uuid NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public.active_routing
    ADD COLUMN IF NOT EXISTS id uuid,
    ADD COLUMN IF NOT EXISTS category text,
    ADD COLUMN IF NOT EXISTS routing_info jsonb,
    ADD COLUMN IF NOT EXISTS expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS created_by uuid,
    ADD COLUMN IF NOT EXISTS metadata jsonb,
    ADD COLUMN IF NOT EXISTS created_at timestamptz,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz,
    ADD COLUMN IF NOT EXISTS user_id uuid;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.active_routing
    ALTER COLUMN id SET DEFAULT gen_random_uuid(),
    ALTER COLUMN category SET DEFAULT 'active_org',
    ALTER COLUMN routing_info SET DEFAULT '{}'::jsonb,
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  UPDATE public.active_routing
  SET id = gen_random_uuid()
  WHERE id IS NULL;

  UPDATE public.active_routing
  SET category = 'active_org'
  WHERE category IS NULL OR btrim(category) = '';

  UPDATE public.active_routing
  SET routing_info = '{}'::jsonb
  WHERE routing_info IS NULL;

  UPDATE public.active_routing
  SET created_at = COALESCE(created_at, updated_at, now()),
      updated_at = COALESCE(updated_at, created_at, now());
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

DO $$
DECLARE
  pk_name text;
  pk_columns text[];
BEGIN
  SELECT con.conname, array_agg(att.attname ORDER BY att.attnum)
  INTO pk_name, pk_columns
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid
   AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.active_routing'::regclass
    AND con.contype = 'p'
  GROUP BY con.conname;

  IF pk_name IS NOT NULL AND pk_columns <> ARRAY['id'] THEN
    EXECUTE format('ALTER TABLE public.active_routing DROP CONSTRAINT %I', pk_name);
  END IF;

  ALTER TABLE public.active_routing
    ALTER COLUMN user_id DROP NOT NULL,
    ALTER COLUMN id SET NOT NULL,
    ALTER COLUMN category SET NOT NULL,
    ALTER COLUMN routing_info SET NOT NULL,
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN updated_at SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.active_routing'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.active_routing
      ADD CONSTRAINT active_routing_pkey PRIMARY KEY (id);
  END IF;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS active_routing_org_idx
  ON public.active_routing (org_id);

CREATE INDEX IF NOT EXISTS active_routing_category_expires_idx
  ON public.active_routing (category, expires_at);

CREATE INDEX IF NOT EXISTS active_routing_routing_info_gin_idx
  ON public.active_routing USING GIN (routing_info);

CREATE UNIQUE INDEX IF NOT EXISTS active_routing_active_org_user_uidx
  ON public.active_routing (user_id)
  WHERE user_id IS NOT NULL AND category = 'active_org' AND expires_at IS NULL;

-- -----------------------------------------------------------------
-- public.audit_log (unified: replaces both control audit_log and
-- tenant tenant_audit_log)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  actor_user_id uuid NULL,
  actor_email text NULL,
  actor_role text NULL,
  correlation_id uuid NULL,
  event_type text NOT NULL,
  action_category text NULL,
  retention_category text NOT NULL DEFAULT 'standard',
  resource_type text NULL,
  resource_id text NULL,
  before_state jsonb NULL,
  after_state jsonb NULL,
  details jsonb NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  CONSTRAINT audit_log_retention_category_check CHECK (retention_category IN ('critical', 'standard', 'diagnostic'))
);


CREATE INDEX IF NOT EXISTS audit_log_org_idx
  ON public.audit_log (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_resource_idx
  ON public.audit_log (resource_type, resource_id);

CREATE INDEX IF NOT EXISTS audit_log_expiry_idx
  ON public.audit_log (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_event_type_idx
  ON public.audit_log (event_type, created_at DESC);

-- -----------------------------------------------------------------
-- public.impersonation_sessions
-- Tracks every admin "log in as user" session for audit + live revoke.
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  admin_email text NOT NULL,
  target_user_id uuid NOT NULL,
  target_email text NOT NULL,
  target_org_id uuid NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  target_org_name text NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  expires_at timestamptz NOT NULL,
  ended_reason text NULL,
  ended_by_user_id uuid NULL,
  ip inet NULL,
  user_agent text NULL,
  audit_event_id uuid NULL REFERENCES public.audit_log(id) ON DELETE SET NULL,
  CONSTRAINT impersonation_sessions_reason_length CHECK (char_length(reason) >= 3),
  CONSTRAINT impersonation_sessions_status_check CHECK (status IN ('active', 'ended', 'expired', 'revoked'))
);


CREATE INDEX IF NOT EXISTS impersonation_sessions_admin_idx
  ON public.impersonation_sessions (admin_user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS impersonation_sessions_target_idx
  ON public.impersonation_sessions (target_user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS impersonation_sessions_active_idx
  ON public.impersonation_sessions (status, started_at DESC)
  WHERE status = 'active';

ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------
-- public.admin_data
-- Shared key-value store for admin-console modules that previously
-- used localStorage (Incidents, Knowledge Base, Future Ideas,
-- Compliance Requests). Replaces per-browser storage with cross-admin
-- persistence. Only accessible via the service_role key; RLS blocks
-- all authenticated-user access.
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_data (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  module      text        NOT NULL,
  record_id   text        NOT NULL,
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid        NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_data_module_record_uidx
  ON public.admin_data (module, record_id);

CREATE INDEX IF NOT EXISTS admin_data_module_created_idx
  ON public.admin_data (module, created_at DESC);

ALTER TABLE public.admin_data ENABLE ROW LEVEL SECURITY;

-- No GRANT to app_user and no permissive policies — access is service_role
-- only. Any non-service-role attempt gets a hard "permission denied" error
-- before RLS even runs, which is the intended security boundary.

-- -----------------------------------------------------------------
-- public.error_events
-- Operational support/debug log for frontend-safe error responses.
-- Written by service_role only; read through system-admin-error-events.
-- Raw provider/DB/stack details live here, never in user responses.
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.error_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  support_code    text        NOT NULL UNIQUE,
  status          integer     NOT NULL,
  public_message  text        NOT NULL,
  route           text        NULL,
  method          text        NULL,
  org_id          uuid        NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  actor_user_id   uuid        NULL,
  severity        text        NOT NULL DEFAULT 'error',
  request_context jsonb       NOT NULL DEFAULT '{}'::jsonb,
  internal_error  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  CONSTRAINT error_events_status_check CHECK (status >= 400 AND status <= 599),
  CONSTRAINT error_events_severity_check CHECK (severity IN ('info', 'warning', 'error', 'critical'))
);

CREATE INDEX IF NOT EXISTS error_events_created_idx
  ON public.error_events (created_at DESC);

CREATE INDEX IF NOT EXISTS error_events_expires_idx
  ON public.error_events (expires_at);

CREATE INDEX IF NOT EXISTS error_events_status_idx
  ON public.error_events (status, created_at DESC);

CREATE INDEX IF NOT EXISTS error_events_org_idx
  ON public.error_events (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS error_events_route_idx
  ON public.error_events (route, created_at DESC);

ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;

-- No GRANT to app_user — service_role only. Same pattern as admin_data.

-- -----------------------------------------------------------------
-- public.email_log
-- Immutable log of every outbound Brevo email sent by the platform.
-- Written by service_role only; accessible via system-admin-email-log
-- endpoint. Not visible to app_user — service_role boundary only.
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_type    text        NOT NULL,
  to_email      text        NOT NULL,
  subject       text        NULL,
  status        text        NOT NULL DEFAULT 'sent',
  error_message text        NULL,
  org_id        uuid        NULL,
  actor_user_id uuid        NULL,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_log_status_check CHECK (status IN ('sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS email_log_sent_at_idx
  ON public.email_log (sent_at DESC);

CREATE INDEX IF NOT EXISTS email_log_email_type_idx
  ON public.email_log (email_type, sent_at DESC);

CREATE INDEX IF NOT EXISTS email_log_to_email_idx
  ON public.email_log (to_email, sent_at DESC);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- No GRANT to app_user — service_role only. Same pattern as admin_data.

-- -----------------------------------------------------------------
-- Control RPCs
-- -----------------------------------------------------------------

DROP FUNCTION IF EXISTS public.ensure_my_profile_exists(text, text);

CREATE OR REPLACE FUNCTION public.ensure_my_profile_exists(
  p_full_name text DEFAULT NULL,
  p_locale text DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_profile_id uuid;
  v_locale text;
  v_first_name text;
  v_last_name text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  v_locale := lower(NULLIF(btrim(COALESCE(p_locale, '')), ''));
  IF v_locale IS NULL THEN
    v_locale := 'he';
  END IF;

  v_first_name := NULLIF(btrim(COALESCE(p_first_name, '')), '');
  v_last_name := NULLIF(btrim(COALESCE(p_last_name, '')), '');

  IF v_first_name IS NULL AND NULLIF(btrim(COALESCE(p_full_name, '')), '') IS NOT NULL THEN
    v_first_name := NULLIF(split_part(btrim(p_full_name), ' ', 1), '');
  END IF;

  IF v_last_name IS NULL AND NULLIF(btrim(COALESCE(p_full_name, '')), '') IS NOT NULL THEN
    v_last_name := NULLIF(
      btrim(
        regexp_replace(
          btrim(p_full_name),
          '^\S+\s*',
          ''
        )
      ),
      ''
    );
  END IF;

  INSERT INTO public.profiles (id, first_name, last_name, locale, updated_at)
  VALUES (v_user_id, v_first_name, v_last_name, v_locale, now())
  ON CONFLICT (id) DO UPDATE
  SET
    first_name = COALESCE(public.profiles.first_name, EXCLUDED.first_name),
    last_name = COALESCE(public.profiles.last_name, EXCLUDED.last_name),
    locale = COALESCE(public.profiles.locale, EXCLUDED.locale),
    updated_at = now();

  SELECT p.id
    INTO v_profile_id
  FROM public.profiles p
  WHERE p.id = v_user_id;

  RETURN v_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organization(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_base_slug text;
  v_slug text;
  v_try int := 0;
  v_is_system_admin boolean := false;
  v_can_create_organizations boolean := false;
  v_max_owned_organizations integer := NULL;
  v_owned_organizations integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  PERFORM public.ensure_my_profile_exists(NULL, NULL);

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'invalid_organization_name';
  END IF;

  SELECT
    p.is_system_admin,
    COALESCE(p.can_create_organizations, false),
    p.max_owned_organizations
  INTO
    v_is_system_admin,
    v_can_create_organizations,
    v_max_owned_organizations
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF NOT COALESCE(v_is_system_admin, false) AND NOT COALESCE(v_can_create_organizations, false) THEN
    RAISE EXCEPTION 'not_authorized_to_create_organization';
  END IF;

  IF v_max_owned_organizations IS NOT NULL THEN
    SELECT COUNT(*)::integer
      INTO v_owned_organizations
    FROM public.org_memberships om
    WHERE om.user_id = auth.uid()
      AND om.role = 'owner'
      AND om.is_active = true;

    IF v_owned_organizations >= v_max_owned_organizations THEN
      RAISE EXCEPTION 'organization_quota_exceeded';
    END IF;
  END IF;

  v_base_slug := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' THEN
    v_base_slug := 'org';
  END IF;

  v_slug := v_base_slug;

  LOOP
    BEGIN
      INSERT INTO public.organizations (name, slug, created_by)
      VALUES (btrim(p_name), v_slug, auth.uid())
      RETURNING id INTO v_org_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        v_try := v_try + 1;
        IF v_try > 10 THEN
          RAISE;
        END IF;
        v_slug := left(v_base_slug, 50) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    END;
  END LOOP;

  INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES (v_org_id, auth.uid(), 'owner')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  RETURN v_org_id;
END;
$$;

-- =================================================================
-- Tenant Public Domain Tables (Product-Agnostic)
-- =================================================================

-- -----------------------------------------------------------------
-- public.students (operational overlay)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  client_profile_id uuid,
  notes_internal text NULL,
  medical_provider text NULL,
  special_rate integer NULL,
  medical_flags jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);


DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'first_name'
  ) THEN
    ALTER TABLE public.students ALTER COLUMN first_name DROP NOT NULL;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'last_name'
  ) THEN
    ALTER TABLE public.students ALTER COLUMN last_name DROP NOT NULL;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

-- -----------------------------------------------------------------
-- public.guardians
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  first_name text NOT NULL,
  middle_name text NULL,
  last_name text NULL,
  phone text NULL,
  email text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);



CREATE INDEX IF NOT EXISTS guardians_name_idx
  ON public.guardians (org_id, first_name, last_name);

-- -----------------------------------------------------------------
-- public.client_profiles
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  first_name text NOT NULL,
  middle_name text NULL,
  last_name text NOT NULL,
  identity_number text NULL,
  phone text NULL,
  email text NULL,
  date_of_birth date NULL,
  default_notification_method text NOT NULL DEFAULT 'whatsapp',
  tags uuid[] NULL,
  onboarding_status text NOT NULL DEFAULT 'not_started',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT client_profiles_default_notification_method_check CHECK (default_notification_method IN ('whatsapp','email')),
  CONSTRAINT client_profiles_onboarding_status_check CHECK (onboarding_status IN ('not_started','pending_forms','approved'))
);



CREATE INDEX IF NOT EXISTS client_profiles_is_active_idx ON public.client_profiles (org_id, is_active);
CREATE INDEX IF NOT EXISTS client_profiles_name_idx ON public.client_profiles (org_id, first_name, last_name);

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS client_profiles_identity_number_unique_idx
    ON public.client_profiles (org_id, identity_number)
    WHERE identity_number IS NOT NULL AND identity_number <> '';
EXCEPTION
  WHEN others THEN NULL;
END $$;


DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS students_client_profile_id_uidx
    ON public.students (org_id, client_profile_id)
    WHERE client_profile_id IS NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'students'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'client_profiles'
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_client_profile_id_fkey
      FOREIGN KEY (client_profile_id)
      REFERENCES public.client_profiles(id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$;


-- -----------------------------------------------------------------
-- public.client_guardians
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  client_profile_id uuid NOT NULL,
  guardian_id uuid NOT NULL,
  relationship text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_guardians_client_profile_id_fkey FOREIGN KEY (client_profile_id) REFERENCES public.client_profiles(id),
  CONSTRAINT client_guardians_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.guardians(id),
  CONSTRAINT client_guardians_relationship_check CHECK (relationship IN ('father','mother','self','caretaker','other'))
);


CREATE UNIQUE INDEX IF NOT EXISTS client_guardians_client_guardian_uidx
  ON public.client_guardians (org_id, client_profile_id, guardian_id);

CREATE INDEX IF NOT EXISTS client_guardians_client_profile_id_idx
  ON public.client_guardians (org_id, client_profile_id);

-- -----------------------------------------------------------------
-- public.Employees (complete table with payroll fields)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Employees" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES public.organizations(id),
  "user_id" uuid,
  "first_name" text NOT NULL,
  "middle_name" text,
  "last_name" text,
  "employee_id" text NOT NULL,
  "employee_type" text,
  "payroll_model" text,
  "current_rate" integer,
  "monthly_salary_amount" integer,
  "phone" text,
  "email" text,
  "start_date" date,
  "is_active" boolean DEFAULT true,
  "notes" text,
  "working_days" jsonb,
  "annual_leave_days" numeric DEFAULT 12,
  "leave_pay_method" text,
  "leave_fixed_day_rate" integer,
  "employment_scope" text,
  "instructor_types" uuid[],
  "metadata" jsonb,
  CONSTRAINT "Employees_pkey" PRIMARY KEY ("id"),
  CONSTRAINT Employees_payroll_model_check CHECK ("payroll_model" IS NULL OR "payroll_model" IN ('hourly', 'monthly_salary', 'lesson_based'))
);


CREATE INDEX IF NOT EXISTS "Employees_name_idx" ON public."Employees" ("org_id", "first_name", "last_name");
CREATE INDEX IF NOT EXISTS "Employees_user_id_idx" ON public."Employees" ("org_id", "user_id");

-- -----------------------------------------------------------------
-- public.Services (service catalog)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Services" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES public.organizations(id),
  "name" text NOT NULL,
  "duration_minutes" bigint,
  "payment_model" text,
  "default_customer_charge_amount" integer,
  "color" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "metadata" jsonb,
  CONSTRAINT "Services_pkey" PRIMARY KEY ("id"),
  CONSTRAINT Services_payment_model_check CHECK ("payment_model" IS NULL OR "payment_model" IN ('fixed_rate', 'per_student')),
  CONSTRAINT Services_default_customer_charge_amount_non_negative_check CHECK ("default_customer_charge_amount" IS NULL OR "default_customer_charge_amount" >= 0)
);


-- -----------------------------------------------------------------
-- public.RateHistory (rate tracking per employee/service/date)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."RateHistory" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES public.organizations(id),
  "rate" integer NOT NULL,
  "effective_date" date NOT NULL,
  "notes" text,
  "employee_id" uuid NOT NULL,
  "service_id" uuid,
  "metadata" jsonb,
  CONSTRAINT "RateHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RateHistory_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES public."Employees"("id"),
  CONSTRAINT "RateHistory_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES public."Services"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RateHistory_employee_service_effective_date_key"
  ON public."RateHistory" ("org_id", "employee_id", "service_id", "effective_date");



CREATE TABLE IF NOT EXISTS public.employee_attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  attendance_date date NOT NULL,
  status text NOT NULL DEFAULT 'present',
  worked_minutes integer NULL,
  notes text NULL,
  source_type text NOT NULL DEFAULT 'manual',
  version int NOT NULL DEFAULT 1,
  created_by uuid NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT employee_attendance_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public."Employees"(id),
  CONSTRAINT employee_attendance_records_status_check CHECK (status IN ('present', 'partial', 'absent', 'remote')),
  CONSTRAINT employee_attendance_records_source_type_check CHECK (source_type IN ('manual', 'import', 'system', 'correction'))
);

DROP INDEX IF EXISTS public.employee_attendance_records_employee_date_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS employee_attendance_records_primary_date_uidx
  ON public.employee_attendance_records (org_id, employee_id, attendance_date)
  WHERE source_type IN ('manual', 'import', 'system');

CREATE INDEX IF NOT EXISTS employee_attendance_records_date_idx
  ON public.employee_attendance_records (org_id, attendance_date);

CREATE INDEX IF NOT EXISTS employee_attendance_records_correction_idx
  ON public.employee_attendance_records (org_id, employee_id, attendance_date, source_type)
  WHERE source_type = 'correction';

-- -----------------------------------------------------------------
-- public.employee_leave_entries
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_leave_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  leave_type text NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  duration_mode text NOT NULL DEFAULT 'full_day',
  half_day_part text NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NULL,
  notes text NULL,
  source_type text NOT NULL DEFAULT 'admin_manual',
  approved_by uuid NULL,
  created_by uuid NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT employee_leave_entries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public."Employees"(id),
  CONSTRAINT employee_leave_entries_leave_type_check CHECK (leave_type IN ('employee_paid', 'system_paid', 'unpaid', 'half_day')),
  CONSTRAINT employee_leave_entries_status_check CHECK (status IN ('approved', 'cancelled')),
  CONSTRAINT employee_leave_entries_duration_mode_check CHECK (duration_mode IN ('full_day', 'half_day')),
  CONSTRAINT employee_leave_entries_half_day_part_check CHECK (half_day_part IS NULL OR half_day_part IN ('first_half', 'second_half'))
);


CREATE INDEX IF NOT EXISTS employee_leave_entries_employee_range_idx
  ON public.employee_leave_entries (org_id, employee_id, start_date, end_date);

-- -----------------------------------------------------------------
-- public.employee_leave_days
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_leave_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  leave_entry_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  leave_date date NOT NULL,
  day_portion text NOT NULL DEFAULT 'full_day',
  leave_type text NOT NULL,
  balance_days_delta numeric NOT NULL DEFAULT 0,
  pay_fraction numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT employee_leave_days_leave_entry_id_fkey FOREIGN KEY (leave_entry_id) REFERENCES public.employee_leave_entries(id) ON DELETE CASCADE,
  CONSTRAINT employee_leave_days_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public."Employees"(id),
  CONSTRAINT employee_leave_days_day_portion_check CHECK (day_portion IN ('full_day', 'first_half', 'second_half')),
  CONSTRAINT employee_leave_days_leave_type_check CHECK (leave_type IN ('employee_paid', 'system_paid', 'unpaid', 'half_day'))
);


CREATE UNIQUE INDEX IF NOT EXISTS employee_leave_days_employee_date_uidx
  ON public.employee_leave_days (org_id, employee_id, leave_date);

CREATE INDEX IF NOT EXISTS employee_leave_days_entry_idx
  ON public.employee_leave_days (org_id, leave_entry_id);

-- -----------------------------------------------------------------
-- public.employee_leave_balance_events
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_leave_balance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  leave_entry_id uuid NULL,
  leave_day_id uuid NULL,
  event_type text NOT NULL,
  leave_type text NULL,
  quantity_days numeric NOT NULL,
  effective_date date NOT NULL,
  notes text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT employee_leave_balance_events_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public."Employees"(id),
  CONSTRAINT employee_leave_balance_events_leave_entry_id_fkey FOREIGN KEY (leave_entry_id) REFERENCES public.employee_leave_entries(id) ON DELETE SET NULL,
  CONSTRAINT employee_leave_balance_events_leave_day_id_fkey FOREIGN KEY (leave_day_id) REFERENCES public.employee_leave_days(id) ON DELETE SET NULL,
  CONSTRAINT employee_leave_balance_events_event_type_check CHECK (event_type IN ('allocation', 'carryover', 'adjustment', 'usage', 'reversal', 'correction'))
);


CREATE INDEX IF NOT EXISTS employee_leave_balance_events_employee_date_idx
  ON public.employee_leave_balance_events (org_id, employee_id, effective_date);

-- -----------------------------------------------------------------
-- public.finance_corrections
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.finance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  correction_type text NOT NULL,
  amount integer NOT NULL,
  effective_date date NOT NULL,
  notes text NULL,
  version int NOT NULL DEFAULT 1,
  created_by uuid NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT finance_corrections_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public."Employees"(id),
  CONSTRAINT finance_corrections_correction_type_check CHECK (correction_type IN ('bonus', 'deduction', 'adjustment', 'correction'))
);


CREATE INDEX IF NOT EXISTS finance_corrections_employee_date_idx
  ON public.finance_corrections (org_id, employee_id, effective_date);

-- -----------------------------------------------------------------
-- public.instructor_profiles
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.instructor_profiles (
  employee_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  break_time_minutes int NULL,
  metadata jsonb NULL,
  CONSTRAINT instructor_profiles_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public."Employees"(id)
);



-- -----------------------------------------------------------------
-- public.instructor_service_capabilities
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.instructor_service_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  service_id uuid NOT NULL,
  max_students int NOT NULL DEFAULT 1,
  base_rate integer NULL,
  availability_windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NULL,
  CONSTRAINT instructor_service_capabilities_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public."Employees"(id),
  CONSTRAINT instructor_service_capabilities_service_id_fkey FOREIGN KEY (service_id) REFERENCES public."Services"(id)
);


UPDATE public.instructor_service_capabilities
SET availability_windows = '[]'::jsonb
WHERE availability_windows IS NULL;


CREATE UNIQUE INDEX IF NOT EXISTS instructor_service_capabilities_employee_service_uidx
  ON public.instructor_service_capabilities (org_id, employee_id, service_id);

CREATE INDEX IF NOT EXISTS instructor_service_capabilities_employee_id_idx
  ON public.instructor_service_capabilities (org_id, employee_id);

-- -----------------------------------------------------------------
-- public.lesson_templates
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lesson_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  student_id uuid NOT NULL,
  instructor_employee_id uuid NOT NULL,
  service_id uuid NOT NULL,
  day_of_week text NOT NULL,
  time_of_day time NOT NULL,
  duration_minutes int NOT NULL,
  valid_from date NOT NULL,
  valid_until date NULL,
  price_override integer NULL,
  notes_internal text NULL,
  flags jsonb NULL,
  is_active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  supersedes_template_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT lesson_templates_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
  CONSTRAINT lesson_templates_instructor_employee_id_fkey FOREIGN KEY (instructor_employee_id) REFERENCES public."Employees"(id),
  CONSTRAINT lesson_templates_service_id_fkey FOREIGN KEY (service_id) REFERENCES public."Services"(id),
  CONSTRAINT lesson_templates_supersedes_template_id_fkey FOREIGN KEY (supersedes_template_id) REFERENCES public.lesson_templates(id),
  CONSTRAINT lesson_templates_day_of_week_check CHECK (day_of_week IN ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'))
);


CREATE INDEX IF NOT EXISTS lesson_templates_student_id_idx ON public.lesson_templates (org_id, student_id);
CREATE INDEX IF NOT EXISTS lesson_templates_instructor_day_time_idx ON public.lesson_templates (org_id, instructor_employee_id, day_of_week, time_of_day);

CREATE OR REPLACE FUNCTION public.validate_lesson_template_no_active_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.is_active, true) = false THEN
    RETURN NEW;
  END IF;

  IF NEW.valid_until IS NOT NULL AND NEW.valid_until < NEW.valid_from THEN
    RAISE EXCEPTION 'invalid_valid_until' USING ERRCODE = '22007';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.lesson_templates existing
    WHERE existing.id IS DISTINCT FROM NEW.id
      AND existing.org_id = NEW.org_id
      AND existing.instructor_employee_id = NEW.instructor_employee_id
      AND existing.day_of_week = NEW.day_of_week
      AND existing.is_active = true
      AND NEW.valid_from <= COALESCE(existing.valid_until, DATE '9999-12-31')
      AND existing.valid_from <= COALESCE(NEW.valid_until, DATE '9999-12-31')
      AND (
        ((EXTRACT(HOUR FROM existing.time_of_day)::int * 60) + EXTRACT(MINUTE FROM existing.time_of_day)::int)
          < ((EXTRACT(HOUR FROM NEW.time_of_day)::int * 60) + EXTRACT(MINUTE FROM NEW.time_of_day)::int + NEW.duration_minutes)
      )
      AND (
        ((EXTRACT(HOUR FROM NEW.time_of_day)::int * 60) + EXTRACT(MINUTE FROM NEW.time_of_day)::int)
          < ((EXTRACT(HOUR FROM existing.time_of_day)::int * 60) + EXTRACT(MINUTE FROM existing.time_of_day)::int + existing.duration_minutes)
      )
  ) THEN
    RAISE EXCEPTION 'instructor_template_time_conflict'
      USING ERRCODE = '23P01',
            DETAIL = 'lesson_templates_active_overlap';
  END IF;

  RETURN NEW;
END;
$$;


CREATE TABLE IF NOT EXISTS public.lesson_template_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  template_id uuid NOT NULL,
  target_date date NOT NULL,
  override_type text NOT NULL,
  new_instructor_employee_id uuid NULL,
  new_service_id uuid NULL,
  new_time_of_day time NULL,
  new_duration_minutes int NULL,
  note text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_template_overrides_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.lesson_templates(id),
  CONSTRAINT lesson_template_overrides_new_instructor_employee_id_fkey FOREIGN KEY (new_instructor_employee_id) REFERENCES public."Employees"(id),
  CONSTRAINT lesson_template_overrides_new_service_id_fkey FOREIGN KEY (new_service_id) REFERENCES public."Services"(id),
  CONSTRAINT lesson_template_overrides_override_type_check CHECK (override_type IN ('cancel','modify'))
);

CREATE UNIQUE INDEX IF NOT EXISTS lesson_template_overrides_template_date_uidx
  ON public.lesson_template_overrides (org_id, template_id, target_date);

CREATE INDEX IF NOT EXISTS lesson_template_overrides_target_date_idx
  ON public.lesson_template_overrides (org_id, target_date);

-- -----------------------------------------------------------------
-- public.lesson_instances
-- -----------------------------------------------------------------
-- is_closed is the workflow closure flag for a lesson instance.
-- It must reflect downstream settlement completion, not only attendance
-- resolution. A lesson may be attendance-resolved and still remain open until
-- billing, payroll, and required HMO claim workflow are resolved.

CREATE TABLE IF NOT EXISTS public.lesson_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  template_id uuid NULL,
  applied_override_id uuid NULL,
  datetime_start timestamptz NOT NULL,
  duration_minutes int NOT NULL,
  instructor_employee_id uuid NOT NULL,
  service_id uuid NOT NULL,
  status text NOT NULL,
  documentation_status text NOT NULL DEFAULT 'undocumented',
  is_closed boolean NOT NULL DEFAULT false,
  closed_reason text NULL,
  closed_by uuid NULL,
  closed_at timestamptz NULL,
  created_source text NOT NULL,
  version int NOT NULL DEFAULT 1,
  created_by uuid NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT lesson_instances_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.lesson_templates(id),
  CONSTRAINT lesson_instances_instructor_employee_id_fkey FOREIGN KEY (instructor_employee_id) REFERENCES public."Employees"(id),
  CONSTRAINT lesson_instances_service_id_fkey FOREIGN KEY (service_id) REFERENCES public."Services"(id),
  CONSTRAINT lesson_instances_applied_override_id_fkey FOREIGN KEY (applied_override_id) REFERENCES public.lesson_template_overrides(id),
  CONSTRAINT lesson_instances_status_check CHECK (status IN ('scheduled','completed','cancelled')),
  CONSTRAINT lesson_instances_documentation_status_check CHECK (documentation_status IN ('undocumented','documented')),
  CONSTRAINT lesson_instances_created_source_check CHECK (created_source IN ('weekly_generation','one_time','manual_reschedule','migration'))
);


DO $$
BEGIN
  UPDATE public.lesson_instances
  SET status = CASE
    WHEN regexp_replace(lower(coalesce(status, '')), '[[:space:]]+', '', 'g') IN ('cancelled_student', 'cancelled_clinic', 'no_show', 'cancelled') THEN 'cancelled'
    WHEN regexp_replace(lower(coalesce(status, '')), '[[:space:]]+', '', 'g') = 'completed' THEN 'completed'
    WHEN regexp_replace(lower(coalesce(status, '')), '[[:space:]]+', '', 'g') = 'scheduled' THEN 'scheduled'
    ELSE status
  END
  WHERE status IS NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  UPDATE public.lesson_instances
  SET documentation_status = regexp_replace(lower(coalesce(documentation_status, '')), '[[:space:]]+', '', 'g')
  WHERE documentation_status IS NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

ALTER TABLE public.lesson_instances
  DROP CONSTRAINT IF EXISTS lesson_instances_status_check;

DO $$
BEGIN
  UPDATE public.lesson_instances
  SET created_source = CASE
    WHEN regexp_replace(lower(coalesce(created_source, '')), '[[:space:]]+', '', 'g') IN ('weekly_generation', 'one_time', 'manual_reschedule', 'migration')
      THEN regexp_replace(lower(coalesce(created_source, '')), '[[:space:]]+', '', 'g')
    WHEN regexp_replace(lower(coalesce(created_source, '')), '[[:space:]]+', '', 'g') IN ('manual', 'manual_create', 'one-off', 'one_off')
      THEN 'one_time'
    WHEN regexp_replace(lower(coalesce(created_source, '')), '[[:space:]]+', '', 'g') IN ('reschedule', 'manual-reschedule', 'manualreschedule')
      THEN 'manual_reschedule'
    ELSE created_source
  END
  WHERE created_source IS NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS lesson_instances_datetime_start_idx ON public.lesson_instances (org_id, datetime_start);
CREATE INDEX IF NOT EXISTS lesson_instances_instructor_datetime_idx ON public.lesson_instances (org_id, instructor_employee_id, datetime_start);
CREATE INDEX IF NOT EXISTS lesson_instances_applied_override_id_idx ON public.lesson_instances (org_id, applied_override_id) WHERE applied_override_id IS NOT NULL;

-- -----------------------------------------------------------------
-- public.lesson_participants
-- -----------------------------------------------------------------
-- metadata.workflow may hold participant-level workflow decisions used by the
-- calendar closeout flow, such as student billing, instructor compensation, and
-- HMO claim decisions. These values are source-side workflow inputs only; they
-- do not replace dedicated financial or task artifact tables.

CREATE TABLE IF NOT EXISTS public.lesson_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  lesson_instance_id uuid NOT NULL,
  client_profile_id uuid NOT NULL,
  student_id uuid NULL,
  participant_status text NOT NULL,
  price_charged integer NULL,
  pricing_breakdown jsonb NULL,
  commitment_id uuid NULL,
  documentation_ref jsonb NULL,
  reminder_sent boolean NOT NULL DEFAULT false,
  reminder_seen boolean NOT NULL DEFAULT false,
  attendance_confirmed_at timestamptz NULL,
  attendance_confirmed_by uuid NULL,
  documented_at timestamptz NULL,
  documented_by uuid NULL,
  locked_at timestamptz NULL,
  version int NOT NULL DEFAULT 1,
  updated_by uuid NULL,
  metadata jsonb NULL,
  CONSTRAINT lesson_participants_lesson_instance_id_fkey FOREIGN KEY (lesson_instance_id) REFERENCES public.lesson_instances(id),
  CONSTRAINT lesson_participants_client_profile_id_fkey FOREIGN KEY (client_profile_id) REFERENCES public.client_profiles(id),
  CONSTRAINT lesson_participants_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
  CONSTRAINT lesson_participants_participant_status_check CHECK (participant_status IN ('scheduled','attended','cancelled_student','cancelled_clinic','no_show'))
);


DO $$
BEGIN
  UPDATE public.lesson_participants
  SET participant_status = regexp_replace(lower(coalesce(participant_status, '')), '[[:space:]]+', '', 'g')
  WHERE participant_status IS NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS lesson_participants_instance_client_profile_uidx
  ON public.lesson_participants (org_id, lesson_instance_id, client_profile_id);

CREATE INDEX IF NOT EXISTS lesson_participants_client_profile_id_idx
  ON public.lesson_participants (org_id, client_profile_id);

CREATE INDEX IF NOT EXISTS lesson_participants_student_id_idx
  ON public.lesson_participants (org_id, student_id);

DO $$
BEGIN
  UPDATE public.lesson_participants lp
  SET client_profile_id = s.client_profile_id
  FROM public.students s
  WHERE lp.student_id = s.id
    AND lp.client_profile_id IS NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;


DO $$
BEGIN
  ALTER TABLE public.lesson_participants ALTER COLUMN student_id DROP NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS lesson_participants_locked_at_idx
  ON public.lesson_participants (org_id, locked_at) WHERE locked_at IS NOT NULL;

-- -----------------------------------------------------------------
-- public.grace_cancellation_requests
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.grace_cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  lesson_participant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  reason text NULL,
  status text NOT NULL DEFAULT 'manually_excused',
  CONSTRAINT grace_cancellation_requests_lesson_participant_id_fkey FOREIGN KEY (lesson_participant_id) REFERENCES public.lesson_participants(id),
  CONSTRAINT grace_cancellation_requests_status_check CHECK (status IN ('manually_excused'))
);


DO $$
BEGIN
  ALTER TABLE public.grace_cancellation_requests
    DROP CONSTRAINT IF EXISTS grace_cancellation_requests_created_by_fkey;
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN insufficient_privilege THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS grace_cancellation_requests_participant_uidx
  ON public.grace_cancellation_requests (org_id, lesson_participant_id);

CREATE INDEX IF NOT EXISTS grace_cancellation_requests_created_at_idx
  ON public.grace_cancellation_requests (org_id, created_at DESC);

-- -----------------------------------------------------------------
-- public.payroll_runs
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  finalized_at timestamptz NULL,
  finalized_by uuid NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT payroll_runs_status_check CHECK (status IN ('draft', 'finalized', 'cancelled'))
);


CREATE INDEX IF NOT EXISTS payroll_runs_period_idx
  ON public.payroll_runs (org_id, period_start, period_end, status);

-- -----------------------------------------------------------------
-- public.claim_batches
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.claim_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  batch_type text NOT NULL DEFAULT 'hmo',
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  submitted_at timestamptz NULL,
  submitted_by uuid NULL,
  paid_at timestamptz NULL,
  paid_by uuid NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT claim_batches_batch_type_check CHECK (batch_type IN ('hmo', 'manual')),
  CONSTRAINT claim_batches_status_check CHECK (status IN ('draft', 'submitted', 'rejected', 'paid', 'cancelled'))
);


CREATE INDEX IF NOT EXISTS claim_batches_period_idx
  ON public.claim_batches (org_id, period_start, period_end, status);

-- -----------------------------------------------------------------
-- public.instance_locks
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.instance_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  lesson_instance_id uuid NOT NULL,
  lock_source_type text NOT NULL,
  lock_source_id uuid NOT NULL,
  lock_reason text NOT NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT instance_locks_lesson_instance_id_fkey FOREIGN KEY (lesson_instance_id) REFERENCES public.lesson_instances(id) ON DELETE CASCADE,
  CONSTRAINT instance_locks_source_type_check CHECK (lock_source_type IN ('payroll_run', 'claim_batch', 'manual_compliance_lock'))
);


CREATE UNIQUE INDEX IF NOT EXISTS instance_locks_instance_source_uidx
  ON public.instance_locks (org_id, lesson_instance_id, lock_source_type, lock_source_id);

CREATE INDEX IF NOT EXISTS instance_locks_instance_idx
  ON public.instance_locks (org_id, lesson_instance_id, created_at DESC);

-- -----------------------------------------------------------------
-- public.participant_locks
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.participant_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  lesson_participant_id uuid NOT NULL,
  lock_source_type text NOT NULL,
  lock_source_id uuid NOT NULL,
  lock_reason text NOT NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT participant_locks_lesson_participant_id_fkey FOREIGN KEY (lesson_participant_id) REFERENCES public.lesson_participants(id) ON DELETE CASCADE,
  CONSTRAINT participant_locks_source_type_check CHECK (lock_source_type IN ('payroll_run', 'claim_batch', 'manual_compliance_lock'))
);


CREATE UNIQUE INDEX IF NOT EXISTS participant_locks_participant_source_uidx
  ON public.participant_locks (org_id, lesson_participant_id, lock_source_type, lock_source_id);

CREATE INDEX IF NOT EXISTS participant_locks_participant_idx
  ON public.participant_locks (org_id, lesson_participant_id, created_at DESC);

-- -----------------------------------------------------------------
-- public.calendar_instance_corrections
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calendar_instance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  original_instance_id uuid NOT NULL,
  correction_mode text NOT NULL DEFAULT 'value_only',
  reason_code text NOT NULL,
  reason_text text NOT NULL,
  status text NOT NULL DEFAULT 'applied',
  instance_patch jsonb NOT NULL DEFAULT '{}'::jsonb,
  participant_patches jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  impact_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  blocked_by_paid_claim boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,
  created_by uuid NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT calendar_instance_corrections_instance_fkey FOREIGN KEY (original_instance_id) REFERENCES public.lesson_instances(id) ON DELETE CASCADE,
  CONSTRAINT calendar_instance_corrections_mode_check CHECK (correction_mode IN ('value_only', 'replacement_instance', 'participant_adjustment')),
  CONSTRAINT calendar_instance_corrections_status_check CHECK (status IN ('previewed', 'applied', 'blocked'))
);


CREATE INDEX IF NOT EXISTS calendar_instance_corrections_instance_idx
  ON public.calendar_instance_corrections (org_id, original_instance_id, created_at DESC);

-- (tenant_audit_log removed — replaced by unified public.audit_log in Control Tables section above)

-- -----------------------------------------------------------------
-- public.dashboard_tasks
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.dashboard_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  task_type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  resource_type text NULL,
  resource_id text NULL,
  action_path text NULL,
  version int NOT NULL DEFAULT 1,
  created_by uuid NULL,
  resolved_by uuid NULL,
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  metadata jsonb NULL,
  CONSTRAINT dashboard_tasks_priority_check CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT dashboard_tasks_status_check CHECK (status IN ('open', 'resolved', 'dismissed'))
);


CREATE INDEX IF NOT EXISTS dashboard_tasks_open_idx
  ON public.dashboard_tasks (org_id, status, priority, created_at DESC)
  WHERE status = 'open';

-- -----------------------------------------------------------------
-- public.hmo_providers
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.hmo_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  claim_submission_mode text NOT NULL DEFAULT 'amount',
  claim_payment_timing text NOT NULL DEFAULT 'after_submission',
  claim_reference_required boolean NOT NULL DEFAULT false,
  claim_period_granularity text NOT NULL DEFAULT 'monthly',
  claim_payment_matching_mode text NOT NULL DEFAULT 'batch_amount',
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hmo_providers_claim_submission_mode_check CHECK (claim_submission_mode IN ('amount', 'unit_count', 'hybrid')),
  CONSTRAINT hmo_providers_claim_payment_timing_check CHECK (claim_payment_timing IN ('after_submission', 'monthly', 'quarterly', 'custom')),
  CONSTRAINT hmo_providers_claim_period_granularity_check CHECK (claim_period_granularity IN ('monthly', 'quarterly', 'custom')),
  CONSTRAINT hmo_providers_claim_payment_matching_mode_check CHECK (claim_payment_matching_mode IN ('batch_amount', 'line_amount', 'unit_count', 'manual_reconciliation'))
);

ALTER TABLE public.hmo_providers
  ADD COLUMN IF NOT EXISTS claim_submission_mode text NOT NULL DEFAULT 'amount',
  ADD COLUMN IF NOT EXISTS claim_payment_timing text NOT NULL DEFAULT 'after_submission',
  ADD COLUMN IF NOT EXISTS claim_reference_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claim_period_granularity text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS claim_payment_matching_mode text NOT NULL DEFAULT 'batch_amount';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hmo_providers_claim_submission_mode_check') THEN
    ALTER TABLE public.hmo_providers
      ADD CONSTRAINT hmo_providers_claim_submission_mode_check
      CHECK (claim_submission_mode IN ('amount', 'unit_count', 'hybrid'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hmo_providers_claim_payment_timing_check') THEN
    ALTER TABLE public.hmo_providers
      ADD CONSTRAINT hmo_providers_claim_payment_timing_check
      CHECK (claim_payment_timing IN ('after_submission', 'monthly', 'quarterly', 'custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hmo_providers_claim_period_granularity_check') THEN
    ALTER TABLE public.hmo_providers
      ADD CONSTRAINT hmo_providers_claim_period_granularity_check
      CHECK (claim_period_granularity IN ('monthly', 'quarterly', 'custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hmo_providers_claim_payment_matching_mode_check') THEN
    ALTER TABLE public.hmo_providers
      ADD CONSTRAINT hmo_providers_claim_payment_matching_mode_check
      CHECK (claim_payment_matching_mode IN ('batch_amount', 'line_amount', 'unit_count', 'manual_reconciliation'));
  END IF;
END $$;


CREATE UNIQUE INDEX IF NOT EXISTS hmo_providers_name_uidx
  ON public.hmo_providers (org_id, lower(name));

-- -----------------------------------------------------------------
-- public.hmo_provider_tracks
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.hmo_provider_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  provider_id uuid NOT NULL,
  service_id uuid NULL,
  name text NOT NULL,
  payment_mode text NOT NULL DEFAULT 'partially_paid_by_hmo',
  default_customer_charge_amount integer NOT NULL DEFAULT 0,
  default_insurer_claim_amount integer NOT NULL DEFAULT 0,
  default_post_coverage_policy text NOT NULL DEFAULT 'service_default',
  default_post_coverage_customer_charge_amount integer NULL,
  default_workflow_notes text NULL,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hmo_provider_tracks_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.hmo_providers(id) ON DELETE RESTRICT,
  CONSTRAINT hmo_provider_tracks_service_id_fkey FOREIGN KEY (service_id) REFERENCES public."Services"(id),
  CONSTRAINT hmo_provider_tracks_payment_mode_check CHECK (payment_mode IN ('fully_paid_by_hmo', 'partially_paid_by_hmo', 'fully_paid_by_customer')),
  CONSTRAINT hmo_provider_tracks_customer_charge_non_negative_check CHECK (default_customer_charge_amount >= 0),
  CONSTRAINT hmo_provider_tracks_insurer_claim_non_negative_check CHECK (default_insurer_claim_amount >= 0),
  CONSTRAINT hmo_provider_tracks_post_coverage_policy_check CHECK (default_post_coverage_policy IN ('service_default', 'explicit_customer_charge', 'manual_block')),
  CONSTRAINT hmo_provider_tracks_post_coverage_customer_charge_non_negative_check CHECK (default_post_coverage_customer_charge_amount IS NULL OR default_post_coverage_customer_charge_amount >= 0)
);

ALTER TABLE public.hmo_provider_tracks
  ADD COLUMN IF NOT EXISTS default_post_coverage_policy text NOT NULL DEFAULT 'service_default',
  ADD COLUMN IF NOT EXISTS default_post_coverage_customer_charge_amount integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hmo_provider_tracks_post_coverage_policy_check'
  ) THEN
    ALTER TABLE public.hmo_provider_tracks
      ADD CONSTRAINT hmo_provider_tracks_post_coverage_policy_check
      CHECK (default_post_coverage_policy IN ('service_default', 'explicit_customer_charge', 'manual_block'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hmo_provider_tracks_post_coverage_customer_charge_non_negative_check'
  ) THEN
    ALTER TABLE public.hmo_provider_tracks
      ADD CONSTRAINT hmo_provider_tracks_post_coverage_customer_charge_non_negative_check
      CHECK (default_post_coverage_customer_charge_amount IS NULL OR default_post_coverage_customer_charge_amount >= 0);
  END IF;
END $$;



DROP INDEX IF EXISTS hmo_provider_tracks_provider_name_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS hmo_provider_tracks_provider_service_name_uidx
  ON public.hmo_provider_tracks (org_id, provider_id, service_id, lower(name));

CREATE INDEX IF NOT EXISTS hmo_provider_tracks_provider_id_idx
  ON public.hmo_provider_tracks (org_id, provider_id);

CREATE INDEX IF NOT EXISTS hmo_provider_tracks_service_id_idx
  ON public.hmo_provider_tracks (org_id, service_id);

-- -----------------------------------------------------------------
-- public.hmo_authorizations
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.hmo_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  student_id uuid NOT NULL,
  service_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  provider_track_id uuid NOT NULL,
  authorization_reference text NULL,
  authorized_lessons int NOT NULL DEFAULT 0,
  valid_from date NULL,
  expires_at date NULL,
  reminder_date date NULL,
  covered_customer_charge_amount integer NOT NULL DEFAULT 0,
  covered_insurer_claim_amount integer NOT NULL DEFAULT 0,
  post_coverage_policy text NOT NULL DEFAULT 'manual_block',
  post_coverage_customer_charge_amount integer NULL,
  customer_charge_amount_override integer NULL,
  insurer_claim_amount_override integer NULL,
  contracted_rate_amount integer NOT NULL DEFAULT 0,
  workflow_notes_override text NULL,
  status text NOT NULL DEFAULT 'active',
  notes text NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hmo_authorizations_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
  CONSTRAINT hmo_authorizations_service_id_fkey FOREIGN KEY (service_id) REFERENCES public."Services"(id),
  CONSTRAINT hmo_authorizations_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.hmo_providers(id) ON DELETE RESTRICT,
  CONSTRAINT hmo_authorizations_provider_track_id_fkey FOREIGN KEY (provider_track_id) REFERENCES public.hmo_provider_tracks(id) ON DELETE RESTRICT,
  CONSTRAINT hmo_authorizations_status_check CHECK (status IN ('active', 'cancelled', 'completed', 'expired')),
  CONSTRAINT hmo_authorizations_authorized_lessons_non_negative_check CHECK (authorized_lessons >= 0),
  CONSTRAINT hmo_authorizations_covered_customer_charge_non_negative_check CHECK (covered_customer_charge_amount >= 0),
  CONSTRAINT hmo_authorizations_covered_insurer_claim_non_negative_check CHECK (covered_insurer_claim_amount >= 0),
  CONSTRAINT hmo_authorizations_post_coverage_policy_check CHECK (post_coverage_policy IN ('service_default', 'explicit_customer_charge', 'manual_block')),
  CONSTRAINT hmo_authorizations_post_coverage_customer_charge_non_negative_check CHECK (post_coverage_customer_charge_amount IS NULL OR post_coverage_customer_charge_amount >= 0),
  CONSTRAINT hmo_authorizations_customer_override_non_negative_check CHECK (customer_charge_amount_override IS NULL OR customer_charge_amount_override >= 0),
  CONSTRAINT hmo_authorizations_insurer_override_non_negative_check CHECK (insurer_claim_amount_override IS NULL OR insurer_claim_amount_override >= 0)
);

ALTER TABLE public.hmo_authorizations
  ADD COLUMN IF NOT EXISTS covered_customer_charge_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS covered_insurer_claim_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS post_coverage_policy text NOT NULL DEFAULT 'manual_block',
  ADD COLUMN IF NOT EXISTS post_coverage_customer_charge_amount integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hmo_authorizations_covered_customer_charge_non_negative_check'
  ) THEN
    ALTER TABLE public.hmo_authorizations
      ADD CONSTRAINT hmo_authorizations_covered_customer_charge_non_negative_check
      CHECK (covered_customer_charge_amount >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hmo_authorizations_covered_insurer_claim_non_negative_check'
  ) THEN
    ALTER TABLE public.hmo_authorizations
      ADD CONSTRAINT hmo_authorizations_covered_insurer_claim_non_negative_check
      CHECK (covered_insurer_claim_amount >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hmo_authorizations_post_coverage_policy_check'
  ) THEN
    ALTER TABLE public.hmo_authorizations
      ADD CONSTRAINT hmo_authorizations_post_coverage_policy_check
      CHECK (post_coverage_policy IN ('service_default', 'explicit_customer_charge', 'manual_block'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hmo_authorizations_post_coverage_customer_charge_non_negative_check'
  ) THEN
    ALTER TABLE public.hmo_authorizations
      ADD CONSTRAINT hmo_authorizations_post_coverage_customer_charge_non_negative_check
      CHECK (post_coverage_customer_charge_amount IS NULL OR post_coverage_customer_charge_amount >= 0);
  END IF;
END $$;



CREATE INDEX IF NOT EXISTS hmo_authorizations_student_id_idx
  ON public.hmo_authorizations (org_id, student_id);

CREATE INDEX IF NOT EXISTS hmo_authorizations_service_id_idx
  ON public.hmo_authorizations (org_id, service_id);

CREATE INDEX IF NOT EXISTS hmo_authorizations_provider_id_idx
  ON public.hmo_authorizations (org_id, provider_id);

CREATE INDEX IF NOT EXISTS hmo_authorizations_provider_track_id_idx
  ON public.hmo_authorizations (org_id, provider_track_id);

DROP INDEX IF EXISTS hmo_authorizations_active_student_service_uidx;

CREATE INDEX IF NOT EXISTS hmo_authorizations_student_service_status_idx
  ON public.hmo_authorizations (org_id, student_id, service_id, status);

-- -----------------------------------------------------------------
-- public.commitments
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  student_id uuid NOT NULL,
  service_id uuid NOT NULL,
  commitment_type text NOT NULL DEFAULT 'package',
  total_amount integer NOT NULL,
  default_charge_amount integer NULL,
  transfer_ref uuid NULL,
  notes text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  metadata jsonb NULL,
  hmo_provider_id uuid NULL,
  hmo_provider_track_id uuid NULL,
  hmo_authorization_id uuid NULL,
  CONSTRAINT commitments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
  CONSTRAINT commitments_service_id_fkey FOREIGN KEY (service_id) REFERENCES public."Services"(id),
  CONSTRAINT commitments_hmo_provider_id_fkey FOREIGN KEY (hmo_provider_id) REFERENCES public.hmo_providers(id) ON DELETE RESTRICT,
  CONSTRAINT commitments_hmo_provider_track_id_fkey FOREIGN KEY (hmo_provider_track_id) REFERENCES public.hmo_provider_tracks(id) ON DELETE RESTRICT,
  CONSTRAINT commitments_hmo_authorization_id_fkey FOREIGN KEY (hmo_authorization_id) REFERENCES public.hmo_authorizations(id),
  CONSTRAINT commitments_commitment_type_check CHECK (commitment_type IN ('package', 'subscription', 'hmo', 'manual_credit')),
  CONSTRAINT commitments_total_amount_non_negative_check CHECK (total_amount >= 0),
  CONSTRAINT commitments_default_charge_amount_non_negative_check CHECK (default_charge_amount IS NULL OR default_charge_amount >= 0)
);



CREATE INDEX IF NOT EXISTS commitments_student_id_idx ON public.commitments (org_id, student_id);
CREATE INDEX IF NOT EXISTS commitments_transfer_ref_idx ON public.commitments (org_id, transfer_ref) WHERE transfer_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS commitments_hmo_provider_id_idx ON public.commitments (org_id, hmo_provider_id) WHERE hmo_provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commitments_hmo_provider_track_id_idx ON public.commitments (org_id, hmo_provider_track_id) WHERE hmo_provider_track_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS commitments_hmo_authorization_id_uidx ON public.commitments (org_id, hmo_authorization_id) WHERE hmo_authorization_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'lesson_participants'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'commitments'
  ) THEN
    ALTER TABLE public.lesson_participants
      ADD CONSTRAINT lesson_participants_commitment_id_fkey
      FOREIGN KEY (commitment_id)
      REFERENCES public.commitments(id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$;

-- -----------------------------------------------------------------
-- public.ledger_transactions (replaces consumption_entries)
-- Double-entry-like ledger: balance = SUM(CREDIT) - SUM(DEBIT)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  client_profile_id uuid NULL,
  student_id uuid NULL,
  commitment_id uuid NULL,
  transaction_type text NOT NULL,
  usage_type text NOT NULL,
  amount integer NOT NULL,
  source_ref uuid NULL,
  invoice_id text NULL,
  invoice_link text NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- v2 ledger compatibility columns kept in base schema for greenfield stability
  ledger_account_id uuid NULL,
  direction text NULL,
  effective_at timestamptz NULL,
  posted_at timestamptz NULL,
  source_type text NULL,
  source_id uuid NULL,
  lesson_instance_id uuid NULL,
  lesson_participant_id uuid NULL,
  hmo_provider_id uuid NULL,
  hmo_authorization_id uuid NULL,
  service_id uuid NULL,
  rate_source text NULL,
  reverses_transaction_id uuid NULL,
  external_reference text NULL,
  posted_at_migrated boolean NULL,
  metadata jsonb NULL,
  CONSTRAINT ledger_transactions_client_profile_id_fkey FOREIGN KEY (client_profile_id) REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  CONSTRAINT ledger_transactions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE,
  CONSTRAINT ledger_transactions_commitment_id_fkey FOREIGN KEY (commitment_id) REFERENCES public.commitments(id) ON DELETE CASCADE,
  CONSTRAINT ledger_transactions_transaction_type_check CHECK (transaction_type IN ('CREDIT', 'DEBIT')),
  CONSTRAINT ledger_transactions_usage_type_check CHECK (
    (transaction_type = 'CREDIT' AND usage_type IN ('manual_topup', 'commitment_creation', 'transfer_received', 'hmo_authorization_added'))
    OR (transaction_type = 'DEBIT' AND usage_type IN ('standard', 'double', 'cross_service', 'manual_adjustment', 'transfer_debit', 'refund'))
  ),
  CONSTRAINT ledger_transactions_amount_non_negative_check CHECK (amount >= 0)
);

ALTER TABLE public.ledger_transactions
  ALTER COLUMN client_profile_id DROP NOT NULL;










-- Drop and recreate usage_type constraint to include transfer_debit and refund DEBIT types.

CREATE INDEX IF NOT EXISTS ledger_transactions_commitment_id_idx
  ON public.ledger_transactions (org_id, commitment_id);
CREATE INDEX IF NOT EXISTS ledger_transactions_client_profile_id_idx
  ON public.ledger_transactions (org_id, client_profile_id);
CREATE INDEX IF NOT EXISTS ledger_transactions_student_id_idx
  ON public.ledger_transactions (org_id, student_id);
CREATE INDEX IF NOT EXISTS ledger_transactions_transaction_type_idx
  ON public.ledger_transactions (org_id, transaction_type);
CREATE INDEX IF NOT EXISTS ledger_transactions_usage_type_idx
  ON public.ledger_transactions (org_id, usage_type);
CREATE INDEX IF NOT EXISTS ledger_transactions_created_at_idx
  ON public.ledger_transactions (org_id, created_at);

-- Trigger: validate that ledger transaction commitment belongs to the same student
CREATE OR REPLACE FUNCTION public.validate_ledger_commitment_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_commitment_student_id uuid;
  v_commitment_client_profile_id uuid;
BEGIN
  IF NEW.client_profile_id IS NULL AND NEW.hmo_provider_id IS NULL THEN
    RAISE EXCEPTION 'ledger_transactions requires client_profile_id or hmo_provider_id';
  END IF;

  IF NEW.commitment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.student_id, s.client_profile_id
    INTO v_commitment_student_id, v_commitment_client_profile_id
  FROM public.commitments c
  LEFT JOIN public.students s ON s.id = c.student_id AND s.org_id = NEW.org_id
  WHERE c.id = NEW.commitment_id
    AND c.org_id = NEW.org_id;

  IF v_commitment_student_id IS NULL THEN
    RAISE EXCEPTION 'Invalid commitment_id for ledger transaction';
  END IF;

  IF NEW.student_id IS NULL OR v_commitment_student_id <> NEW.student_id THEN
    RAISE EXCEPTION 'ledger_transactions.commitment_id must belong to the same student';
  END IF;

  IF v_commitment_client_profile_id IS NULL OR v_commitment_client_profile_id <> NEW.client_profile_id THEN
    RAISE EXCEPTION 'ledger_transactions.commitment_id must belong to the same client profile';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_transactions_validate_commitment_ownership_trg ON public.ledger_transactions;
CREATE TRIGGER ledger_transactions_validate_commitment_ownership_trg
BEFORE INSERT OR UPDATE OF commitment_id, student_id
ON public.ledger_transactions
FOR EACH ROW
EXECUTE FUNCTION public.validate_ledger_commitment_ownership();

-- -----------------------------------------------------------------
-- Query-time balance computation helpers (ledger-based)
-- -----------------------------------------------------------------

-- Returns balance in agorot (integer). amount column is integer since agorot migration.
CREATE OR REPLACE FUNCTION public.get_student_remaining_balance(p_org_id uuid, p_student_id uuid)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_credits bigint := 0;
  v_debits bigint := 0;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(lt.amount), 0)
    INTO v_credits
  FROM public.ledger_transactions lt
  WHERE lt.org_id = p_org_id
    AND lt.student_id = p_student_id
    AND lt.transaction_type = 'CREDIT';

  SELECT COALESCE(SUM(lt.amount), 0)
    INTO v_debits
  FROM public.ledger_transactions lt
  WHERE lt.org_id = p_org_id
    AND lt.student_id = p_student_id
    AND lt.transaction_type = 'DEBIT';

  RETURN v_credits - v_debits;
END;
$$;

-- -----------------------------------------------------------------
-- public.lesson_earnings
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lesson_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  lesson_instance_id uuid NOT NULL,
  rate_used integer NOT NULL,
  payout_amount integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT lesson_earnings_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public."Employees"(id),
  CONSTRAINT lesson_earnings_lesson_instance_id_fkey FOREIGN KEY (lesson_instance_id) REFERENCES public.lesson_instances(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS lesson_earnings_employee_lesson_unique
  ON public.lesson_earnings (org_id, employee_id, lesson_instance_id);


CREATE INDEX IF NOT EXISTS lesson_earnings_employee_id_idx
  ON public.lesson_earnings (org_id, employee_id);

CREATE INDEX IF NOT EXISTS lesson_earnings_lesson_instance_id_idx
  ON public.lesson_earnings (org_id, lesson_instance_id);

-- -----------------------------------------------------------------
-- public.forms
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  description text NULL,
  form_usage text NOT NULL DEFAULT 'general',
  form_schema jsonb NOT NULL,
  alert_rules jsonb NULL,
  visibility_rules jsonb NULL,
  version int NOT NULL DEFAULT 1,
  published_at timestamptz NULL,
  archived_at timestamptz NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NULL,
  CONSTRAINT forms_form_usage_check CHECK (form_usage IN ('general','waiting_list_intake'))
);



UPDATE public.forms
SET form_usage = COALESCE(NULLIF(form_usage, ''), 'general')
WHERE form_usage IS NULL OR form_usage = '';


CREATE INDEX IF NOT EXISTS forms_is_active_idx ON public.forms (org_id, is_active);
CREATE INDEX IF NOT EXISTS forms_form_usage_idx ON public.forms (org_id, form_usage);

-- -----------------------------------------------------------------
-- public.shared_form_blocks
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.shared_form_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  block_type text NOT NULL,
  name text NOT NULL,
  content_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT shared_form_blocks_block_type_check CHECK (block_type IN ('question', 'text'))
);



CREATE INDEX IF NOT EXISTS shared_form_blocks_is_active_idx ON public.shared_form_blocks (org_id, is_active);
CREATE INDEX IF NOT EXISTS shared_form_blocks_block_type_idx ON public.shared_form_blocks (org_id, block_type);

-- -----------------------------------------------------------------
-- public.form_shared_block_links
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.form_shared_block_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  form_id uuid NOT NULL,
  shared_block_id uuid NOT NULL,
  section_id text NOT NULL,
  item_id text NOT NULL,
  schema_scope text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_shared_block_links_schema_scope_check CHECK (schema_scope IN ('draft', 'published')),
  CONSTRAINT form_shared_block_links_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.forms(id) ON DELETE CASCADE,
  CONSTRAINT form_shared_block_links_shared_block_id_fkey FOREIGN KEY (shared_block_id) REFERENCES public.shared_form_blocks(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS form_shared_block_links_unique_form_item_scope
  ON public.form_shared_block_links (org_id, form_id, section_id, item_id, schema_scope);


UPDATE public.form_shared_block_links
SET schema_scope = 'draft'
WHERE schema_scope IS NULL;


DO $$
BEGIN
  ALTER TABLE public.form_shared_block_links
    DROP CONSTRAINT IF EXISTS form_shared_block_links_unique_form_item;
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS form_shared_block_links_form_idx ON public.form_shared_block_links (org_id, form_id);
CREATE INDEX IF NOT EXISTS form_shared_block_links_shared_block_idx ON public.form_shared_block_links (org_id, shared_block_id);
CREATE INDEX IF NOT EXISTS form_shared_block_links_scope_idx ON public.form_shared_block_links (org_id, schema_scope);

-- -----------------------------------------------------------------
-- public.form_submissions
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  form_id uuid NOT NULL,
  client_profile_id uuid NOT NULL,
  student_id uuid NULL,
  answers jsonb NOT NULL,
  alert_flags jsonb NULL,
  otp_metadata jsonb NOT NULL,
  submitted_by_guardian_id uuid NULL,
  source text NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid NULL,
  reviewed_at timestamptz NULL,
  locked_at timestamptz NULL,
  metadata jsonb NULL,
  CONSTRAINT form_submissions_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.forms(id),
  CONSTRAINT form_submissions_client_profile_id_fkey FOREIGN KEY (client_profile_id) REFERENCES public.client_profiles(id),
  CONSTRAINT form_submissions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
  CONSTRAINT form_submissions_submitted_by_guardian_id_fkey FOREIGN KEY (submitted_by_guardian_id) REFERENCES public.guardians(id),
  CONSTRAINT form_submissions_source_check CHECK (source IN ('web','whatsapp','internal','email','sms') OR source IS NULL)
);


CREATE INDEX IF NOT EXISTS form_submissions_form_id_idx
  ON public.form_submissions (org_id, form_id);

CREATE INDEX IF NOT EXISTS form_submissions_client_profile_id_idx
  ON public.form_submissions (org_id, client_profile_id);

CREATE INDEX IF NOT EXISTS form_submissions_student_id_idx
  ON public.form_submissions (org_id, student_id);

CREATE INDEX IF NOT EXISTS form_submissions_submitted_by_guardian_id_idx
  ON public.form_submissions (org_id, submitted_by_guardian_id) WHERE submitted_by_guardian_id IS NOT NULL;

-- -----------------------------------------------------------------
-- public.otp_challenges
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  client_profile_id uuid NOT NULL,
  student_id uuid NULL,
  channel text NOT NULL,
  destination text NOT NULL,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  verified_at timestamptz NULL,
  attempts int NOT NULL DEFAULT 0,
  ip text NULL,
  metadata jsonb NULL,
  CONSTRAINT otp_challenges_client_profile_id_fkey FOREIGN KEY (client_profile_id) REFERENCES public.client_profiles(id),
  CONSTRAINT otp_challenges_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
  CONSTRAINT otp_challenges_channel_check CHECK (channel IN ('whatsapp','email')),
  CONSTRAINT otp_challenges_status_check CHECK (status IN ('pending','verified','expired','cancelled'))
);


CREATE INDEX IF NOT EXISTS otp_challenges_client_profile_id_idx
  ON public.otp_challenges (org_id, client_profile_id);

CREATE INDEX IF NOT EXISTS otp_challenges_student_id_idx
  ON public.otp_challenges (org_id, student_id);

CREATE INDEX IF NOT EXISTS otp_challenges_status_idx
  ON public.otp_challenges (org_id, status);

CREATE INDEX IF NOT EXISTS otp_challenges_expires_at_idx
  ON public.otp_challenges (org_id, expires_at);

-- -----------------------------------------------------------------
-- public.waiting_list_entries
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.waiting_list_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  client_profile_id uuid NOT NULL,
  student_id uuid NULL,
  desired_service_id uuid NOT NULL,
  preferred_days int[] NULL,
  preferred_times jsonb NULL,
  instructor_preferences uuid[] NULL,
  willing_to_pay_premium boolean NOT NULL DEFAULT false,
  priority_flag boolean NOT NULL DEFAULT false,
  priority_reason text NULL,
  notes text NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  latest_submission_id uuid NULL,
  metadata jsonb NULL,
  CONSTRAINT waiting_list_entries_client_profile_id_fkey FOREIGN KEY (client_profile_id) REFERENCES public.client_profiles(id),
  CONSTRAINT waiting_list_entries_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
  CONSTRAINT waiting_list_entries_latest_submission_id_fkey FOREIGN KEY (latest_submission_id) REFERENCES public.form_submissions(id),
  CONSTRAINT waiting_list_entries_desired_service_id_fkey FOREIGN KEY (desired_service_id) REFERENCES public."Services"(id),
  CONSTRAINT waiting_list_entries_status_check CHECK (status IN ('new','open','matched','closed'))
);


CREATE INDEX IF NOT EXISTS waiting_list_entries_client_profile_id_idx
  ON public.waiting_list_entries (org_id, client_profile_id);

CREATE INDEX IF NOT EXISTS waiting_list_entries_student_id_idx
  ON public.waiting_list_entries (org_id, student_id);

CREATE INDEX IF NOT EXISTS waiting_list_entries_status_idx
  ON public.waiting_list_entries (org_id, status);

DO $$
BEGIN
  UPDATE public.form_submissions fs
  SET client_profile_id = s.client_profile_id
  FROM public.students s
  WHERE fs.student_id = s.id
    AND fs.client_profile_id IS NULL;

  UPDATE public.otp_challenges oc
  SET client_profile_id = s.client_profile_id
  FROM public.students s
  WHERE oc.student_id = s.id
    AND oc.client_profile_id IS NULL;

  UPDATE public.waiting_list_entries wle
  SET client_profile_id = s.client_profile_id
  FROM public.students s
  WHERE wle.student_id = s.id
    AND wle.client_profile_id IS NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;




-- -----------------------------------------------------------------
-- public."Settings" (cross-feature configuration)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Settings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "org_id" uuid NOT NULL REFERENCES public.organizations(id),
  "key" text NOT NULL,
  "settings_value" jsonb NOT NULL,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);


DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Settings_key_key'
      AND conrelid = 'public."Settings"'::regclass
  ) THEN
    ALTER TABLE public."Settings" DROP CONSTRAINT "Settings_key_key";
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DROP INDEX IF EXISTS public."Settings_key_key";
DROP INDEX IF EXISTS public.settings_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS settings_org_key_uidx
  ON public."Settings" ("org_id", "key");

INSERT INTO public."Settings" ("org_id", "key", "settings_value")
SELECT
  org.id,
  seed.key,
  seed.settings_value
FROM public.organizations org
CROSS JOIN (
  VALUES
    ('leave_policy', '{"carryover_enabled":false,"carryover_cap_days":null,"holiday_rules":[]}'::jsonb),
    ('leave_pay_policy', '{"default_method":"legal","lookback_months":3,"legal_allow_12m_if_better":true,"fixed_rate_default":0}'::jsonb),
    ('billing_consumption_policy', '{"attended":true,"no_show":false,"cancelled_student":false,"cancelled_clinic":false}'::jsonb),
    ('instructor_earnings_policy', '{"attended":true,"no_show":true,"cancelled_student":false,"cancelled_clinic":false}'::jsonb)
) AS seed(key, settings_value)
ON CONFLICT ("org_id", "key") DO NOTHING;

-- -----------------------------------------------------------------
-- public."Documents" (polymorphic file metadata)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Documents" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "org_id" uuid NOT NULL REFERENCES public.organizations(id),
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "name" text NOT NULL,
  "original_name" text NOT NULL,
  "relevant_date" date,
  "expiration_date" date,
  "resolved" boolean DEFAULT false,
  "url" text,
  "path" text NOT NULL,
  "storage_provider" text,
  "uploaded_at" timestamptz NOT NULL DEFAULT now(),
  "uploaded_by" uuid,
  "definition_id" uuid,
  "definition_name" text,
  "size" bigint,
  "type" text,
  "hash" text,
  "metadata" jsonb
);


-- Drop entity_type CHECK constraint if it exists (moved to UI validation)
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'Documents'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%entity_type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public."Documents" DROP CONSTRAINT IF EXISTS ' || quote_ident(constraint_name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Documents_entity_idx" ON public."Documents" ("org_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "Documents_uploaded_at_idx" ON public."Documents" ("org_id", "uploaded_at");
CREATE INDEX IF NOT EXISTS "Documents_expiration_idx" ON public."Documents" ("org_id", "expiration_date") WHERE "expiration_date" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Documents_hash_idx" ON public."Documents" ("org_id", "hash") WHERE "hash" IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_entity_updated_at_and_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = TG_TABLE_SCHEMA
        AND table_name = TG_TABLE_NAME
        AND column_name = 'updated_at'
    ) THEN
      NEW.updated_at := now();
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = TG_TABLE_SCHEMA
        AND table_name = TG_TABLE_NAME
        AND column_name = 'version'
    ) THEN
      NEW.version := COALESCE(OLD.version, 0) + 1;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_audit_log_expiry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  base_timestamp timestamptz;
BEGIN
  base_timestamp := COALESCE(NEW.created_at, now());
  NEW.created_at := base_timestamp;

  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := CASE COALESCE(NEW.retention_category, 'standard')
      WHEN 'critical' THEN base_timestamp + interval '7 years'
      WHEN 'diagnostic' THEN base_timestamp + interval '90 days'
      ELSE base_timestamp + interval '1 year'
    END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_lesson_instance_locked()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_instance_id uuid;
BEGIN
  target_instance_id := COALESCE(NEW.id, OLD.id);

  IF target_instance_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.instance_locks locked
    WHERE locked.lesson_instance_id = target_instance_id
      AND locked.org_id = COALESCE(NEW.org_id, OLD.org_id)
  ) THEN
    RAISE EXCEPTION 'lesson_instance_locked'
      USING ERRCODE = 'P0001',
            DETAIL = target_instance_id::text,
            HINT = 'Use the correction workflow for locked lesson instances.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_lesson_participant_locked()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_participant_id uuid;
  target_instance_id uuid;
BEGIN
  target_participant_id := COALESCE(NEW.id, OLD.id);
  target_instance_id := COALESCE(NEW.lesson_instance_id, OLD.lesson_instance_id);

  IF target_participant_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.participant_locks locked
    WHERE locked.lesson_participant_id = target_participant_id
      AND locked.org_id = COALESCE(NEW.org_id, OLD.org_id)
  ) THEN
    RAISE EXCEPTION 'lesson_participant_locked'
      USING ERRCODE = 'P0001',
            DETAIL = target_participant_id::text,
            HINT = 'Use the correction workflow for locked lesson participants.';
  END IF;

  IF target_instance_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.instance_locks locked
    WHERE locked.lesson_instance_id = target_instance_id
      AND locked.org_id = COALESCE(NEW.org_id, OLD.org_id)
  ) THEN
    RAISE EXCEPTION 'lesson_instance_locked'
      USING ERRCODE = 'P0001',
            DETAIL = target_instance_id::text,
            HINT = 'Use the correction workflow for locked lesson participants.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_lesson_instance_with_participants(
  p_org_id uuid,
  p_instance_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer DEFAULT NULL,
  p_documentation_status text DEFAULT NULL
)
RETURNS TABLE (
  outcome text,
  instance_version integer,
  instance_metadata jsonb,
  cancelled_participant_ids uuid[],
  attended_participants jsonb,
  cancelled_participant_audit_rows jsonb,
  instance_before_state jsonb,
  instance_after_state jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_instance public.lesson_instances%ROWTYPE;
  v_now timestamptz := now();
  v_base_metadata jsonb := '{}'::jsonb;
  v_next_snapshots jsonb := '{}'::jsonb;
  v_attended_participants jsonb := '[]'::jsonb;
  v_cancelled_participant_ids uuid[] := ARRAY[]::uuid[];
  v_cancelled_participant_audit_rows jsonb := '[]'::jsonb;
  v_billing_policy jsonb := '{"attended":true,"no_show":false,"cancelled_student":false,"cancelled_clinic":false}'::jsonb;
  v_instructor_policy jsonb := '{"attended":true,"no_show":true,"cancelled_student":false,"cancelled_clinic":false}'::jsonb;
  v_instance_before_state jsonb := NULL;
  v_instance_after_state jsonb := NULL;
BEGIN
  SELECT *
  INTO v_instance
  FROM public.lesson_instances
  WHERE id = p_instance_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      'not_found'::text,
      NULL::integer,
      NULL::jsonb,
      ARRAY[]::uuid[],
      '[]'::jsonb,
      '[]'::jsonb,
      NULL::jsonb,
      NULL::jsonb;
    RETURN;
  END IF;

  v_instance_before_state := to_jsonb(v_instance);

  IF p_expected_version IS NOT NULL
    AND COALESCE(v_instance.version, 1) <> p_expected_version THEN
    RETURN QUERY
    SELECT
      'version_conflict'::text,
      COALESCE(v_instance.version, 1)::integer,
      COALESCE(v_instance.metadata, '{}'::jsonb),
      ARRAY[]::uuid[],
      '[]'::jsonb,
      '[]'::jsonb,
      v_instance_before_state,
      v_instance_before_state;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.instance_locks
    WHERE lesson_instance_id = p_instance_id
      AND org_id = p_org_id
      AND lock_source_type IN ('payroll_run', 'claim_batch')
  ) OR EXISTS (
    SELECT 1
    FROM public.participant_locks lock_row
    JOIN public.lesson_participants participant
      ON participant.id = lock_row.lesson_participant_id
    WHERE participant.lesson_instance_id = p_instance_id
      AND participant.org_id = p_org_id
      AND lock_row.lock_source_type IN ('payroll_run', 'claim_batch')
  ) THEN
    RETURN QUERY
    SELECT
      'locked'::text,
      COALESCE(v_instance.version, 1)::integer,
      COALESCE(v_instance.metadata, '{}'::jsonb),
      ARRAY[]::uuid[],
      '[]'::jsonb,
      '[]'::jsonb,
      v_instance_before_state,
      v_instance_before_state;
    RETURN;
  END IF;

  PERFORM 1
  FROM public.lesson_participants
  WHERE lesson_instance_id = p_instance_id
    AND org_id = p_org_id
  FOR UPDATE;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', participant.id,
        'name', COALESCE(
          NULLIF(trim(concat_ws(' ',
            cp.first_name,
            cp.middle_name,
            cp.last_name
          )), ''),
          NULLIF(trim(concat_ws(' ',
            scp.first_name,
            scp.middle_name,
            scp.last_name
          )), ''),
          'לקוח/ה'
        )
      )
    ),
    '[]'::jsonb
  )
  INTO v_attended_participants
  FROM public.lesson_participants participant
  LEFT JOIN public.client_profiles cp
    ON cp.id = participant.client_profile_id
  LEFT JOIN public.students student
    ON student.id = participant.student_id
  LEFT JOIN public.client_profiles scp
    ON scp.id = student.client_profile_id
  WHERE participant.lesson_instance_id = p_instance_id
    AND participant.org_id = p_org_id
    AND participant.participant_status = 'attended';

  IF jsonb_array_length(v_attended_participants) > 0 THEN
    RETURN QUERY
    SELECT
      'attended_conflict'::text,
      COALESCE(v_instance.version, 1)::integer,
      COALESCE(v_instance.metadata, '{}'::jsonb),
      ARRAY[]::uuid[],
      v_attended_participants,
      '[]'::jsonb,
      v_instance_before_state,
      v_instance_before_state;
    RETURN;
  END IF;

  v_base_metadata := COALESCE(v_instance.metadata, '{}'::jsonb);

  SELECT settings_value
  INTO v_billing_policy
  FROM public."Settings"
  WHERE "org_id" = p_org_id
    AND key = 'billing_consumption_policy'
  LIMIT 1;

  IF v_billing_policy IS NULL THEN
    v_billing_policy := '{"attended":true,"no_show":false,"cancelled_student":false,"cancelled_clinic":false}'::jsonb;
  END IF;

  SELECT settings_value
  INTO v_instructor_policy
  FROM public."Settings"
  WHERE "org_id" = p_org_id
    AND key = 'instructor_earnings_policy'
  LIMIT 1;

  IF v_instructor_policy IS NULL THEN
    v_instructor_policy := '{"attended":true,"no_show":true,"cancelled_student":false,"cancelled_clinic":false}'::jsonb;
  END IF;

  WITH participants_before AS (
    SELECT
      participant.id,
      to_jsonb(participant.*) AS before_state
    FROM public.lesson_participants participant
    WHERE participant.lesson_instance_id = p_instance_id
      AND participant.org_id = p_org_id
      AND participant.participant_status = 'scheduled'
    FOR UPDATE
  ),
  updated_participants AS (
    UPDATE public.lesson_participants participant
    SET
      participant_status = 'cancelled_clinic',
      attendance_confirmed_at = v_now,
      attendance_confirmed_by = p_actor_user_id,
      updated_by = p_actor_user_id,
      metadata = COALESCE(participant.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'workflow',
          COALESCE(COALESCE(participant.metadata, '{}'::jsonb)->'workflow', '{}'::jsonb)
            || jsonb_build_object(
              'student_billing',
              COALESCE(COALESCE(participant.metadata, '{}'::jsonb)->'workflow'->'student_billing', '{}'::jsonb)
                || jsonb_build_object(
                  'decision', 'not_applicable',
                  'decided_at', v_now,
                  'decided_by', p_actor_user_id,
                  'reason', 'instance_cancelled'
                ),
              'instructor_compensation',
              COALESCE(COALESCE(participant.metadata, '{}'::jsonb)->'workflow'->'instructor_compensation', '{}'::jsonb)
                || jsonb_build_object(
                  'decision', 'not_compensated',
                  'decided_at', v_now,
                  'decided_by', p_actor_user_id,
                  'reason', 'instance_cancelled'
                ),
              'hmo_claim',
              COALESCE(COALESCE(participant.metadata, '{}'::jsonb)->'workflow'->'hmo_claim', '{}'::jsonb)
                || jsonb_build_object(
                  'decision', 'not_required',
                  'decided_at', v_now,
                  'decided_by', p_actor_user_id,
                  'reason', 'instance_cancelled'
                )
            )
        )
    WHERE participant.id IN (SELECT id FROM participants_before)
    RETURNING participant.id, to_jsonb(participant.*) AS after_state
  )
  SELECT
    COALESCE(array_agg(id), ARRAY[]::uuid[]),
    COALESCE(
      jsonb_object_agg(
        id::text,
        jsonb_build_object(
          'evaluated_at', v_now,
          'participant_status', 'cancelled_clinic',
          'billing_consumption_policy', v_billing_policy,
          'instructor_earnings_policy', v_instructor_policy,
          'instructor_compensation_decision', 'not_compensated'
        )
      ),
      '{}'::jsonb
    ),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'participant_id', updated_participants.id,
          'before_state', participants_before.before_state,
          'after_state', updated_participants.after_state
        )
      ),
      '[]'::jsonb
    )
  INTO v_cancelled_participant_ids, v_next_snapshots, v_cancelled_participant_audit_rows
  FROM updated_participants
  JOIN participants_before
    ON participants_before.id = updated_participants.id;

  UPDATE public.lesson_instances instance
  SET
    status = 'cancelled',
    documentation_status = COALESCE(NULLIF(trim(p_documentation_status), ''), instance.documentation_status),
    metadata = v_base_metadata
      || jsonb_build_object(
        'attendance_resolution_snapshots',
        COALESCE(v_base_metadata->'attendance_resolution_snapshots', '{}'::jsonb) || v_next_snapshots
      ),
    updated_by = p_actor_user_id
  WHERE instance.id = p_instance_id
    AND instance.org_id = p_org_id
  RETURNING instance.version, instance.metadata, to_jsonb(instance.*)
  INTO instance_version, instance_metadata, v_instance_after_state;

  outcome := 'cancelled';
  cancelled_participant_ids := COALESCE(v_cancelled_participant_ids, ARRAY[]::uuid[]);
  attended_participants := '[]'::jsonb;
  cancelled_participant_audit_rows := COALESCE(v_cancelled_participant_audit_rows, '[]'::jsonb);
  instance_before_state := v_instance_before_state;
  instance_after_state := COALESCE(v_instance_after_state, v_instance_before_state);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_lesson_instance_with_participants(
  p_org_id uuid,
  p_instance_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer DEFAULT NULL,
  p_documentation_status text DEFAULT NULL
)
RETURNS TABLE (
  outcome text,
  instance_version integer,
  instance_metadata jsonb,
  promoted_participant_ids uuid[],
  promoted_participant_audit_rows jsonb,
  instance_before_state jsonb,
  instance_after_state jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_instance public.lesson_instances%ROWTYPE;
  v_now timestamptz := now();
  v_base_metadata jsonb := '{}'::jsonb;
  v_next_snapshots jsonb := '{}'::jsonb;
  v_promoted_participant_ids uuid[] := ARRAY[]::uuid[];
  v_promoted_participant_audit_rows jsonb := '[]'::jsonb;
  v_billing_policy jsonb := '{"attended":true,"no_show":false,"cancelled_student":false,"cancelled_clinic":false}'::jsonb;
  v_instructor_policy jsonb := '{"attended":true,"no_show":true,"cancelled_student":false,"cancelled_clinic":false}'::jsonb;
  v_instance_before_state jsonb := NULL;
  v_instance_after_state jsonb := NULL;
BEGIN
  SELECT *
  INTO v_instance
  FROM public.lesson_instances
  WHERE id = p_instance_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      'not_found'::text,
      NULL::integer,
      NULL::jsonb,
      ARRAY[]::uuid[],
      '[]'::jsonb,
      NULL::jsonb,
      NULL::jsonb;
    RETURN;
  END IF;

  v_instance_before_state := to_jsonb(v_instance);

  IF p_expected_version IS NOT NULL
    AND COALESCE(v_instance.version, 1) <> p_expected_version THEN
    RETURN QUERY
    SELECT
      'version_conflict'::text,
      COALESCE(v_instance.version, 1)::integer,
      COALESCE(v_instance.metadata, '{}'::jsonb),
      ARRAY[]::uuid[],
      '[]'::jsonb,
      v_instance_before_state,
      v_instance_before_state;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.instance_locks
    WHERE lesson_instance_id = p_instance_id
      AND org_id = p_org_id
      AND lock_source_type IN ('payroll_run', 'claim_batch')
  ) OR EXISTS (
    SELECT 1
    FROM public.participant_locks lock_row
    JOIN public.lesson_participants participant
      ON participant.id = lock_row.lesson_participant_id
    WHERE participant.lesson_instance_id = p_instance_id
      AND participant.org_id = p_org_id
      AND lock_row.lock_source_type IN ('payroll_run', 'claim_batch')
  ) THEN
    RETURN QUERY
    SELECT
      'locked'::text,
      COALESCE(v_instance.version, 1)::integer,
      COALESCE(v_instance.metadata, '{}'::jsonb),
      ARRAY[]::uuid[],
      '[]'::jsonb,
      v_instance_before_state,
      v_instance_before_state;
    RETURN;
  END IF;

  PERFORM 1
  FROM public.lesson_participants
  WHERE lesson_instance_id = p_instance_id
    AND org_id = p_org_id
  FOR UPDATE;

  v_base_metadata := COALESCE(v_instance.metadata, '{}'::jsonb);

  SELECT settings_value
  INTO v_billing_policy
  FROM public."Settings"
  WHERE "org_id" = p_org_id AND key = 'billing_consumption_policy'
  LIMIT 1;

  IF v_billing_policy IS NULL THEN
    v_billing_policy := '{"attended":true,"no_show":false,"cancelled_student":false,"cancelled_clinic":false}'::jsonb;
  END IF;

  SELECT settings_value
  INTO v_instructor_policy
  FROM public."Settings"
  WHERE "org_id" = p_org_id AND key = 'instructor_earnings_policy'
  LIMIT 1;

  IF v_instructor_policy IS NULL THEN
    v_instructor_policy := '{"attended":true,"no_show":true,"cancelled_student":false,"cancelled_clinic":false}'::jsonb;
  END IF;

  WITH participants_before AS (
    SELECT
      participant.id,
      to_jsonb(participant.*) AS before_state
    FROM public.lesson_participants participant
    WHERE participant.lesson_instance_id = p_instance_id
      AND participant.org_id = p_org_id
      AND participant.participant_status = 'scheduled'
    FOR UPDATE
  ),
  updated_participants AS (
    UPDATE public.lesson_participants participant
    SET
      participant_status = 'attended',
      attendance_confirmed_at = COALESCE(participant.attendance_confirmed_at, v_now),
      attendance_confirmed_by = COALESCE(participant.attendance_confirmed_by, p_actor_user_id),
      updated_by = p_actor_user_id,
      metadata = COALESCE(participant.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'workflow',
          COALESCE(COALESCE(participant.metadata, '{}'::jsonb)->'workflow', '{}'::jsonb)
            || jsonb_build_object(
              'student_billing',
              COALESCE(COALESCE(participant.metadata, '{}'::jsonb)->'workflow'->'student_billing', '{}'::jsonb)
                || jsonb_build_object(
                  'decision', 'pending',
                  'decided_at', v_now,
                  'decided_by', p_actor_user_id,
                  'reason', 'attended'
                ),
              'instructor_compensation',
              COALESCE(COALESCE(participant.metadata, '{}'::jsonb)->'workflow'->'instructor_compensation', '{}'::jsonb)
                || jsonb_build_object(
                  'decision', 'compensated',
                  'decided_at', v_now,
                  'decided_by', p_actor_user_id,
                  'reason', 'attended'
                ),
              'hmo_claim',
              COALESCE(COALESCE(participant.metadata, '{}'::jsonb)->'workflow'->'hmo_claim', '{}'::jsonb)
                || jsonb_build_object(
                  'decision', 'pending',
                  'decided_at', v_now,
                  'decided_by', p_actor_user_id,
                  'reason', 'attended'
                )
            )
        )
    WHERE participant.id IN (SELECT id FROM participants_before)
    RETURNING participant.id, to_jsonb(participant.*) AS after_state
  )
  SELECT
    COALESCE(array_agg(id), ARRAY[]::uuid[]),
    COALESCE(
      jsonb_object_agg(
        id::text,
        jsonb_build_object(
          'evaluated_at', v_now,
          'participant_status', 'attended',
          'billing_consumption_policy', v_billing_policy,
          'instructor_earnings_policy', v_instructor_policy,
          'instructor_compensation_decision', 'compensated'
        )
      ),
      '{}'::jsonb
    ),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'participant_id', updated_participants.id,
          'before_state', participants_before.before_state,
          'after_state', updated_participants.after_state
        )
      ),
      '[]'::jsonb
    )
  INTO v_promoted_participant_ids, v_next_snapshots, v_promoted_participant_audit_rows
  FROM updated_participants
  JOIN participants_before
    ON participants_before.id = updated_participants.id;

  UPDATE public.lesson_instances instance
  SET
    status = 'completed',
    documentation_status = COALESCE(NULLIF(trim(p_documentation_status), ''), instance.documentation_status),
    metadata = v_base_metadata
      || jsonb_build_object(
        'attendance_resolution_snapshots',
        COALESCE(v_base_metadata->'attendance_resolution_snapshots', '{}'::jsonb) || v_next_snapshots
      ),
    updated_by = p_actor_user_id
  WHERE instance.id = p_instance_id
    AND instance.org_id = p_org_id
  RETURNING instance.version, instance.metadata, to_jsonb(instance.*)
  INTO instance_version, instance_metadata, v_instance_after_state;

  outcome := 'completed';
  promoted_participant_ids := COALESCE(v_promoted_participant_ids, ARRAY[]::uuid[]);
  promoted_participant_audit_rows := COALESCE(v_promoted_participant_audit_rows, '[]'::jsonb);
  instance_before_state := v_instance_before_state;
  instance_after_state := COALESCE(v_instance_after_state, v_instance_before_state);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_selected_scheduled_participants_and_reconcile_instance(
  p_org_id uuid,
  p_instance_id uuid,
  p_participant_ids uuid[],
  p_actor_user_id uuid
)
RETURNS TABLE (
  outcome text,
  instance_version integer,
  instance_status text,
  instance_metadata jsonb,
  cancelled_participant_ids uuid[],
  cancelled_participant_audit_rows jsonb,
  blocking_participants jsonb,
  instance_before_state jsonb,
  instance_after_state jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_instance public.lesson_instances%ROWTYPE;
  v_now timestamptz := now();
  v_base_metadata jsonb := '{}'::jsonb;
  v_next_snapshots jsonb := '{}'::jsonb;
  v_cancelled_participant_ids uuid[] := ARRAY[]::uuid[];
  v_cancelled_participant_audit_rows jsonb := '[]'::jsonb;
  v_blocking_participants jsonb := '[]'::jsonb;
  v_billing_policy jsonb := '{"attended":true,"no_show":false,"cancelled_student":false,"cancelled_clinic":false}'::jsonb;
  v_instructor_policy jsonb := '{"attended":true,"no_show":true,"cancelled_student":false,"cancelled_clinic":false}'::jsonb;
  v_has_scheduled boolean := false;
  v_has_attended boolean := false;
  v_next_status text := 'scheduled';
  v_instance_before_state jsonb := NULL;
  v_instance_after_state jsonb := NULL;
BEGIN
  SELECT *
  INTO v_instance
  FROM public.lesson_instances
  WHERE id = p_instance_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      'not_found'::text,
      NULL::integer,
      NULL::text,
      NULL::jsonb,
      ARRAY[]::uuid[],
      '[]'::jsonb,
      '[]'::jsonb,
      NULL::jsonb,
      NULL::jsonb;
    RETURN;
  END IF;

  v_instance_before_state := to_jsonb(v_instance);

  IF EXISTS (
    SELECT 1
    FROM public.instance_locks
    WHERE lesson_instance_id = p_instance_id
      AND org_id = p_org_id
      AND lock_source_type IN ('payroll_run', 'claim_batch')
  ) OR EXISTS (
    SELECT 1
    FROM public.participant_locks lock_row
    JOIN public.lesson_participants participant
      ON participant.id = lock_row.lesson_participant_id
    WHERE participant.lesson_instance_id = p_instance_id
      AND participant.org_id = p_org_id
      AND lock_row.lock_source_type IN ('payroll_run', 'claim_batch')
  ) THEN
    RETURN QUERY
    SELECT
      'locked'::text,
      COALESCE(v_instance.version, 1)::integer,
      normalize_lesson_instance_status(v_instance.status)::text,
      COALESCE(v_instance.metadata, '{}'::jsonb),
      ARRAY[]::uuid[],
      '[]'::jsonb,
      '[]'::jsonb,
      v_instance_before_state,
      v_instance_before_state;
    RETURN;
  END IF;

  PERFORM 1
  FROM public.lesson_participants
  WHERE lesson_instance_id = p_instance_id
    AND org_id = p_org_id
  FOR UPDATE;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', participant.id,
        'participant_status', participant.participant_status,
        'name', COALESCE(
          NULLIF(trim(concat_ws(' ',
            cp.first_name,
            cp.middle_name,
            cp.last_name
          )), ''),
          NULLIF(trim(concat_ws(' ',
            scp.first_name,
            scp.middle_name,
            scp.last_name
          )), ''),
          'לקוח/ה'
        )
      )
    ),
    '[]'::jsonb
  )
  INTO v_blocking_participants
  FROM public.lesson_participants participant
  LEFT JOIN public.client_profiles cp
    ON cp.id = participant.client_profile_id
  LEFT JOIN public.students student
    ON student.id = participant.student_id
  LEFT JOIN public.client_profiles scp
    ON scp.id = student.client_profile_id
  WHERE participant.lesson_instance_id = p_instance_id
    AND participant.org_id = p_org_id
    AND participant.id = ANY(COALESCE(p_participant_ids, ARRAY[]::uuid[]))
    AND participant.participant_status <> 'scheduled';

  IF jsonb_array_length(v_blocking_participants) > 0 THEN
    RETURN QUERY
    SELECT
      'participant_status_conflict'::text,
      COALESCE(v_instance.version, 1)::integer,
      normalize_lesson_instance_status(v_instance.status)::text,
      COALESCE(v_instance.metadata, '{}'::jsonb),
      ARRAY[]::uuid[],
      '[]'::jsonb,
      v_blocking_participants,
      v_instance_before_state,
      v_instance_before_state;
    RETURN;
  END IF;

  v_base_metadata := COALESCE(v_instance.metadata, '{}'::jsonb);

  SELECT settings_value
  INTO v_billing_policy
  FROM public."Settings"
  WHERE "org_id" = p_org_id AND key = 'billing_consumption_policy'
  LIMIT 1;

  IF v_billing_policy IS NULL THEN
    v_billing_policy := '{"attended":true,"no_show":false,"cancelled_student":false,"cancelled_clinic":false}'::jsonb;
  END IF;

  SELECT settings_value
  INTO v_instructor_policy
  FROM public."Settings"
  WHERE "org_id" = p_org_id AND key = 'instructor_earnings_policy'
  LIMIT 1;

  IF v_instructor_policy IS NULL THEN
    v_instructor_policy := '{"attended":true,"no_show":true,"cancelled_student":false,"cancelled_clinic":false}'::jsonb;
  END IF;

  WITH participants_before AS (
    SELECT
      participant.id,
      to_jsonb(participant.*) AS before_state
    FROM public.lesson_participants participant
    WHERE participant.lesson_instance_id = p_instance_id
      AND participant.org_id = p_org_id
      AND participant.id = ANY(COALESCE(p_participant_ids, ARRAY[]::uuid[]))
      AND participant.participant_status = 'scheduled'
    FOR UPDATE
  ),
  updated_participants AS (
    UPDATE public.lesson_participants participant
    SET
      participant_status = 'cancelled_student',
      attendance_confirmed_at = v_now,
      attendance_confirmed_by = p_actor_user_id,
      updated_by = p_actor_user_id,
      metadata = COALESCE(participant.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'workflow',
          COALESCE(COALESCE(participant.metadata, '{}'::jsonb)->'workflow', '{}'::jsonb)
            || jsonb_build_object(
              'student_billing',
              COALESCE(COALESCE(participant.metadata, '{}'::jsonb)->'workflow'->'student_billing', '{}'::jsonb)
                || jsonb_build_object(
                  'decision', 'pending',
                  'decided_at', v_now,
                  'decided_by', p_actor_user_id,
                  'reason', 'cancelled_student'
                ),
              'instructor_compensation',
              COALESCE(COALESCE(participant.metadata, '{}'::jsonb)->'workflow'->'instructor_compensation', '{}'::jsonb)
                || jsonb_build_object(
                  'decision', 'not_compensated',
                  'decided_at', v_now,
                  'decided_by', p_actor_user_id,
                  'reason', 'student_suspension_bulk_cancel'
                ),
              'hmo_claim',
              COALESCE(COALESCE(participant.metadata, '{}'::jsonb)->'workflow'->'hmo_claim', '{}'::jsonb)
                || jsonb_build_object(
                  'decision', 'not_required',
                  'decided_at', v_now,
                  'decided_by', p_actor_user_id,
                  'reason', 'cancelled_student'
                )
            )
        )
    WHERE participant.id IN (SELECT id FROM participants_before)
    RETURNING participant.id, to_jsonb(participant.*) AS after_state
  )
  SELECT
    COALESCE(array_agg(id), ARRAY[]::uuid[]),
    COALESCE(
      jsonb_object_agg(
        id::text,
        jsonb_build_object(
          'evaluated_at', v_now,
          'participant_status', 'cancelled_student',
          'billing_consumption_policy', v_billing_policy,
          'instructor_earnings_policy', v_instructor_policy,
          'instructor_compensation_decision', 'not_compensated'
        )
      ),
      '{}'::jsonb
    ),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'participant_id', updated_participants.id,
          'before_state', participants_before.before_state,
          'after_state', updated_participants.after_state
        )
      ),
      '[]'::jsonb
    )
  INTO v_cancelled_participant_ids, v_next_snapshots, v_cancelled_participant_audit_rows
  FROM updated_participants
  JOIN participants_before
    ON participants_before.id = updated_participants.id;

  IF cardinality(COALESCE(v_cancelled_participant_ids, ARRAY[]::uuid[])) = 0 THEN
    RETURN QUERY
    SELECT
      'no_target_participants'::text,
      COALESCE(v_instance.version, 1)::integer,
      normalize_lesson_instance_status(v_instance.status)::text,
      COALESCE(v_instance.metadata, '{}'::jsonb),
      ARRAY[]::uuid[],
      '[]'::jsonb,
      '[]'::jsonb,
      v_instance_before_state,
      v_instance_before_state;
    RETURN;
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.lesson_participants
      WHERE lesson_instance_id = p_instance_id
        AND org_id = p_org_id
        AND participant_status = 'scheduled'
    ),
    EXISTS (
      SELECT 1
      FROM public.lesson_participants
      WHERE lesson_instance_id = p_instance_id
        AND org_id = p_org_id
        AND participant_status = 'attended'
    )
  INTO v_has_scheduled, v_has_attended;

  IF v_has_scheduled THEN
    v_next_status := 'scheduled';
  ELSIF v_has_attended THEN
    v_next_status := 'completed';
  ELSE
    v_next_status := 'cancelled';
  END IF;

  UPDATE public.lesson_instances instance
  SET
    status = v_next_status,
    metadata = v_base_metadata
      || jsonb_build_object(
        'attendance_resolution_snapshots',
        COALESCE(v_base_metadata->'attendance_resolution_snapshots', '{}'::jsonb) || v_next_snapshots
      ),
    updated_by = p_actor_user_id
  WHERE instance.id = p_instance_id
    AND instance.org_id = p_org_id
  RETURNING instance.version, instance.metadata, instance.status, to_jsonb(instance.*)
  INTO instance_version, instance_metadata, instance_status, v_instance_after_state;

  outcome := 'updated';
  instance_status := normalize_lesson_instance_status(instance_status);
  cancelled_participant_ids := COALESCE(v_cancelled_participant_ids, ARRAY[]::uuid[]);
  cancelled_participant_audit_rows := COALESCE(v_cancelled_participant_audit_rows, '[]'::jsonb);
  blocking_participants := '[]'::jsonb;
  instance_before_state := v_instance_before_state;
  instance_after_state := COALESCE(v_instance_after_state, v_instance_before_state);
  RETURN NEXT;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_employee_attendance_records_set_updated_at_version'
      AND tgrelid = 'public.employee_attendance_records'::regclass
  ) THEN
    CREATE TRIGGER trg_employee_attendance_records_set_updated_at_version
      BEFORE UPDATE ON public.employee_attendance_records
      FOR EACH ROW
      EXECUTE FUNCTION public.set_entity_updated_at_and_version();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_finance_corrections_set_updated_at_version'
      AND tgrelid = 'public.finance_corrections'::regclass
  ) THEN
    CREATE TRIGGER trg_finance_corrections_set_updated_at_version
      BEFORE UPDATE ON public.finance_corrections
      FOR EACH ROW
      EXECUTE FUNCTION public.set_entity_updated_at_and_version();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_lesson_instances_guard_locked'
      AND tgrelid = 'public.lesson_instances'::regclass
  ) THEN
    CREATE TRIGGER trg_lesson_instances_guard_locked
      BEFORE UPDATE OR DELETE ON public.lesson_instances
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_lesson_instance_locked();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_lesson_instances_set_updated_at_version'
      AND tgrelid = 'public.lesson_instances'::regclass
  ) THEN
    CREATE TRIGGER trg_lesson_instances_set_updated_at_version
      BEFORE UPDATE ON public.lesson_instances
      FOR EACH ROW
      EXECUTE FUNCTION public.set_entity_updated_at_and_version();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_lesson_participants_guard_locked'
      AND tgrelid = 'public.lesson_participants'::regclass
  ) THEN
    CREATE TRIGGER trg_lesson_participants_guard_locked
      BEFORE UPDATE OR DELETE ON public.lesson_participants
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_lesson_participant_locked();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_lesson_participants_set_updated_at_version'
      AND tgrelid = 'public.lesson_participants'::regclass
  ) THEN
    CREATE TRIGGER trg_lesson_participants_set_updated_at_version
      BEFORE UPDATE ON public.lesson_participants
      FOR EACH ROW
      EXECUTE FUNCTION public.set_entity_updated_at_and_version();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_payroll_runs_set_updated_at_version'
      AND tgrelid = 'public.payroll_runs'::regclass
  ) THEN
    CREATE TRIGGER trg_payroll_runs_set_updated_at_version
      BEFORE UPDATE ON public.payroll_runs
      FOR EACH ROW
      EXECUTE FUNCTION public.set_entity_updated_at_and_version();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_claim_batches_set_updated_at_version'
      AND tgrelid = 'public.claim_batches'::regclass
  ) THEN
    CREATE TRIGGER trg_claim_batches_set_updated_at_version
      BEFORE UPDATE ON public.claim_batches
      FOR EACH ROW
      EXECUTE FUNCTION public.set_entity_updated_at_and_version();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_calendar_instance_corrections_set_updated_at_version'
      AND tgrelid = 'public.calendar_instance_corrections'::regclass
  ) THEN
    CREATE TRIGGER trg_calendar_instance_corrections_set_updated_at_version
      BEFORE UPDATE ON public.calendar_instance_corrections
      FOR EACH ROW
      EXECUTE FUNCTION public.set_entity_updated_at_and_version();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_dashboard_tasks_set_updated_at_version'
      AND tgrelid = 'public.dashboard_tasks'::regclass
  ) THEN
    CREATE TRIGGER trg_dashboard_tasks_set_updated_at_version
      BEFORE UPDATE ON public.dashboard_tasks
      FOR EACH ROW
      EXECUTE FUNCTION public.set_entity_updated_at_and_version();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_audit_log_set_expiry'
      AND tgrelid = 'public.audit_log'::regclass
  ) THEN
    CREATE TRIGGER trg_audit_log_set_expiry
      BEFORE INSERT ON public.audit_log
      FOR EACH ROW
      EXECUTE FUNCTION public.set_audit_log_expiry();
  END IF;
END $$;

-- =================================================================
-- Tenant Public Domain Tables — RLS + Diagnostics
-- =================================================================

-- Add indexes for payroll tables
CREATE INDEX IF NOT EXISTS "RateHistory_employee_service_idx" ON public."RateHistory" ("org_id", "employee_id", "service_id", "effective_date");
CREATE INDEX IF NOT EXISTS hmo_providers_is_active_idx ON public.hmo_providers (org_id, is_active);
CREATE INDEX IF NOT EXISTS hmo_provider_tracks_is_active_idx ON public.hmo_provider_tracks (org_id, is_active);
CREATE INDEX IF NOT EXISTS hmo_authorizations_status_idx ON public.hmo_authorizations (org_id, status);
CREATE INDEX IF NOT EXISTS employee_leave_entries_status_idx ON public.employee_leave_entries (org_id, status);
CREATE INDEX IF NOT EXISTS employee_leave_days_date_idx ON public.employee_leave_days (org_id, leave_date);
CREATE INDEX IF NOT EXISTS finance_corrections_type_idx ON public.finance_corrections (org_id, correction_type);
CREATE INDEX IF NOT EXISTS payroll_runs_status_idx ON public.payroll_runs (org_id, status, finalized_at);
CREATE INDEX IF NOT EXISTS claim_batches_status_idx ON public.claim_batches (org_id, status, paid_at);
CREATE INDEX IF NOT EXISTS dashboard_tasks_resource_idx ON public.dashboard_tasks (org_id, resource_type, resource_id, status);

-- =================================================================
-- RLS Helper Functions (SECURITY DEFINER)
-- Must be defined BEFORE any RLS policy that references them.
-- =================================================================

-- get_active_org_id()
-- Reads the x-org-id header injected by the frontend Supabase client,
-- validates that the authenticated user is a member of that org, and
-- returns the org UUID. Used as the single gatekeeper in all tenant
-- RLS policies: WHERE org_id = get_active_org_id().
--
-- Raises an exception (→ denies all rows) when:
--   • The header is missing or not a valid UUID
--   • The caller is not authenticated
--   • The authenticated user is not a member of the requested org
CREATE OR REPLACE FUNCTION public.get_active_org_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text;
  v_org_id uuid;
BEGIN
  -- Extract x-org-id from PostgREST request headers
  v_raw := current_setting('request.headers', true)::json->>'x-org-id';

  IF v_raw IS NULL OR v_raw = '' THEN
    RAISE EXCEPTION 'missing_org_id: x-org-id header is required';
  END IF;

  BEGIN
    v_org_id := v_raw::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_org_id: x-org-id header is not a valid UUID';
  END;

  -- Verify the caller is a member of the requested org
  IF NOT EXISTS (
    SELECT 1
    FROM public.org_memberships
    WHERE org_id = v_org_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden: user is not a member of org %', v_org_id;
  END IF;

  RETURN v_org_id;
END;
$$;

-- get_my_org_ids()
-- Returns the set of org UUIDs the authenticated user belongs to.
-- Used for multi-org list views (e.g., org switcher) and control-
-- table RLS policies that need "show all my orgs" semantics.
CREATE OR REPLACE FUNCTION public.get_my_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id
  FROM public.org_memberships
  WHERE user_id = auth.uid();
$$;

-- Enable RLS on control tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- =================================================================
-- RLS Policies — Control Tables
-- These use INLINE subqueries (no function calls) to avoid infinite
-- recursion, since get_active_org_id() itself queries org_memberships.
-- =================================================================

-- org_memberships: users see only their own memberships
DROP POLICY IF EXISTS "org_memberships_select" ON public.org_memberships;
CREATE POLICY "org_memberships_select"
  ON public.org_memberships FOR SELECT
  TO authenticated, app_user
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "org_memberships_insert" ON public.org_memberships;
CREATE POLICY "org_memberships_insert"
  ON public.org_memberships FOR INSERT
  TO authenticated, app_user
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "org_memberships_update" ON public.org_memberships;
CREATE POLICY "org_memberships_update"
  ON public.org_memberships FOR UPDATE
  TO authenticated, app_user
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "org_memberships_delete" ON public.org_memberships;
CREATE POLICY "org_memberships_delete"
  ON public.org_memberships FOR DELETE
  TO authenticated, app_user
  USING (user_id = auth.uid());

-- organizations: users see orgs they belong to
DROP POLICY IF EXISTS "organizations_select" ON public.organizations;
CREATE POLICY "organizations_select"
  ON public.organizations FOR SELECT
  TO authenticated, app_user
  USING (id IN (SELECT org_id FROM public.org_memberships WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "organizations_insert" ON public.organizations;
CREATE POLICY "organizations_insert"
  ON public.organizations FOR INSERT
  TO authenticated, app_user
  WITH CHECK (true);

DROP POLICY IF EXISTS "organizations_update" ON public.organizations;
CREATE POLICY "organizations_update"
  ON public.organizations FOR UPDATE
  TO authenticated, app_user
  USING (id IN (SELECT org_id FROM public.org_memberships WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "organizations_delete" ON public.organizations;
CREATE POLICY "organizations_delete"
  ON public.organizations FOR DELETE
  TO authenticated, app_user
  USING (id IN (SELECT org_id FROM public.org_memberships WHERE user_id = auth.uid()));

-- profiles: users see only their own profile
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT
  TO authenticated, app_user
  USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_insert"
  ON public.profiles FOR INSERT
  TO authenticated, app_user
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update"
  ON public.profiles FOR UPDATE
  TO authenticated, app_user
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Prevent is_system_admin from being changed via the API.
-- The WITH CHECK ensures the new value must equal the existing DB value,
-- so only direct Postgres superuser access can modify this flag.
DROP POLICY IF EXISTS "profiles_no_self_admin_upgrade" ON public.profiles;
CREATE POLICY "profiles_no_self_admin_upgrade"
  ON public.profiles FOR UPDATE
  TO authenticated, app_user
  USING (id = auth.uid())
  WITH CHECK (
    is_system_admin = (SELECT p.is_system_admin FROM public.profiles p WHERE p.id = auth.uid())
    AND can_create_organizations = (SELECT p.can_create_organizations FROM public.profiles p WHERE p.id = auth.uid())
    AND max_owned_organizations IS NOT DISTINCT FROM (SELECT p.max_owned_organizations FROM public.profiles p WHERE p.id = auth.uid())
  );

DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;
CREATE POLICY "profiles_delete"
  ON public.profiles FOR DELETE
  TO authenticated, app_user
  USING (id = auth.uid());

-- org_invitations: members of the org OR the invited email can see
DROP POLICY IF EXISTS "org_invitations_select" ON public.org_invitations;
CREATE POLICY "org_invitations_select"
  ON public.org_invitations FOR SELECT
  TO authenticated, app_user
  USING (
    org_id IN (SELECT om.org_id FROM public.org_memberships om WHERE om.user_id = auth.uid())
    OR email = auth.jwt()->>'email'
  );

DROP POLICY IF EXISTS "org_invitations_insert" ON public.org_invitations;
CREATE POLICY "org_invitations_insert"
  ON public.org_invitations FOR INSERT
  TO authenticated, app_user
  WITH CHECK (
    org_id IN (SELECT om.org_id FROM public.org_memberships om WHERE om.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "org_invitations_update" ON public.org_invitations;
CREATE POLICY "org_invitations_update"
  ON public.org_invitations FOR UPDATE
  TO authenticated, app_user
  USING (
    org_id IN (SELECT om.org_id FROM public.org_memberships om WHERE om.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "org_invitations_delete" ON public.org_invitations;
CREATE POLICY "org_invitations_delete"
  ON public.org_invitations FOR DELETE
  TO authenticated, app_user
  USING (
    org_id IN (SELECT om.org_id FROM public.org_memberships om WHERE om.user_id = auth.uid())
  );

-- permission_registry: read-only reference data, visible to all authenticated users
DROP POLICY IF EXISTS "permission_registry_select" ON public.permission_registry;
CREATE POLICY "permission_registry_select"
  ON public.permission_registry FOR SELECT
  TO authenticated, app_user
  USING (true);

-- No INSERT/UPDATE/DELETE policies for permission_registry (admin-only via service_role)

-- active_routing: users see/manage only their own routing row
DROP POLICY IF EXISTS "active_routing_select" ON public.active_routing;
CREATE POLICY "active_routing_select"
  ON public.active_routing FOR SELECT
  TO authenticated, app_user
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "active_routing_insert" ON public.active_routing;
CREATE POLICY "active_routing_insert"
  ON public.active_routing FOR INSERT
  TO authenticated, app_user
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "active_routing_update" ON public.active_routing;
CREATE POLICY "active_routing_update"
  ON public.active_routing FOR UPDATE
  TO authenticated, app_user
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "active_routing_delete" ON public.active_routing;
CREATE POLICY "active_routing_delete"
  ON public.active_routing FOR DELETE
  TO authenticated, app_user
  USING (user_id = auth.uid());

-- audit_log: system admins can read all rows; regular users only see their org's entries.
DROP POLICY IF EXISTS "audit_log_select_admin" ON public.audit_log;
CREATE POLICY "audit_log_select_admin"
  ON public.audit_log FOR SELECT
  TO authenticated, app_user
  USING (
    (SELECT p.is_system_admin FROM public.profiles p WHERE p.id = auth.uid())
  );

DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select"
  ON public.audit_log FOR SELECT
  TO authenticated, app_user
  USING (
    org_id IS NOT NULL
    AND org_id IN (SELECT om.org_id FROM public.org_memberships om WHERE om.user_id = auth.uid())
  );

-- audit_log INSERT: users may only write tenant-scoped entries (org_id must be non-null
-- and must be one of their orgs). They cannot inject system-admin-scoped events
-- (NULL org_id) or events with reserved event_type prefixes.
DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
CREATE POLICY "audit_log_insert"
  ON public.audit_log FOR INSERT
  TO authenticated, app_user
  WITH CHECK (
    org_id IS NOT NULL
    AND org_id IN (SELECT om.org_id FROM public.org_memberships om WHERE om.user_id = auth.uid())
    AND event_type NOT LIKE 'system_admin.%'
    AND event_type NOT LIKE 'impersonation.%'
    AND event_type NOT LIKE 'admin.%'
  );

-- No UPDATE/DELETE policies for audit_log (append-only; service_role handles all writes)

-- impersonation_sessions: only system admins may read via JWT; all writes go through
-- service_role (which bypasses RLS). No user-facing access at all.
DROP POLICY IF EXISTS "impersonation_sessions_select_admin" ON public.impersonation_sessions;
CREATE POLICY "impersonation_sessions_select_admin"
  ON public.impersonation_sessions FOR SELECT
  TO authenticated, app_user
  USING (
    (SELECT p.is_system_admin FROM public.profiles p WHERE p.id = auth.uid())
  );

-- Enable RLS on all tables (both domain and payroll)
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RateHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hmo_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hmo_provider_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hmo_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_leave_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_leave_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_leave_balance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instance_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_instance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_service_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_template_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grace_cancellation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_form_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_shared_block_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiting_list_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Documents" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  ops text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE'];
  op text;
  pol text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'students',
    'guardians',
    'client_profiles',
    'client_guardians',
    'Employees',
    'Services',
    'RateHistory',
    'hmo_providers',
    'hmo_provider_tracks',
    'hmo_authorizations',
    'employee_attendance_records',
    'employee_leave_entries',
    'employee_leave_days',
    'employee_leave_balance_events',
    'finance_corrections',
    'payroll_runs',
    'claim_batches',
    'instance_locks',
    'participant_locks',
    'calendar_instance_corrections',
    'dashboard_tasks',
    'instructor_profiles',
    'instructor_service_capabilities',
    'lesson_templates',
    'lesson_template_overrides',
    'lesson_instances',
    'lesson_participants',
    'grace_cancellation_requests',
    'commitments',
    'ledger_transactions',
    'lesson_earnings',
    'forms',
    'shared_form_blocks',
    'form_shared_block_links',
    'form_submissions',
    'otp_challenges',
    'waiting_list_entries',
    'Settings',
    'Documents'
  ]
  LOOP
    -- Drop the old permissive "USING (true)" policy if it exists
    EXECUTE 'DROP POLICY IF EXISTS '
      || quote_ident(left('Allow full access to authenticated users on ' || tbl, 63))
      || ' ON public.' || quote_ident(tbl);

    FOREACH op IN ARRAY ops
    LOOP
      pol := left('tenant_' || lower(op) || '_' || tbl, 63);
      EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(pol) || ' ON public.' || quote_ident(tbl);

      IF op = 'SELECT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated, app_user USING (org_id = get_active_org_id())',
          pol, tbl);
      ELSIF op = 'INSERT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated, app_user WITH CHECK (org_id = get_active_org_id())',
          pol, tbl);
      ELSE  -- UPDATE / DELETE
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR %s TO authenticated, app_user USING (org_id = get_active_org_id())',
          pol, tbl, op);
        IF op = 'UPDATE' THEN
          -- Also enforce WITH CHECK on UPDATE to prevent changing org_id
          EXECUTE format(
            'ALTER POLICY %I ON public.%I WITH CHECK (org_id = get_active_org_id())',
            pol, tbl);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT EXECUTE ON FUNCTION public.get_active_org_id() TO authenticated, app_user;
GRANT EXECUTE ON FUNCTION public.get_my_org_ids() TO authenticated, app_user;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile_exists(text, text, text, text) TO authenticated, app_user;
GRANT EXECUTE ON FUNCTION public.create_organization(text) TO authenticated, app_user;
GRANT EXECUTE ON FUNCTION public.cancel_lesson_instance_with_participants(uuid, uuid, uuid, integer, text) TO app_user;
GRANT EXECUTE ON FUNCTION public.complete_lesson_instance_with_participants(uuid, uuid, uuid, integer, text) TO app_user;
GRANT EXECUTE ON FUNCTION public.cancel_selected_scheduled_participants_and_reconcile_instance(uuid, uuid, uuid[], uuid) TO app_user;
REVOKE EXECUTE ON FUNCTION public.cancel_lesson_instance_with_participants(uuid, uuid, uuid, integer, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_lesson_instance_with_participants(uuid, uuid, uuid, integer, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_selected_scheduled_participants_and_reconcile_instance(uuid, uuid, uuid[], uuid) FROM authenticated;

-- Grants for control tables
GRANT ALL ON TABLE public.organizations TO app_user;
GRANT ALL ON TABLE public.profiles TO app_user;
GRANT ALL ON TABLE public.org_memberships TO app_user;
GRANT ALL ON TABLE public.org_invitations TO app_user;
GRANT ALL ON TABLE public.permission_registry TO app_user;
GRANT ALL ON TABLE public.active_routing TO app_user;

GRANT ALL ON TABLE public.students TO app_user;
GRANT ALL ON TABLE public.guardians TO app_user;
GRANT ALL ON TABLE public.client_profiles TO app_user;
GRANT ALL ON TABLE public.client_guardians TO app_user;
GRANT ALL ON TABLE public."Employees" TO app_user;
GRANT ALL ON TABLE public."Services" TO app_user;
GRANT ALL ON TABLE public."RateHistory" TO app_user;
GRANT ALL ON TABLE public.hmo_providers TO app_user;
GRANT ALL ON TABLE public.hmo_provider_tracks TO app_user;
GRANT ALL ON TABLE public.hmo_authorizations TO app_user;
GRANT ALL ON TABLE public.employee_attendance_records TO app_user;
GRANT ALL ON TABLE public.employee_leave_entries TO app_user;
GRANT ALL ON TABLE public.employee_leave_days TO app_user;
GRANT ALL ON TABLE public.employee_leave_balance_events TO app_user;
GRANT ALL ON TABLE public.finance_corrections TO app_user;
GRANT ALL ON TABLE public.payroll_runs TO app_user;
GRANT ALL ON TABLE public.claim_batches TO app_user;
GRANT ALL ON TABLE public.instance_locks TO app_user;
GRANT ALL ON TABLE public.participant_locks TO app_user;
GRANT ALL ON TABLE public.calendar_instance_corrections TO app_user;
GRANT ALL ON TABLE public.audit_log TO app_user;
GRANT ALL ON TABLE public.impersonation_sessions TO app_user;
GRANT ALL ON TABLE public.dashboard_tasks TO app_user;
GRANT ALL ON TABLE public.instructor_profiles TO app_user;
GRANT ALL ON TABLE public.instructor_service_capabilities TO app_user;
GRANT ALL ON TABLE public.lesson_templates TO app_user;
GRANT ALL ON TABLE public.lesson_template_overrides TO app_user;
GRANT ALL ON TABLE public.lesson_instances TO app_user;
GRANT ALL ON TABLE public.lesson_participants TO app_user;
GRANT ALL ON TABLE public.grace_cancellation_requests TO app_user;
GRANT ALL ON TABLE public.commitments TO app_user;
GRANT ALL ON TABLE public.ledger_transactions TO app_user;
GRANT ALL ON TABLE public.lesson_earnings TO app_user;
GRANT ALL ON TABLE public.forms TO app_user;
GRANT ALL ON TABLE public.shared_form_blocks TO app_user;
GRANT ALL ON TABLE public.form_shared_block_links TO app_user;
GRANT ALL ON TABLE public.form_submissions TO app_user;
GRANT ALL ON TABLE public.otp_challenges TO app_user;
GRANT ALL ON TABLE public.waiting_list_entries TO app_user;
GRANT ALL ON TABLE public."Settings" TO app_user;
GRANT ALL ON TABLE public."Documents" TO app_user;

GRANT app_user TO postgres, authenticated, anon;

-- Canonical permission registry rows (idempotent, non-destructive)
INSERT INTO public.permission_registry (
  permission_key,
  display_name_en,
  display_name_he,
  description_en,
  description_he,
  default_value,
  category,
  requires_approval
) VALUES
  (
    'backup_cooldown_override',
    'Backup Cooldown Override',
    'עקיפת המתנה לגיבוי',
    'One-time override of the 7-day backup cooldown (automatically resets after use)',
    'עקיפה חד-פעמית של תקופת ההמתנה של 7 ימים (מתאפסת אוטומטית לאחר שימוש)',
    'false'::jsonb,
    'backup',
    true
  ),
  (
    'backup_local_enabled',
    'Local Backup',
    'גיבוי מקומי',
    'Allow organization to create encrypted local backups',
    'אפשר לארגון ליצור גיבויים מוצפנים מקומיים',
    'false'::jsonb,
    'backup',
    true
  ),
  (
    'backup_oauth_enabled',
    'Cloud Backup (OAuth)',
    'גיבוי ענן (Google Drive, OneDrive)',
    'Allow organization to backup to cloud storage providers',
    'אפשר לארגון לגבות לספקי אחסון ענן',
    'false'::jsonb,
    'backup',
    true
  ),
  (
    'can_export_pdf_reports',
    'Export PDF Reports',
    'ייצוא דוחות PDF',
    'Allow organization to export student session records to professional PDF documents',
    'אפשר לארגון לייצא רישומי מפגשים של תלמידים למסמכי PDF מקצועיים',
    'false'::jsonb,
    'features',
    true
  ),
  (
    'can_reupload_legacy_reports',
    'Re-upload Legacy Session Reports',
    'העלאה חוזרת של דוחות עבר',
    'Allow organization admins/owners to upload legacy session records for a student more than once (subsequent uploads replace previous legacy data).',
    'מאפשר למנהלי ובעלי הארגון להעלות מחדש נתוני מפגשי עבר לתלמיד יותר מפעם אחת (העלאה חדשה מחליפה נתונים קודמים).',
    'false'::jsonb,
    'features',
    true
  ),
  (
    'can_use_custom_logo_on_exports',
    'Custom Logo on Exports',
    'לוגו מותאם ביצוא',
    'Allow organization to display their custom logo alongside TutTiud logo on PDF exports',
    'אפשר לארגון להציג את הלוגו המותאם שלו לצד לוגו TutTiud ביצוא PDF',
    'false'::jsonb,
    'branding',
    true
  ),
  (
    'invitation_expiry_seconds',
    'Invitation Expiry Seconds',
    'שניות תוקף הזמנה',
    'Number of seconds until invitation links expire (global). Overrides Supabase auth config if set.',
    'מספר שניות עד פקיעת קישורי הזמנה (גלובלי). דורס את הגדרת Supabase אם מוגדר.',
    '36399'::jsonb,
    'features',
    false
  ),
  (
    'logo_enabled',
    'Custom Logo',
    'לוגו מותאם אישית',
    'Allow organization to upload and use a custom logo',
    'אפשר לארגון להעלות ולהשתמש בלוגו מותאם אישית',
    'false'::jsonb,
    'branding',
    true
  ),
  (
    'session_form_preanswers_cap',
    'Session Form: Preanswers Cap',
    'טופס מפגש: תקרת תשובות מוכנות',
    'Maximum number of preconfigured answers allowed per question (text/textarea)',
    'מספר מרבי של תשובות מוכנות לשאלה (טקסט/טקסט חופשי)',
    '50'::jsonb,
    'features',
    false
  ),
  (
    'session_form_preanswers_enabled',
    'Session Form: Preconfigured Answers',
    'טופס מפגש: תשובות מוכנות מראש',
    'Allow organizations to configure predefined answer lists for text/textarea questions',
    'אפשר לארגון להגדיר רשימות תשובות מוכנות לשאלות טקסט/טקסט חופשי',
    'true'::jsonb,
    'features',
    false
  ),
  (
    'storage_access_level',
    'Storage Configuration Access',
    'גישה להגדרות אחסון',
    'Determines if the organization can configure storage and which modes are available. Options: false (locked), "byos_only" (BYOS only), "managed_only" (Managed only), "all" (both modes).',
    'קובע האם הארגון יכול להגדיר אחסון ואילו מצבים זמינים. אפשרויות: false (נעול), "byos_only" (BYOS בלבד), "managed_only" (מנוהל בלבד), "all" (שני המצבים).',
    'false'::jsonb,
    'storage',
    true
  ),
  (
    'storage_grace_period_days',
    'Storage Grace Period (Days)',
    'תקופת חסד לאחסון (ימים)',
    'Number of days users have to download files after storage is disconnected before permanent deletion',
    'מספר הימים שיש למשתמשים להוריד קבצים לאחר ניתוק האחסון לפני מחיקה סופית',
    '30'::jsonb,
    'storage',
    false
  )
ON CONFLICT (permission_key) DO UPDATE SET
  display_name_en = COALESCE(NULLIF(public.permission_registry.display_name_en, ''), EXCLUDED.display_name_en),
  display_name_he = COALESCE(NULLIF(public.permission_registry.display_name_he, ''), EXCLUDED.display_name_he),
  description_en = COALESCE(public.permission_registry.description_en, EXCLUDED.description_en),
  description_he = COALESCE(public.permission_registry.description_he, EXCLUDED.description_he),
  default_value = COALESCE(public.permission_registry.default_value, EXCLUDED.default_value),
  category = COALESCE(NULLIF(public.permission_registry.category, ''), EXCLUDED.category),
  requires_approval = COALESCE(public.permission_registry.requires_approval, EXCLUDED.requires_approval),
  updated_at = NOW();

-- =================================================================
-- Permission helpers
-- =================================================================

-- get_default_permissions()
-- Aggregates all permission_key → default_value pairs from permission_registry.
CREATE OR REPLACE FUNCTION public.get_default_permissions()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_object_agg(permission_key, default_value)
  INTO result
  FROM public.permission_registry;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

-- initialize_org_permissions(p_org_id)
-- Ensures the organizations.permissions JSONB column is populated.
-- If empty/null → sets to registry defaults.
-- Otherwise → merges any newly-added registry keys into existing permissions.
CREATE OR REPLACE FUNCTION public.initialize_org_permissions(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  current_permissions JSONB;
  default_permissions JSONB;
  merged_permissions JSONB;
  permission_key TEXT;
  default_value JSONB;
BEGIN
  SELECT permissions
  INTO current_permissions
  FROM public.organizations
  WHERE id = p_org_id;

  default_permissions := public.get_default_permissions();

  IF current_permissions IS NULL OR
     current_permissions = '{}'::jsonb OR
     jsonb_typeof(current_permissions) = 'null' OR
     (SELECT COUNT(*) FROM jsonb_object_keys(current_permissions)) = 0 THEN

    UPDATE public.organizations
    SET permissions = default_permissions,
        updated_at = NOW()
    WHERE id = p_org_id;

    RETURN default_permissions;
  END IF;

  merged_permissions := current_permissions;

  FOR permission_key, default_value IN
    SELECT key, value
    FROM jsonb_each(default_permissions)
  LOOP
    IF NOT (merged_permissions ? permission_key) THEN
      merged_permissions := jsonb_set(
        merged_permissions,
        ARRAY[permission_key],
        default_value,
        true
      );
    END IF;
  END LOOP;

  UPDATE public.organizations
  SET permissions = merged_permissions,
      updated_at = NOW()
  WHERE id = p_org_id;

  RETURN merged_permissions;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_default_permissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_default_permissions() TO app_user;
GRANT EXECUTE ON FUNCTION public.initialize_org_permissions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_org_permissions(UUID) TO app_user;

CREATE OR REPLACE FUNCTION public.setup_assistant_diagnostics()
RETURNS TABLE (check_name text, success boolean, details text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  required_tables constant text[] := array[
    'organizations',
    'profiles',
    'org_memberships',
    'org_invitations',
    'permission_registry',
    'active_routing',
    'audit_log',
    'students',
    'guardians',
    'client_profiles',
    'client_guardians',
    'Employees',
    'Services',
    'RateHistory',
    'employee_attendance_records',
    'employee_leave_entries',
    'employee_leave_days',
    'employee_leave_balance_events',
    'finance_corrections',
    'instructor_profiles',
    'instructor_service_capabilities',
    'lesson_templates',
    'lesson_template_overrides',
    'lesson_instances',
    'lesson_participants',
    'grace_cancellation_requests',
    'commitments',
    'ledger_transactions',
    'lesson_earnings',
    'forms',
    'form_submissions',
    'otp_challenges',
    'waiting_list_entries',
    'Settings',
    'Documents'
  ];
  table_name text;
  expected_policy_prefix text;
  expected_policy_name text;
BEGIN
  success := EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'public');
  check_name := 'Schema "public" exists';
  details := CASE WHEN success THEN 'OK' ELSE 'Schema "public" not found.' END;
  RETURN NEXT;

  success := EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'app_user');
  check_name := 'Role "app_user" exists';
  details := CASE WHEN success THEN 'OK' ELSE 'Role "app_user" not found.' END;
  RETURN NEXT;

  FOREACH table_name IN ARRAY required_tables LOOP
    success := to_regclass('public.' || quote_ident(table_name)) IS NOT NULL;
    check_name := 'Table "' || table_name || '" exists';
    details := CASE WHEN success THEN 'OK' ELSE 'Table public.' || table_name || ' is missing.' END;
    RETURN NEXT;
  END LOOP;

  FOREACH table_name IN ARRAY required_tables LOOP
    success := EXISTS(
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = table_name
        AND c.relrowsecurity = true
    );
    check_name := 'RLS enabled on "' || table_name || '"';
    details := CASE WHEN success THEN 'OK' ELSE 'RLS is not enabled on public.' || table_name || '.' END;
    RETURN NEXT;
  END LOOP;

  FOREACH table_name IN ARRAY required_tables LOOP
    expected_policy_prefix := 'Allow full access to authenticated users on ' || table_name;
    expected_policy_name := left(expected_policy_prefix, 63);
    success := EXISTS(
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = table_name
        AND p.policyname = expected_policy_name
    );
    check_name := 'Policy "' || expected_policy_prefix || '" exists';
    details := CASE
      WHEN success THEN
        CASE
          WHEN expected_policy_name = expected_policy_prefix THEN 'OK'
          ELSE 'OK (stored as "' || expected_policy_name || '" due to 63-char identifier limit)'
        END
      ELSE
        'Policy ' || expected_policy_prefix || ' is missing.'
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- =================================================================
-- Schema Drift Detection & Patch Engine (Bootstrap RPCs)
-- =================================================================
-- These functions enable:
-- - Introspection of tenant schema via JSON
-- - Preflight SELECT queries
-- - Execution of SAFE schema patch statements (and optionally destructive when explicitly confirmed)
--
-- Security model:
-- - EXECUTE is granted ONLY to the database role service_role.
-- - SAFE mode rejects destructive keywords and only allows a strict allow-list of statement patterns.

CREATE OR REPLACE FUNCTION public.schema_introspection_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  result := jsonb_build_object(
    'generated_at', NOW(),
    'schema', 'public',
    'tables', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'name', c.relname,
          'columns', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'name', a.attname,
                'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
                'nullable', NOT a.attnotnull,
                'default', pg_get_expr(ad.adbin, ad.adrelid)
              ) ORDER BY a.attnum
            ), '[]'::jsonb)
            FROM pg_attribute a
            LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
            WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          ),
          'primary_key', (
            SELECT COALESCE(jsonb_agg(att.attname ORDER BY ord.ordinality), '[]'::jsonb)
            FROM pg_index i
            JOIN unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality) ON TRUE
            JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum = ord.attnum
            WHERE i.indrelid = c.oid AND i.indisprimary
          )
        )
      ), '[]'::jsonb)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    ),
    'indexes', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'table', tablename,
          'name', indexname,
          'definition', indexdef
        )
      ), '[]'::jsonb)
      FROM pg_indexes
      WHERE schemaname = 'public'
    ),
    'constraints', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'table', cls.relname,
          'name', con.conname,
          'type', con.contype,
          'definition', pg_get_constraintdef(con.oid)
        )
      ), '[]'::jsonb)
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = cls.relnamespace
      WHERE n.nspname = 'public'
    ),
    'rls', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'table', c.relname,
          'enabled', c.relrowsecurity
        )
      ), '[]'::jsonb)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'table', p.tablename,
          'name', p.policyname,
          'command', p.cmd,
          'roles', p.roles,
          'using', p.qual,
          'check', p.with_check
        )
      ), '[]'::jsonb)
      FROM pg_policies p
      WHERE p.schemaname = 'public'
    ),
    'views', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'name', c.relname,
          'definition', pg_get_viewdef(c.oid, true)
        )
      ), '[]'::jsonb)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v'
    ),
    'extensions', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'name', extname,
          'schema', n.nspname,
          'version', extversion
        )
      ), '[]'::jsonb)
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
    )
  );

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.schema_run_selects_v1(queries text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  q text;
  row jsonb;
  results jsonb := '[]'::jsonb;
  upper_q text;
  result_row record;
BEGIN
  IF queries IS NULL OR array_length(queries, 1) IS NULL THEN
    RETURN results;
  END IF;

  FOREACH q IN ARRAY queries LOOP
    upper_q := upper(trim(coalesce(q, '')));
    IF upper_q = '' THEN
      CONTINUE;
    END IF;
    IF position(';' in q) > 0 THEN
      RAISE EXCEPTION 'query_contains_semicolon';
    END IF;
    IF NOT upper_q LIKE 'SELECT%' THEN
      RAISE EXCEPTION 'only_select_allowed';
    END IF;

    BEGIN
      EXECUTE q INTO result_row;
      row := jsonb_build_object('query', q, 'ok', true, 'result', to_jsonb(result_row));
    EXCEPTION WHEN OTHERS THEN
      row := jsonb_build_object('query', q, 'ok', false, 'error', SQLERRM);
    END;

    results := results || jsonb_build_array(row);
  END LOOP;

  RETURN results;
END;
$$;

CREATE OR REPLACE FUNCTION public.schema_execute_statements_v1(
  statements text[],
  allow_destructive boolean DEFAULT false,
  confirmation_phrase text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  stmt text;
  upper_stmt text;
  row jsonb;
  results jsonb := '[]'::jsonb;
  safe_ok boolean;
BEGIN
  IF statements IS NULL OR array_length(statements, 1) IS NULL THEN
    RETURN results;
  END IF;

  IF allow_destructive THEN
    IF confirmation_phrase IS DISTINCT FROM 'ALLOW DESTRUCTIVE CHANGES' THEN
      RAISE EXCEPTION 'destructive_confirmation_required';
    END IF;
  END IF;

  FOREACH stmt IN ARRAY statements LOOP
    upper_stmt := upper(trim(coalesce(stmt, '')));
    IF upper_stmt = '' THEN
      CONTINUE;
    END IF;

    IF NOT allow_destructive THEN
      safe_ok := (
        upper_stmt LIKE 'CREATE TABLE IF NOT EXISTS %' OR
        upper_stmt LIKE 'ALTER TABLE % ADD COLUMN IF NOT EXISTS %' OR
        upper_stmt LIKE 'CREATE INDEX IF NOT EXISTS %' OR
        upper_stmt LIKE 'CREATE UNIQUE INDEX IF NOT EXISTS %' OR
        upper_stmt LIKE 'ALTER TABLE % ENABLE ROW LEVEL SECURITY%' OR
        upper_stmt LIKE 'CREATE POLICY %' OR
        upper_stmt LIKE 'ALTER TABLE % ADD CONSTRAINT %' OR
        upper_stmt LIKE 'CREATE EXTENSION IF NOT EXISTS %' OR
        upper_stmt LIKE 'CREATE OR REPLACE VIEW %'
      );

      IF NOT safe_ok THEN
        RAISE EXCEPTION 'statement_not_allowed_in_safe_mode';
      END IF;

      IF upper_stmt LIKE '%DROP %' OR upper_stmt LIKE '%RENAME %' OR upper_stmt LIKE '%ALTER COLUMN % TYPE %' THEN
        RAISE EXCEPTION 'statement_contains_destructive_keywords';
      END IF;
    END IF;

    BEGIN
      EXECUTE stmt;
      row := jsonb_build_object('statement', stmt, 'ok', true);
    EXCEPTION WHEN OTHERS THEN
      row := jsonb_build_object('statement', stmt, 'ok', false, 'error', SQLERRM);
    END;

    results := results || jsonb_build_array(row);
  END LOOP;

  RETURN jsonb_build_object('statements', results);
END;
$$;

REVOKE ALL ON FUNCTION public.schema_introspection_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schema_run_selects_v1(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schema_execute_statements_v1(text[], boolean, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.schema_introspection_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.schema_run_selects_v1(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.schema_execute_statements_v1(text[], boolean, text) TO service_role;

-- =================================================================
-- Atomic Finance RPCs (Fixes Issues #1, #2, #4 from code review)
-- All amounts are in agorot (integer). 1 shekel = 100 agorot.
-- =================================================================

-- -----------------------------------------------------------------
-- create_commitment_transfer_atomic
-- Issue #1 fix: replaces the broken 3-step JS transfer that left an
-- orphaned DEBIT when the target CREDIT insert failed.
-- All three operations (new commitment + source DEBIT + target CREDIT)
-- execute inside a single Postgres transaction. Any failure rolls
-- back everything — no orphaned ledger entries possible.
--
-- Usage (JS):
--   const { data, error } = await client.rpc(
--     'create_commitment_transfer_atomic', { p_source_commitment_id, ... }
--   );
-- Returns: { target_commitment_id, source_debit_id, target_credit_id }
-- -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_commitment_transfer_atomic(
  p_org_id                    uuid,
  p_source_commitment_id      uuid,
  p_transfer_amount           integer,   -- in agorot
  p_transfer_ref              uuid,
  p_target_student_id         uuid,
  p_target_service_id         uuid,
  p_target_commitment_type    text,
  p_target_default_charge     integer,   -- in agorot, nullable via 0
  p_target_expires_at         timestamptz,
  p_target_notes              text,
  p_actor_user_id             uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_source_student_id         uuid;
  v_source_client_profile_id  uuid;
  v_target_client_profile_id  uuid;
  v_target_commitment_id      uuid;
  v_source_debit_id           uuid;
  v_target_credit_id          uuid;
BEGIN
  -- Validate amount
  IF p_transfer_amount IS NULL OR p_transfer_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_transfer_amount';
  END IF;

  -- Validate commitment type
  IF p_target_commitment_type NOT IN ('package', 'subscription', 'manual_credit') THEN
    RAISE EXCEPTION 'invalid_commitment_type';
  END IF;

  -- Resolve source student and client profile
  SELECT c.student_id, s.client_profile_id
    INTO v_source_student_id, v_source_client_profile_id
  FROM public.commitments c
  JOIN public.students s ON s.id = c.student_id
  WHERE c.id = p_source_commitment_id
    AND c.org_id = p_org_id;

  IF v_source_student_id IS NULL THEN
    RAISE EXCEPTION 'source_commitment_not_found';
  END IF;

  -- Resolve target client profile
  SELECT client_profile_id
    INTO v_target_client_profile_id
  FROM public.students
  WHERE id = p_target_student_id
    AND org_id = p_org_id;

  IF v_target_client_profile_id IS NULL THEN
    RAISE EXCEPTION 'target_student_not_found';
  END IF;

  -- Step 1: Create target commitment
  INSERT INTO public.commitments (
    org_id,
    student_id,
    service_id,
    commitment_type,
    total_amount,
    default_charge_amount,
    transfer_ref,
    notes,
    is_active,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    p_org_id,
    p_target_student_id,
    p_target_service_id,
    p_target_commitment_type,
    p_transfer_amount,
    NULLIF(p_target_default_charge, 0),
    p_transfer_ref,
    p_target_notes,
    true,
    p_target_expires_at,
    now(),
    now()
  )
  RETURNING id INTO v_target_commitment_id;

  -- Step 2: Insert source DEBIT (deducts from source commitment)
  INSERT INTO public.ledger_transactions (
    org_id,
    client_profile_id,
    student_id,
    commitment_id,
    transaction_type,
    usage_type,
    amount,
    source_ref,
    notes,
    created_at,
    updated_at,
    metadata
  ) VALUES (
    p_org_id,
    v_source_client_profile_id,
    v_source_student_id,
    p_source_commitment_id,
    'DEBIT',
    'transfer_debit',
    p_transfer_amount,
    p_transfer_ref,
    'Balance transfer out',
    now(),
    now(),
    jsonb_build_object('actor_user_id', p_actor_user_id)
  )
  RETURNING id INTO v_source_debit_id;

  -- Step 3: Insert target CREDIT (funds the new commitment)
  INSERT INTO public.ledger_transactions (
    org_id,
    client_profile_id,
    student_id,
    commitment_id,
    transaction_type,
    usage_type,
    amount,
    source_ref,
    notes,
    created_at,
    updated_at,
    metadata
  ) VALUES (
    p_org_id,
    v_target_client_profile_id,
    p_target_student_id,
    v_target_commitment_id,
    'CREDIT',
    'transfer_received',
    p_transfer_amount,
    p_transfer_ref,
    'Balance transfer in',
    now(),
    now(),
    jsonb_build_object('actor_user_id', p_actor_user_id)
  )
  RETURNING id INTO v_target_credit_id;

  RETURN jsonb_build_object(
    'target_commitment_id', v_target_commitment_id,
    'source_debit_id',      v_source_debit_id,
    'target_credit_id',     v_target_credit_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_commitment_transfer_atomic(
  uuid, uuid, integer, uuid, uuid, uuid, text, integer, timestamptz, text, uuid
) TO authenticated, service_role;

-- -----------------------------------------------------------------
-- ensure_hmo_authorization_and_link_commitment
-- Issue #2 fix: replaces the two-step JS upsert that could leave a
-- ghost authorization if the commitment-update query failed.
-- Both the authorization upsert and the commitment FK update happen
-- inside a single Postgres transaction — they both commit or both
-- roll back together.
--
-- p_authorization_data fields (all required unless marked optional):
--   id, student_id, service_id, provider_id, provider_track_id,
--   authorized_lessons, status,
--   valid_from (optional), expires_at (optional),
--   customer_charge_amount_override (optional, agorot),
--   insurer_claim_amount_override (optional, agorot),
--   workflow_notes_override (optional),
--   authorization_reference (optional)
--
-- Returns: { authorization_id, commitment_id }
-- -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_hmo_authorization_and_link_commitment(
  p_org_id              uuid,
  p_authorization_data  jsonb,
  p_commitment_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_authorization_id  uuid;
  v_auth_id_input     uuid;
BEGIN
  v_auth_id_input := (p_authorization_data->>'id')::uuid;

  IF v_auth_id_input IS NULL THEN
    RAISE EXCEPTION 'authorization_id_required';
  END IF;

  IF p_commitment_id IS NULL THEN
    RAISE EXCEPTION 'commitment_id_required';
  END IF;

  -- Upsert authorization (idempotent via id conflict)
  INSERT INTO public.hmo_authorizations (
    id,
    org_id,
    student_id,
    service_id,
    provider_id,
    provider_track_id,
    authorized_lessons,
    status,
    valid_from,
    expires_at,
    customer_charge_amount_override,
    insurer_claim_amount_override,
    workflow_notes_override,
    authorization_reference,
    created_at,
    updated_at
  ) VALUES (
    v_auth_id_input,
    p_org_id,
    (p_authorization_data->>'student_id')::uuid,
    (p_authorization_data->>'service_id')::uuid,
    (p_authorization_data->>'provider_id')::uuid,
    (p_authorization_data->>'provider_track_id')::uuid,
    COALESCE((p_authorization_data->>'authorized_lessons')::int, 0),
    COALESCE(p_authorization_data->>'status', 'active'),
    (p_authorization_data->>'valid_from')::date,
    (p_authorization_data->>'expires_at')::date,
    (p_authorization_data->>'customer_charge_amount_override')::integer,
    (p_authorization_data->>'insurer_claim_amount_override')::integer,
    p_authorization_data->>'workflow_notes_override',
    p_authorization_data->>'authorization_reference',
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    authorized_lessons              = EXCLUDED.authorized_lessons,
    status                          = EXCLUDED.status,
    valid_from                      = EXCLUDED.valid_from,
    expires_at                      = EXCLUDED.expires_at,
    customer_charge_amount_override = EXCLUDED.customer_charge_amount_override,
    insurer_claim_amount_override   = EXCLUDED.insurer_claim_amount_override,
    workflow_notes_override         = EXCLUDED.workflow_notes_override,
    authorization_reference         = EXCLUDED.authorization_reference,
    updated_at                      = now()
  RETURNING id INTO v_authorization_id;

  -- Link commitment to authorization atomically in the same transaction
  UPDATE public.commitments
  SET
    hmo_authorization_id   = v_authorization_id,
    hmo_provider_id        = (p_authorization_data->>'provider_id')::uuid,
    hmo_provider_track_id  = (p_authorization_data->>'provider_track_id')::uuid,
    updated_at             = now()
  WHERE id = p_commitment_id
    AND org_id = p_org_id;

  IF NOT FOUND THEN
    -- Commitment not found: roll back by raising (Postgres will undo the INSERT above)
    RAISE EXCEPTION 'commitment_not_found';
  END IF;

  RETURN jsonb_build_object(
    'authorization_id', v_authorization_id,
    'commitment_id',    p_commitment_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_hmo_authorization_and_link_commitment(
  uuid, jsonb, uuid
) TO authenticated, service_role;

-- -----------------------------------------------------------------
-- create_commitment_and_ledger_entry
-- Issue #7 fix: replaces the two-step JS flow that first inserts a
-- commitment then inserts a CREDIT ledger entry. If the second step
-- failed the commitment could exist without a ledger entry, breaking
-- financial integrity. This RPC performs both writes atomically.
--
-- Usage (JS):
--   const { data, error } = await client.rpc(
--     'create_commitment_and_ledger_entry', { p_student_id, ... }
--   );
-- Returns: { commitment_id, ledger_entry_id }
-- -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_commitment_and_ledger_entry(
  p_org_id                  uuid,
  p_student_id              uuid,
  p_service_id              uuid,
  p_commitment_type         text,
  p_total_amount            integer,   -- agorot
  p_default_charge_amount   integer,   -- agorot, nullable via NULL
  p_transfer_ref            uuid,
  p_notes                   text,
  p_is_active               boolean,
  p_expires_at              timestamptz,
  p_metadata                jsonb,
  p_hmo_provider_id         uuid,
  p_hmo_provider_track_id   uuid,
  p_hmo_authorization_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_commitment_id           uuid;
  v_client_profile_id       uuid;
  v_ledger_entry_id         uuid;
  v_usage_type              text;
  v_now                     timestamptz := now();
BEGIN
  -- Validate required fields
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'missing_student_id';
  END IF;
  IF p_service_id IS NULL THEN
    RAISE EXCEPTION 'missing_service_id';
  END IF;
  IF p_total_amount IS NULL OR p_total_amount < 0 THEN
    RAISE EXCEPTION 'invalid_total_amount';
  END IF;
  IF p_commitment_type NOT IN ('package', 'subscription', 'hmo', 'manual_credit') THEN
    RAISE EXCEPTION 'invalid_commitment_type';
  END IF;

  -- Resolve client_profile_id for ledger entry
  SELECT client_profile_id
    INTO v_client_profile_id
  FROM public.students
  WHERE id = p_student_id
    AND org_id = p_org_id;

  IF v_client_profile_id IS NULL THEN
    RAISE EXCEPTION 'student_not_found_or_missing_client_profile';
  END IF;

  -- Step 1: Insert commitment
  INSERT INTO public.commitments (
    org_id,
    student_id,
    service_id,
    commitment_type,
    total_amount,
    default_charge_amount,
    transfer_ref,
    notes,
    is_active,
    expires_at,
    metadata,
    hmo_provider_id,
    hmo_provider_track_id,
    hmo_authorization_id,
    created_at,
    updated_at
  ) VALUES (
    p_org_id,
    p_student_id,
    p_service_id,
    p_commitment_type,
    p_total_amount,
    p_default_charge_amount,
    p_transfer_ref,
    p_notes,
    COALESCE(p_is_active, true),
    p_expires_at,
    COALESCE(p_metadata, '{}'::jsonb),
    p_hmo_provider_id,
    p_hmo_provider_track_id,
    p_hmo_authorization_id,
    v_now,
    v_now
  )
  RETURNING id INTO v_commitment_id;

  -- Step 2: Insert initial CREDIT ledger entry (only when amount > 0)
  IF p_total_amount > 0 THEN
    v_usage_type := CASE
      WHEN p_commitment_type = 'hmo' THEN 'hmo_authorization_added'
      ELSE 'commitment_creation'
    END;

    INSERT INTO public.ledger_transactions (
      org_id,
      client_profile_id,
      student_id,
      commitment_id,
      transaction_type,
      usage_type,
      amount,
      source_ref,
      notes,
      created_at,
      updated_at,
      metadata
    ) VALUES (
      p_org_id,
      v_client_profile_id,
      p_student_id,
      v_commitment_id,
      'CREDIT',
      v_usage_type,
      p_total_amount,
      NULL,
      NULL,
      v_now,
      v_now,
      jsonb_build_object('commitment_type', p_commitment_type)
    )
    RETURNING id INTO v_ledger_entry_id;
  END IF;

  RETURN jsonb_build_object(
    'commitment_id',   v_commitment_id,
    'ledger_entry_id', v_ledger_entry_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_commitment_and_ledger_entry(
  uuid, uuid, uuid, text, integer, integer, uuid, text, boolean, timestamptz, jsonb, uuid, uuid, uuid
) TO authenticated, service_role;

-- -----------------------------------------------------------------
-- update_commitment_and_record_delta
-- Atomically updates an existing commitment and, if the total_amount
-- changed, records a CREDIT or DEBIT delta in ledger_transactions.
-- This replaces the non-atomic JS two-step approach which could leave
-- a commitment updated without a matching ledger entry (or vice versa).
--
-- Returns: { commitment_id, delta, ledger_entry_id }
-- -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_commitment_and_record_delta(
  p_org_id                  uuid,
  p_commitment_id           uuid,
  p_student_id              uuid,
  p_service_id              uuid,
  p_commitment_type         text,
  p_total_amount            integer,   -- agorot
  p_default_charge_amount   integer,   -- agorot, nullable via NULL
  p_transfer_ref            uuid,
  p_notes                   text,
  p_is_active               boolean,
  p_expires_at              timestamptz,
  p_metadata                jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_total               integer;
  v_client_profile_id       uuid;
  v_delta                   integer;
  v_ledger_entry_id         uuid;
  v_now                     timestamptz := now();
BEGIN
  IF p_commitment_id IS NULL THEN
    RAISE EXCEPTION 'missing_commitment_id';
  END IF;
  IF p_total_amount IS NULL OR p_total_amount < 0 THEN
    RAISE EXCEPTION 'invalid_total_amount';
  END IF;

  -- Lock the row and read old total
  SELECT total_amount
    INTO v_old_total
  FROM public.commitments
  WHERE id = p_commitment_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'commitment_not_found';
  END IF;

  -- Update the commitment
  UPDATE public.commitments SET
    student_id            = p_student_id,
    service_id            = p_service_id,
    commitment_type       = p_commitment_type,
    total_amount          = p_total_amount,
    default_charge_amount = p_default_charge_amount,
    transfer_ref          = p_transfer_ref,
    notes                 = p_notes,
    is_active             = COALESCE(p_is_active, true),
    expires_at            = p_expires_at,
    metadata              = COALESCE(p_metadata, '{}'::jsonb),
    updated_at            = v_now
  WHERE id = p_commitment_id
    AND org_id = p_org_id;

  -- Record a ledger delta if total_amount changed
  v_delta := p_total_amount - COALESCE(v_old_total, 0);

  IF v_delta <> 0 THEN
    -- Resolve client_profile_id for ledger entry
    SELECT client_profile_id
      INTO v_client_profile_id
    FROM public.students
    WHERE id = p_student_id
      AND org_id = p_org_id;

    IF v_client_profile_id IS NULL THEN
      RAISE EXCEPTION 'student_not_found_or_missing_client_profile';
    END IF;

    INSERT INTO public.ledger_transactions (
      org_id,
      client_profile_id,
      student_id,
      commitment_id,
      transaction_type,
      usage_type,
      amount,
      source_ref,
      notes,
      created_at,
      updated_at,
      metadata
    ) VALUES (
      p_org_id,
      v_client_profile_id,
      p_student_id,
      p_commitment_id,
      CASE WHEN v_delta > 0 THEN 'CREDIT' ELSE 'DEBIT' END,
      CASE WHEN v_delta > 0 THEN 'manual_topup' ELSE 'manual_adjustment' END,
      ABS(v_delta),
      NULL,
      'Commitment total_amount updated',
      v_now,
      v_now,
      jsonb_build_object('commitment_update', true, 'old_total', COALESCE(v_old_total, 0), 'new_total', p_total_amount)
    )
    RETURNING id INTO v_ledger_entry_id;
  END IF;

  RETURN jsonb_build_object(
    'commitment_id',   p_commitment_id,
    'delta',           COALESCE(v_delta, 0),
    'ledger_entry_id', v_ledger_entry_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_commitment_and_record_delta(
  uuid, uuid, uuid, uuid, text, integer, integer, uuid, text, boolean, timestamptz, jsonb
) TO authenticated, service_role;

-- -----------------------------------------------------------------
-- batch_sync_lesson_ledger_entries
-- Issue #4 fix: replaces the per-participant JS loop in
-- syncLessonBillingArtifacts() which updated participants one-by-one
-- without a transaction wrapper. This RPC receives all billing
-- decisions for a lesson instance and applies them atomically —
-- all participants commit or none do.
--
-- p_entries is a JSONB array. Each element:
--   {
--     participant_id:    uuid (required),
--     client_profile_id: uuid (required),
--     student_id:        uuid (required),
--     commitment_id:     uuid | null,
--     should_charge:     boolean,
--     transaction_type:  "DEBIT" | null,
--     usage_type:        text | null,
--     amount:            integer (agorot) | null,
--     source_ref:        uuid | null,    -- lesson_participant id
--     pricing_breakdown: jsonb | null,
--     notes:             text | null
--   }
--
-- For each entry:
--   - If should_charge = true:  upsert a DEBIT ledger_transaction
--     (idempotent via ledger_transactions_source_usage_unique)
--   - If should_charge = false: delete any existing DEBIT for this source_ref
--   - Always: update lesson_participants.pricing_breakdown + price_charged
--
-- Returns: { updated: integer, charged: integer, cleared: integer }
-- -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.batch_sync_lesson_ledger_entries(
  p_org_id              uuid,
  p_lesson_instance_id  uuid,
  p_actor_user_id       uuid,
  p_entries             jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  entry             jsonb;
  v_participant_id  uuid;
  v_client_id       uuid;
  v_student_id      uuid;
  v_commitment_id   uuid;
  v_should_charge   boolean;
  v_tx_type         text;
  v_usage_type      text;
  v_amount          integer;
  v_source_ref      uuid;
  v_breakdown       jsonb;
  v_notes           text;
  v_updated         integer := 0;
  v_charged         integer := 0;
  v_cleared         integer := 0;
BEGIN
  IF p_lesson_instance_id IS NULL THEN
    RAISE EXCEPTION 'lesson_instance_id_required';
  END IF;

  IF p_entries IS NULL OR jsonb_array_length(p_entries) = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'charged', 0, 'cleared', 0);
  END IF;

  FOR entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    v_participant_id := (entry->>'participant_id')::uuid;
    v_client_id      := (entry->>'client_profile_id')::uuid;
    v_student_id     := (entry->>'student_id')::uuid;
    v_commitment_id  := (entry->>'commitment_id')::uuid;
    v_should_charge  := COALESCE((entry->>'should_charge')::boolean, false);
    v_tx_type        := entry->>'transaction_type';
    v_usage_type     := entry->>'usage_type';
    v_amount         := (entry->>'amount')::integer;
    v_source_ref     := (entry->>'source_ref')::uuid;
    v_breakdown      := entry->'pricing_breakdown';
    v_notes          := entry->>'notes';

    IF v_participant_id IS NULL THEN
      RAISE EXCEPTION 'participant_id_required_in_entry';
    END IF;

    IF v_should_charge AND v_amount IS NOT NULL AND v_amount > 0 THEN
      -- Upsert the DEBIT ledger entry (idempotent: unique on source_ref + usage_type)
      INSERT INTO public.ledger_transactions (
        org_id,
        client_profile_id,
        student_id,
        commitment_id,
        transaction_type,
        usage_type,
        amount,
        source_ref,
        notes,
        created_at,
        updated_at,
        metadata
      ) VALUES (
        p_org_id,
        v_client_id,
        v_student_id,
        v_commitment_id,
        COALESCE(v_tx_type, 'DEBIT'),
        COALESCE(v_usage_type, 'standard'),
        v_amount,
        v_source_ref,
        v_notes,
        now(),
        now(),
        jsonb_build_object('actor_user_id', p_actor_user_id, 'lesson_instance_id', p_lesson_instance_id)
      )
      ON CONFLICT (org_id, source_ref, usage_type) DO UPDATE SET
        commitment_id     = EXCLUDED.commitment_id,
        amount            = EXCLUDED.amount,
        notes             = EXCLUDED.notes,
        updated_at        = now();

      v_charged := v_charged + 1;
    ELSE
      -- Remove any existing DEBIT for this participant (lesson no longer billable)
      IF v_source_ref IS NOT NULL AND v_usage_type IS NOT NULL THEN
        DELETE FROM public.ledger_transactions
        WHERE source_ref = v_source_ref
          AND org_id = p_org_id
          AND usage_type = v_usage_type
          AND transaction_type = 'DEBIT';
      END IF;

      v_cleared := v_cleared + 1;
    END IF;

    -- Always update participant pricing snapshot
    UPDATE public.lesson_participants
    SET
      price_charged     = CASE WHEN v_should_charge THEN v_amount ELSE NULL END,
      pricing_breakdown = v_breakdown,
      updated_by        = p_actor_user_id
    WHERE id = v_participant_id
      AND org_id = p_org_id;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'charged', v_charged,
    'cleared', v_cleared
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.batch_sync_lesson_ledger_entries(
  uuid, uuid, uuid, jsonb
) TO authenticated, service_role;

-- -----------------------------------------------------------------
-- Append-only billing ledger cutover
-- Final finance cutover section is additive-only on rerun:
--   - preserves existing ledger / commitments / cached lesson billing data
--   - creates ledger_accounts + immutable ledger_transactions only if missing
--   - preserves legacy columns/tables for audit safety
--   - adds HMO invoice metadata tables if missing
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  account_type text NOT NULL DEFAULT 'client_profile',
  client_profile_id uuid NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  student_id uuid NULL REFERENCES public.students(id) ON DELETE SET NULL,
  hmo_provider_id uuid NULL REFERENCES public.hmo_providers(id) ON DELETE RESTRICT,
  service_id uuid NULL REFERENCES public."Services"(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ledger_accounts_account_type_check CHECK (account_type IN ('student', 'client_profile', 'hmo_provider')),
  CONSTRAINT ledger_accounts_target_check CHECK (
    (account_type = 'student' AND student_id IS NOT NULL AND hmo_provider_id IS NULL)
    OR (account_type = 'client_profile' AND client_profile_id IS NOT NULL AND student_id IS NULL AND hmo_provider_id IS NULL)
    OR (account_type = 'hmo_provider' AND hmo_provider_id IS NOT NULL AND student_id IS NULL)
  )
);

ALTER TABLE public.ledger_accounts
  ADD COLUMN IF NOT EXISTS account_type text NULL,
  ADD COLUMN IF NOT EXISTS hmo_provider_id uuid NULL REFERENCES public.hmo_providers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.ledger_accounts
  ALTER COLUMN client_profile_id DROP NOT NULL,
  ALTER COLUMN account_type DROP DEFAULT,
  ALTER COLUMN account_type DROP NOT NULL,
  ALTER COLUMN is_active SET DEFAULT true;

UPDATE public.ledger_accounts
SET hmo_provider_id = NULL
WHERE hmo_provider_id IS NOT NULL
  AND student_id IS NOT NULL;

UPDATE public.ledger_accounts
SET account_type = CASE
  WHEN hmo_provider_id IS NOT NULL THEN 'hmo_provider'
  WHEN student_id IS NOT NULL THEN 'student'
  WHEN client_profile_id IS NOT NULL THEN 'client_profile'
  ELSE account_type
END
WHERE account_type IS NULL OR account_type NOT IN ('student', 'client_profile', 'hmo_provider');

UPDATE public.ledger_accounts account
SET client_profile_id = student.client_profile_id
FROM public.students student
WHERE account.org_id = student.org_id
  AND account.student_id = student.id
  AND account.account_type = 'student'
  AND account.client_profile_id IS NULL
  AND student.client_profile_id IS NOT NULL;

INSERT INTO public.ledger_accounts (
  org_id,
  account_type,
  client_profile_id,
  student_id,
  hmo_provider_id,
  service_id,
  is_active,
  metadata
)
SELECT
  provider.org_id,
  'hmo_provider',
  NULL,
  NULL,
  provider.id,
  NULL,
  COALESCE(provider.is_active, true),
  jsonb_build_object('created_by', 'hmo_provider_account_backfill')
FROM public.hmo_providers provider
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ledger_accounts account
  WHERE account.org_id = provider.org_id
    AND account.account_type = 'hmo_provider'
    AND account.hmo_provider_id = provider.id
);

UPDATE public.ledger_transactions tx
SET ledger_account_id = account.id
FROM public.ledger_accounts account
WHERE tx.org_id = account.org_id
  AND tx.hmo_provider_id = account.hmo_provider_id
  AND account.account_type = 'hmo_provider'
  AND tx.hmo_provider_id IS NOT NULL
  AND tx.ledger_account_id IS NULL;

DO $$
DECLARE
  v_invalid_count integer := 0;
BEGIN
  SELECT COUNT(*)
    INTO v_invalid_count
  FROM public.ledger_accounts account
  WHERE NOT (
    (account.account_type = 'student' AND account.student_id IS NOT NULL AND account.client_profile_id IS NOT NULL AND account.hmo_provider_id IS NULL)
    OR (account.account_type = 'client_profile' AND account.client_profile_id IS NOT NULL AND account.student_id IS NULL AND account.hmo_provider_id IS NULL)
    OR (account.account_type = 'hmo_provider' AND account.hmo_provider_id IS NOT NULL AND account.student_id IS NULL AND account.client_profile_id IS NULL)
  );

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'ledger_accounts migration blocked: % invalid rows remain; inspect public.ledger_accounts before applying strict constraints', v_invalid_count;
  END IF;
END $$;

ALTER TABLE public.ledger_accounts
  ALTER COLUMN account_type SET NOT NULL,
  ALTER COLUMN account_type SET DEFAULT 'client_profile';

DO $$
BEGIN
  ALTER TABLE public.ledger_accounts
    DROP CONSTRAINT IF EXISTS ledger_accounts_account_type_check;
  ALTER TABLE public.ledger_accounts
    DROP CONSTRAINT IF EXISTS ledger_accounts_target_check;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE public.ledger_accounts
  ADD CONSTRAINT ledger_accounts_account_type_check
  CHECK (account_type IN ('student', 'client_profile', 'hmo_provider'));

ALTER TABLE public.ledger_accounts
  ADD CONSTRAINT ledger_accounts_target_check
  CHECK (
    (account_type = 'student' AND student_id IS NOT NULL AND client_profile_id IS NOT NULL AND hmo_provider_id IS NULL)
    OR (account_type = 'client_profile' AND client_profile_id IS NOT NULL AND student_id IS NULL AND hmo_provider_id IS NULL)
    OR (account_type = 'hmo_provider' AND hmo_provider_id IS NOT NULL AND student_id IS NULL AND client_profile_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS ledger_accounts_client_profile_idx
  ON public.ledger_accounts (org_id, client_profile_id);

CREATE INDEX IF NOT EXISTS ledger_accounts_student_idx
  ON public.ledger_accounts (org_id, student_id)
  WHERE student_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_student_uidx
  ON public.ledger_accounts (org_id, student_id)
  WHERE account_type = 'student' AND student_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_client_profile_uidx
  ON public.ledger_accounts (org_id, client_profile_id)
  WHERE account_type = 'client_profile' AND client_profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_hmo_provider_uidx
  ON public.ledger_accounts (org_id, hmo_provider_id)
  WHERE account_type = 'hmo_provider' AND hmo_provider_id IS NOT NULL;



CREATE TABLE IF NOT EXISTS public.hmo_invoice_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  hmo_provider_id uuid NOT NULL REFERENCES public.hmo_providers(id) ON DELETE RESTRICT,
  period_start date NULL,
  period_end date NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'submitted', 'acknowledged', 'partially_paid', 'paid', 'disputed', 'closed', 'cancelled')),
  total_amount integer NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  paid_amount integer NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  external_reference text NULL,
  external_link text NULL,
  notes text NULL,
  issued_at timestamptz NULL,
  submitted_at timestamptz NULL,
  submitted_by uuid NULL,
  received_at timestamptz NULL,
  paid_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.hmo_invoice_batches
  ALTER COLUMN status SET DEFAULT 'draft',
  ALTER COLUMN issued_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS submitted_by uuid NULL,
  ADD COLUMN IF NOT EXISTS received_at timestamptz NULL;

ALTER TABLE public.hmo_invoice_batches
  DROP CONSTRAINT IF EXISTS hmo_invoice_batches_status_check;

ALTER TABLE public.hmo_invoice_batches
  ADD CONSTRAINT hmo_invoice_batches_status_check
  CHECK (status IN ('draft', 'issued', 'submitted', 'acknowledged', 'partially_paid', 'paid', 'disputed', 'closed', 'cancelled'));

CREATE INDEX IF NOT EXISTS hmo_invoice_batches_provider_idx
  ON public.hmo_invoice_batches (org_id, hmo_provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.hmo_invoice_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  batch_id uuid NOT NULL REFERENCES public.hmo_invoice_batches(id) ON DELETE CASCADE,
  ledger_transaction_id uuid NOT NULL REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
  amount integer NOT NULL CHECK (amount > 0),
  expected_amount integer NOT NULL DEFAULT 0 CHECK (expected_amount >= 0),
  expected_unit_count integer NOT NULL DEFAULT 1 CHECK (expected_unit_count > 0),
  paid_amount integer NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'acknowledged', 'partially_paid', 'paid', 'disputed', 'cancelled')),
  lesson_participant_id uuid NULL REFERENCES public.lesson_participants(id) ON DELETE SET NULL,
  hmo_authorization_id uuid NULL REFERENCES public.hmo_authorizations(id) ON DELETE SET NULL,
  hmo_provider_id uuid NULL REFERENCES public.hmo_providers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.hmo_invoice_batch_items
  ADD COLUMN IF NOT EXISTS expected_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_unit_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS paid_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS lesson_participant_id uuid NULL REFERENCES public.lesson_participants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hmo_authorization_id uuid NULL REFERENCES public.hmo_authorizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hmo_provider_id uuid NULL REFERENCES public.hmo_providers(id) ON DELETE SET NULL;

ALTER TABLE public.hmo_invoice_batch_items
  DROP CONSTRAINT IF EXISTS hmo_invoice_batch_items_status_check;

ALTER TABLE public.hmo_invoice_batch_items
  DROP CONSTRAINT IF EXISTS hmo_invoice_batch_items_ledger_transaction_id_key;

ALTER TABLE public.hmo_invoice_batch_items
  ADD CONSTRAINT hmo_invoice_batch_items_status_check
  CHECK (status IN ('draft', 'submitted', 'acknowledged', 'partially_paid', 'paid', 'disputed', 'cancelled'));

CREATE INDEX IF NOT EXISTS hmo_invoice_batch_items_batch_idx
  ON public.hmo_invoice_batch_items (org_id, batch_id);

CREATE INDEX IF NOT EXISTS hmo_invoice_batch_items_ledger_idx
  ON public.hmo_invoice_batch_items (org_id, ledger_transaction_id);

CREATE UNIQUE INDEX IF NOT EXISTS hmo_invoice_batch_items_active_ledger_uidx
  ON public.hmo_invoice_batch_items (org_id, ledger_transaction_id)
  WHERE status IN ('draft', 'submitted', 'acknowledged', 'partially_paid', 'paid', 'disputed');

CREATE INDEX IF NOT EXISTS hmo_invoice_batch_items_authorization_idx
  ON public.hmo_invoice_batch_items (org_id, hmo_authorization_id, status)
  WHERE hmo_authorization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hmo_invoice_batch_items_provider_idx
  ON public.hmo_invoice_batch_items (org_id, hmo_provider_id, status)
  WHERE hmo_provider_id IS NOT NULL;

-- RLS for billing ledger tables
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hmo_invoice_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hmo_invoice_batch_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  ops text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE'];
  op text;
  pol text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ledger_accounts',
    'ledger_transactions',
    'hmo_invoice_batches',
    'hmo_invoice_batch_items'
  ]
  LOOP
    -- Drop the old permissive "USING (true)" policy if it exists
    EXECUTE 'DROP POLICY IF EXISTS '
      || quote_ident(left('Allow full access to authenticated users on ' || tbl, 63))
      || ' ON public.' || quote_ident(tbl);

    FOREACH op IN ARRAY ops
    LOOP
      pol := left('tenant_' || lower(op) || '_' || tbl, 63);
      EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(pol) || ' ON public.' || quote_ident(tbl);

      IF op = 'SELECT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated, app_user USING (org_id = get_active_org_id())',
          pol, tbl);
      ELSIF op = 'INSERT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated, app_user WITH CHECK (org_id = get_active_org_id())',
          pol, tbl);
      ELSE
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR %s TO authenticated, app_user USING (org_id = get_active_org_id())',
          pol, tbl, op);
        IF op = 'UPDATE' THEN
          EXECUTE format(
            'ALTER POLICY %I ON public.%I WITH CHECK (org_id = get_active_org_id())',
            pol, tbl);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;

GRANT ALL ON TABLE public.ledger_accounts TO app_user;
GRANT ALL ON TABLE public.ledger_transactions TO app_user;
GRANT ALL ON TABLE public.hmo_invoice_batches TO app_user;
GRANT ALL ON TABLE public.hmo_invoice_batch_items TO app_user;

SELECT extensions.sign(
  json_build_object(
    'role', 'app_user',
    'exp', (EXTRACT(EPOCH FROM (NOW() + INTERVAL '5 year')))::integer,
    'iat', (EXTRACT(EPOCH FROM NOW()))::integer
  ),
  'YOUR_SUPER_SECRET_AND_LONG_JWT_SECRET_HERE'
) AS "APP_DEDICATED_KEY (COPY THIS BACK TO THE APP)";

-- =================================================================
-- Patch 2026-05-04: Privacy / pseudonymization status columns
-- =================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'students'
      AND column_name  = 'privacy_status'
  ) THEN
    ALTER TABLE public.students
      ADD COLUMN IF NOT EXISTS privacy_status text NOT NULL DEFAULT 'active'
        CHECK (privacy_status IN ('active', 'anonymized'));
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'client_profiles'
      AND column_name  = 'privacy_status'
  ) THEN
    ALTER TABLE public.client_profiles
      ADD COLUMN IF NOT EXISTS privacy_status text NOT NULL DEFAULT 'active'
        CHECK (privacy_status IN ('active', 'anonymized'));
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS students_privacy_status_idx
  ON public.students (org_id, privacy_status);

CREATE INDEX IF NOT EXISTS client_profiles_privacy_status_idx
  ON public.client_profiles (org_id, privacy_status);

-- =================================================================
-- Patch 2026-05-04b: Encrypted Bucket — pii_encrypted_data columns
-- =================================================================
-- Strategy: Collect all sensitive fields into a single JSON object,
-- AES-256-GCM-encrypt the serialized string, and store the ciphertext in
-- pii_encrypted_data (text). On anonymize the source columns are NULLed.
-- Existing column types are NEVER changed.
--
-- Bucket contents:
--   students         : notes_internal, medical_provider, metadata
--   client_profiles  : identity_number, phone, email, date_of_birth, metadata
--   guardians        : phone, email, metadata
--
-- Names (first_name, middle_name, last_name) are intentionally excluded
-- from the bucket on all tables to preserve searchability.
--
-- privacy_status is added to students and client_profiles (tracked ownership).
-- Guardians do not carry privacy_status — their anonymization is a side-effect
-- of the linked student and is controlled by the endpoint's sole-link check.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'students'
      AND column_name = 'pii_encrypted_data'
  ) THEN
    ALTER TABLE public.students ADD COLUMN IF NOT EXISTS pii_encrypted_data text NULL;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'client_profiles'
      AND column_name = 'pii_encrypted_data'
  ) THEN
    ALTER TABLE public.client_profiles ADD COLUMN IF NOT EXISTS pii_encrypted_data text NULL;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'guardians'
      AND column_name = 'pii_encrypted_data'
  ) THEN
    ALTER TABLE public.guardians ADD COLUMN IF NOT EXISTS pii_encrypted_data text NULL;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;
`;
