-- 0002_remove_legacy_rate_columns
--
-- Every pay rate is a dated row in "RateHistory", written only by api/employee-rates. The older
-- places a rate used to live, and the bridge that copied them into "RateHistory", are removed:
--   * Employees.current_rate, monthly_salary_amount, leave_fixed_day_rate - copied into RateHistory
--     as attendance_hourly / monthly_salary / leave_day by the trigger below
--   * Employees.payroll_model - a label only; pay adds up every kind of rate the employee has
--   * instructor_service_capabilities.base_rate and metadata.compensation_input - a capability
--     carries no money
--   * the trigger trg_employees_mirror_rate_history, its function, and record_rate_history_from_legacy_value
--   * the capability mirror (trigger and function), in case a database still has it
-- Before the columns go, each value that "RateHistory" does not hold yet is copied into it (step 0),
-- the way the schema script of the rate-history change did: a first row from 2000-01-01 with
-- metadata.source = 'backfill_2026_09' (current_rate = attendance_hourly, monthly_salary_amount =
-- monthly_salary, leave_fixed_day_rate = leave_day, base_rate = lesson_hourly for its service). A
-- value is copied only while its column still exists and only where the employee has no rate of that
-- kind yet (for a capability: none for that service), so a database that was already copied, or
-- one whose columns are gone, gets nothing.
--
-- Safe to run more than once. On an existing database run this file first and
-- src/lib/setup-sql.js after it. A new database needs only setup-sql.js.

BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- 0. Copy what RateHistory does not hold yet ----------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'instructor_service_capabilities' AND column_name = 'base_rate') THEN
    INSERT INTO public."RateHistory" ("org_id", "employee_id", "service_id", "pay_basis", "rate", "effective_date", "metadata")
    SELECT
      cap."org_id", cap."employee_id", cap."service_id", 'lesson_hourly', cap."base_rate", DATE '2000-01-01',
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'backfill_2026_09',
        'compensation_input', cap."metadata" -> 'compensation_input'
      ))
    FROM public.instructor_service_capabilities cap
    WHERE cap."base_rate" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public."RateHistory" existing_rate
        WHERE existing_rate."org_id" = cap."org_id"
          AND existing_rate."employee_id" = cap."employee_id"
          AND existing_rate."service_id" = cap."service_id"
          AND existing_rate."pay_basis" IN ('lesson_hourly', 'lesson_flat')
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'Employees' AND column_name = 'current_rate') THEN
    INSERT INTO public."RateHistory" ("org_id", "employee_id", "service_id", "pay_basis", "rate", "effective_date", "metadata")
    SELECT emp."org_id", emp."id", NULL::uuid, 'attendance_hourly', emp."current_rate", DATE '2000-01-01',
           jsonb_build_object('source', 'backfill_2026_09')
    FROM public."Employees" emp
    WHERE emp."current_rate" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public."RateHistory" existing_rate
        WHERE existing_rate."org_id" = emp."org_id" AND existing_rate."employee_id" = emp."id"
          AND existing_rate."pay_basis" = 'attendance_hourly'
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'Employees' AND column_name = 'monthly_salary_amount') THEN
    INSERT INTO public."RateHistory" ("org_id", "employee_id", "service_id", "pay_basis", "rate", "effective_date", "metadata")
    SELECT emp."org_id", emp."id", NULL::uuid, 'monthly_salary', emp."monthly_salary_amount", DATE '2000-01-01',
           jsonb_build_object('source', 'backfill_2026_09')
    FROM public."Employees" emp
    WHERE emp."monthly_salary_amount" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public."RateHistory" existing_rate
        WHERE existing_rate."org_id" = emp."org_id" AND existing_rate."employee_id" = emp."id"
          AND existing_rate."pay_basis" = 'monthly_salary'
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'Employees' AND column_name = 'leave_fixed_day_rate') THEN
    INSERT INTO public."RateHistory" ("org_id", "employee_id", "service_id", "pay_basis", "rate", "effective_date", "metadata")
    SELECT emp."org_id", emp."id", NULL::uuid, 'leave_day', emp."leave_fixed_day_rate", DATE '2000-01-01',
           jsonb_build_object('source', 'backfill_2026_09')
    FROM public."Employees" emp
    WHERE emp."leave_fixed_day_rate" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public."RateHistory" existing_rate
        WHERE existing_rate."org_id" = emp."org_id" AND existing_rate."employee_id" = emp."id"
          AND existing_rate."pay_basis" = 'leave_day'
      );
  END IF;
END $$;

-- 1. The bridges ------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_employees_mirror_rate_history ON public."Employees";
DROP FUNCTION IF EXISTS public.mirror_employee_rates_to_rate_history();

DROP TRIGGER IF EXISTS trg_instructor_service_capabilities_mirror_rate_history ON public.instructor_service_capabilities;
DROP FUNCTION IF EXISTS public.mirror_capability_rate_to_rate_history();

DROP FUNCTION IF EXISTS public.record_rate_history_from_legacy_value(uuid, uuid, uuid, text, integer, text, jsonb);

-- 2. The legacy columns -----------------------------------------------------------------------

-- Dropping payroll_model drops its CHECK constraint with it.
ALTER TABLE public."Employees"
  DROP COLUMN IF EXISTS current_rate,
  DROP COLUMN IF EXISTS monthly_salary_amount,
  DROP COLUMN IF EXISTS leave_fixed_day_rate,
  DROP COLUMN IF EXISTS payroll_model;

ALTER TABLE public.instructor_service_capabilities
  DROP COLUMN IF EXISTS base_rate;

-- 3. What the office once typed as a capability's pay ------------------------------------------

UPDATE public.instructor_service_capabilities
SET metadata = metadata - 'compensation_input'
WHERE metadata ? 'compensation_input';

INSERT INTO public.schema_migrations (version)
VALUES ('0002_remove_legacy_rate_columns')
ON CONFLICT (version) DO NOTHING;

COMMIT;
