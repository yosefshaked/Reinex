export const SETUP_SQL_SCRIPT = String.raw`-- =================================================================
-- Reinex Tenant Database Setup Script (SSOT)
-- =================================================================
--
-- Notes:
-- - Tenant schema is "public".
-- - Safe/idempotent patterns are used throughout.
-- - Optional compatibility patches are conditional (do not assume other systems exist).
-- - The final SELECT prints a dedicated JWT key; replace the placeholder secret first.
-- =================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA extensions;

-- =================================================================
-- Tenant Public Domain Tables (Product-Agnostic)
-- =================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------
-- public.students (SSOT)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  middle_name text NULL,
  last_name text NULL,
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
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
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
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

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
  ADD COLUMN IF NOT EXISTS id uuid,
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
-- public.Employees (shared table) - canonical name fields
-- -----------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'Employees'
  ) THEN
    EXECUTE 'ALTER TABLE public."Employees" ADD COLUMN IF NOT EXISTS "first_name" text';
    EXECUTE 'ALTER TABLE public."Employees" ADD COLUMN IF NOT EXISTS "middle_name" text';
    EXECUTE 'ALTER TABLE public."Employees" ADD COLUMN IF NOT EXISTS "last_name" text';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Employees_name_idx" ON public."Employees" ("first_name", "last_name")';
    EXECUTE 'COMMENT ON COLUMN public."Employees"."name" IS ''Legacy display name (non-canonical). Prefer first_name/middle_name/last_name.''';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'employees'
  ) THEN
    EXECUTE 'ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS first_name text';
    EXECUTE 'ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS middle_name text';
    EXECUTE 'ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS last_name text';
    EXECUTE 'CREATE INDEX IF NOT EXISTS employees_name_idx ON public.employees (first_name, last_name)';
    EXECUTE 'COMMENT ON COLUMN public.employees.name IS ''Legacy display name (non-canonical). Prefer first_name/middle_name/last_name.''';
  END IF;
END $$;

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
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS service_id uuid,
  ADD COLUMN IF NOT EXISTS max_students int,
  ADD COLUMN IF NOT EXISTS base_rate numeric,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

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
  ADD COLUMN IF NOT EXISTS id uuid,
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
  ADD COLUMN IF NOT EXISTS id uuid,
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
  datetime_start timestamptz NOT NULL,
  duration_minutes int NOT NULL,
  instructor_employee_id uuid NOT NULL,
  service_id uuid NOT NULL,
  status text NOT NULL,
  documentation_status text NOT NULL DEFAULT 'undocumented',
  created_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE public.lesson_instances
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS template_id uuid,
  ADD COLUMN IF NOT EXISTS datetime_start timestamptz,
  ADD COLUMN IF NOT EXISTS duration_minutes int,
  ADD COLUMN IF NOT EXISTS instructor_employee_id uuid,
  ADD COLUMN IF NOT EXISTS service_id uuid,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS documentation_status text,
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
  metadata jsonb NULL
);

ALTER TABLE public.lesson_participants
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS lesson_instance_id uuid,
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS participant_status text,
  ADD COLUMN IF NOT EXISTS price_charged numeric,
  ADD COLUMN IF NOT EXISTS pricing_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS commitment_id uuid,
  ADD COLUMN IF NOT EXISTS documentation_ref jsonb,
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
  ADD COLUMN IF NOT EXISTS id uuid,
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

CREATE INDEX IF NOT EXISTS commitments_student_id_idx ON public.commitments (student_id);

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
  ADD COLUMN IF NOT EXISTS id uuid,
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
  ADD COLUMN IF NOT EXISTS id uuid,
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
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.forms
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS form_schema jsonb,
  ADD COLUMN IF NOT EXISTS alert_rules jsonb,
  ADD COLUMN IF NOT EXISTS visibility_rules jsonb,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_active boolean;

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
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid NULL,
  metadata jsonb NULL
);

ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS form_id uuid,
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS answers jsonb,
  ADD COLUMN IF NOT EXISTS alert_flags jsonb,
  ADD COLUMN IF NOT EXISTS otp_metadata jsonb,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
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

CREATE INDEX IF NOT EXISTS form_submissions_form_id_idx
  ON public.form_submissions (form_id);

CREATE INDEX IF NOT EXISTS form_submissions_student_id_idx
  ON public.form_submissions (student_id);

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
  ADD COLUMN IF NOT EXISTS id uuid,
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
  ADD COLUMN IF NOT EXISTS id uuid,
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
  "metadata" jsonb
);

ALTER TABLE public."Settings"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

-- -----------------------------------------------------------------
-- public."Documents" (polymorphic file metadata)
-- -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Documents" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "entity_type" text NOT NULL CHECK ("entity_type" IN ('student', 'instructor', 'organization')),
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

CREATE INDEX IF NOT EXISTS "Documents_entity_idx" ON public."Documents" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "Documents_uploaded_at_idx" ON public."Documents" ("uploaded_at");
CREATE INDEX IF NOT EXISTS "Documents_expiration_idx" ON public."Documents" ("expiration_date") WHERE "expiration_date" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Documents_hash_idx" ON public."Documents" ("hash") WHERE "hash" IS NOT NULL;

-- =================================================================
-- Tenant Public Domain Tables — RLS + Diagnostics
-- =================================================================

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_guardians ENABLE ROW LEVEL SECURITY;
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
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'students',
    'guardians',
    'student_guardians',
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
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
      'Allow full access to authenticated users on ' || tbl,
      tbl
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated, app_user USING (true) WITH CHECK (true)',
      'Allow full access to authenticated users on ' || tbl,
      tbl
    );
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;

GRANT ALL ON TABLE public.students TO app_user;
GRANT ALL ON TABLE public.guardians TO app_user;
GRANT ALL ON TABLE public.student_guardians TO app_user;
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
    success := EXISTS(
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = table_name
        AND p.policyname = expected_policy_prefix
    );
    check_name := 'Policy "' || expected_policy_prefix || '" exists';
    details := CASE WHEN success THEN 'OK' ELSE 'Policy ' || expected_policy_prefix || ' is missing.' END;
    RETURN NEXT;
  END LOOP;
END;
$$;

SELECT extensions.sign(
  json_build_object(
    'role', 'app_user',
    'exp', (EXTRACT(EPOCH FROM (NOW() + INTERVAL '5 year')))::integer,
    'iat', (EXTRACT(EPOCH FROM NOW()))::integer
  ),
  'YOUR_SUPER_SECRET_AND_LONG_JWT_SECRET_HERE'
) AS "APP_DEDICATED_KEY (COPY THIS BACK TO THE APP)";
`;

