-- 0005_employee_leave_pay_method_dated
--
-- An employee's own way of valuing a leave day (legal / historical average / fixed value) was a
-- plain column, "Employees"."leave_pay_method", so changing it re-valued every leave day already
-- paid. It is now a dated setting: a version from a date, read as of the leave day
-- (api/_shared/dated-settings.js, key 'leave_pay_method', one row per employee and date in
-- "SettingsHistory"; null method = follow the organisation).
--
--   1. "SettingsHistory" gets "employee_id" (all-zero = a version of the whole organisation) and the
--      unique index becomes (org_id, key, employee_id, effective_date); the old index on
--      (org_id, key, effective_date) is dropped.
--   2. Each employee's current "leave_pay_method" becomes a first version in force "since the
--      beginning" (2000-01-01, as the other carried-over values), so every leave day, past ones
--      included, is valued exactly as before. Nothing is added where the employee already has a version.
--   3. The column is dropped: nothing else reads it (pay reads the versions).
--
-- Safe to run more than once. On an existing database run this file first and
-- src/lib/setup-sql.js after it. A new database needs only setup-sql.js.

BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- 1. Employee scope on the dated settings ------------------------------------------------------

ALTER TABLE public."SettingsHistory"
  ADD COLUMN IF NOT EXISTS "employee_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

CREATE UNIQUE INDEX IF NOT EXISTS settings_history_org_key_employee_effective_date_uidx
  ON public."SettingsHistory" ("org_id", "key", "employee_id", "effective_date");

DROP INDEX IF EXISTS public.settings_history_org_key_effective_date_uidx;

-- 2 + 3. Copy the column into versions, then drop it (only while the column still exists) -------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Employees' AND column_name = 'leave_pay_method'
  ) THEN
    INSERT INTO public."SettingsHistory" ("org_id", "key", "employee_id", "effective_date", "settings_value", "notes")
    SELECT e."org_id", 'leave_pay_method', e."id", DATE '2000-01-01',
           jsonb_build_object('method', e."leave_pay_method"), NULL
    FROM public."Employees" e
    WHERE e."leave_pay_method" IN ('legal', 'avg_hourly_x_avg_day_hours', 'fixed_rate')
      AND NOT EXISTS (
        SELECT 1 FROM public."SettingsHistory" h
        WHERE h."org_id" = e."org_id" AND h."key" = 'leave_pay_method' AND h."employee_id" = e."id"
      );

    ALTER TABLE public."Employees" DROP COLUMN "leave_pay_method";
  END IF;
END $$;

INSERT INTO public.schema_migrations (version)
VALUES ('0005_employee_leave_pay_method_dated')
ON CONFLICT (version) DO NOTHING;

COMMIT;
