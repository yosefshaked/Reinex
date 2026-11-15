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
-- No value is moved: the mirror already wrote each of these values into RateHistory.
--
-- Safe to run more than once. On an existing database run this file first and
-- src/lib/setup-sql.js after it. A new database needs only setup-sql.js.

BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

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
