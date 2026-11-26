-- 0004_leave_entitlement_default
--
-- Every employee type is owed annual leave. How many days is the organisation default
-- (leave_entitlement_policy, a dated setting: "לפי החוק" or the organisation's own table, see
-- api/_shared/leave-entitlement.js) unless a manual yearly number is set on the employee.
-- That manual number is "Employees"."annual_leave_days"; null now means "the organisation default".
--
--   1. The column loses its default of 12, so a new employee follows the organisation default.
--   2. Existing rows holding 12 - the old default, which instructors could never change and which
--      office employees got unless someone typed another number - become null (organisation
--      default). Any other number was typed by a person and stays as that employee's manual number.
--      This step runs only the first time (it is skipped once the migration is recorded), so a 12
--      typed after the migration is never cleared.
--
-- No setting is seeded: an organisation without a leave_entitlement_policy version follows the law.
--
-- Safe to run more than once. On an existing database run this file first and
-- src/lib/setup-sql.js after it. A new database needs only setup-sql.js.

BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."Employees" ALTER COLUMN "annual_leave_days" DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.schema_migrations WHERE version = '0004_leave_entitlement_default'
  ) THEN
    UPDATE public."Employees"
    SET "annual_leave_days" = NULL
    WHERE "annual_leave_days" = 12;
  END IF;
END $$;

INSERT INTO public.schema_migrations (version)
VALUES ('0004_leave_entitlement_default')
ON CONFLICT (version) DO NOTHING;

COMMIT;
