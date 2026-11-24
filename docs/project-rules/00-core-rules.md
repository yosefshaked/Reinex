# 00 Core Rules

## When to read
- Start of any task.
- Any work that touches tenant access, instructors, invitations, Azure Functions, or services.

## Start here
These files are an entry point, not a boundary: follow imports, callers (grep the symbol), dependencies, cross-domain effects and tests as far as the change needs.
- [`../../AGENTS.md`](../../AGENTS.md)
- [`../../api/_shared/org-bff.js`](../../api/_shared/org-bff.js)
- [`../../api/_shared/http.js`](../../api/_shared/http.js)
- [`../../api/instructors/index.js`](../../api/instructors/index.js)
- [`../../api/services/index.js`](../../api/services/index.js)
- [`../../src/components/settings/employee-management/DirectoryView.jsx`](../../src/components/settings/employee-management/DirectoryView.jsx)
- [`../../src/components/settings/employee-management/InviteUserDialog.jsx`](../../src/components/settings/employee-management/InviteUserDialog.jsx)

## Architecture: Single-Database Multi-Tenant
- All tenant tables live in one Supabase project. Every tenant table has `org_id uuid NOT NULL REFERENCES organizations(id)`.
- RLS protects requests made with a user's token (policies use the `get_active_org_id()` SECURITY DEFINER function, which reads `x-org-id` from request headers and verifies `org_memberships`).
- The API uses the `service_role` key, which bypasses RLS, so the API itself keeps each org's data apart: authorise first, then scope every tenant table operation to the org. The rule is in [`30-backend-shared-helpers.md`](30-backend-shared-helpers.md) "Org isolation in the API".
- **Never** reintroduce per-org database credentials (`dedicated_key`, `supabase_url` on orgs), BYOD patterns, or the `org_settings` table — all are deprecated and removed. Create the client with `createSingleClient(env)` from `api/_shared/org-bff.js`, and scope tenant table access with `withOrgScope(client, table, orgId)`.
- The schema is defined by a snapshot plus migrations; see "Schema" below.

## Shared helpers to reuse
- `respond`, `readEnv`, `ensureMembership`, `resolveOrgId`, `createSingleClient`, `withOrgScope` in [`../../api/_shared/org-bff.js`](../../api/_shared/org-bff.js)
- `resolveBearerAuthorization` in [`../../api/_shared/http.js`](../../api/_shared/http.js)
- `createDashboardTask` (idempotent), `listDashboardTasks`, `resolveDashboardTask` in [`../../api/_shared/dashboard-tasks.js`](../../api/_shared/dashboard-tasks.js)

## Known patterns / do not reinvent
- All tenant data is in the shared Supabase project; tenant schema is `public`.
- API route names are domain-based; do not add `reinex` to route paths.
- For Azure Functions HTTP routes, do not use route names that start with `admin` (reserved by Azure host management routes under `/admin/*`).
- Instructors are self-scoped unless membership role is `admin` or `owner`.
- Current instructor shape is split across:
  - [`Employees`](../../api/instructors/index.js): base row, including `working_days`
  - [`instructor_profiles`](../../api/instructors/index.js): `break_time_minutes`, `metadata`
  - [`instructor_service_capabilities`](../../api/instructors/index.js): `service_id`, `max_students`, `availability_windows`, `metadata` (no pay: rates live in `RateHistory`)
- `GET /api/instructors` manually loads those tables and returns merged rows with `instructor_profile` and `service_capabilities`.
- Invitation UI lives in Employees management via [`DirectoryView.jsx`](../../src/components/settings/employee-management/DirectoryView.jsx) + [`InviteUserDialog.jsx`](../../src/components/settings/employee-management/InviteUserDialog.jsx); do not move new invitation work back into Settings.
- Azure Functions must return through `respond(context, ...)` (5xx rules in [`30-backend-shared-helpers.md`](30-backend-shared-helpers.md)), must read auth with `resolveBearerAuthorization(req)`, and must use `supabase.auth.getUser(token)`, which returns `{ data, error }`; the user is `result.data.user`.
- A new Azure Function needs a `function.json` next to its `index.js`; without it the host does not load the endpoint.
- Services use `is_active` for enable/disable; do not introduce delete-driven disablement.
- Use `createDashboardTask` (from `dashboard-tasks.js`) to push inbox tasks for domain operations that require user follow-up; it is idempotent — duplicate open tasks for the same `taskType` + `resourceType` + `resourceId` are suppressed automatically.
- Dashboard task helpers are single-DB org-scoped primitives: always pass `orgId` to `createDashboardTask`, `listDashboardTasks`, and `resolveDashboardTask`. Do not call them without org scope.
- Dashboard inbox UI should summarize open tasks by task kind/count rather than rendering long flat lists one row per task when volumes grow. Task rows remain the source data, but the default dashboard presentation should aggregate them.

## Dates and time zones
Reinex serves Israeli organisations; stored instants stay UTC for data integrity, and every "which local day / month / time is this" decision is made in the organisation's time zone by one module.
- **Storage (unchanged):** an instant (`lesson_instances.datetime_start`, `created_at`, `effective_at`, ...) is `timestamptz` in UTC and travels as an ISO string. A calendar date with no time (attendance day, leave day, rate `effective_date`, `valid_from`, ...) is a `date` / `'YYYY-MM-DD'` key and is never converted through a time zone.
- **One module:** [`../../api/_shared/local-time.js`](../../api/_shared/local-time.js) (isomorphic; the frontend imports it through the re-export [`../../src/lib/local-time.js`](../../src/lib/local-time.js) — never copy it). Read its header for the rules and the DST decisions.
  - Instant -> local: `localDateKey`, `localMonthKey`, `localTime`, `localWeekday`, `todayKey`, `currentMonthKey`. A value that is already a date key passes through `localDateKey` unchanged.
  - Local -> UTC for queries and writes: `localDateTimeToUtc(dateKey, 'HH:mm')`, `startOfLocalDayUtc`, `endOfLocalDayUtc` (exclusive), `localDateRangeUtc(start, end)` / `localMonthRangeUtc(month)` -> `{ startIso, endExclusiveIso }` for `.gte(...).lt(...)`. They resolve the real offset on that date (23-hour spring day, 25-hour autumn day). Non-existent local time (spring forward) shifts forward; a repeated local time (autumn) takes the first occurrence.
  - Date-only arithmetic (no zone): `addDays`, `addMonths`, `diffDays`, `compareDateKeys`, `enumerateDateKeys`, `firstDayOfMonth`, `lastDayOfMonth`, `weekdayOfDateKey`, `normalizeDateKey`. A day picked in a browser date picker: `dateKeyFromCalendarDate` (local getters); a spreadsheet/Excel calendar date: `dateKeyFromUtcCalendarDate`.
  - Display: `formatInstant(value, options)`, `formatLocalDateTime`.
  - Technical UTC stamps only (file names, support codes, retention cut-offs): `utcDateKey`, `utcFileStamp`.
- **Clock changes (daylight saving):** `findClockChanges(from, to, zone)` / `classifyLocalTime(dateKey, 'HH:mm', zone)` in the module derive every change from the IANA zone through `Intl` (offset compared across each day, located to the minute; non-60-minute shifts and midnight changes included; zones without changes return none). Never hard-code a country, a date or a 60-minute shift. Lesson rules live in [`../../api/_shared/clock-change-rules.js`](../../api/_shared/clock-change-rules.js) (frontend: `src/lib/clock-change.js`):
  - **Skipped interval (offset increases):** a person may not schedule a lesson that STARTS in it. The browser has already moved 02:30 to 03:30 in the instant, so the calendar sends the chosen wall time as `start_local_date` + `start_local_time` next to `datetime_start`, and the server checks that (422 `lesson_time_skipped_by_clock_change`, Hebrew message with the times from `findClockChanges`). Requests without those fields are not checked. Recurring templates are not blocked; generation skips that single occurrence and reports a `clock_change_skipped_time` conflict.
  - **Repeated interval (offset decreases):** allowed; saved at the first occurrence; the form shows a non-blocking notice.
  - "שעון קיץ" / "שעון חורף" wording follows the direction of the shift, never the month.
  - The calendar draws a band over each interval of the visible days (background event across all resources, never interactive). The grid runs in the browser's zone, so bands are drawn only when the browser's zone has the same change as the org's.
- **One zone per organisation:** there is no per-org setting yet; `resolveOrgTimeZone()` returns `DEFAULT_ORG_TIME_ZONE` (`Asia/Jerusalem`). Adding a setting is a change to that function only. Never write the zone literal elsewhere.
- **Never cut a date out of a timestamp** (`.toISOString().slice(0, 10)`, `.split('T')[0]`, `.substring(0, 10)`): that is the UTC date, so a lesson at 00:30 Israel time lands on the previous day — and on the 1st, in the previous month's pay.
- **Frontend month/day ranges** are sent to the API as date keys (`start_date` / `end_date`); the API turns them into UTC ranges through the module. Do not send browser-zone instants as range bounds.
- **Lint:** `no-restricted-syntax` in [`../../eslint.config.js`](../../eslint.config.js) fails on those cut patterns and on the `'Asia/Jerusalem'` literal outside the module and its test. A per-line disable needs a reason comment and should be rare. Tests: [`../../api/_shared/local-time.test.js`](../../api/_shared/local-time.test.js) (in `npm run test:finance-calendar`).

## Dated settings (money-affecting policy)
- A setting that affects how money is computed is read **as of the date it applies to** (a lesson's local date, a leave day), never "the current value": changing it from a date must not change months before that date. These keys live only in `SettingsHistory` and are listed in `DATED_SETTING_KEYS` in [`../../api/_shared/dated-settings.js`](../../api/_shared/dated-settings.js).
- Read them only through the one resolver: `loadFinancePolicies(client, orgId, { asOf })` (with `financePoliciesOnDate` / `policies.onDate(date)` per lesson or day) or `resolveSettingOnDate`. Pass `todayKey()` explicitly when you mean "now". Never read a dated key from `Settings` (`loadSettingsMap` throws) and never store a copy of a policy's answer on a record "to freeze it".
- Write them only through `api/settings` with an `effective_date`; edit them in the UI with `DatedSettingFields`. Details in [`80-finance-billing-payroll.md`](80-finance-billing-payroll.md).

## Money in code
- Money is stored and computed in **agorot** (integers). Convert only with the currency helpers: `toAgorot()` / `toShekel()` from `src/lib/currency.js` (backend: `api/_shared/currency.js`). **Why:** floating shekel values drift by a fraction of an agora.
- ESLint (`no-restricted-syntax`, run by `npm run lint` and `npm run lint:api`) rejects a hand-written `* 100` / `/ 100` in `src/**` and `api/**`. Use the currency helpers; for a value that is not money use `roundTo2()` (`src/lib/round.js`) or `// eslint-disable-next-line no-restricted-syntax -- not money: <why>`.

## Schema
- **Two parts, applied in this order:**
  - `src/lib/setup-sql.js` is the target snapshot. A new database is set up from it alone.
  - On an existing database, run the new migrations from `migrations/` in order, then the snapshot.
  - The procedure is in [`../../migrations/README.md`](../../migrations/README.md): migrations are applied by hand today; applying them from CI is planned.
  - **Why:** a new database needs only the target state; an existing one must first lose what the snapshot no longer defines.
- **The snapshot is safe to run again.** Every `CREATE TABLE`, `CREATE INDEX` and `ALTER TABLE ... ADD COLUMN` uses `IF NOT EXISTS`; every `ADD CONSTRAINT ... UNIQUE` sits inside a `DO $$ BEGIN IF NOT EXISTS ... END $$` guard. **Why:** the same file is applied to new and existing databases, repeatedly.
- **Checks:** `npm run lint:sql` checks the snapshot. Some tests read a migration file (for example `tests/dated-settings.test.js`). No general checker validates every migration file yet.

**Upsert contract (42P10 prevention).** Every `.upsert(...)` states `onConflict` explicitly. A new or changed `withOrgScope().upsert({ onConflict: '...' })` requires three simultaneous changes:
1. Add the table+columns to `EXPECTED_CONFLICTS_BY_TABLE` in `scripts/validate-upsert-conflicts.js`.
2. Add `CREATE UNIQUE INDEX IF NOT EXISTS` or a named `UNIQUE` constraint in `src/lib/setup-sql.js`.
3. Run `npm run lint:upsert-conflicts` to verify both sides agree.

Missing step 2 causes PostgreSQL error `42P10` at runtime — silent in code review, only visible when the upsert is exercised on a real DB.

## Finding and running tests
- Node tests use `node --test`. A unit test may sit next to its module (`api/**`, `src/**`); shared tests are in `tests/`; browser and API scenarios are in `tests/automatic-tester/` (runner: `node tests/automatic-tester/runner.js --script <name>`).
- Find the tests for a module with `git grep -l "<module or function name>" -- "*.test.js" tests/automatic-tester/scripts`.
- `npm run test:finance-calendar` runs a fixed list of files (finance and others); `npm run verify:beta` runs it too. Neither `npm run build` nor CI runs it.
- CI runs `tests/validate-plans-index.test.js` ("Plan registry" workflow) and `tests/check-doc-links.test.js` ("Doc links" workflow) directly.
- Every other test file has no entry point: run it with `node --test <file>` when you change the code it covers. Not being in an npm list does not mean a test is obsolete.
- Which tests a change needs is the "Tests for every behaviour change" rule in [`../../AGENTS.md`](../../AGENTS.md).

## Required validation after edits
The validation table is kept once, in [`../../AGENTS.md`](../../AGENTS.md) "After writing code — required validation".
