-- 0001_live_pay_remove_stored_copies
--
-- Pay is computed from the facts when it is shown (api/_shared/pay-calculation.js), so the
-- copies that used to be kept in step with the calendar are removed:
--   * lesson_earnings            - the stored pay of each lesson
--   * payroll_runs               - the half-built pay runs, and the 'payroll_run' lock type
--   * employee_attendance_records.lesson_minutes / worked_minutes, their trigger, and the
--     'system' and 'correction' rows that existed only to carry lesson minutes
-- What stays in employee_attendance_records is other_minutes: work that is not a lesson.
--
-- Safe to run more than once. On an existing database run this file first and
-- src/lib/setup-sql.js after it. A new database needs only setup-sql.js.

BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- 1. Stored lesson pay ------------------------------------------------------------------------

DROP TABLE IF EXISTS public.lesson_earnings;

-- 2. Pay runs and their lock type -------------------------------------------------------------

DELETE FROM public.instance_locks WHERE lock_source_type = 'payroll_run';
DELETE FROM public.participant_locks WHERE lock_source_type = 'payroll_run';

ALTER TABLE public.instance_locks DROP CONSTRAINT IF EXISTS instance_locks_source_type_check;
ALTER TABLE public.instance_locks
  ADD CONSTRAINT instance_locks_source_type_check
  CHECK (lock_source_type IN ('claim_batch', 'manual_compliance_lock'));

ALTER TABLE public.participant_locks DROP CONSTRAINT IF EXISTS participant_locks_source_type_check;
ALTER TABLE public.participant_locks
  ADD CONSTRAINT participant_locks_source_type_check
  CHECK (lock_source_type IN ('claim_batch', 'manual_compliance_lock'));

DROP TABLE IF EXISTS public.payroll_runs;

-- 3. Lesson minutes kept on the attendance day ------------------------------------------------

DROP TRIGGER IF EXISTS trg_employee_attendance_records_sync_minutes ON public.employee_attendance_records;
DROP FUNCTION IF EXISTS public.sync_attendance_minute_buckets();

-- Rows the system wrote to carry lesson minutes, and the minute deltas of calendar corrections.
DELETE FROM public.employee_attendance_records WHERE source_type IN ('system', 'correction');

-- The lesson sync also left its own note and lesson lists on rows a person entered. They describe
-- lesson time that is no longer stored here, so they go; a note a person wrote stays.
UPDATE public.employee_attendance_records
SET metadata = COALESCE(metadata, '{}'::jsonb)
      - 'lesson_ids' - 'lesson_count' - 'resolved_lesson_ids' - 'resolved_lesson_count'
      - 'policy_paid_unattended_lesson_ids' - 'policy_paid_unattended_lesson_count',
    notes = CASE WHEN notes ~ '^[0-9]+ שיעורים נספרו לנוכחות' THEN NULL ELSE notes END
WHERE metadata ?| ARRAY['lesson_ids', 'lesson_count', 'resolved_lesson_ids', 'resolved_lesson_count',
                        'policy_paid_unattended_lesson_ids', 'policy_paid_unattended_lesson_count']
   OR notes ~ '^[0-9]+ שיעורים נספרו לנוכחות';

ALTER TABLE public.employee_attendance_records
  ADD COLUMN IF NOT EXISTS other_minutes integer NOT NULL DEFAULT 0;

-- A database from before the two buckets existed holds everything in worked_minutes. The rows
-- left at this point were entered by a person or imported, so their minutes are other work.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_attendance_records' AND column_name = 'worked_minutes'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_attendance_records' AND column_name = 'lesson_minutes'
  ) THEN
    EXECUTE 'UPDATE public.employee_attendance_records
             SET other_minutes = GREATEST(COALESCE(worked_minutes, 0), 0)
             WHERE other_minutes = 0 AND COALESCE(worked_minutes, 0) > 0';
  END IF;
END $$;

ALTER TABLE public.employee_attendance_records
  DROP COLUMN IF EXISTS lesson_minutes,
  DROP COLUMN IF EXISTS worked_minutes;

ALTER TABLE public.employee_attendance_records
  DROP CONSTRAINT IF EXISTS employee_attendance_records_source_type_check;
ALTER TABLE public.employee_attendance_records
  ADD CONSTRAINT employee_attendance_records_source_type_check
  CHECK (source_type IN ('manual', 'import'));

-- One row per employee and day, now without exceptions.
DROP INDEX IF EXISTS public.employee_attendance_records_correction_idx;
DROP INDEX IF EXISTS public.employee_attendance_records_primary_date_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS employee_attendance_records_primary_date_uidx
  ON public.employee_attendance_records (org_id, employee_id, attendance_date);

INSERT INTO public.schema_migrations (version)
VALUES ('0001_live_pay_remove_stored_copies')
ON CONFLICT (version) DO NOTHING;

COMMIT;
