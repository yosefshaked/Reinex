# BYO Supabase setup – customer guide and automation (post‑MVP)

Status: Planned (defer until after MVP)
Owner: Yosef
Related: `src/lib/setup-sql.js`, AGENTS.md (Setup Assistant, Tenant schema policy)

## Goal
Make the Bring‑Your‑Own Supabase onboarding copy‑paste simple so customers never need to hunt around the Supabase UI. Provide:
- A single SQL bootstrap to create the `tuttiud` schema, private storage bucket, and expose the schema to the API (PostgREST reload).
- A quick verification query with clear “green checks”.
- A short customer‑facing guide (5 minutes), plus an optional in‑app checker.

## Current (MVP)
- We already ship a SQL bootstrap in `src/lib/setup-sql.js` (idempotent).
- BYO Supabase remains the deployment model to avoid paid project limits.
- No in‑app checker or polished customer docs yet.

## Planned deliverables
- Customer guide (Markdown page): prerequisites, 3 steps, and a verification query.
- Copy‑paste SQL block (matches `src/lib/setup-sql.js`, idempotent).
- Env keys mapping and where to paste them (frontend + API).
- Troubleshooting section (common symptoms → fixes).
- Optional (stretch): In‑app Setup Checker UI in Settings.

## Draft customer guide outline
1) Create a Supabase project (org → new project).
2) Open Supabase → SQL Editor → paste and run the bootstrap SQL.
3) Verify setup (one `SELECT`): `has_schema`, `has_bucket`, and `db_schemas` contains `tuttiud`.
4) Provide keys to TutTiud:
   - Supabase URL
   - anon/public key (frontend)
   - service‑role key (server; never used in the browser). Recommend rotating it after onboarding.
5) App config variables:
   - Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - API: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - All tenant clients use `db: { schema: 'tuttiud' }` (already enforced in code per AGENTS.md).

## Copy‑paste SQL bootstrap (idempotent)
> Lives in `src/lib/setup-sql.js`. Keep this snippet in sync when we change the DB bootstrap.

```sql
begin;

-- 0) Extensions used by TutTiud
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists uuid-ossp;  -- uuid_generate_v4()

-- 1) Schema
create schema if not exists tuttiud;

-- 2) Private storage bucket
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'tuttiud') then
    perform storage.create_bucket('tuttiud', false, false);
  end if;
end $$;

-- 3) Expose schema to API (PostgREST) and reload
alter database postgres set pgrst.db_schemas = 'public,tuttiud';
notify pgrst, 'reload config';

-- 4) Quick verification view
create or replace view public.tuttiud_setup_status as
select
  current_setting('pgrst.db_schemas', true) as db_schemas,
  exists(select 1 from information_schema.schemata where schema_name='tuttiud') as has_schema,
  exists(select 1 from storage.buckets where id='tuttiud') as has_bucket;

commit;
```

Verify:
```sql
select * from public.tuttiud_setup_status;
```

Expected: `has_schema = true`, `has_bucket = true`, and `db_schemas` includes `tuttiud`.

## Troubleshooting (customer)
- 404/Relation not found for `tuttiud.*`: schema not exposed yet. Re‑run SQL; ensure `pgrst.db_schemas = 'public,tuttiud'`; wait ~10s (reload) and retry.
- 401 from server API needing service role: `SUPABASE_SERVICE_ROLE_KEY` missing or wrong in the API environment.
- Storage errors: bucket missing. Re‑run bootstrap (idempotent).

## Acceptance criteria
- [ ] Markdown guide checked into repo (linkable from Settings later).
- [ ] SQL bootstrap and verification copied from `src/lib/setup-sql.js` and kept in sync.
- [ ] Clear env key mapping and which app surfaces use which key (anon vs service role).
- [ ] Troubleshooting covers the top 3 failure modes.
- [ ] (Optional) In‑app Setup Checker component shows green checks and missing steps.

## Security notes
- Customers should never send the service role to the browser.
- Treat the service role as sensitive: accept server‑side only, never log, and recommend rotating after onboarding.
- RLS remains the primary defense in multi‑tenant mode; all tables must carry `org_id` and strict policies.

## Future enhancements (post‑MVP)
- In‑app Setup Checker banner (for admins/owners): reads `public.tuttiud_setup_status` and shows green checks.
- One‑click copy buttons (SQL block and env keys).
- Optional “connector” flow: server accepts Supabase URL + temporary service role to run bootstrap automatically, then discards; prompt user to rotate key.
- GitHub Actions job to ping `/api/health` and alert if misconfigured.

## Open questions
- Where will the customer doc live in‑app? (Settings → Organization → Setup)
- Do we need a Hebrew and English version? (Consider `ProjectDoc/Heb.md` parity.)
- Should we ship a CLI snippet as an alternative for advanced teams?

## References
- `src/lib/setup-sql.js` – source of truth for the bootstrap SQL.
- `AGENTS.md` – Tenant schema policy, Setup Assistant notes.
- `api/_shared/org-bff.js` – centralized tenant client creation (schema default).
