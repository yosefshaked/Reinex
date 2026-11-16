-- 0003_dated_settings
--
-- Settings that change how instructor pay is computed are read as of the date they apply to, like
-- rates (api/_shared/dated-settings.js). They move from "Settings" (one value per org and key) to
-- "SettingsHistory" (a version per org, key and effective date):
--   * instructor_earnings_policy - which participant outcomes pay the instructor
--   * leave_pay_policy           - the organisation's default way to value a paid leave day
-- Each organisation's current value becomes its first version, in force "since the beginning"
-- (2000-01-01, the date rates carried over from before rate history start on), and its row in
-- "Settings" is deleted: a dated key is never read from "Settings".
--
-- The paid / not-paid decision on a participant is now stored only when a person chooses it in the
-- absence form; otherwise the policy in force on the lesson's date decides. Decisions the system
-- wrote by itself are cleared so the policy reaches them:
--   * an attended participant (no form ever asks about pay for an attended participant);
--   * a participant of a whole lesson cancelled by the clinic (reason 'instance_cancelled').
-- A decision on a no-show or a cancellation marked one at a time cannot be told apart from a choice
-- made in the form (both are stored the same way), so it stays and counts as a choice. So does any
-- decision on a locked participant (see step 3).
--
-- Safe to run more than once. On an existing database run this file first and
-- src/lib/setup-sql.js after it. A new database needs only setup-sql.js.

BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- 1. The table (setup-sql.js adds its RLS policies and grants) ---------------------------------

CREATE TABLE IF NOT EXISTS public."SettingsHistory" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "org_id" uuid NOT NULL REFERENCES public.organizations(id),
  "key" text NOT NULL,
  "effective_date" date NOT NULL,
  "settings_value" jsonb NOT NULL,
  "notes" text,
  "created_by" uuid NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."SettingsHistory" ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS settings_history_org_key_effective_date_uidx
  ON public."SettingsHistory" ("org_id", "key", "effective_date");

-- 2. Move the dated keys ------------------------------------------------------------------------

-- An organisation that already has versions of a key keeps them; its "Settings" row is a leftover.
INSERT INTO public."SettingsHistory" ("org_id", "key", "effective_date", "settings_value", "notes")
SELECT s."org_id", s."key", DATE '2000-01-01', s."settings_value", NULL
FROM public."Settings" s
WHERE s."key" IN ('instructor_earnings_policy', 'leave_pay_policy')
  AND s."settings_value" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public."SettingsHistory" h
    WHERE h."org_id" = s."org_id" AND h."key" = s."key"
  );

DELETE FROM public."Settings"
WHERE "key" IN ('instructor_earnings_policy', 'leave_pay_policy');

-- 3. Pay decisions the system stored by itself -------------------------------------------------

-- A locked participant (an HMO claim batch or a compliance lock) is changed only through the
-- correction workflow, so it is left as it is.
UPDATE public.lesson_participants p
SET metadata = jsonb_set(p.metadata, '{workflow,instructor_compensation,decision}', '"unknown"'::jsonb)
WHERE p.metadata #>> '{workflow,instructor_compensation,decision}' IN ('compensated', 'not_compensated')
  AND (
    p.participant_status = 'attended'
    OR p.metadata #>> '{workflow,instructor_compensation,reason}' = 'instance_cancelled'
  )
  AND NOT EXISTS (SELECT 1 FROM public.participant_locks pl WHERE pl.lesson_participant_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.instance_locks il WHERE il.lesson_instance_id = p.lesson_instance_id);

INSERT INTO public.schema_migrations (version)
VALUES ('0003_dated_settings')
ON CONFLICT (version) DO NOTHING;

COMMIT;
