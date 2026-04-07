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
-- Tenant Public Domain Tables (Product-Agnostic)
-- =================================================================

-- -----------------------------------------------------------------
-- public.students (operational overlay)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid,
  notes_internal text NULL,
  medical_provider text NULL,
  special_rate numeric NULL,
  medical_flags jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS client_profile_id uuid,
  ADD COLUMN IF NOT EXISTS notes_internal text,
  ADD COLUMN IF NOT EXISTS medical_provider text,
  ADD COLUMN IF NOT EXISTS special_rate numeric,
  ADD COLUMN IF NOT EXISTS medical_flags jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- -----------------------------------------------------------------
-- public.guardians
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  middle_name text NULL,
  last_name text NULL,
  phone text NULL,
  email text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.guardians
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.guardians ALTER COLUMN first_name SET NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS guardians_name_idx
  ON public.guardians (first_name, last_name);

-- -----------------------------------------------------------------
-- public.client_profiles
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  metadata jsonb NULL
);

ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS identity_number text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS default_notification_method text,
  ADD COLUMN IF NOT EXISTS tags uuid[],
  ADD COLUMN IF NOT EXISTS onboarding_status text,
  ADD COLUMN IF NOT EXISTS is_active boolean,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.client_profiles ALTER COLUMN first_name SET NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.client_profiles ALTER COLUMN last_name SET NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.client_profiles
    ADD CONSTRAINT client_profiles_default_notification_method_check
    CHECK (default_notification_method IN ('whatsapp','email'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  UPDATE public.client_profiles
  SET onboarding_status = CASE
    WHEN onboarding_status = 'in_progress' THEN 'pending_forms'
    WHEN onboarding_status = 'completed' THEN 'approved'
    ELSE onboarding_status
  END
  WHERE onboarding_status IN ('in_progress', 'completed');

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_profiles_onboarding_status_check'
      AND conrelid = 'public.client_profiles'::regclass
  ) THEN
    ALTER TABLE public.client_profiles DROP CONSTRAINT client_profiles_onboarding_status_check;
  END IF;

  ALTER TABLE public.client_profiles
    ADD CONSTRAINT client_profiles_onboarding_status_check
    CHECK (onboarding_status IN ('not_started','pending_forms','approved'));
EXCEPTION
  WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS client_profiles_is_active_idx ON public.client_profiles (is_active);
CREATE INDEX IF NOT EXISTS client_profiles_name_idx ON public.client_profiles (first_name, last_name);

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS client_profiles_identity_number_unique_idx
    ON public.client_profiles (identity_number)
    WHERE identity_number IS NOT NULL AND identity_number <> '';
EXCEPTION
  WHEN others THEN NULL;
END $$;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS client_profile_id uuid;

DO $$
BEGIN
  ALTER TABLE public.students
    ADD CONSTRAINT students_client_profile_id_fkey
    FOREIGN KEY (client_profile_id) REFERENCES public.client_profiles(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS students_client_profile_id_uidx
    ON public.students (client_profile_id)
    WHERE client_profile_id IS NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
DECLARE
  student_row record;
  profile_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'first_name'
  ) THEN
    FOR student_row IN EXECUTE '
      SELECT id, first_name, middle_name, last_name, identity_number, phone, email, date_of_birth,
             default_notification_method, tags, onboarding_status, is_active, created_at, updated_at, metadata
      FROM public.students
      WHERE client_profile_id IS NULL
    '
    LOOP
      SELECT id
      INTO profile_id
      FROM public.client_profiles
      WHERE identity_number IS NOT DISTINCT FROM student_row.identity_number
        AND (
          student_row.identity_number IS NOT NULL
          OR (
            first_name IS NOT DISTINCT FROM student_row.first_name
            AND middle_name IS NOT DISTINCT FROM student_row.middle_name
            AND last_name IS NOT DISTINCT FROM student_row.last_name
            AND phone IS NOT DISTINCT FROM student_row.phone
            AND email IS NOT DISTINCT FROM student_row.email
          )
        )
      ORDER BY created_at
      LIMIT 1;

      IF profile_id IS NULL THEN
        INSERT INTO public.client_profiles (
          first_name,
          middle_name,
          last_name,
          identity_number,
          phone,
          email,
          date_of_birth,
          default_notification_method,
          tags,
          onboarding_status,
          is_active,
          created_at,
          updated_at,
          metadata
        ) VALUES (
          student_row.first_name,
          student_row.middle_name,
          student_row.last_name,
          student_row.identity_number,
          student_row.phone,
          student_row.email,
          student_row.date_of_birth,
          COALESCE(student_row.default_notification_method, 'whatsapp'),
          student_row.tags,
          CASE
            WHEN student_row.onboarding_status = 'pending_wl_form' THEN 'pending_forms'
            ELSE COALESCE(student_row.onboarding_status, 'not_started')
          END,
          COALESCE(student_row.is_active, true),
          COALESCE(student_row.created_at, now()),
          COALESCE(student_row.updated_at, COALESCE(student_row.created_at, now())),
          student_row.metadata
        )
        RETURNING id INTO profile_id;
      END IF;

      UPDATE public.students
      SET client_profile_id = profile_id
      WHERE id = student_row.id;
    END LOOP;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE public.students ALTER COLUMN client_profile_id SET NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DROP TRIGGER IF EXISTS students_sync_person_fields_from_client_profile_trigger ON public.students;
DROP TRIGGER IF EXISTS client_profiles_sync_to_students_trigger ON public.client_profiles;
DROP FUNCTION IF EXISTS public.sync_student_person_fields_from_client_profile();
DROP FUNCTION IF EXISTS public.sync_client_profile_changes_to_students();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_default_notification_method_check'
      AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students DROP CONSTRAINT students_default_notification_method_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_onboarding_status_check'
      AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students DROP CONSTRAINT students_onboarding_status_check;
  END IF;
END $$;

DROP INDEX IF EXISTS public.students_identity_number_unique_idx;
DROP INDEX IF EXISTS public.students_is_active_idx;
DROP INDEX IF EXISTS public.students_name_idx;

ALTER TABLE public.students
  DROP COLUMN IF EXISTS first_name,
  DROP COLUMN IF EXISTS middle_name,
  DROP COLUMN IF EXISTS last_name,
  DROP COLUMN IF EXISTS identity_number,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS date_of_birth,
  DROP COLUMN IF EXISTS default_notification_method,
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS onboarding_status,
  DROP COLUMN IF EXISTS is_active;

-- -----------------------------------------------------------------
-- public.client_guardians
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL,
  guardian_id uuid NOT NULL,
  relationship text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_guardians
  ADD COLUMN IF NOT EXISTS client_profile_id uuid,
  ADD COLUMN IF NOT EXISTS guardian_id uuid,
  ADD COLUMN IF NOT EXISTS relationship text,
  ADD COLUMN IF NOT EXISTS is_primary boolean,
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.client_guardians
    ADD CONSTRAINT client_guardians_client_profile_id_fkey
    FOREIGN KEY (client_profile_id) REFERENCES public.client_profiles(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.client_guardians
    ADD CONSTRAINT client_guardians_guardian_id_fkey
    FOREIGN KEY (guardian_id) REFERENCES public.guardians(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.client_guardians
    ADD CONSTRAINT client_guardians_relationship_check
    CHECK (relationship IN ('father','mother','self','caretaker','other'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS client_guardians_client_guardian_uidx
  ON public.client_guardians (client_profile_id, guardian_id);

CREATE INDEX IF NOT EXISTS client_guardians_client_profile_id_idx
  ON public.client_guardians (client_profile_id);

DO $$
BEGIN
  INSERT INTO public.client_guardians (client_profile_id, guardian_id, relationship, is_primary, created_at)
  SELECT s.client_profile_id, sg.guardian_id, sg.relationship, sg.is_primary, sg.created_at
  FROM public.student_guardians sg
  JOIN public.students s ON s.id = sg.student_id
  WHERE s.client_profile_id IS NOT NULL
  ON CONFLICT (client_profile_id, guardian_id) DO UPDATE
  SET relationship = EXCLUDED.relationship,
      is_primary = EXCLUDED.is_primary;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DROP TABLE IF EXISTS public.student_guardians;

-- -----------------------------------------------------------------
-- public.Employees (complete table with payroll fields)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Employees" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "first_name" text NOT NULL,
  "middle_name" text,
  "last_name" text,
  "employee_id" text NOT NULL,
  "employee_type" text,
  "payroll_model" text,
  "current_rate" numeric,
  "monthly_salary_amount" numeric,
  "phone" text,
  "email" text,
  "start_date" date,
  "is_active" boolean DEFAULT true,
  "notes" text,
  "working_days" jsonb,
  "annual_leave_days" numeric DEFAULT 12,
  "leave_pay_method" text,
  "leave_fixed_day_rate" numeric,
  "employment_scope" text,
  "instructor_types" uuid[],
  "metadata" jsonb,
  CONSTRAINT "Employees_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."Employees"
  ADD COLUMN IF NOT EXISTS "user_id" uuid,
  ADD COLUMN IF NOT EXISTS "first_name" text,
  ADD COLUMN IF NOT EXISTS "middle_name" text,
  ADD COLUMN IF NOT EXISTS "last_name" text,
  ADD COLUMN IF NOT EXISTS "employee_id" text,
  ADD COLUMN IF NOT EXISTS "employee_type" text,
  ADD COLUMN IF NOT EXISTS "payroll_model" text,
  ADD COLUMN IF NOT EXISTS "current_rate" numeric,
  ADD COLUMN IF NOT EXISTS "monthly_salary_amount" numeric,
  ADD COLUMN IF NOT EXISTS "phone" text,
  ADD COLUMN IF NOT EXISTS "email" text,
  ADD COLUMN IF NOT EXISTS "start_date" date,
  ADD COLUMN IF NOT EXISTS "is_active" boolean,
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "working_days" jsonb,
  ADD COLUMN IF NOT EXISTS "annual_leave_days" numeric,
  ADD COLUMN IF NOT EXISTS "leave_pay_method" text,
  ADD COLUMN IF NOT EXISTS "leave_fixed_day_rate" numeric,
  ADD COLUMN IF NOT EXISTS "employment_scope" text,
  ADD COLUMN IF NOT EXISTS "instructor_types" uuid[],
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

CREATE INDEX IF NOT EXISTS "Employees_name_idx" ON public."Employees" ("first_name", "last_name");
CREATE INDEX IF NOT EXISTS "Employees_user_id_idx" ON public."Employees" ("user_id");

DO $$
BEGIN
  ALTER TABLE public."Employees"
    ADD CONSTRAINT "Employees_payroll_model_check"
    CHECK ("payroll_model" IS NULL OR "payroll_model" IN ('hourly', 'monthly_salary', 'lesson_based'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- -----------------------------------------------------------------
-- public.Services (service catalog)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Services" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "duration_minutes" bigint,
  "payment_model" text,
  "color" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "metadata" jsonb,
  CONSTRAINT "Services_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."Services"
  ADD COLUMN IF NOT EXISTS "name" text,
  ADD COLUMN IF NOT EXISTS "duration_minutes" bigint,
  ADD COLUMN IF NOT EXISTS "payment_model" text,
  ADD COLUMN IF NOT EXISTS "color" text,
  ADD COLUMN IF NOT EXISTS "is_active" boolean,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

DO $$
BEGIN
  ALTER TABLE public."Services"
    ADD CONSTRAINT "Services_payment_model_check"
    CHECK ("payment_model" IS NULL OR "payment_model" IN ('fixed_rate', 'per_student'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- -----------------------------------------------------------------
-- public.RateHistory (rate tracking per employee/service/date)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."RateHistory" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "rate" numeric NOT NULL,
  "effective_date" date NOT NULL,
  "notes" text,
  "employee_id" uuid NOT NULL,
  "service_id" uuid,
  "metadata" jsonb,
  CONSTRAINT "RateHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RateHistory_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES public."Employees"("id"),
  CONSTRAINT "RateHistory_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES public."Services"("id")
);

ALTER TABLE public."RateHistory"
  ADD COLUMN IF NOT EXISTS "rate" numeric,
  ADD COLUMN IF NOT EXISTS "effective_date" date,
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "employee_id" uuid,
  ADD COLUMN IF NOT EXISTS "service_id" uuid,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

-- Add unique constraint to prevent duplicates per employee/service/effective_date
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'RateHistory_employee_service_effective_date_key'
      AND conrelid = 'public."RateHistory"'::regclass
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'RateHistory_employee_service_effective_date_key'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE public."RateHistory"
      ADD CONSTRAINT "RateHistory_employee_service_effective_date_key"
      UNIQUE (employee_id, service_id, effective_date);
  END IF;
END;
$$;

-- -----------------------------------------------------------------
-- Legacy cleanup: public.WorkSessions / public.LeaveBalances
-- -----------------------------------------------------------------

DROP INDEX IF EXISTS "WorkSessions_employee_date_idx";
DROP INDEX IF EXISTS "WorkSessions_service_idx";
DROP INDEX IF EXISTS "WorkSessions_deleted_idx";
DROP INDEX IF EXISTS "LeaveBalances_employee_date_idx";

ALTER TABLE IF EXISTS public.lesson_earnings
  DROP CONSTRAINT IF EXISTS lesson_earnings_work_session_id_fkey;

ALTER TABLE IF EXISTS public.lesson_earnings
  DROP COLUMN IF EXISTS work_session_id;

DROP TABLE IF EXISTS public."LeaveBalances";
DROP TABLE IF EXISTS public."WorkSessions";

-- -----------------------------------------------------------------
-- public.employee_attendance_records
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  metadata jsonb NULL
);

ALTER TABLE public.employee_attendance_records
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS attendance_date date,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS worked_minutes integer,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS version int,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.employee_attendance_records
    ADD CONSTRAINT employee_attendance_records_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public."Employees"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_attendance_records
    ADD CONSTRAINT employee_attendance_records_status_check
    CHECK (status IN ('present', 'partial', 'absent', 'remote'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_attendance_records
    ADD CONSTRAINT employee_attendance_records_source_type_check
    CHECK (source_type IN ('manual', 'import', 'system', 'correction'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DROP INDEX IF EXISTS public.employee_attendance_records_employee_date_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS employee_attendance_records_primary_date_uidx
  ON public.employee_attendance_records (employee_id, attendance_date)
  WHERE source_type IN ('manual', 'import', 'system');

CREATE INDEX IF NOT EXISTS employee_attendance_records_date_idx
  ON public.employee_attendance_records (attendance_date);

CREATE INDEX IF NOT EXISTS employee_attendance_records_correction_idx
  ON public.employee_attendance_records (employee_id, attendance_date, source_type)
  WHERE source_type = 'correction';

-- -----------------------------------------------------------------
-- public.employee_leave_entries
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_leave_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  metadata jsonb NULL
);

ALTER TABLE public.employee_leave_entries
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS leave_type text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS duration_mode text,
  ADD COLUMN IF NOT EXISTS half_day_part text,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_entries
    ADD CONSTRAINT employee_leave_entries_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public."Employees"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_entries
    ADD CONSTRAINT employee_leave_entries_leave_type_check
    CHECK (leave_type IN ('employee_paid', 'system_paid', 'unpaid', 'half_day'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_entries
    ADD CONSTRAINT employee_leave_entries_status_check
    CHECK (status IN ('approved', 'cancelled'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_entries
    ADD CONSTRAINT employee_leave_entries_duration_mode_check
    CHECK (duration_mode IN ('full_day', 'half_day'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_entries
    ADD CONSTRAINT employee_leave_entries_half_day_part_check
    CHECK (half_day_part IS NULL OR half_day_part IN ('first_half', 'second_half'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS employee_leave_entries_employee_range_idx
  ON public.employee_leave_entries (employee_id, start_date, end_date);

-- -----------------------------------------------------------------
-- public.employee_leave_days
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_leave_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_entry_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  leave_date date NOT NULL,
  day_portion text NOT NULL DEFAULT 'full_day',
  leave_type text NOT NULL,
  balance_days_delta numeric NOT NULL DEFAULT 0,
  pay_fraction numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.employee_leave_days
  ADD COLUMN IF NOT EXISTS leave_entry_id uuid,
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS leave_date date,
  ADD COLUMN IF NOT EXISTS day_portion text,
  ADD COLUMN IF NOT EXISTS leave_type text,
  ADD COLUMN IF NOT EXISTS balance_days_delta numeric,
  ADD COLUMN IF NOT EXISTS pay_fraction numeric,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_days
    ADD CONSTRAINT employee_leave_days_leave_entry_id_fkey
    FOREIGN KEY (leave_entry_id) REFERENCES public.employee_leave_entries(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_days
    ADD CONSTRAINT employee_leave_days_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public."Employees"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_days
    ADD CONSTRAINT employee_leave_days_day_portion_check
    CHECK (day_portion IN ('full_day', 'first_half', 'second_half'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_days
    ADD CONSTRAINT employee_leave_days_leave_type_check
    CHECK (leave_type IN ('employee_paid', 'system_paid', 'unpaid', 'half_day'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS employee_leave_days_employee_date_uidx
  ON public.employee_leave_days (employee_id, leave_date);

CREATE INDEX IF NOT EXISTS employee_leave_days_entry_idx
  ON public.employee_leave_days (leave_entry_id);

-- -----------------------------------------------------------------
-- public.employee_leave_balance_events
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_leave_balance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  metadata jsonb NULL
);

ALTER TABLE public.employee_leave_balance_events
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS leave_entry_id uuid,
  ADD COLUMN IF NOT EXISTS leave_day_id uuid,
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS leave_type text,
  ADD COLUMN IF NOT EXISTS quantity_days numeric,
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_balance_events
    ADD CONSTRAINT employee_leave_balance_events_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public."Employees"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_balance_events
    ADD CONSTRAINT employee_leave_balance_events_leave_entry_id_fkey
    FOREIGN KEY (leave_entry_id) REFERENCES public.employee_leave_entries(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_balance_events
    ADD CONSTRAINT employee_leave_balance_events_leave_day_id_fkey
    FOREIGN KEY (leave_day_id) REFERENCES public.employee_leave_days(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_leave_balance_events
    ADD CONSTRAINT employee_leave_balance_events_event_type_check
    CHECK (event_type IN ('allocation', 'carryover', 'adjustment', 'usage', 'reversal', 'correction'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS employee_leave_balance_events_employee_date_idx
  ON public.employee_leave_balance_events (employee_id, effective_date);

-- -----------------------------------------------------------------
-- public.finance_corrections
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.finance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  correction_type text NOT NULL,
  amount numeric NOT NULL,
  effective_date date NOT NULL,
  notes text NULL,
  version int NOT NULL DEFAULT 1,
  created_by uuid NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.finance_corrections
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS correction_type text,
  ADD COLUMN IF NOT EXISTS amount numeric,
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS version int,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.finance_corrections
    ADD CONSTRAINT finance_corrections_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public."Employees"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.finance_corrections
    ADD CONSTRAINT finance_corrections_correction_type_check
    CHECK (correction_type IN ('bonus', 'deduction', 'adjustment', 'correction'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS finance_corrections_employee_date_idx
  ON public.finance_corrections (employee_id, effective_date);

-- -----------------------------------------------------------------
-- public.instructor_profiles
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.instructor_profiles (
  employee_id uuid PRIMARY KEY,
  break_time_minutes int NULL,
  metadata jsonb NULL
);

ALTER TABLE public.instructor_profiles
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS break_time_minutes int,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE public.instructor_profiles
  DROP COLUMN IF EXISTS working_days;

DO $$
BEGIN
  ALTER TABLE public.instructor_profiles
    ADD CONSTRAINT instructor_profiles_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public."Employees"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- -----------------------------------------------------------------
-- public.instructor_service_capabilities
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.instructor_service_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  service_id uuid NOT NULL,
  max_students int NOT NULL DEFAULT 1,
  base_rate numeric NULL,
  availability_windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NULL
);

ALTER TABLE public.instructor_service_capabilities
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS service_id uuid,
  ADD COLUMN IF NOT EXISTS max_students int,
  ADD COLUMN IF NOT EXISTS base_rate numeric,
  ADD COLUMN IF NOT EXISTS availability_windows jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

UPDATE public.instructor_service_capabilities
SET availability_windows = '[]'::jsonb
WHERE availability_windows IS NULL;

DO $$
BEGIN
  ALTER TABLE public.instructor_service_capabilities
    ALTER COLUMN availability_windows SET DEFAULT '[]'::jsonb;
  ALTER TABLE public.instructor_service_capabilities
    ALTER COLUMN availability_windows SET NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.instructor_service_capabilities
    ADD CONSTRAINT instructor_service_capabilities_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public."Employees"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.instructor_service_capabilities
    ADD CONSTRAINT instructor_service_capabilities_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES public."Services"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS instructor_service_capabilities_employee_service_uidx
  ON public.instructor_service_capabilities (employee_id, service_id);

CREATE INDEX IF NOT EXISTS instructor_service_capabilities_employee_id_idx
  ON public.instructor_service_capabilities (employee_id);

-- -----------------------------------------------------------------
-- public.lesson_templates
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lesson_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  instructor_employee_id uuid NOT NULL,
  service_id uuid NOT NULL,
  day_of_week text NOT NULL,
  time_of_day time NOT NULL,
  duration_minutes int NOT NULL,
  valid_from date NOT NULL,
  valid_until date NULL,
  price_override numeric NULL,
  notes_internal text NULL,
  flags jsonb NULL,
  is_active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  supersedes_template_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.lesson_templates
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS instructor_employee_id uuid,
  ADD COLUMN IF NOT EXISTS service_id uuid,
  ADD COLUMN IF NOT EXISTS day_of_week text,
  ADD COLUMN IF NOT EXISTS time_of_day time,
  ADD COLUMN IF NOT EXISTS duration_minutes int,
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS price_override numeric,
  ADD COLUMN IF NOT EXISTS notes_internal text,
  ADD COLUMN IF NOT EXISTS flags jsonb,
  ADD COLUMN IF NOT EXISTS is_active boolean,
  ADD COLUMN IF NOT EXISTS version int,
  ADD COLUMN IF NOT EXISTS supersedes_template_id uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.lesson_templates
    ADD CONSTRAINT lesson_templates_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_templates
    ADD CONSTRAINT lesson_templates_instructor_employee_id_fkey
    FOREIGN KEY (instructor_employee_id) REFERENCES public."Employees"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_templates
    ADD CONSTRAINT lesson_templates_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES public."Services"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_templates
    ADD CONSTRAINT lesson_templates_supersedes_template_id_fkey
    FOREIGN KEY (supersedes_template_id) REFERENCES public.lesson_templates(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- Drop trigger and old day constraint before changing day_of_week type.
DROP TRIGGER IF EXISTS trg_lesson_templates_active_overlap_guard
  ON public.lesson_templates;

ALTER TABLE public.lesson_templates
  DROP CONSTRAINT IF EXISTS lesson_templates_day_of_week_check;

DO $$
BEGIN
  ALTER TABLE public.lesson_templates
    ALTER COLUMN day_of_week TYPE text
    USING (
      CASE
        WHEN day_of_week::text = '0' THEN 'sunday'
        WHEN day_of_week::text = '1' THEN 'monday'
        WHEN day_of_week::text = '2' THEN 'tuesday'
        WHEN day_of_week::text = '3' THEN 'wednesday'
        WHEN day_of_week::text = '4' THEN 'thursday'
        WHEN day_of_week::text = '5' THEN 'friday'
        WHEN day_of_week::text = '6' THEN 'saturday'
        ELSE lower(day_of_week::text)
      END
    );
EXCEPTION
  WHEN undefined_column THEN
    NULL;
END $$;

ALTER TABLE public.lesson_templates
  ADD CONSTRAINT lesson_templates_day_of_week_check
  CHECK (day_of_week IN ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'));

CREATE INDEX IF NOT EXISTS lesson_templates_student_id_idx ON public.lesson_templates (student_id);
CREATE INDEX IF NOT EXISTS lesson_templates_instructor_day_time_idx ON public.lesson_templates (instructor_employee_id, day_of_week, time_of_day);

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
      AND existing.student_id = NEW.student_id
      AND existing.instructor_employee_id = NEW.instructor_employee_id
      AND existing.day_of_week = NEW.day_of_week
      AND existing.time_of_day = NEW.time_of_day
      AND existing.is_active = true
      AND NEW.valid_from <= COALESCE(existing.valid_until, DATE '9999-12-31')
      AND existing.valid_from <= COALESCE(NEW.valid_until, DATE '9999-12-31')
  ) THEN
    RAISE EXCEPTION 'duplicate_template_conflict'
      USING ERRCODE = '23P01',
            DETAIL = 'lesson_templates_active_overlap';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_lesson_templates_active_overlap_guard'
      AND tgrelid = 'public.lesson_templates'::regclass
  ) THEN
    CREATE TRIGGER trg_lesson_templates_active_overlap_guard
      BEFORE INSERT OR UPDATE OF student_id, instructor_employee_id, day_of_week, time_of_day, valid_from, valid_until, is_active
      ON public.lesson_templates
      FOR EACH ROW
      EXECUTE FUNCTION public.validate_lesson_template_no_active_overlap();
  END IF;
END
$$;

-- -----------------------------------------------------------------
-- public.lesson_template_overrides
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lesson_template_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  target_date date NOT NULL,
  override_type text NOT NULL,
  new_instructor_employee_id uuid NULL,
  new_service_id uuid NULL,
  new_time_of_day time NULL,
  new_duration_minutes int NULL,
  note text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lesson_template_overrides
  ADD COLUMN IF NOT EXISTS template_id uuid,
  ADD COLUMN IF NOT EXISTS target_date date,
  ADD COLUMN IF NOT EXISTS override_type text,
  ADD COLUMN IF NOT EXISTS new_instructor_employee_id uuid,
  ADD COLUMN IF NOT EXISTS new_service_id uuid,
  ADD COLUMN IF NOT EXISTS new_time_of_day time,
  ADD COLUMN IF NOT EXISTS new_duration_minutes int,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.lesson_template_overrides
    ADD CONSTRAINT lesson_template_overrides_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES public.lesson_templates(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_template_overrides
    ADD CONSTRAINT lesson_template_overrides_new_instructor_employee_id_fkey
    FOREIGN KEY (new_instructor_employee_id) REFERENCES public."Employees"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_template_overrides
    ADD CONSTRAINT lesson_template_overrides_new_service_id_fkey
    FOREIGN KEY (new_service_id) REFERENCES public."Services"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_template_overrides
    ADD CONSTRAINT lesson_template_overrides_override_type_check
    CHECK (override_type IN ('cancel','modify'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS lesson_template_overrides_template_date_uidx
  ON public.lesson_template_overrides (template_id, target_date);

CREATE INDEX IF NOT EXISTS lesson_template_overrides_target_date_idx
  ON public.lesson_template_overrides (target_date);

-- -----------------------------------------------------------------
-- public.lesson_instances
-- -----------------------------------------------------------------
-- is_closed is the workflow closure flag for a lesson instance.
-- It must reflect downstream settlement completion, not only attendance
-- resolution. A lesson may be attendance-resolved and still remain open until
-- billing, payroll, and required HMO claim workflow are resolved.

CREATE TABLE IF NOT EXISTS public.lesson_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  metadata jsonb NULL
);

ALTER TABLE public.lesson_instances
  ADD COLUMN IF NOT EXISTS template_id uuid,
  ADD COLUMN IF NOT EXISTS applied_override_id uuid,
  ADD COLUMN IF NOT EXISTS datetime_start timestamptz,
  ADD COLUMN IF NOT EXISTS duration_minutes int,
  ADD COLUMN IF NOT EXISTS instructor_employee_id uuid,
  ADD COLUMN IF NOT EXISTS service_id uuid,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS documentation_status text,
  ADD COLUMN IF NOT EXISTS is_closed boolean,
  ADD COLUMN IF NOT EXISTS closed_reason text,
  ADD COLUMN IF NOT EXISTS closed_by uuid,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_source text,
  ADD COLUMN IF NOT EXISTS version int,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.lesson_instances
    ADD CONSTRAINT lesson_instances_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES public.lesson_templates(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_instances
    ADD CONSTRAINT lesson_instances_instructor_employee_id_fkey
    FOREIGN KEY (instructor_employee_id) REFERENCES public."Employees"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_instances
    ADD CONSTRAINT lesson_instances_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES public."Services"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_instances
    ADD CONSTRAINT lesson_instances_applied_override_id_fkey
    FOREIGN KEY (applied_override_id) REFERENCES public.lesson_template_overrides(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_instances
    ADD CONSTRAINT lesson_instances_status_check
    CHECK (status IN ('scheduled','completed','cancelled_student','cancelled_clinic','no_show'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_instances
    ADD CONSTRAINT lesson_instances_documentation_status_check
    CHECK (documentation_status IN ('undocumented','documented'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_instances
    ADD CONSTRAINT lesson_instances_created_source_check
    CHECK (created_source IN ('weekly_generation','one_time','manual_reschedule','migration'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS lesson_instances_datetime_start_idx ON public.lesson_instances (datetime_start);
CREATE INDEX IF NOT EXISTS lesson_instances_instructor_datetime_idx ON public.lesson_instances (instructor_employee_id, datetime_start);
CREATE INDEX IF NOT EXISTS lesson_instances_applied_override_id_idx ON public.lesson_instances (applied_override_id) WHERE applied_override_id IS NOT NULL;

-- -----------------------------------------------------------------
-- public.lesson_participants
-- -----------------------------------------------------------------
-- metadata.workflow may hold participant-level workflow decisions used by the
-- calendar closeout flow, such as student billing, instructor compensation, and
-- HMO claim decisions. These values are source-side workflow inputs only; they
-- do not replace dedicated financial or task artifact tables.

CREATE TABLE IF NOT EXISTS public.lesson_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_instance_id uuid NOT NULL,
  client_profile_id uuid NOT NULL,
  student_id uuid NULL,
  participant_status text NOT NULL,
  price_charged numeric NULL,
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
  metadata jsonb NULL
);

ALTER TABLE public.lesson_participants
  ADD COLUMN IF NOT EXISTS lesson_instance_id uuid,
  ADD COLUMN IF NOT EXISTS client_profile_id uuid,
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS participant_status text,
  ADD COLUMN IF NOT EXISTS price_charged numeric,
  ADD COLUMN IF NOT EXISTS pricing_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS commitment_id uuid,
  ADD COLUMN IF NOT EXISTS documentation_ref jsonb,
  ADD COLUMN IF NOT EXISTS reminder_sent boolean,
  ADD COLUMN IF NOT EXISTS reminder_seen boolean,
  ADD COLUMN IF NOT EXISTS attendance_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS documented_at timestamptz,
  ADD COLUMN IF NOT EXISTS documented_by uuid,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS version int,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.lesson_participants
    ADD CONSTRAINT lesson_participants_lesson_instance_id_fkey
    FOREIGN KEY (lesson_instance_id) REFERENCES public.lesson_instances(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_participants
    ADD CONSTRAINT lesson_participants_client_profile_id_fkey
    FOREIGN KEY (client_profile_id) REFERENCES public.client_profiles(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_participants
    ADD CONSTRAINT lesson_participants_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_participants
    ADD CONSTRAINT lesson_participants_participant_status_check
    CHECK (participant_status IN ('scheduled','attended','cancelled_student','cancelled_clinic','no_show'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS lesson_participants_instance_client_profile_uidx
  ON public.lesson_participants (lesson_instance_id, client_profile_id);

CREATE INDEX IF NOT EXISTS lesson_participants_client_profile_id_idx
  ON public.lesson_participants (client_profile_id);

CREATE INDEX IF NOT EXISTS lesson_participants_student_id_idx
  ON public.lesson_participants (student_id);

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
  ALTER TABLE public.lesson_participants ALTER COLUMN client_profile_id SET NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS lesson_participants_locked_at_idx
  ON public.lesson_participants (locked_at) WHERE locked_at IS NOT NULL;

-- -----------------------------------------------------------------
-- public.payroll_runs
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  finalized_at timestamptz NULL,
  finalized_by uuid NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_by uuid,
  ADD COLUMN IF NOT EXISTS version int,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.payroll_runs
    ADD CONSTRAINT payroll_runs_status_check
    CHECK (status IN ('draft', 'finalized', 'cancelled'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS payroll_runs_period_idx
  ON public.payroll_runs (period_start, period_end, status);

-- -----------------------------------------------------------------
-- public.claim_batches
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.claim_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  metadata jsonb NULL
);

ALTER TABLE public.claim_batches
  ADD COLUMN IF NOT EXISTS batch_type text,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid,
  ADD COLUMN IF NOT EXISTS version int,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.claim_batches
    ADD CONSTRAINT claim_batches_batch_type_check
    CHECK (batch_type IN ('hmo', 'manual'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.claim_batches
    ADD CONSTRAINT claim_batches_status_check
    CHECK (status IN ('draft', 'submitted', 'rejected', 'paid', 'cancelled'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS claim_batches_period_idx
  ON public.claim_batches (period_start, period_end, status);

-- -----------------------------------------------------------------
-- public.instance_locks
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.instance_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_instance_id uuid NOT NULL,
  lock_source_type text NOT NULL,
  lock_source_id uuid NOT NULL,
  lock_reason text NOT NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.instance_locks
  ADD COLUMN IF NOT EXISTS lesson_instance_id uuid,
  ADD COLUMN IF NOT EXISTS lock_source_type text,
  ADD COLUMN IF NOT EXISTS lock_source_id uuid,
  ADD COLUMN IF NOT EXISTS lock_reason text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.instance_locks
    ADD CONSTRAINT instance_locks_lesson_instance_id_fkey
    FOREIGN KEY (lesson_instance_id) REFERENCES public.lesson_instances(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.instance_locks
    ADD CONSTRAINT instance_locks_source_type_check
    CHECK (lock_source_type IN ('payroll_run', 'claim_batch', 'manual_compliance_lock'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS instance_locks_instance_source_uidx
  ON public.instance_locks (lesson_instance_id, lock_source_type, lock_source_id);

CREATE INDEX IF NOT EXISTS instance_locks_instance_idx
  ON public.instance_locks (lesson_instance_id, created_at DESC);

-- -----------------------------------------------------------------
-- public.participant_locks
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.participant_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_participant_id uuid NOT NULL,
  lock_source_type text NOT NULL,
  lock_source_id uuid NOT NULL,
  lock_reason text NOT NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.participant_locks
  ADD COLUMN IF NOT EXISTS lesson_participant_id uuid,
  ADD COLUMN IF NOT EXISTS lock_source_type text,
  ADD COLUMN IF NOT EXISTS lock_source_id uuid,
  ADD COLUMN IF NOT EXISTS lock_reason text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.participant_locks
    ADD CONSTRAINT participant_locks_lesson_participant_id_fkey
    FOREIGN KEY (lesson_participant_id) REFERENCES public.lesson_participants(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.participant_locks
    ADD CONSTRAINT participant_locks_source_type_check
    CHECK (lock_source_type IN ('payroll_run', 'claim_batch', 'manual_compliance_lock'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS participant_locks_participant_source_uidx
  ON public.participant_locks (lesson_participant_id, lock_source_type, lock_source_id);

CREATE INDEX IF NOT EXISTS participant_locks_participant_idx
  ON public.participant_locks (lesson_participant_id, created_at DESC);

-- -----------------------------------------------------------------
-- public.calendar_instance_corrections
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calendar_instance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  metadata jsonb NULL
);

ALTER TABLE public.calendar_instance_corrections
  ADD COLUMN IF NOT EXISTS original_instance_id uuid,
  ADD COLUMN IF NOT EXISTS correction_mode text,
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS reason_text text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS instance_patch jsonb,
  ADD COLUMN IF NOT EXISTS participant_patches jsonb,
  ADD COLUMN IF NOT EXISTS effective_state jsonb,
  ADD COLUMN IF NOT EXISTS impact_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS blocked_by_paid_claim boolean,
  ADD COLUMN IF NOT EXISTS version int,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.calendar_instance_corrections
    ADD CONSTRAINT calendar_instance_corrections_instance_fkey
    FOREIGN KEY (original_instance_id) REFERENCES public.lesson_instances(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.calendar_instance_corrections
    ADD CONSTRAINT calendar_instance_corrections_mode_check
    CHECK (correction_mode IN ('value_only', 'replacement_instance', 'participant_adjustment'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.calendar_instance_corrections
    ADD CONSTRAINT calendar_instance_corrections_status_check
    CHECK (status IN ('previewed', 'applied', 'blocked'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS calendar_instance_corrections_instance_idx
  ON public.calendar_instance_corrections (original_instance_id, created_at DESC);

-- -----------------------------------------------------------------
-- public.tenant_audit_log
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tenant_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NULL,
  actor_user_id uuid NULL,
  event_type text NOT NULL,
  retention_category text NOT NULL DEFAULT 'standard',
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  before_state jsonb NULL,
  after_state jsonb NULL,
  details jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL
);

ALTER TABLE public.tenant_audit_log
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS actor_user_id uuid,
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS retention_category text,
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS resource_id text,
  ADD COLUMN IF NOT EXISTS before_state jsonb,
  ADD COLUMN IF NOT EXISTS after_state jsonb,
  ADD COLUMN IF NOT EXISTS details jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.tenant_audit_log
    ADD CONSTRAINT tenant_audit_log_retention_category_check
    CHECK (retention_category IN ('critical', 'standard', 'diagnostic'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS tenant_audit_log_resource_idx
  ON public.tenant_audit_log (resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_audit_log_expiry_idx
  ON public.tenant_audit_log (expires_at) WHERE expires_at IS NOT NULL;

-- -----------------------------------------------------------------
-- public.dashboard_tasks
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.dashboard_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  metadata jsonb NULL
);

ALTER TABLE public.dashboard_tasks
  ADD COLUMN IF NOT EXISTS task_type text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS priority text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS resource_id text,
  ADD COLUMN IF NOT EXISTS action_path text,
  ADD COLUMN IF NOT EXISTS version int,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS resolved_by uuid,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.dashboard_tasks
    ADD CONSTRAINT dashboard_tasks_priority_check
    CHECK (priority IN ('low', 'medium', 'high', 'critical'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.dashboard_tasks
    ADD CONSTRAINT dashboard_tasks_status_check
    CHECK (status IN ('open', 'resolved', 'dismissed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS dashboard_tasks_open_idx
  ON public.dashboard_tasks (status, priority, created_at DESC)
  WHERE status = 'open';

-- -----------------------------------------------------------------
-- public.hmo_providers
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.hmo_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hmo_providers
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS is_active boolean,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS hmo_providers_name_uidx
  ON public.hmo_providers (lower(name));

-- -----------------------------------------------------------------
-- public.hmo_provider_tracks
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.hmo_provider_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  service_id uuid NULL,
  name text NOT NULL,
  payment_mode text NOT NULL DEFAULT 'partially_paid_by_hmo',
  default_customer_charge_amount numeric NOT NULL DEFAULT 0,
  default_insurer_claim_amount numeric NOT NULL DEFAULT 0,
  default_workflow_notes text NULL,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hmo_provider_tracks
  ADD COLUMN IF NOT EXISTS provider_id uuid,
  ADD COLUMN IF NOT EXISTS service_id uuid,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS payment_mode text,
  ADD COLUMN IF NOT EXISTS default_customer_charge_amount numeric,
  ADD COLUMN IF NOT EXISTS default_insurer_claim_amount numeric,
  ADD COLUMN IF NOT EXISTS default_workflow_notes text,
  ADD COLUMN IF NOT EXISTS is_active boolean,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.hmo_provider_tracks
    ADD CONSTRAINT hmo_provider_tracks_provider_id_fkey
    FOREIGN KEY (provider_id) REFERENCES public.hmo_providers(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.hmo_provider_tracks
    ADD CONSTRAINT hmo_provider_tracks_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES public."Services"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.hmo_provider_tracks
    ADD CONSTRAINT hmo_provider_tracks_payment_mode_check
    CHECK (payment_mode IN ('fully_paid_by_hmo', 'partially_paid_by_hmo', 'fully_paid_by_customer'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.hmo_provider_tracks
    ADD CONSTRAINT hmo_provider_tracks_customer_charge_non_negative_check
    CHECK (default_customer_charge_amount >= 0);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.hmo_provider_tracks
    ADD CONSTRAINT hmo_provider_tracks_insurer_claim_non_negative_check
    CHECK (default_insurer_claim_amount >= 0);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DROP INDEX IF EXISTS hmo_provider_tracks_provider_name_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS hmo_provider_tracks_provider_service_name_uidx
  ON public.hmo_provider_tracks (provider_id, service_id, lower(name));

CREATE INDEX IF NOT EXISTS hmo_provider_tracks_provider_id_idx
  ON public.hmo_provider_tracks (provider_id);

CREATE INDEX IF NOT EXISTS hmo_provider_tracks_service_id_idx
  ON public.hmo_provider_tracks (service_id);

-- -----------------------------------------------------------------
-- public.hmo_authorizations
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.hmo_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  service_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  provider_track_id uuid NOT NULL,
  authorization_reference text NULL,
  authorized_lessons int NOT NULL DEFAULT 0,
  valid_from date NULL,
  expires_at date NULL,
  reminder_date date NULL,
  customer_charge_amount_override numeric NULL,
  insurer_claim_amount_override numeric NULL,
  workflow_notes_override text NULL,
  status text NOT NULL DEFAULT 'active',
  notes text NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hmo_authorizations
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS service_id uuid,
  ADD COLUMN IF NOT EXISTS provider_id uuid,
  ADD COLUMN IF NOT EXISTS provider_track_id uuid,
  ADD COLUMN IF NOT EXISTS authorization_reference text,
  ADD COLUMN IF NOT EXISTS authorized_lessons int,
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS expires_at date,
  ADD COLUMN IF NOT EXISTS reminder_date date,
  ADD COLUMN IF NOT EXISTS customer_charge_amount_override numeric,
  ADD COLUMN IF NOT EXISTS insurer_claim_amount_override numeric,
  ADD COLUMN IF NOT EXISTS workflow_notes_override text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.hmo_authorizations
    ADD CONSTRAINT hmo_authorizations_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.hmo_authorizations
    ADD CONSTRAINT hmo_authorizations_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES public."Services"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.hmo_authorizations
    ADD CONSTRAINT hmo_authorizations_provider_id_fkey
    FOREIGN KEY (provider_id) REFERENCES public.hmo_providers(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.hmo_authorizations
    ADD CONSTRAINT hmo_authorizations_provider_track_id_fkey
    FOREIGN KEY (provider_track_id) REFERENCES public.hmo_provider_tracks(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.hmo_authorizations
    ADD CONSTRAINT hmo_authorizations_status_check
    CHECK (status IN ('active', 'cancelled', 'completed', 'expired'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.hmo_authorizations
    ADD CONSTRAINT hmo_authorizations_authorized_lessons_non_negative_check
    CHECK (authorized_lessons >= 0);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.hmo_authorizations
    ADD CONSTRAINT hmo_authorizations_customer_override_non_negative_check
    CHECK (customer_charge_amount_override IS NULL OR customer_charge_amount_override >= 0);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.hmo_authorizations
    ADD CONSTRAINT hmo_authorizations_insurer_override_non_negative_check
    CHECK (insurer_claim_amount_override IS NULL OR insurer_claim_amount_override >= 0);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS hmo_authorizations_student_id_idx
  ON public.hmo_authorizations (student_id);

CREATE INDEX IF NOT EXISTS hmo_authorizations_service_id_idx
  ON public.hmo_authorizations (service_id);

CREATE INDEX IF NOT EXISTS hmo_authorizations_provider_id_idx
  ON public.hmo_authorizations (provider_id);

CREATE INDEX IF NOT EXISTS hmo_authorizations_provider_track_id_idx
  ON public.hmo_authorizations (provider_track_id);

CREATE UNIQUE INDEX IF NOT EXISTS hmo_authorizations_active_student_service_uidx
  ON public.hmo_authorizations (student_id, service_id)
  WHERE status = 'active';

-- -----------------------------------------------------------------
-- public.commitments
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  service_id uuid NOT NULL,
  commitment_type text NOT NULL DEFAULT 'package',
  total_amount numeric NOT NULL,
  default_charge_amount numeric NULL,
  transfer_ref uuid NULL,
  notes text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  metadata jsonb NULL,
  hmo_provider_id uuid NULL,
  hmo_provider_track_id uuid NULL,
  hmo_authorization_id uuid NULL
);

ALTER TABLE public.commitments
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS service_id uuid,
  ADD COLUMN IF NOT EXISTS commitment_type text,
  ADD COLUMN IF NOT EXISTS total_amount numeric,
  ADD COLUMN IF NOT EXISTS default_charge_amount numeric,
  ADD COLUMN IF NOT EXISTS transfer_ref uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS is_active boolean,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS hmo_provider_id uuid,
  ADD COLUMN IF NOT EXISTS hmo_provider_track_id uuid,
  ADD COLUMN IF NOT EXISTS hmo_authorization_id uuid;

DO $$
BEGIN
  ALTER TABLE public.commitments
    ADD CONSTRAINT commitments_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.commitments
    ADD CONSTRAINT commitments_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES public."Services"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.commitments
    ADD CONSTRAINT commitments_hmo_provider_id_fkey
    FOREIGN KEY (hmo_provider_id) REFERENCES public.hmo_providers(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.commitments
    ADD CONSTRAINT commitments_hmo_provider_track_id_fkey
    FOREIGN KEY (hmo_provider_track_id) REFERENCES public.hmo_provider_tracks(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.commitments
    ADD CONSTRAINT commitments_hmo_authorization_id_fkey
    FOREIGN KEY (hmo_authorization_id) REFERENCES public.hmo_authorizations(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.commitments
    ADD CONSTRAINT commitments_commitment_type_check
    CHECK (commitment_type IN ('package', 'subscription', 'hmo', 'manual_credit'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.commitments
    ADD CONSTRAINT commitments_total_amount_non_negative_check
    CHECK (total_amount >= 0);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.commitments
    ADD CONSTRAINT commitments_default_charge_amount_non_negative_check
    CHECK (default_charge_amount IS NULL OR default_charge_amount >= 0);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS commitments_student_id_idx ON public.commitments (student_id);
CREATE INDEX IF NOT EXISTS commitments_transfer_ref_idx ON public.commitments (transfer_ref) WHERE transfer_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS commitments_hmo_provider_id_idx ON public.commitments (hmo_provider_id) WHERE hmo_provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commitments_hmo_provider_track_id_idx ON public.commitments (hmo_provider_track_id) WHERE hmo_provider_track_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS commitments_hmo_authorization_id_uidx ON public.commitments (hmo_authorization_id) WHERE hmo_authorization_id IS NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.lesson_participants
    ADD CONSTRAINT lesson_participants_commitment_id_fkey
    FOREIGN KEY (commitment_id) REFERENCES public.commitments(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- -----------------------------------------------------------------
-- public.ledger_transactions (replaces consumption_entries)
-- Double-entry-like ledger: balance = SUM(CREDIT) - SUM(DEBIT)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  commitment_id uuid NOT NULL,
  transaction_type text NOT NULL,
  usage_type text NOT NULL,
  amount numeric NOT NULL,
  source_ref uuid NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.ledger_transactions
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS commitment_id uuid,
  ADD COLUMN IF NOT EXISTS transaction_type text,
  ADD COLUMN IF NOT EXISTS usage_type text,
  ADD COLUMN IF NOT EXISTS amount numeric,
  ADD COLUMN IF NOT EXISTS source_ref uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.ledger_transactions
    ADD CONSTRAINT ledger_transactions_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.ledger_transactions
    ADD CONSTRAINT ledger_transactions_commitment_id_fkey
    FOREIGN KEY (commitment_id) REFERENCES public.commitments(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.ledger_transactions
    ADD CONSTRAINT ledger_transactions_transaction_type_check
    CHECK (transaction_type IN ('CREDIT', 'DEBIT'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.ledger_transactions
    ADD CONSTRAINT ledger_transactions_usage_type_check
    CHECK (
      (transaction_type = 'CREDIT' AND usage_type IN ('manual_topup', 'commitment_creation', 'transfer_received', 'hmo_authorization_added'))
      OR (transaction_type = 'DEBIT' AND usage_type IN ('standard', 'double', 'cross_service', 'manual_adjustment'))
    );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.ledger_transactions
    ADD CONSTRAINT ledger_transactions_amount_non_negative_check
    CHECK (amount >= 0);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- Unique constraint for lesson-based debits: one debit per (source_ref, usage_type).
-- NULL source_ref rows (manual adjustments, credits) are excluded by PostgreSQL semantics.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ledger_transactions_source_usage_unique'
      AND conrelid = 'public.ledger_transactions'::regclass
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'ledger_transactions_source_usage_unique'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE public.ledger_transactions
      ADD CONSTRAINT ledger_transactions_source_usage_unique
      UNIQUE (source_ref, usage_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ledger_transactions_commitment_id_idx
  ON public.ledger_transactions (commitment_id);
CREATE INDEX IF NOT EXISTS ledger_transactions_student_id_idx
  ON public.ledger_transactions (student_id);
CREATE INDEX IF NOT EXISTS ledger_transactions_transaction_type_idx
  ON public.ledger_transactions (transaction_type);
CREATE INDEX IF NOT EXISTS ledger_transactions_usage_type_idx
  ON public.ledger_transactions (usage_type);
CREATE INDEX IF NOT EXISTS ledger_transactions_created_at_idx
  ON public.ledger_transactions (created_at);

-- Trigger: validate that ledger transaction commitment belongs to the same student
CREATE OR REPLACE FUNCTION public.validate_ledger_commitment_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_commitment_student_id uuid;
BEGIN
  SELECT c.student_id
    INTO v_commitment_student_id
  FROM public.commitments c
  WHERE c.id = NEW.commitment_id;

  IF v_commitment_student_id IS NULL THEN
    RAISE EXCEPTION 'Invalid commitment_id for ledger transaction';
  END IF;

  IF v_commitment_student_id <> NEW.student_id THEN
    RAISE EXCEPTION 'ledger_transactions.commitment_id must belong to the same student';
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

-- =================================================================
-- Inline Data Migration: consumption_entries -> ledger_transactions
-- Runs BEFORE dropping consumption_entries. Fully idempotent.
-- =================================================================

-- 1) Migrate existing commitments as CREDIT (commitment_creation).
--    Deterministic UUID derived from commitment id to ensure idempotency.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'commitments') THEN
    INSERT INTO public.ledger_transactions (id, student_id, commitment_id, transaction_type, usage_type, amount, source_ref, notes, created_at, updated_at, metadata)
    SELECT
      md5('commitment-credit:' || c.id::text)::uuid,
      c.student_id,
      c.id,
      'CREDIT',
      'commitment_creation',
      COALESCE(c.total_amount, 0),
      NULL,
      'יצירת התחייבות (מיגרציה)',
      c.created_at,
      COALESCE(c.updated_at, c.created_at),
      jsonb_build_object('migration', 'commitment_to_credit', 'original_commitment_id', c.id)
    FROM public.commitments c
    WHERE c.total_amount > 0
    ON CONFLICT (id) DO UPDATE
      SET notes = EXCLUDED.notes
      WHERE ledger_transactions.notes = 'Migrated from commitment total_amount';
  END IF;
END $$;

-- 2) Migrate existing consumption_entries as DEBIT or CREDIT rows.
--    Only rows with a non-null commitment_id can be migrated (strict FK).
--    Uses the original consumption_entries.id as the new ledger id.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'consumption_entries') THEN
    INSERT INTO public.ledger_transactions (id, student_id, commitment_id, transaction_type, usage_type, amount, source_ref, notes, created_at, updated_at, metadata)
    SELECT
      e.id,
      COALESCE(e.student_id, lp.student_id, c.student_id),
      e.commitment_id,
      CASE WHEN e.amount_charged < 0 THEN 'CREDIT' ELSE 'DEBIT' END,
      CASE
        WHEN e.amount_charged < 0 THEN 'manual_topup'
        WHEN e.source_type = 'lesson' THEN 'standard'
        WHEN e.source_type = 'transfer' THEN 'manual_adjustment'
        WHEN e.source_type = 'adjustment' THEN 'manual_adjustment'
        ELSE 'manual_adjustment'
      END,
      ABS(e.amount_charged),
      e.lesson_participant_id,
      e.notes,
      e.created_at,
      e.created_at,
      COALESCE(e.metadata, '{}'::jsonb)
        || jsonb_build_object('migration', 'consumption_to_ledger', 'original_source_type', e.source_type)
        || CASE WHEN e.transfer_ref IS NOT NULL THEN jsonb_build_object('transfer_ref', e.transfer_ref) ELSE '{}'::jsonb END
        || CASE WHEN e.effective_date IS NOT NULL THEN jsonb_build_object('effective_date', e.effective_date::text) ELSE '{}'::jsonb END
    FROM public.consumption_entries e
    LEFT JOIN public.lesson_participants lp ON lp.id = e.lesson_participant_id
    LEFT JOIN public.commitments c ON c.id = e.commitment_id
    WHERE e.commitment_id IS NOT NULL
      AND COALESCE(e.student_id, lp.student_id, c.student_id) IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- =================================================================
-- Cleanup: drop consumption_entries and all related objects
-- =================================================================

DO $$
BEGIN
  IF to_regclass('public.consumption_entries') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS consumption_entries_validate_commitment_ownership_trg ON public.consumption_entries;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.validate_consumption_commitment_ownership();

DROP VIEW IF EXISTS public.commitment_balances;

-- Cleanup for deprecated precomputed balance model
DROP TRIGGER IF EXISTS commitments_recalculate_student_balance_trg ON public.commitments;
DO $$
BEGIN
  IF to_regclass('public.consumption_entries') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS consumption_entries_recalculate_student_balance_trg ON public.consumption_entries;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.trg_recalculate_student_balance_from_commitments();
DROP FUNCTION IF EXISTS public.trg_recalculate_student_balance_from_consumption_entries();
DROP FUNCTION IF EXISTS public.trg_recalculate_student_balance_from_transfers();
DROP FUNCTION IF EXISTS public.recalculate_student_balance_account_by_commitment(uuid);
DROP FUNCTION IF EXISTS public.recalculate_student_balance_account(uuid);
DROP TABLE IF EXISTS public.student_balance_accounts;
DROP TABLE IF EXISTS public.student_balance_transfers;
DROP INDEX IF EXISTS commitments_balance_entry_type_idx;

ALTER TABLE public.commitments
  DROP CONSTRAINT IF EXISTS commitments_balance_entry_type_check,
  DROP CONSTRAINT IF EXISTS commitments_transfer_not_self_check,
  DROP CONSTRAINT IF EXISTS commitments_transfer_peer_student_id_fkey;

ALTER TABLE public.commitments
  DROP COLUMN IF EXISTS balance_entry_type,
  DROP COLUMN IF EXISTS transfer_peer_student_id;

-- Drop consumption_entries table (data already migrated to ledger_transactions)
DROP TABLE IF EXISTS public.consumption_entries CASCADE;

-- -----------------------------------------------------------------
-- Query-time balance computation helpers (ledger-based)
-- -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_student_remaining_balance(p_student_id uuid)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_credits numeric := 0;
  v_debits numeric := 0;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(lt.amount), 0)
    INTO v_credits
  FROM public.ledger_transactions lt
  WHERE lt.student_id = p_student_id
    AND lt.transaction_type = 'CREDIT';

  SELECT COALESCE(SUM(lt.amount), 0)
    INTO v_debits
  FROM public.ledger_transactions lt
  WHERE lt.student_id = p_student_id
    AND lt.transaction_type = 'DEBIT';

  RETURN v_credits - v_debits;
END;
$$;

-- -----------------------------------------------------------------
-- public.lesson_earnings
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lesson_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  lesson_instance_id uuid NOT NULL,
  rate_used numeric NOT NULL,
  payout_amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.lesson_earnings
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS lesson_instance_id uuid,
  ADD COLUMN IF NOT EXISTS rate_used numeric,
  ADD COLUMN IF NOT EXISTS payout_amount numeric,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.lesson_earnings
    ADD CONSTRAINT lesson_earnings_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public."Employees"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.lesson_earnings
    ADD CONSTRAINT lesson_earnings_lesson_instance_id_fkey
    FOREIGN KEY (lesson_instance_id) REFERENCES public.lesson_instances(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS lesson_earnings_employee_id_idx
  ON public.lesson_earnings (employee_id);

CREATE INDEX IF NOT EXISTS lesson_earnings_lesson_instance_id_idx
  ON public.lesson_earnings (lesson_instance_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lesson_earnings_employee_lesson_unique'
      AND conrelid = 'public.lesson_earnings'::regclass
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'lesson_earnings_employee_lesson_unique'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE public.lesson_earnings
      ADD CONSTRAINT lesson_earnings_employee_lesson_unique
      UNIQUE (employee_id, lesson_instance_id);
  END IF;
END $$;

-- -----------------------------------------------------------------
-- public.forms
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  metadata jsonb NULL
);

ALTER TABLE public.forms
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS form_usage text,
  ADD COLUMN IF NOT EXISTS form_schema jsonb,
  ADD COLUMN IF NOT EXISTS alert_rules jsonb,
  ADD COLUMN IF NOT EXISTS visibility_rules jsonb,
  ADD COLUMN IF NOT EXISTS version int,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_active boolean,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.forms
    ALTER COLUMN form_usage SET DEFAULT 'general';
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

UPDATE public.forms
SET form_usage = COALESCE(NULLIF(form_usage, ''), 'general')
WHERE form_usage IS NULL OR form_usage = '';

DO $$
BEGIN
  ALTER TABLE public.forms
    ALTER COLUMN form_usage SET NOT NULL;
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.forms
    ADD CONSTRAINT forms_form_usage_check
    CHECK (form_usage IN ('general','waiting_list_intake'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS forms_is_active_idx ON public.forms (is_active);
CREATE INDEX IF NOT EXISTS forms_form_usage_idx ON public.forms (form_usage);

-- -----------------------------------------------------------------
-- public.form_submissions
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  metadata jsonb NULL
);

ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS form_id uuid,
  ADD COLUMN IF NOT EXISTS client_profile_id uuid,
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS answers jsonb,
  ADD COLUMN IF NOT EXISTS alert_flags jsonb,
  ADD COLUMN IF NOT EXISTS otp_metadata jsonb,
  ADD COLUMN IF NOT EXISTS submitted_by_guardian_id uuid,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.form_submissions ALTER COLUMN submitted_at DROP NOT NULL;
  EXCEPTION
    WHEN undefined_column THEN NULL;
  END;
END$$;

DO $$
BEGIN
  ALTER TABLE public.form_submissions
    ADD CONSTRAINT form_submissions_form_id_fkey
    FOREIGN KEY (form_id) REFERENCES public.forms(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.form_submissions
    ADD CONSTRAINT form_submissions_client_profile_id_fkey
    FOREIGN KEY (client_profile_id) REFERENCES public.client_profiles(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.form_submissions
    ADD CONSTRAINT form_submissions_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.form_submissions
    ADD CONSTRAINT form_submissions_submitted_by_guardian_id_fkey
    FOREIGN KEY (submitted_by_guardian_id) REFERENCES public.guardians(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.form_submissions
    ADD CONSTRAINT form_submissions_source_check
    CHECK (source IN ('web','whatsapp','internal','email','sms') OR source IS NULL);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS form_submissions_form_id_idx
  ON public.form_submissions (form_id);

CREATE INDEX IF NOT EXISTS form_submissions_client_profile_id_idx
  ON public.form_submissions (client_profile_id);

CREATE INDEX IF NOT EXISTS form_submissions_student_id_idx
  ON public.form_submissions (student_id);

CREATE INDEX IF NOT EXISTS form_submissions_submitted_by_guardian_id_idx
  ON public.form_submissions (submitted_by_guardian_id) WHERE submitted_by_guardian_id IS NOT NULL;

-- -----------------------------------------------------------------
-- public.otp_challenges
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  metadata jsonb NULL
);

ALTER TABLE public.otp_challenges
  ADD COLUMN IF NOT EXISTS client_profile_id uuid,
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS destination text,
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts int,
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.otp_challenges
    ADD CONSTRAINT otp_challenges_client_profile_id_fkey
    FOREIGN KEY (client_profile_id) REFERENCES public.client_profiles(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.otp_challenges
    ADD CONSTRAINT otp_challenges_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.otp_challenges
    ADD CONSTRAINT otp_challenges_channel_check
    CHECK (channel IN ('whatsapp','email'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.otp_challenges
    ADD CONSTRAINT otp_challenges_status_check
    CHECK (status IN ('pending','verified','expired','cancelled'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS otp_challenges_client_profile_id_idx
  ON public.otp_challenges (client_profile_id);

CREATE INDEX IF NOT EXISTS otp_challenges_student_id_idx
  ON public.otp_challenges (student_id);

CREATE INDEX IF NOT EXISTS otp_challenges_status_idx
  ON public.otp_challenges (status);

CREATE INDEX IF NOT EXISTS otp_challenges_expires_at_idx
  ON public.otp_challenges (expires_at);

-- -----------------------------------------------------------------
-- public.waiting_list_entries
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.waiting_list_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  metadata jsonb NULL
);

ALTER TABLE public.waiting_list_entries
  ADD COLUMN IF NOT EXISTS client_profile_id uuid,
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS desired_service_id uuid,
  ADD COLUMN IF NOT EXISTS preferred_days int[],
  ADD COLUMN IF NOT EXISTS preferred_times jsonb,
  ADD COLUMN IF NOT EXISTS instructor_preferences uuid[],
  ADD COLUMN IF NOT EXISTS willing_to_pay_premium boolean,
  ADD COLUMN IF NOT EXISTS priority_flag boolean,
  ADD COLUMN IF NOT EXISTS priority_reason text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS latest_submission_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.waiting_list_entries
    ADD CONSTRAINT waiting_list_entries_client_profile_id_fkey
    FOREIGN KEY (client_profile_id) REFERENCES public.client_profiles(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.waiting_list_entries
    ADD CONSTRAINT waiting_list_entries_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.waiting_list_entries
    ADD CONSTRAINT waiting_list_entries_latest_submission_id_fkey
    FOREIGN KEY (latest_submission_id) REFERENCES public.form_submissions(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.waiting_list_entries
    ADD CONSTRAINT waiting_list_entries_desired_service_id_fkey
    FOREIGN KEY (desired_service_id) REFERENCES public."Services"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'waiting_list_entries_status_check'
      AND conrelid = 'public.waiting_list_entries'::regclass
  ) THEN
    ALTER TABLE public.waiting_list_entries DROP CONSTRAINT waiting_list_entries_status_check;
  END IF;

  ALTER TABLE public.waiting_list_entries
    ADD CONSTRAINT waiting_list_entries_status_check
    CHECK (status IN ('new','open','matched','closed'));
EXCEPTION
  WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS waiting_list_entries_client_profile_id_idx
  ON public.waiting_list_entries (client_profile_id);

CREATE INDEX IF NOT EXISTS waiting_list_entries_student_id_idx
  ON public.waiting_list_entries (student_id);

CREATE INDEX IF NOT EXISTS waiting_list_entries_status_idx
  ON public.waiting_list_entries (status);

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

DO $$
BEGIN
  ALTER TABLE public.form_submissions ALTER COLUMN client_profile_id SET NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.otp_challenges ALTER COLUMN client_profile_id SET NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.waiting_list_entries ALTER COLUMN client_profile_id SET NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

-- -----------------------------------------------------------------
-- public."Settings" (cross-feature configuration)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Settings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "settings_value" jsonb NOT NULL,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."Settings"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb,
  ADD COLUMN IF NOT EXISTS "created_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz;

INSERT INTO public."Settings" ("key", "settings_value")
VALUES
  ('leave_policy', '{"carryover_enabled":false,"carryover_cap_days":null,"holiday_rules":[]}'::jsonb),
  ('leave_pay_policy', '{"default_method":"legal","lookback_months":3,"legal_allow_12m_if_better":true,"fixed_rate_default":0}'::jsonb),
  ('billing_consumption_policy', '{"attended":true,"no_show":false,"cancelled_student":false,"cancelled_clinic":false}'::jsonb),
  ('instructor_earnings_policy', '{"attended":true,"no_show":true,"cancelled_student":false,"cancelled_clinic":false}'::jsonb)
ON CONFLICT ("key") DO NOTHING;

-- -----------------------------------------------------------------
-- HMO provider / authorization compatibility backfill
-- -----------------------------------------------------------------

WITH legacy_provider_entries AS (
  SELECT
    CASE
      WHEN jsonb_typeof(entry) = 'object' THEN NULLIF(trim(entry->>'id'), '')
      ELSE NULLIF(trim(trim(both '"' from entry::text)), '')
    END AS legacy_key,
    CASE
      WHEN jsonb_typeof(entry) = 'object' THEN NULLIF(trim(entry->>'name'), '')
      ELSE NULLIF(trim(trim(both '"' from entry::text)), '')
    END AS provider_name
  FROM public."Settings" s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(s.settings_value) = 'array' THEN s.settings_value
      WHEN jsonb_typeof(s.settings_value) = 'object' AND jsonb_typeof(s.settings_value->'providers') = 'array' THEN s.settings_value->'providers'
      ELSE '[]'::jsonb
    END
  ) AS entry
  WHERE s.key = 'medical_providers'
),
normalized_legacy_providers AS (
  SELECT DISTINCT
    COALESCE(legacy_key, provider_name) AS provider_seed,
    provider_name
  FROM legacy_provider_entries
  WHERE COALESCE(legacy_key, provider_name) IS NOT NULL
    AND provider_name IS NOT NULL
)
INSERT INTO public.hmo_providers (id, name, is_active, metadata)
SELECT
  (
    substr(md5('legacy-hmo-provider:' || lower(provider_seed)), 1, 8) || '-' ||
    substr(md5('legacy-hmo-provider:' || lower(provider_seed)), 9, 4) || '-' ||
    substr(md5('legacy-hmo-provider:' || lower(provider_seed)), 13, 4) || '-' ||
    substr(md5('legacy-hmo-provider:' || lower(provider_seed)), 17, 4) || '-' ||
    substr(md5('legacy-hmo-provider:' || lower(provider_seed)), 21, 12)
  )::uuid,
  provider_name,
  true,
  jsonb_build_object('legacy_source', 'settings.medical_providers', 'legacy_provider_seed', provider_seed)
FROM normalized_legacy_providers
ON CONFLICT DO NOTHING;

WITH legacy_provider_entries AS (
  SELECT
    CASE
      WHEN jsonb_typeof(entry) = 'object' THEN NULLIF(trim(entry->>'id'), '')
      ELSE NULLIF(trim(trim(both '"' from entry::text)), '')
    END AS legacy_key,
    CASE
      WHEN jsonb_typeof(entry) = 'object' THEN NULLIF(trim(entry->>'name'), '')
      ELSE NULLIF(trim(trim(both '"' from entry::text)), '')
    END AS provider_name
  FROM public."Settings" s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(s.settings_value) = 'array' THEN s.settings_value
      WHEN jsonb_typeof(s.settings_value) = 'object' AND jsonb_typeof(s.settings_value->'providers') = 'array' THEN s.settings_value->'providers'
      ELSE '[]'::jsonb
    END
  ) AS entry
  WHERE s.key = 'medical_providers'
)
UPDATE public.students st
SET medical_provider = (
  (
    substr(md5('legacy-hmo-provider:' || lower(COALESCE(lp.legacy_key, lp.provider_name))), 1, 8) || '-' ||
    substr(md5('legacy-hmo-provider:' || lower(COALESCE(lp.legacy_key, lp.provider_name))), 9, 4) || '-' ||
    substr(md5('legacy-hmo-provider:' || lower(COALESCE(lp.legacy_key, lp.provider_name))), 13, 4) || '-' ||
    substr(md5('legacy-hmo-provider:' || lower(COALESCE(lp.legacy_key, lp.provider_name))), 17, 4) || '-' ||
    substr(md5('legacy-hmo-provider:' || lower(COALESCE(lp.legacy_key, lp.provider_name))), 21, 12)
  )::uuid
)::text
FROM legacy_provider_entries lp
WHERE COALESCE(lp.legacy_key, lp.provider_name) IS NOT NULL
  AND (
    st.medical_provider = lp.legacy_key
    OR st.medical_provider = lp.provider_name
  );

WITH legacy_hmo_commitments AS (
  SELECT
    c.id AS commitment_id,
    c.student_id,
    c.service_id,
    c.created_at,
    c.updated_at,
    c.expires_at,
    c.notes,
    c.is_active,
    c.default_charge_amount,
    c.metadata,
    COALESCE(NULLIF(trim(c.metadata->'hmo'->>'provider_name'), ''), 'גורם מממן') AS provider_name,
    COALESCE(NULLIF(trim(c.metadata->'hmo'->>'payment_mode'), ''), 'partially_paid_by_hmo') AS payment_mode,
    COALESCE(NULLIF(trim(c.metadata->'hmo'->>'customer_charge_amount'), '')::numeric, c.default_charge_amount, 0) AS customer_charge_amount,
    COALESCE(NULLIF(trim(c.metadata->'hmo'->>'insurer_claim_amount'), '')::numeric, 0) AS insurer_claim_amount,
    NULLIF(trim(c.metadata->'hmo'->>'workflow_notes'), '') AS workflow_notes,
    NULLIF(trim(c.metadata->'hmo'->>'authorization_reference'), '') AS authorization_reference,
    COALESCE(NULLIF(trim(c.metadata->'hmo'->>'authorized_lessons'), '')::int, 0) AS authorized_lessons,
    NULLIF(trim(c.metadata->'hmo'->>'reminder_date'), '')::date AS reminder_date,
    COALESCE(c.hmo_authorization_id, c.id) AS authorization_id
  FROM public.commitments c
  WHERE c.commitment_type = 'hmo'
),
provider_rows AS (
  SELECT DISTINCT
    provider_name,
    (
      substr(md5('legacy-hmo-provider:' || lower(provider_name)), 1, 8) || '-' ||
      substr(md5('legacy-hmo-provider:' || lower(provider_name)), 9, 4) || '-' ||
      substr(md5('legacy-hmo-provider:' || lower(provider_name)), 13, 4) || '-' ||
      substr(md5('legacy-hmo-provider:' || lower(provider_name)), 17, 4) || '-' ||
      substr(md5('legacy-hmo-provider:' || lower(provider_name)), 21, 12)
    )::uuid AS provider_id
  FROM legacy_hmo_commitments
),
inserted_providers AS (
  INSERT INTO public.hmo_providers (id, name, is_active, metadata)
  SELECT provider_id, provider_name, true, jsonb_build_object('legacy_source', 'commitments.metadata.hmo')
  FROM provider_rows
  ON CONFLICT (lower(name)) DO UPDATE
    SET metadata = EXCLUDED.metadata
  RETURNING id
),
track_rows AS (
  SELECT DISTINCT
    lhc.provider_name,
    COALESCE(hp.id, pr.provider_id) AS provider_id,
    lhc.service_id,
    lhc.payment_mode,
    lhc.customer_charge_amount,
    lhc.insurer_claim_amount,
    lhc.workflow_notes,
    (
      substr(md5(
        COALESCE(hp.id, pr.provider_id)::text || '|' ||
        COALESCE(lhc.service_id::text, '') || '|' ||
        lhc.payment_mode || '|' ||
        COALESCE(lhc.customer_charge_amount, 0)::text || '|' ||
        COALESCE(lhc.insurer_claim_amount, 0)::text || '|' ||
        COALESCE(lhc.workflow_notes, '')
      ), 1, 8) || '-' ||
      substr(md5(
        COALESCE(hp.id, pr.provider_id)::text || '|' ||
        COALESCE(lhc.service_id::text, '') || '|' ||
        lhc.payment_mode || '|' ||
        COALESCE(lhc.customer_charge_amount, 0)::text || '|' ||
        COALESCE(lhc.insurer_claim_amount, 0)::text || '|' ||
        COALESCE(lhc.workflow_notes, '')
      ), 9, 4) || '-' ||
      substr(md5(
        COALESCE(hp.id, pr.provider_id)::text || '|' ||
        COALESCE(lhc.service_id::text, '') || '|' ||
        lhc.payment_mode || '|' ||
        COALESCE(lhc.customer_charge_amount, 0)::text || '|' ||
        COALESCE(lhc.insurer_claim_amount, 0)::text || '|' ||
        COALESCE(lhc.workflow_notes, '')
      ), 13, 4) || '-' ||
      substr(md5(
        COALESCE(hp.id, pr.provider_id)::text || '|' ||
        COALESCE(lhc.service_id::text, '') || '|' ||
        lhc.payment_mode || '|' ||
        COALESCE(lhc.customer_charge_amount, 0)::text || '|' ||
        COALESCE(lhc.insurer_claim_amount, 0)::text || '|' ||
        COALESCE(lhc.workflow_notes, '')
      ), 17, 4) || '-' ||
      substr(md5(
        COALESCE(hp.id, pr.provider_id)::text || '|' ||
        COALESCE(lhc.service_id::text, '') || '|' ||
        lhc.payment_mode || '|' ||
        COALESCE(lhc.customer_charge_amount, 0)::text || '|' ||
        COALESCE(lhc.insurer_claim_amount, 0)::text || '|' ||
        COALESCE(lhc.workflow_notes, '')
      ), 21, 12)
    )::uuid AS track_id
  FROM legacy_hmo_commitments lhc
  JOIN provider_rows pr ON pr.provider_name = lhc.provider_name
  LEFT JOIN public.hmo_providers hp ON lower(hp.name) = lower(lhc.provider_name)
),
inserted_tracks AS (
  INSERT INTO public.hmo_provider_tracks (
    id,
    provider_id,
    service_id,
    name,
    payment_mode,
    default_customer_charge_amount,
    default_insurer_claim_amount,
    default_workflow_notes,
    is_active,
    metadata
  )
  SELECT
    track_id,
    provider_id,
    service_id,
    'מסלול שהוסב • ' ||
      CASE
        WHEN payment_mode = 'fully_paid_by_hmo' THEN 'ממומן מלא'
        WHEN payment_mode = 'fully_paid_by_customer' THEN 'לקוח משלם'
        ELSE 'מימון חלקי'
      END ||
      ' • לקוח ' || COALESCE(customer_charge_amount, 0)::text ||
      ' • קופה ' || COALESCE(insurer_claim_amount, 0)::text,
    payment_mode,
    COALESCE(customer_charge_amount, 0),
    COALESCE(insurer_claim_amount, 0),
    workflow_notes,
    true,
    jsonb_build_object('generated_from', 'legacy_hmo_commitment')
  FROM track_rows
  ON CONFLICT DO NOTHING
  RETURNING id
),
authorization_source AS (
  SELECT
    lhc.*,
    tr.provider_id,
    tr.track_id,
    CASE
      WHEN row_number() OVER (
        PARTITION BY lhc.student_id, lhc.service_id
        ORDER BY CASE WHEN lhc.is_active THEN 0 ELSE 1 END, COALESCE(lhc.updated_at, lhc.created_at) DESC, lhc.commitment_id DESC
      ) = 1 AND lhc.is_active THEN 'active'
      WHEN lhc.expires_at IS NOT NULL AND lhc.expires_at < now() THEN 'expired'
      WHEN lhc.is_active = false THEN 'cancelled'
      ELSE 'completed'
    END AS authorization_status
  FROM legacy_hmo_commitments lhc
  JOIN track_rows tr ON lower(tr.provider_name) = lower(lhc.provider_name)
    AND tr.service_id IS NOT DISTINCT FROM lhc.service_id
    AND tr.payment_mode = lhc.payment_mode
    AND tr.customer_charge_amount = lhc.customer_charge_amount
    AND tr.insurer_claim_amount = lhc.insurer_claim_amount
    AND COALESCE(tr.workflow_notes, '') = COALESCE(lhc.workflow_notes, '')
)
INSERT INTO public.hmo_authorizations (
  id,
  student_id,
  service_id,
  provider_id,
  provider_track_id,
  authorization_reference,
  authorized_lessons,
  valid_from,
  expires_at,
  reminder_date,
  status,
  notes,
  metadata
)
SELECT
  authorization_id,
  student_id,
  service_id,
  provider_id,
  track_id,
  authorization_reference,
  GREATEST(authorized_lessons, 0),
  created_at::date,
  expires_at::date,
  reminder_date,
  authorization_status,
  notes,
  jsonb_build_object('generated_from', 'legacy_hmo_commitment', 'legacy_commitment_id', commitment_id)
FROM authorization_source
ON CONFLICT DO NOTHING;

WITH legacy_hmo_commitments AS (
  SELECT
    c.id AS commitment_id,
    c.service_id,
    COALESCE(NULLIF(trim(c.metadata->'hmo'->>'provider_name'), ''), 'גורם מממן') AS provider_name,
    COALESCE(NULLIF(trim(c.metadata->'hmo'->>'payment_mode'), ''), 'partially_paid_by_hmo') AS payment_mode,
    COALESCE((c.metadata->'hmo'->>'customer_charge_amount')::numeric, c.default_charge_amount, 0) AS customer_charge_amount,
    COALESCE((c.metadata->'hmo'->>'insurer_claim_amount')::numeric, 0) AS insurer_claim_amount,
    NULLIF(trim(c.metadata->'hmo'->>'workflow_notes'), '') AS workflow_notes,
    COALESCE(c.hmo_authorization_id, c.id) AS authorization_id
  FROM public.commitments c
  WHERE c.commitment_type = 'hmo'
)
UPDATE public.commitments c
SET
  hmo_provider_id = hp.id,
  hmo_provider_track_id = hpt.id,
  hmo_authorization_id = lhc.authorization_id
FROM legacy_hmo_commitments lhc
JOIN public.hmo_providers hp ON lower(hp.name) = lower(lhc.provider_name)
JOIN public.hmo_provider_tracks hpt
  ON hpt.provider_id = hp.id
  AND hpt.service_id IS NOT DISTINCT FROM lhc.service_id
  AND hpt.payment_mode = lhc.payment_mode
  AND hpt.default_customer_charge_amount = COALESCE(lhc.customer_charge_amount, 0)
  AND hpt.default_insurer_claim_amount = COALESCE(lhc.insurer_claim_amount, 0)
  AND COALESCE(hpt.default_workflow_notes, '') = COALESCE(lhc.workflow_notes, '')
WHERE c.id = lhc.commitment_id;

-- -----------------------------------------------------------------
-- public."Documents" (polymorphic file metadata)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Documents" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
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

ALTER TABLE public."Documents"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

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

CREATE INDEX IF NOT EXISTS "Documents_entity_idx" ON public."Documents" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "Documents_uploaded_at_idx" ON public."Documents" ("uploaded_at");
CREATE INDEX IF NOT EXISTS "Documents_expiration_idx" ON public."Documents" ("expiration_date") WHERE "expiration_date" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Documents_hash_idx" ON public."Documents" ("hash") WHERE "hash" IS NOT NULL;

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

CREATE OR REPLACE FUNCTION public.set_tenant_audit_log_expiry()
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
  ) THEN
    RAISE EXCEPTION 'lesson_instance_locked'
      USING ERRCODE = 'P0001',
            DETAIL = target_instance_id::text,
            HINT = 'Use the correction workflow for locked lesson participants.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE
  versioned_table text;
  versioned_tables text[] := ARRAY[
    'forms',
    'employee_attendance_records',
    'finance_corrections',
    'lesson_templates',
    'lesson_instances',
    'lesson_participants',
    'payroll_runs',
    'claim_batches',
    'calendar_instance_corrections',
    'dashboard_tasks'
  ];
BEGIN
  FOREACH versioned_table IN ARRAY versioned_tables
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = versioned_table
        AND column_name = 'version'
    ) THEN
      IF versioned_table = 'lesson_instances'
        AND EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'trg_lesson_instances_guard_locked'
            AND tgrelid = 'public.lesson_instances'::regclass
        ) THEN
        EXECUTE 'ALTER TABLE public.lesson_instances DISABLE TRIGGER trg_lesson_instances_guard_locked';
      ELSIF versioned_table = 'lesson_participants'
        AND EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'trg_lesson_participants_guard_locked'
            AND tgrelid = 'public.lesson_participants'::regclass
        ) THEN
        EXECUTE 'ALTER TABLE public.lesson_participants DISABLE TRIGGER trg_lesson_participants_guard_locked';
      END IF;

      EXECUTE format(
        'UPDATE public.%I SET version = 1 WHERE version IS NULL OR version < 1',
        versioned_table
      );

      IF versioned_table = 'lesson_instances'
        AND EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'trg_lesson_instances_guard_locked'
            AND tgrelid = 'public.lesson_instances'::regclass
        ) THEN
        EXECUTE 'ALTER TABLE public.lesson_instances ENABLE TRIGGER trg_lesson_instances_guard_locked';
      ELSIF versioned_table = 'lesson_participants'
        AND EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'trg_lesson_participants_guard_locked'
            AND tgrelid = 'public.lesson_participants'::regclass
        ) THEN
        EXECUTE 'ALTER TABLE public.lesson_participants ENABLE TRIGGER trg_lesson_participants_guard_locked';
      END IF;

      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN version SET DEFAULT 1',
        versioned_table
      );
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN version SET NOT NULL',
        versioned_table
      );
    END IF;
  END LOOP;
END $$;

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
    WHERE tgname = 'trg_tenant_audit_log_set_expiry'
      AND tgrelid = 'public.tenant_audit_log'::regclass
  ) THEN
    CREATE TRIGGER trg_tenant_audit_log_set_expiry
      BEFORE INSERT ON public.tenant_audit_log
      FOR EACH ROW
      EXECUTE FUNCTION public.set_tenant_audit_log_expiry();
  END IF;
END $$;

-- =================================================================
-- Tenant Public Domain Tables — RLS + Diagnostics
-- =================================================================

-- Add indexes for payroll tables
CREATE INDEX IF NOT EXISTS "RateHistory_employee_service_idx" ON public."RateHistory" ("employee_id", "service_id", "effective_date");
CREATE INDEX IF NOT EXISTS hmo_providers_is_active_idx ON public.hmo_providers (is_active);
CREATE INDEX IF NOT EXISTS hmo_provider_tracks_is_active_idx ON public.hmo_provider_tracks (is_active);
CREATE INDEX IF NOT EXISTS hmo_authorizations_status_idx ON public.hmo_authorizations (status);
CREATE INDEX IF NOT EXISTS employee_leave_entries_status_idx ON public.employee_leave_entries (status);
CREATE INDEX IF NOT EXISTS employee_leave_days_date_idx ON public.employee_leave_days (leave_date);
CREATE INDEX IF NOT EXISTS finance_corrections_type_idx ON public.finance_corrections (correction_type);
CREATE INDEX IF NOT EXISTS payroll_runs_status_idx ON public.payroll_runs (status, finalized_at);
CREATE INDEX IF NOT EXISTS claim_batches_status_idx ON public.claim_batches (status, paid_at);
CREATE INDEX IF NOT EXISTS dashboard_tasks_resource_idx ON public.dashboard_tasks (resource_type, resource_id, status);

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
ALTER TABLE public.tenant_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_service_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_template_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiting_list_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Documents" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  policy_name text;
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
    'tenant_audit_log',
    'dashboard_tasks',
    'instructor_profiles',
    'instructor_service_capabilities',
    'lesson_templates',
    'lesson_template_overrides',
    'lesson_instances',
    'lesson_participants',
    'commitments',
    'ledger_transactions',
    'lesson_earnings',
    'forms',
    'form_submissions',
    'otp_challenges',
    'waiting_list_entries',
    'Settings',
    'Documents'
  ]
  LOOP
    -- Postgres identifiers are limited to 63 bytes; long policy names are silently truncated.
    policy_name := left('Allow full access to authenticated users on ' || tbl, 63);
    
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(policy_name) || ' ON public.' || quote_ident(tbl);
    
    EXECUTE 'CREATE POLICY ' || quote_ident(policy_name) || ' ON public.' || quote_ident(tbl) || ' FOR ALL TO authenticated, app_user USING (true) WITH CHECK (true)';
  END LOOP;
END $$;

-- Safety net: ensure key policies exist even if a prior run missed them
DO $$
DECLARE
  tbl text;
  policy_name text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'instructor_service_capabilities',
    'lesson_template_overrides',
    'waiting_list_entries'
  ]
  LOOP
    policy_name := left('Allow full access to authenticated users on ' || tbl, 63);
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(policy_name) || ' ON public.' || quote_ident(tbl);
    EXECUTE 'CREATE POLICY ' || quote_ident(policy_name) || ' ON public.' || quote_ident(tbl) || ' FOR ALL TO authenticated, app_user USING (true) WITH CHECK (true)';
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;

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
GRANT ALL ON TABLE public.tenant_audit_log TO app_user;
GRANT ALL ON TABLE public.dashboard_tasks TO app_user;
GRANT ALL ON TABLE public.instructor_profiles TO app_user;
GRANT ALL ON TABLE public.instructor_service_capabilities TO app_user;
GRANT ALL ON TABLE public.lesson_templates TO app_user;
GRANT ALL ON TABLE public.lesson_template_overrides TO app_user;
GRANT ALL ON TABLE public.lesson_instances TO app_user;
GRANT ALL ON TABLE public.lesson_participants TO app_user;
GRANT ALL ON TABLE public.commitments TO app_user;
GRANT ALL ON TABLE public.ledger_transactions TO app_user;
GRANT ALL ON TABLE public.lesson_earnings TO app_user;
GRANT ALL ON TABLE public.forms TO app_user;
GRANT ALL ON TABLE public.form_submissions TO app_user;
GRANT ALL ON TABLE public.otp_challenges TO app_user;
GRANT ALL ON TABLE public.waiting_list_entries TO app_user;
GRANT ALL ON TABLE public."Settings" TO app_user;
GRANT ALL ON TABLE public."Documents" TO app_user;

GRANT app_user TO postgres, authenticated, anon;

CREATE OR REPLACE FUNCTION public.setup_assistant_diagnostics()
RETURNS TABLE (check_name text, success boolean, details text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  required_tables constant text[] := array[
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

SELECT extensions.sign(
  json_build_object(
    'role', 'app_user',
    'exp', (EXTRACT(EPOCH FROM (NOW() + INTERVAL '5 year')))::integer,
    'iat', (EXTRACT(EPOCH FROM NOW()))::integer
  ),
  'YOUR_SUPER_SECRET_AND_LONG_JWT_SECRET_HERE'
) AS "APP_DEDICATED_KEY (COPY THIS BACK TO THE APP)";
`;

