export const SETUP_SQL_SCRIPT = String.raw`-- =================================================================
-- Reinex Tenant Database Setup Script (SSOT)
-- Version: Aligned with Reinex-PRD.md (Therapeutic Riding & Clinic Management System)
-- =================================================================
--
-- This script implements the complete Reinex domain as described in the PRD:
-- 1. Lessons & Scheduling (Templates, Instances, Overrides, Participants)
-- 2. Students & Guardians (with medical flags, onboarding forms, OTP security)
-- 3. Forms & Submissions (with alert rules, visibility rules, OTP metadata)
-- 4. Commitments & Consumption (prepaid packages, HMO support)
-- 5. Waiting List (with priority, preferences, conflict detection)
-- 6. Instructors & Payroll (Employees, Services, RateHistory, LessonEarnings, LeaveBalances, WorkSessions)
-- 7. Settings (cross-feature configuration)
-- 8. Documents (polymorphic file storage)
--
-- Design Notes:
-- - Tenant schema is "public" (product-agnostic, no tuttiud references).
-- - Idempotent DDL: CREATE TABLE/COLUMN IF NOT EXISTS, INSERT...ON CONFLICT DO NOTHING.
-- - Supports weekly generation engine with template versioning and undo capability.
-- - Supports partial attendance (group lessons) via lesson_participants per student per instance.
-- - Supports service-per-student pricing overrides and HMO-specific rules via metadata.
-- - RLS enabled on all tables; uniform policies for authenticated users.
-- - Final SELECT prints a dedicated JWT key; replace the placeholder secret first.
--
-- Patch Notes (2025-12-15):
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
-- public.students (SSOT)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  middle_name text NULL,
  last_name text NOT NULL,
  identity_number text NULL,
  phone text NULL,
  email text NULL,
  date_of_birth date NULL,
  notes_internal text NULL,
  default_notification_method text NOT NULL DEFAULT 'whatsapp',
  special_rate numeric NULL,
  medical_flags jsonb NULL,
  onboarding_status text NOT NULL DEFAULT 'not_started',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS identity_number text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS notes_internal text,
  ADD COLUMN IF NOT EXISTS default_notification_method text,
  ADD COLUMN IF NOT EXISTS special_rate numeric,
  ADD COLUMN IF NOT EXISTS medical_flags jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_status text,
  ADD COLUMN IF NOT EXISTS is_active boolean,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.students ALTER COLUMN first_name SET NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.students ALTER COLUMN last_name SET NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.students
    ADD CONSTRAINT students_default_notification_method_check
    CHECK (default_notification_method IN ('whatsapp','email'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.students
    ADD CONSTRAINT students_onboarding_status_check
    CHECK (onboarding_status IN ('not_started','pending_forms','approved'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS students_is_active_idx ON public.students (is_active);
CREATE INDEX IF NOT EXISTS students_name_idx ON public.students (first_name, last_name);

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS students_identity_number_unique_idx
    ON public.students (identity_number)
    WHERE identity_number IS NOT NULL AND identity_number <> '';
EXCEPTION
  WHEN others THEN NULL;
END $$;

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
-- public.student_guardians
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.student_guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  guardian_id uuid NOT NULL,
  relationship text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.student_guardians
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS guardian_id uuid,
  ADD COLUMN IF NOT EXISTS relationship text,
  ADD COLUMN IF NOT EXISTS is_primary boolean,
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.student_guardians
    ADD CONSTRAINT student_guardians_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.student_guardians
    ADD CONSTRAINT student_guardians_guardian_id_fkey
    FOREIGN KEY (guardian_id) REFERENCES public.guardians(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.student_guardians
    ADD CONSTRAINT student_guardians_relationship_check
    CHECK (relationship IN ('father','mother','self','caretaker','other'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS student_guardians_student_guardian_uidx
  ON public.student_guardians (student_id, guardian_id);

CREATE INDEX IF NOT EXISTS student_guardians_student_id_idx
  ON public.student_guardians (student_id);

-- -----------------------------------------------------------------
-- public.Employees (complete table with payroll fields)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Employees" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "name" text NOT NULL,
  "employee_id" text NOT NULL,
  "employee_type" text,
  "current_rate" numeric,
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
  ADD COLUMN IF NOT EXISTS "name" text,
  ADD COLUMN IF NOT EXISTS "employee_id" text,
  ADD COLUMN IF NOT EXISTS "employee_type" text,
  ADD COLUMN IF NOT EXISTS "current_rate" numeric,
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

-- Add canonical name fields for future use
ALTER TABLE public."Employees"
  ADD COLUMN IF NOT EXISTS "first_name" text,
  ADD COLUMN IF NOT EXISTS "middle_name" text,
  ADD COLUMN IF NOT EXISTS "last_name" text;

CREATE INDEX IF NOT EXISTS "Employees_name_idx" ON public."Employees" ("first_name", "last_name");
CREATE INDEX IF NOT EXISTS "Employees_user_id_idx" ON public."Employees" ("user_id");

-- -----------------------------------------------------------------
-- public.Services (service catalog)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Services" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "duration_minutes" bigint,
  "payment_model" text,
  "color" text,
  "metadata" jsonb,
  CONSTRAINT "Services_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."Services"
  ADD COLUMN IF NOT EXISTS "name" text,
  ADD COLUMN IF NOT EXISTS "duration_minutes" bigint,
  ADD COLUMN IF NOT EXISTS "payment_model" text,
  ADD COLUMN IF NOT EXISTS "color" text,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

-- Seed the generic, non-deletable service for general rates
INSERT INTO public."Services" ("id", "name", "duration_minutes", "payment_model", "color", "metadata")
VALUES ('00000000-0000-0000-0000-000000000000', 'תעריף כללי *לא למחוק או לשנות*', NULL, 'fixed_rate', '#84CC16', NULL)
ON CONFLICT DO NOTHING;

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
    SELECT 1 FROM pg_constraint
    WHERE conname = 'RateHistory_employee_service_effective_date_key'
  ) THEN
    ALTER TABLE public."RateHistory"
      ADD CONSTRAINT "RateHistory_employee_service_effective_date_key"
      UNIQUE (employee_id, service_id, effective_date);
  END IF;
END;
$$;

-- -----------------------------------------------------------------
-- public.WorkSessions (work/leave tracking)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."WorkSessions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL,
  "service_id" uuid,
  "date" date NOT NULL,
  "session_type" text,
  "hours" numeric,
  "sessions_count" bigint,
  "students_count" bigint,
  "rate_used" numeric,
  "total_payment" numeric,
  "notes" text,
  "created_at" timestamptz DEFAULT now(),
  "entry_type" text NOT NULL DEFAULT 'hours',
  "payable" boolean,
  "metadata" jsonb,
  "deleted" boolean NOT NULL DEFAULT false,
  "deleted_at" timestamptz,
  CONSTRAINT "WorkSessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkSessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES public."Employees"("id"),
  CONSTRAINT "WorkSessions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES public."Services"("id")
);

ALTER TABLE public."WorkSessions"
  ADD COLUMN IF NOT EXISTS "employee_id" uuid,
  ADD COLUMN IF NOT EXISTS "service_id" uuid,
  ADD COLUMN IF NOT EXISTS "date" date,
  ADD COLUMN IF NOT EXISTS "session_type" text,
  ADD COLUMN IF NOT EXISTS "hours" numeric,
  ADD COLUMN IF NOT EXISTS "sessions_count" bigint,
  ADD COLUMN IF NOT EXISTS "students_count" bigint,
  ADD COLUMN IF NOT EXISTS "rate_used" numeric,
  ADD COLUMN IF NOT EXISTS "total_payment" numeric,
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "created_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "entry_type" text,
  ADD COLUMN IF NOT EXISTS "payable" boolean,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb,
  ADD COLUMN IF NOT EXISTS "deleted" boolean,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

-- -----------------------------------------------------------------
-- public.LeaveBalances (leave allocation and usage ledger)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."LeaveBalances" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "employee_id" uuid NOT NULL,
  "leave_type" text NOT NULL,
  "balance" numeric NOT NULL DEFAULT 0,
  "effective_date" date NOT NULL,
  "notes" text,
  "work_session_id" uuid,
  "metadata" jsonb,
  CONSTRAINT "LeaveBalances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES public."Employees"("id"),
  CONSTRAINT "LeaveBalances_work_session_id_fkey" FOREIGN KEY ("work_session_id") REFERENCES public."WorkSessions"("id") ON DELETE SET NULL
);

ALTER TABLE public."LeaveBalances"
  ADD COLUMN IF NOT EXISTS "created_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "employee_id" uuid,
  ADD COLUMN IF NOT EXISTS "leave_type" text,
  ADD COLUMN IF NOT EXISTS "balance" numeric,
  ADD COLUMN IF NOT EXISTS "effective_date" date,
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "work_session_id" uuid,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

-- -----------------------------------------------------------------
-- public.instructor_profiles
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.instructor_profiles (
  employee_id uuid PRIMARY KEY,
  working_days int[] NULL,
  break_time_minutes int NULL,
  metadata jsonb NULL
);

ALTER TABLE public.instructor_profiles
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS working_days int[],
  ADD COLUMN IF NOT EXISTS break_time_minutes int,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

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
  metadata jsonb NULL
);

ALTER TABLE public.instructor_service_capabilities
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS service_id uuid,
  ADD COLUMN IF NOT EXISTS max_students int,
  ADD COLUMN IF NOT EXISTS base_rate numeric,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

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
  day_of_week int NOT NULL,
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
  ADD COLUMN IF NOT EXISTS day_of_week int,
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

DO $$
BEGIN
  ALTER TABLE public.lesson_templates
    ADD CONSTRAINT lesson_templates_day_of_week_check
    CHECK (day_of_week BETWEEN 0 AND 6);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS lesson_templates_student_id_idx ON public.lesson_templates (student_id);
CREATE INDEX IF NOT EXISTS lesson_templates_instructor_day_time_idx ON public.lesson_templates (instructor_employee_id, day_of_week, time_of_day);

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

CREATE TABLE IF NOT EXISTS public.lesson_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_instance_id uuid NOT NULL,
  student_id uuid NOT NULL,
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
  metadata jsonb NULL
);

ALTER TABLE public.lesson_participants
  ADD COLUMN IF NOT EXISTS lesson_instance_id uuid,
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

CREATE UNIQUE INDEX IF NOT EXISTS lesson_participants_instance_student_uidx
  ON public.lesson_participants (lesson_instance_id, student_id);

CREATE INDEX IF NOT EXISTS lesson_participants_student_id_idx
  ON public.lesson_participants (student_id);

CREATE INDEX IF NOT EXISTS lesson_participants_locked_at_idx
  ON public.lesson_participants (locked_at) WHERE locked_at IS NOT NULL;

-- -----------------------------------------------------------------
-- public.commitments
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  service_id uuid NOT NULL,
  total_amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  metadata jsonb NULL
);

ALTER TABLE public.commitments
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS service_id uuid,
  ADD COLUMN IF NOT EXISTS total_amount numeric,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

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

CREATE INDEX IF NOT EXISTS commitments_student_id_idx ON public.commitments (student_id);

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
-- public.consumption_entries
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.consumption_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_participant_id uuid NOT NULL,
  commitment_id uuid NULL,
  amount_charged numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.consumption_entries
  ADD COLUMN IF NOT EXISTS lesson_participant_id uuid,
  ADD COLUMN IF NOT EXISTS commitment_id uuid,
  ADD COLUMN IF NOT EXISTS amount_charged numeric,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  ALTER TABLE public.consumption_entries
    ADD CONSTRAINT consumption_entries_lesson_participant_id_fkey
    FOREIGN KEY (lesson_participant_id) REFERENCES public.lesson_participants(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.consumption_entries
    ADD CONSTRAINT consumption_entries_commitment_id_fkey
    FOREIGN KEY (commitment_id) REFERENCES public.commitments(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS consumption_entries_commitment_id_idx
  ON public.consumption_entries (commitment_id);

CREATE OR REPLACE VIEW public.commitment_balances AS
SELECT
  c.id AS commitment_id,
  c.student_id,
  c.service_id,
  c.total_amount,
  COALESCE(SUM(e.amount_charged), 0) AS consumed_amount,
  c.total_amount - COALESCE(SUM(e.amount_charged), 0) AS remaining_balance
FROM public.commitments c
LEFT JOIN public.consumption_entries e
  ON e.commitment_id = c.id
GROUP BY c.id, c.student_id, c.service_id, c.total_amount;

-- -----------------------------------------------------------------
-- public.lesson_earnings
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lesson_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  lesson_instance_id uuid NOT NULL,
  rate_used numeric NOT NULL,
  payout_amount numeric NOT NULL,
  work_session_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.lesson_earnings
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS lesson_instance_id uuid,
  ADD COLUMN IF NOT EXISTS rate_used numeric,
  ADD COLUMN IF NOT EXISTS payout_amount numeric,
  ADD COLUMN IF NOT EXISTS work_session_id uuid,
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

DO $$
BEGIN
  ALTER TABLE public.lesson_earnings
    ADD CONSTRAINT lesson_earnings_work_session_id_fkey
    FOREIGN KEY (work_session_id) REFERENCES public."WorkSessions"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS lesson_earnings_employee_id_idx
  ON public.lesson_earnings (employee_id);

CREATE INDEX IF NOT EXISTS lesson_earnings_lesson_instance_id_idx
  ON public.lesson_earnings (lesson_instance_id);

-- -----------------------------------------------------------------
-- public.forms
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NULL,
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

CREATE INDEX IF NOT EXISTS forms_is_active_idx ON public.forms (is_active);

-- -----------------------------------------------------------------
-- public.form_submissions
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL,
  student_id uuid NOT NULL,
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

CREATE INDEX IF NOT EXISTS form_submissions_student_id_idx
  ON public.form_submissions (student_id);

CREATE INDEX IF NOT EXISTS form_submissions_submitted_by_guardian_id_idx
  ON public.form_submissions (submitted_by_guardian_id) WHERE submitted_by_guardian_id IS NOT NULL;

-- -----------------------------------------------------------------
-- public.otp_challenges
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  student_id uuid NOT NULL,
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
  metadata jsonb NULL
);

ALTER TABLE public.waiting_list_entries
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
  ADD COLUMN IF NOT EXISTS metadata jsonb;

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
    ADD CONSTRAINT waiting_list_entries_desired_service_id_fkey
    FOREIGN KEY (desired_service_id) REFERENCES public."Services"(id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.waiting_list_entries
    ADD CONSTRAINT waiting_list_entries_status_check
    CHECK (status IN ('open','matched','closed'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS waiting_list_entries_student_id_idx
  ON public.waiting_list_entries (student_id);

CREATE INDEX IF NOT EXISTS waiting_list_entries_status_idx
  ON public.waiting_list_entries (status);

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

-- =================================================================
-- Tenant Public Domain Tables — RLS + Diagnostics
-- =================================================================

-- Add indexes for payroll tables
CREATE INDEX IF NOT EXISTS "RateHistory_employee_service_idx" ON public."RateHistory" ("employee_id", "service_id", "effective_date");
CREATE INDEX IF NOT EXISTS "LeaveBalances_employee_date_idx" ON public."LeaveBalances" ("employee_id", "effective_date");
CREATE INDEX IF NOT EXISTS "WorkSessions_employee_date_idx" ON public."WorkSessions" ("employee_id", "date");
CREATE INDEX IF NOT EXISTS "WorkSessions_service_idx" ON public."WorkSessions" ("service_id");
CREATE INDEX IF NOT EXISTS "WorkSessions_deleted_idx" ON public."WorkSessions" ("deleted") WHERE "deleted" = true;

-- Enable RLS on all tables (both domain and payroll)
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RateHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkSessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LeaveBalances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instructor_service_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_template_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_entries ENABLE ROW LEVEL SECURITY;
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
    'student_guardians',
    'Employees',
    'Services',
    'RateHistory',
    'WorkSessions',
    'LeaveBalances',
    'instructor_profiles',
    'instructor_service_capabilities',
    'lesson_templates',
    'lesson_template_overrides',
    'lesson_instances',
    'lesson_participants',
    'commitments',
    'consumption_entries',
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
GRANT ALL ON TABLE public.student_guardians TO app_user;
GRANT ALL ON TABLE public."Employees" TO app_user;
GRANT ALL ON TABLE public."Services" TO app_user;
GRANT ALL ON TABLE public."RateHistory" TO app_user;
GRANT ALL ON TABLE public."WorkSessions" TO app_user;
GRANT ALL ON TABLE public."LeaveBalances" TO app_user;
GRANT ALL ON TABLE public.instructor_profiles TO app_user;
GRANT ALL ON TABLE public.instructor_service_capabilities TO app_user;
GRANT ALL ON TABLE public.lesson_templates TO app_user;
GRANT ALL ON TABLE public.lesson_template_overrides TO app_user;
GRANT ALL ON TABLE public.lesson_instances TO app_user;
GRANT ALL ON TABLE public.lesson_participants TO app_user;
GRANT ALL ON TABLE public.commitments TO app_user;
GRANT ALL ON TABLE public.consumption_entries TO app_user;
GRANT ALL ON TABLE public.lesson_earnings TO app_user;
GRANT ALL ON TABLE public.forms TO app_user;
GRANT ALL ON TABLE public.form_submissions TO app_user;
GRANT ALL ON TABLE public.otp_challenges TO app_user;
GRANT ALL ON TABLE public.waiting_list_entries TO app_user;
GRANT ALL ON TABLE public."Settings" TO app_user;
GRANT ALL ON TABLE public."Documents" TO app_user;

DO $$
BEGIN
  IF to_regclass('public.commitment_balances') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.commitment_balances TO app_user;
  END IF;
END $$;

GRANT app_user TO postgres, authenticated, anon;

CREATE OR REPLACE FUNCTION public.setup_assistant_diagnostics()
RETURNS TABLE (check_name text, success boolean, details text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  required_tables constant text[] := array[
    'students',
    'guardians',
    'student_guardians',
    'Employees',
    'Services',
    'RateHistory',
    'WorkSessions',
    'LeaveBalances',
    'instructor_profiles',
    'instructor_service_capabilities',
    'lesson_templates',
    'lesson_template_overrides',
    'lesson_instances',
    'lesson_participants',
    'commitments',
    'consumption_entries',
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

