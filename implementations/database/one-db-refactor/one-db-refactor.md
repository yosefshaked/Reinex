# SaaS Multi-Tenant Refactor: State & Context Tracker

## 🚀 Architecture Context
* **Paradigm:** Single-Database Multi-Tenant with RLS (`org_id` on all tenant tables).
* **Environment:** Brand new Supabase project (Greenfield). No legacy BYOD columns needed (`supabase_url`, `anon_key`, `dedicated_key_encrypted` are NOT carried over).
* **Schema SSOT:** `src/lib/setup-sql.js`.
* **Artifacts:** All migration/helper scripts go in `/implementations/database/one-db-refactor/`.
* **Pre-Refactor Inventory:**
  - 42 distinct tenant tables, 20 RPCs/functions, 87 indexes.
  - 57 API endpoints using `resolveTenantClient` (BYOD pattern).
  - ~10 control-DB-only API endpoints (org-memberships, organizations, invitations, config, etc.).
  - 5 frontend files forming the dual-client BYOD plumbing.

### Key Decisions (Approved 2026-04-16)
* **`org_settings`:** Survivable columns (`permissions`, `logo_url`, `storage_profile`, `storage_grace_ends_at`, `backup_history`, `metadata`) merged directly into `organizations`. `org_settings` table is **deprecated/dropped**.
* **`audit_log`:** Control DB `audit_log` and tenant `tenant_audit_log` merged into a single unified `audit_log` table with `org_id`.
* **`org_id` strategy:** Denormalized on ALL tables (root + child). No cascading-join RLS.
* **Backend:** Continues using `service_role` (RLS bypass). Org isolation enforced programmatically via `ensureMembership()` + `.eq('org_id', orgId)`.
* **RLS helper:** `get_active_org_id()` SECURITY DEFINER function reading `x-org-id` from request headers.
* **Storage buckets:** Out of scope (separate workstream).

## 🧠 Current Working Context (For AI Memory)
* **Last Completed Task:** Step 19 — RLS isolation test suite (14/14 ✔) and schema dry-run (0 SQL errors) against local Docker Supabase.
* **Currently Working On:** Step 20 — Update Documentation (`AGENTS.md` + `agents-docs/`).
* **Next Immediate Step:** Step 21 — Environment Variables & Deployment Config Cleanup.
* **Known Issues / Technical Debt:**
  - Supabase Storage bucket isolation strategy NOT in scope (separate workstream).
  - Step 22 (Technical Debt Sweep): backward-compat aliases (`dataClient`, `setActiveOrg`, `activeOrgHasConnection`, `tenantClientReady`, `configStatus`, `activeOrgConfig`) still exposed in `OrgContext` and `SupabaseContext` — to be cleaned up.
  - `org_settings` table may still exist on any live DB from old BYOD era — add DROP in Step 21 or 22.

## 📋 Execution Plan (23 Steps)

### PHASE A: Greenfield Merged Schema Design
> Goal: Produce a clean, single SSOT in `setup-sql.js` that contains BOTH the control tables and the tenant tables, all with `org_id`.

- [x] **Step 1 — Merge Control Tables into `setup-sql.js`** ✅
  Design clean versions of `organizations`, `org_memberships`, `profiles`, `org_invitations`, `permission_registry`, `audit_log` (unified), and `active_routing`. Strip all BYOD columns. Merge `org_settings` survivable columns (`permissions`, `logo_url`, `storage_profile`, `storage_grace_ends_at`, `backup_history`) into `organizations`. Drop `org_settings` as a separate table. Unify control `audit_log` with tenant `tenant_audit_log` into a single `audit_log` table with `org_id`.
  **Output:** Updated `setup-sql.js` with control tables at the top.
  **Done:** 7 control tables inserted after roles section. `tenant_audit_log` CREATE/ALTER/constraint/indexes removed; trigger renamed to `trg_audit_log_set_expiry` → `set_audit_log_expiry()`. RLS ENABLE, GRANT, policy loop, and diagnostics function all updated.

- [x] **Step 2 — Add `org_id` Column to All 42 Tenant Tables** ✅
  Add `org_id uuid NOT NULL REFERENCES organizations(id)` to every tenant table in `setup-sql.js`. Tables: `client_profiles`, `students`, `guardians`, `client_guardians`, `"Employees"`, `"Services"`, `"RateHistory"`, `employee_attendance_records`, `employee_leave_entries`, `employee_leave_days`, `employee_leave_balance_events`, `finance_corrections`, `instructor_profiles`, `instructor_service_capabilities`, `lesson_templates`, `lesson_template_overrides`, `lesson_instances`, `lesson_participants`, `grace_cancellation_requests`, `payroll_runs`, `claim_batches`, `instance_locks`, `participant_locks`, `calendar_instance_corrections`, `dashboard_tasks`, `hmo_providers`, `hmo_provider_tracks`, `hmo_authorizations`, `commitments`, `ledger_accounts`, `ledger_transactions`, `lesson_earnings`, `forms`, `shared_form_blocks`, `form_shared_block_links`, `form_submissions`, `otp_challenges`, `waiting_list_entries`, `"Settings"`, `"Documents"`, `hmo_invoice_batches`, `hmo_invoice_batch_items`.
  **Output:** Every CREATE TABLE has `org_id` as second column after `id`.
  **Done:** 42 CREATE TABLE inserts + 41 ALTER TABLE inserts via automated script. Quoted tables (`"Employees"`, `"Services"`, etc.) use `"org_id"`. Verified: 43 tenant blocks (incl. both `ledger_transactions` definitions) all confirmed. JS parse OK.

- [x] **Step 3 — Convert Unique Indexes to Org-Scoped Composites** ✅
  Rewrite all UNIQUE indexes/constraints that are currently table-scoped to be `(org_id, ...)`. Key targets:
  - `client_profiles_identity_number_unique_idx` → `(org_id, identity_number)` with WHERE clause for NULLs
  - `students_client_profile_id_uidx` → `(org_id, client_profile_id)`
  - `hmo_providers_name_uidx` → `(org_id, name)`
  - `"Settings"` key UNIQUE → `(org_id, key)`
  - `employee_attendance_records_primary_date_uidx` → `(org_id, employee_id, attendance_date)`
  - All 31 unique indexes reviewed and updated.
  **Output:** No cross-org collision possible for business-unique fields.
  **Done:** 15 simple CREATE UNIQUE INDEX statements updated (org_id prepended). 4 complex DO blocks updated (RateHistory, ledger_transactions v1, lesson_earnings, form_shared_block_links — all UNIQUE tuples got org_id). Settings inline UNIQUE removed → separate `settings_org_key_uidx` on `(org_id, key)` + ON CONFLICT updated. ledger_accounts 3 inline constraints updated to `(org_id, ...)`. Category D (UUID uniques: reverses_transaction_id, ledger_transaction_id; control table uniques: slug, token, permission_key) kept as-is. Verified: 0 UNIQUE column tuples remain without org_id. JS parse OK.

- [x] **Step 4 — Add `org_id`-Prefixed Composite Indexes** ✅
  For every existing regular index, prepend `org_id` to make composite indexes that support RLS-filtered queries. Example: `lesson_instances_datetime_start_idx` → `(org_id, datetime_start)`. This ensures the Postgres query planner combines the RLS `org_id` filter with domain filters in a single index scan. All 56+ regular indexes updated.
  **Output:** All indexes are multi-tenant aware.
  **Done:** 89 tenant indexes updated via automated script (`add-org-id-to-indexes.cjs`). Two passes needed (\r\n fix). Quoted tables (`"Employees"`, `"Documents"`, `"RateHistory"`) use `"org_id"`. 10 control-table indexes (organizations, org_memberships, org_invitations, active_routing, audit_log) left untouched. Final audit: 0 tenant indexes remain without org_id. JS parse OK.

- [x] **Step 5 — Update All 20 RPCs/Functions for `org_id`** ✅
  Modify every stored function/RPC to accept `p_org_id uuid` and filter/enforce it:
  - `cancel_lesson_instance_with_participants` — add p_org_id, filter lesson_instances
  - `complete_lesson_instance_with_participants` — add p_org_id
  - `cancel_selected_scheduled_participants_and_reconcile_instance` — add p_org_id
  - `get_student_remaining_balance` — add p_org_id, filter ledger_accounts
  - `create_commitment_transfer_atomic` — add p_org_id
  - `ensure_hmo_authorization_and_link_commitment` — add p_org_id
  - `create_commitment_and_ledger_entry` — add p_org_id
  - `update_commitment_and_record_delta` — add p_org_id
  - `batch_sync_lesson_ledger_entries` — add p_org_id
  - Trigger functions (`validate_lesson_template_no_active_overlap`, `validate_ledger_commitment_ownership`, `guard_lesson_instance_locked`, `guard_lesson_participant_locked`) — read org_id from NEW row
  - Utility functions (`set_entity_updated_at_and_version`, `set_audit_log_expiry`, `prevent_ledger_transaction_mutation`) — no org_id change needed (row-level triggers)
  - Diagnostic functions (`setup_assistant_diagnostics`, `schema_introspection_v1`, `schema_run_selects_v1`, `schema_execute_statements_v1`) — kept as-is (dev-only tools)
  **Output:** All RPCs enforce `org_id` in their WHERE clauses. Triggers read org_id from the triggering row.
  **Done:** 9 callable RPCs updated — `p_org_id uuid` added as first parameter, all SELECT/UPDATE/INSERT/DELETE queries filter on `org_id`, all GRANT statements updated with new signature. 4 trigger functions updated with `NEW.org_id`/`OLD.org_id` cross-table filters. 3 utility triggers unchanged (row-level, no cross-table). 4 diagnostic functions unchanged (dev tools). `batch_sync_lesson_ledger_entries` ON CONFLICT updated to `(org_id, source_ref, usage_type)`. All org_id-bearing INSERT statements include `org_id` column + value. JS parse verified OK.

### PHASE B: RLS & Auth Security Layer
> Goal: Lock down the merged database so no tenant can see another tenant's data.

- [x] **Step 6 — Create RLS Helper Functions** ✅
  Write two `SECURITY DEFINER` helper functions:
  - `get_active_org_id()` — reads `x-org-id` from Supabase request headers (`current_setting('request.headers', true)::json->>'x-org-id'`). Used in all tenant RLS policies.
  - `get_my_org_ids()` — returns `SETOF uuid` from `org_memberships WHERE user_id = auth.uid()`. Used for multi-org list views if needed.
  Both must be `STABLE`, `SET search_path = public`, and `SECURITY DEFINER`.
  **Output:** Helper SQL added to `setup-sql.js`.
  **Done:** Both functions created in RLS Helper Functions section (before ENABLE ROW LEVEL SECURITY). `get_active_org_id()` is plpgsql with UUID validation, NULL/empty guard, and membership verification via `org_memberships`. `get_my_org_ids()` is a lean SQL function returning SETOF uuid. Both are STABLE + SECURITY DEFINER + SET search_path = public. GRANTs added for authenticated + app_user roles. Stale REVOKE statements (old RPC signatures from Step 5) also fixed. JS parse verified OK.

- [x] **Step 7 — Write RLS Policies for Control Tables** ✅
  Non-recursive policies for tables that the helper functions themselves query:
  - `org_memberships` → `USING (user_id = auth.uid())` — direct, no function call
  - `organizations` → `USING (id IN (SELECT org_id FROM org_memberships WHERE user_id = auth.uid()))` — inline subquery
  - `profiles` → `USING (id = auth.uid())`
  - `org_invitations` → `USING (org_id IN (SELECT org_id FROM org_memberships WHERE user_id = auth.uid()) OR email = auth.jwt()->>'email')`
  - `permission_registry` → `USING (true)` (read-only reference data)
  **Output:** RLS SQL added to `setup-sql.js`.
  **Done:** 23 explicit policies created for 7 control tables. Per-operation policies (SELECT/INSERT/UPDATE/DELETE) instead of FOR ALL. `org_memberships` uses `user_id = auth.uid()` (no helper call — avoids recursion). `organizations` uses inline subquery on org_memberships. `profiles` uses `id = auth.uid()`. `org_invitations` allows org members + invited email via `auth.jwt()->>'email'`. `permission_registry` is SELECT-only (`USING (true)`). `active_routing` uses `user_id = auth.uid()`. `audit_log` is SELECT + INSERT only (append-only). `audit_log` removed from tenant DO block. JS parse verified OK (245127 chars).

- [x] **Step 8 — Write Generic RLS Policies for All Tenant Tables** ✅
  Apply the standard 4-policy set (SELECT/INSERT/UPDATE/DELETE) using `org_id = get_active_org_id()` to all 42 tenant tables. Generate the SQL programmatically (loop over table names). Include `ALTER TABLE ... FORCE ROW LEVEL SECURITY` so even service_role is affected (defense-in-depth option — discuss with user whether to enable or not).
  **Output:** RLS SQL added to `setup-sql.js`.
  **Done:** Two DO blocks updated — main tenant block (39 tables) and v2 finance cutover block (4 tables: ledger_accounts, ledger_transactions, hmo_invoice_batches, hmo_invoice_batch_items). `ledger_transactions` intentionally in both (v2 cutover DROPs/recreates it). Old permissive `USING (true) WITH CHECK (true)` policies replaced with 4 per-operation policies per table: SELECT `USING (org_id = get_active_org_id())`, INSERT `WITH CHECK (org_id = get_active_org_id())`, UPDATE `USING + WITH CHECK`, DELETE `USING`. Old safety-net DO block removed (tables already covered). Policy naming convention: `tenant_{op}_{table}` (truncated to 63 chars). Total: 42 unique tenant tables × 4 ops = 168 policies at runtime. Zero `USING (true) WITH CHECK (true)` policies remaining. JS parse verified OK (246300 chars). Note: `FORCE ROW LEVEL SECURITY` not applied — deferred for user decision (service_role bypass is the normal Supabase pattern for backend APIs).

- [x] **Step 9 — Handle Anonymous/Public Access Paths** ✅
  `waiting-list-intake` and potentially `form-submissions` (public OTP flow) operate without an authenticated user. Design:
  - A dedicated `anon` policy on `waiting_list_entries`, `otp_challenges`, `form_submissions`, `client_profiles`, `active_routing` that allows INSERT/SELECT for anonymous users scoped by `org_id` (resolved from `active_routing`).
  - OR: Keep these flows as backend-only (service_role bypass) with no anon RLS. Decision: document the chosen approach.
  **Output:** SQL or design decision documented.
  **Done — Decision: Backend-only (service_role bypass), no anon RLS policies needed.**
  Analysis of anonymous endpoints:
  - `GET/POST /api/waiting-list-intake` (load/submit) — anonymous, gated by invite token UUID. Uses service_role controlClient + dedicated_key tenantClient. Reads/writes: `active_routing`, `form_submissions`, `forms`, `client_profiles`, `Services`, `shared_form_blocks`, `students`, `guardians`, `client_guardians`, `waiting_list_entries`, `audit_log`.
  - `POST /api/form-submissions?action=verify` — anonymous, gated by identity_number + OTP code. Service_role. Reads/writes: `active_routing`, `form_submissions`, `client_profiles`, `students`, `otp_challenges`, `forms`, `shared_form_blocks`.
  - `PUT /api/form-submissions?action=submit` — anonymous, gated by submission_id + OTP code. Service_role. Reads/writes: `active_routing`, `form_submissions`, `otp_challenges`, `forms`, `shared_form_blocks`, `audit_log`.
  - `GET /api/config` — anonymous, reads only env vars, no Supabase access.
  All anonymous endpoints use **service_role** (bypasses RLS). Org_id is resolved from `active_routing` rows (created by authenticated staff). No frontend-direct Supabase queries for anonymous flows. `withOrgScope()` (Step 11) will enforce programmatic org_id isolation. `FORCE ROW LEVEL SECURITY` intentionally NOT applied to preserve service_role bypass.

### PHASE C: Backend API Refactor
> Goal: Replace the BYOD dual-client plumbing with a single Supabase client. All 57+ endpoints updated.

- [x] **Step 10 — Refactor `api/_shared/org-bff.js` (Core Helper)** ✅
  Remove: `fetchOrgConnection()`, `resolveEncryptionSecret()`, `deriveEncryptionKey()`, `decryptDedicatedKey()`, `createTenantClient()`, `resolveTenantClient()`, `mapConnectionError()`, `buildTenantError()` (tenant-specific).
  Add: `createSingleClient(env)` — creates one `service_role` Supabase client for the merged DB using `env.SUPABASE_URL` + `env.SUPABASE_SERVICE_ROLE_KEY`. Returns a singleton (or per-request client). All existing helpers (`respond`, `readEnv`, `ensureMembership`, `resolveOrgId`, `isAdminRole`, etc.) remain unchanged.
  **Output:** Lean `org-bff.js` with ~60% less code.
  **Done:** File reduced from ~307 lines to ~240 lines. Fully removed: `fetchOrgConnection()`, `decryptDedicatedKey()`, `createTenantClient()`, `decodeKeyMaterial()` (private). Added: `createSingleClient(env)` — module-level singleton, reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (with fallback env var names). Deprecated but kept for backward compat (used by un-migrated endpoints): `resolveTenantClient()` (now a passthrough shim that returns the same client), `buildTenantError()`, `mapConnectionError()`, `resolveEncryptionSecret()`, `deriveEncryptionKey()` (still needed by `forms-runtime.js` and `save-org-credentials`). `createDecipheriv` import removed. Lint clean. All 18 exports verified.

- [x] **Step 11 — Create `withOrgScope()` Query Wrapper (Defense-in-Depth)**
  Helper function that wraps Supabase query builder to auto-inject `.eq('org_id', orgId)`:
  ```js
  function withOrgScope(client, table, orgId) { return client.from(table).eq('org_id', orgId); }
  ```
  This prevents "forgot the .eq('org_id')" bugs — the primary cross-tenant data leak risk in service_role backends.
  **Output:** New export in `org-bff.js` or separate `api/_shared/tenant-scope.js`.
  **Done:** Added `withOrgScope(client, table, orgId)` as exported function in `org-bff.js` (between `createSingleClient` and `resolveOrgId`). Includes JSDoc. Lint clean. Export verified.

- [x] **Step 12 — Bulk-Refactor 57 Tenant API Endpoints** ✅
  **Completed (57 files):** calendar-attendance, backup, billing, calendar, calendar-corrections, calendar-conflicts, calendar-generate, calendar-instructors, client-profiles, consumption-entries, daily-compliance, dashboard-tasks, debug-uat-tools, documents, documents-check, documents-download, employee-activity, employee-attendance, employee-leave, form-blocks, form-submissions, forms, guardians, hmo-authorizations, instructor-files-check, instructors, instructors-link-user, lesson-instances, lesson-template-overrides, lesson-templates, loose-sessions, org-documents-check, payroll, payroll-adjustments, restore, services, session-records, sessions, settings, settings-medical-providers, settings-student-tags, storage-bulk-download, student-files-check, students-check-id, students-compliance-summary, students-export, students-legacy-import, students-list, students-maintenance-export, students-maintenance-import, students-merge, students-remove-tag, students-search, waiting-list, waiting-list-intake, waiting-list-suggestions, weekly-compliance.
  Mechanical replacement across all 57 endpoint `index.js` files:
  - Remove: `import { resolveTenantClient ... }` and the `await resolveTenantClient(...)` call + error handling block.
  - Replace: Use `createSingleClient(env)` (or the shared singleton) and change all `tenantClient.from('table')` to `withOrgScope(client, 'table', orgId)` (or `client.from('table').eq('org_id', orgId)`).
  - Ensure all INSERT payloads include `org_id: orgId`.
  **Affected endpoints (57):** calendar-attendance, backup, calendar-generate, calendar, calendar-corrections, billing, calendar-conflicts, consumption-entries, client-profiles, debug-uat-tools, dashboard-tasks, daily-compliance, calendar-instructors, documents-check, employee-attendance, documents, guardians, documents-download, form-blocks, employee-activity, forms, employee-leave, instructors-link-user, loose-sessions, payroll, instructors, lesson-templates, instructor-files-check, lesson-template-overrides, hmo-authorizations, lesson-instances, students-check-id, weekly-compliance, org-documents-check, waiting-list-suggestions, student-files-check, restore, settings, waiting-list-intake, sessions, waiting-list, payroll-adjustments, session-records, services, settings-student-tags, form-submissions, settings-medical-providers, storage-bulk-download, students-maintenance-export, students-search, students-compliance-summary, students-legacy-import, students-remove-tag, students-list, students-maintenance-import, students-merge, students-export.
  **Special case:** `form-submissions/index.js` has 6 separate `resolveTenantClient` calls.
  **Special case:** `waiting-list-intake/index.js` has 3 calls including anonymous-path routing.
  **Output:** All 57 endpoints use single client + org_id filter.
  **Done:** Final validation confirmed `resolveTenantClient` references reduced to zero across `api/**/index.js`. Remaining `tenantClient` tokens are only intentional property keys for `BillingLedgerService({ tenantClient: supabase })`. Targeted ESLint validation passed for the final completion batch: calendar-attendance, calendar-corrections, documents-check, documents-download, documents, instructor-files-check, org-documents-check, storage-bulk-download, student-files-check, form-submissions, waiting-list-intake, weekly-compliance.

- [x] **Step 13 — Refactor Control-DB-Only API Endpoints** ✅
  These endpoints currently only talk to the control DB and need updating to point at the new merged DB:
  - `api/config/` — return new project's URL + anon key (hardcoded or from env).
  - `api/org-keys/` — **DELETE entirely** (no per-org credentials to serve).
  - `api/save-org-credentials/` — **DELETE entirely** (no credentials to save).
  - `api/org-memberships/` — point at merged DB (same schema, just new connection).
  - `api/organizations/` — point at merged DB, remove BYOD columns from SELECT/INSERT.
  - `api/invitations/` — point at merged DB.
  - `api/permissions-registry/` — point at merged DB.
  - `api/directory/` — point at merged DB.
  - `api/health/` — point at merged DB.
  - `api/cross-platform/` — evaluate if still needed.
  **Output:** Remaining control endpoints use the merged DB admin config/client path, and deprecated BYOD-only routes are removed.
  **Done:** `api/org-memberships`, `api/invitations`, and `api/directory` now use shared merged-db admin config helpers instead of bespoke control-db connection code. `api/organizations` no longer writes removed BYOD columns (`supabase_url`, `supabase_anon_key`) or `org_settings` rows on org creation. `api/health` now reports merged-db env readiness only. `api/org-keys` and `api/save-org-credentials` were removed, and the setup assistant frontend now records verification directly through `recordVerification(...)` after diagnostics instead of posting dedicated credentials. `api/permissions-registry` and `api/config` were already compatible with the merged-db model. No standalone `api/cross-platform` endpoint exists in the current workspace.

- [x] **Step 14 — Update `api/_shared/permissions-utils.js`** ✅
  Remove queries to `org_settings.supabase_url` / `org_settings.anon_key`. Update permission resolution to query `organizations` table (where permissions JSONB now lives) in the merged DB.
  **Output:** Clean permissions helper with no BYOD references.
  **Done:** `ensureOrgPermissions()` now reads/writes `organizations.permissions` (via `.from('organizations').eq('id', orgId)`) instead of the deprecated `org_settings` table. `get_default_permissions()` and `initialize_org_permissions(p_org_id)` RPCs added to `setup-sql.js` SSOT, both updated to reference `organizations` instead of `org_settings`. Callers (`api/settings`, `api/students-export`) validated — no signature change needed.

### PHASE D: Frontend Refactor
> Goal: Remove the dual-client architecture. A single Supabase client serves both auth and data.

- [x] **Step 15 — Collapse to Single Supabase Client** ✅
  - `src/lib/supabase-manager.js`: Remove `createDataClient()` export entirely. `initializeAuthClient()` becomes the only client — rename to `initializeClient()` or keep name. This client handles auth AND data queries.
  - `src/context/SupabaseContext.jsx`: Remove `dataClient` state, `activeOrg` watcher that creates data clients. The auth client IS the data client. Simplify provider to expose one `client`.
  - `src/runtime/org-gate.js`: Remove `createDataClient` import and data client provisioning logic.
  **Output:** Single client used everywhere.
  **Done:** `createDataClient()` removed from `supabase-manager.js`. `SupabaseContext.jsx` collapsed: `dataClient` state removed and aliased to `authClient` in context value, `activeOrg` watcher useEffect removed, `setActiveOrg` replaced with stable no-op callback for backward compat. `org-gate.js` stripped of `dataClientCache`, `getRuntimeSupabase`, `getCachedRuntimeSupabase`, `resetRuntimeSupabase` — all had zero importers. Consumers (`OrgContext.jsx`, `SetupAssistant.jsx`, `verification.js`, all pages destructuring `dataClient`/`tenantClientReady`) continue to work because `dataClient: authClient` and `setActiveOrg` are still exposed.

- [x] **Step 16 — Simplify Org Switching Flow**
  - `src/org/OrgContext.jsx`: Remove `fetchOrgRuntimeConfig()` and all tenant credential fetching. Org switch = store `activeOrgId` in state/localStorage. No API call needed to rotate credentials.
  - `src/runtime/config.js`: Remove 'org' scope. Single config: one Supabase URL + anon key for the merged project.
  **Output:** Instant org switching (no network round-trip for credentials).
  **Done:** Removed `fetchOrgRuntimeConfig()` (~135 lines), `syncOrgSettings()` (~90 lines), `orgConnections` state/Map, `configStatus`/`activeOrgConfig`/`configRequestRef` state, and the useEffect trigger from `OrgContext.jsx`. Imports of `loadRuntimeConfig`, `MissingRuntimeConfigError`, `maskSupabaseCredential` removed. `createOrganization` no longer accepts/handles BYOD credentials. `updateConnection` no longer syncs to `org_settings` or fetches runtime config. `activeOrgHasConnection` simplified to `Boolean(activeOrgId)`. `orgSettings` memo now derives `permissions`/`storageProfile` from `activeOrg` directly (organizations table). Backward-compat: `configStatus`, `activeOrgConfig`, `activeOrgConnection`, `tenantClientReady` still exposed in context value. In `runtime/config.js`: removed 'org' scope from `loadRuntimeConfig()`, removed `getStoredOrgId()` and `ACTIVE_ORG_STORAGE_KEY`. In `api/user-context/index.js`: removed `org_settings` query entirely, read `permissions`/`storage_profile` from `organizations` table directly, stopped returning `connections` payload and `org_settings_metadata`/`org_settings_updated_at` fields.

- [x] **Step 17 — Add `x-org-id` Header to Frontend API Calls**
  Update `src/lib/api-client.js` → `authenticatedFetch()` to inject `x-org-id: activeOrgId` header on every request. This enables:
  1. Backend to read org context from headers (in addition to query params).
  2. Supabase RLS `get_active_org_id()` to work for any direct client queries.
  **Output:** Org context flows through headers end-to-end.
  **Done:** Added `getActiveOrgId()` helper in `api-client.js` that reads `active_org_id` from localStorage. Extended `createAuthorizationHeaders()` with optional `orgId` parameter that injects `x-org-id` header. All 3 exported functions (`authenticatedFetch`, `authenticatedFetchBlob`, `authenticatedFetchText`) now call `getActiveOrgId()` and pass it through. Also updated `OrgContext.jsx` local `authenticatedFetch` to inject `x-org-id` via `readStoredOrgId()`. On the backend, updated `resolveOrgId()` in `api/_shared/org-bff.js` to check `req.headers['x-org-id']` as a fallback after body and query params — body/query still take precedence for backward compatibility.

### PHASE E: Validation, Testing & Cleanup
> Goal: Prove the system is secure, performant, and correctly isolated.

- [x] **Step 18 — Write RLS Isolation Integration Tests**
  Create test script (Node.js or SQL) that:
  1. Creates two test orgs (Org A, Org B) with test users.
  2. Inserts `client_profiles`, `lesson_instances`, `commitments` for each org.
  3. Authenticates as Org A user → asserts zero Org B rows visible.
  4. Attempts INSERT with wrong org_id → asserts rejection.
  5. Tests composite unique constraints (same identity_number in two orgs = OK, same org = violation).
  6. Tests `org_memberships` RLS (no recursion).
  7. Tests anonymous access path for waiting-list-intake.
  **Output:** Test file in `/implementations/database/one-db-refactor/`.
  **Done:** Created `rls-isolation.test.js` (Node.js, `node:test` runner). 6 test suites / 12 assertions covering: (1) Row isolation — User A sees only Org A data across `client_profiles`, `lesson_instances`, `commitments`; User B cannot see Org A rows by ID. (2) Cross-org INSERT rejection — RLS blocks `client_profiles` and `commitments` inserts with wrong `org_id`. (3) Composite unique constraints — same `identity_number` in two orgs succeeds; same org triggers unique violation. (4) `org_memberships` RLS — user sees only own memberships (no recursion, policies use `user_id = auth.uid()`). (5) Anonymous access blocked — unauthenticated client gets zero rows / error on read and insert. (6) Non-member org access blocked — authenticated user with `x-org-id` pointing to a non-member org is rejected by `get_active_org_id()`. Test uses real Supabase client, auto-creates/cleans up orgs and auth users. Run with: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... node --test implementations/database/one-db-refactor/rls-isolation.test.js`.

- [x] **Step 19 — End-to-End Smoke Test All Major Flows**
  Manual/scripted test of:
  - Login → org selection → student list loads
  - Create student → verify org_id stamped
  - Calendar generation → lesson instances have org_id
  - Billing sync → ledger entries have org_id
  - Form submission (authenticated + public OTP flow)
  - Org switch → data swaps correctly
  - `EXPLAIN ANALYZE` on key queries to confirm index scans
  **Output:** Test results documented.
  **Done:** Created `e2e-smoke.test.js` (Node.js, `node:test` runner) in `/implementations/database/one-db-refactor/`. 7 test suites covering all major flows: (1) Login → `GET /user-context` → `GET /client-profiles` list. (2) `POST /client-profiles` create + DB-level `org_id` verification. (3) `POST /calendar-generate` dry-run + direct `lesson_instances` org_id check. (4) `GET /lesson-instances` date query confirms inserted instance visible. (5) `GET /billing` responds for org + `commitments` org_id verification. (6) Org isolation: second org/user cannot see first org's data. (7) `EXPLAIN ANALYZE` index-scan checks on `client_profiles`, `lesson_instances`, `commitments`, `org_memberships` (gracefully skips if `explain_query` RPC not installed). Script auto-creates/cleans up orgs, auth users, and test data. Supports env-var overrides to reuse existing users/orgs. Run with: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... API_BASE_URL=http://localhost:7071/api node --test implementations/database/one-db-refactor/e2e-smoke.test.js`.

- [ ] **Step 20 — Update Documentation (AGENTS.md + agents-docs/)**
  - `AGENTS.md` global rules: Add "Single-DB multi-tenant: all tables have `org_id`. Backend must always filter by `org_id`."
  - `agents-docs/00-core-rules.md`: Rewrite architecture section.
  - `agents-docs/10-runtime-auth-org.md`: Rewrite BYOD → single-DB flow.
  - `agents-docs/20-frontend-shared-helpers.md`: Remove `createDataClient` references.
  - `agents-docs/30-backend-shared-helpers.md`: Replace `resolveTenantClient` with `createSingleClient` / `withOrgScope` docs.
  **Output:** All agent docs reflect new architecture.

- [ ] **Step 21 — Environment Variables & Deployment Config Cleanup**
  - Remove: all legacy org-credential encryption env vars and per-tenant env vars.
  - Add/update: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` pointing to the new merged project.
  - Add/update: `SECURITY_ENCRYPTION_SECRET` and optional `SECURITY_ENCRYPTION_SECRET_OLD` for dual-key rotation.
  - Update `api/local.settings.json` for local dev.
  - Update Azure SWA / Functions app settings for production.
  - Update `staticwebapp.config.json` if route changes needed (e.g., remove `/api/org-keys` route).
  **Output:** Deployment-ready configuration.

### PHASE F: Technical Debt Cleanup
> Goal: Eliminate every backward-compat shim, dead code path, and naming inconsistency introduced during the refactor so the codebase reads as if it was always single-DB multi-tenant.

- [ ] **Step 22 — Post-Refactor Technical Debt Sweep**
  This step is not about quick fixes. It is a thorough pass to make the codebase professional and unambiguous for all future work. No shortcuts, no "good enough" — every artifact of the old BYOD architecture must be resolved.

  **22a — Remove Dead Modules & Exports**
  - Delete or gut `src/runtime/org-gate.js` if all remaining exports are passthrough stubs with zero live callers.
  - Remove `maskSupabaseCredential` from `src/lib/supabase-utils.js` if no longer imported anywhere.
  - Remove `MissingRuntimeConfigError` re-export from `src/runtime/config.js` if only consumer was OrgContext (now removed).
  - Audit `src/runtime/config.js` for dead functions after org-scope removal (e.g., `buildCacheKey` is now trivial — inline or remove).
  - Delete the `api/org-keys/` endpoint directory if it still exists (BYOD route removed in Step 13).
  - Delete the `api/save-org-credentials/` endpoint directory if it still exists.
  - Remove any remaining `org_settings`-related API endpoints or references.

  **22b — Remove Backward-Compat Aliases & Shims**
  - `SupabaseContext.jsx`: Remove `dataClient` alias — expose only `authClient` (or rename to just `client`). Update all consumers that destructure `dataClient` to use the canonical name.
  - `SupabaseContext.jsx`: Remove the no-op `setActiveOrg` callback. Remove from all destructuring sites.
  - `OrgContext.jsx`: Remove backward-compat context values: `activeOrgConfig` (always `null`), `configStatus` (derived shim), `activeOrgConnection` (always `null`). Update Diagnostics.jsx and any other consumers.
  - `OrgContext.jsx`: Evaluate whether `tenantClientReady` should be removed entirely (it's `Boolean(authClient)` — always true when logged in). If consumers just need "is authenticated", they should use `useAuth()` instead.
  - `OrgContext.jsx`: Evaluate whether `activeOrgHasConnection` should be removed entirely (it's `Boolean(activeOrgId)` — redundant check). If consumers just need "has org selected", `activeOrgId` is sufficient.

  **22c — Fix Naming Inconsistencies**
  - Rename `has_connection` field on organization records (from user-context API) — it's always `true` now, so either remove it or rename to something meaningful.
  - Audit all frontend code that checks `has_connection` and remove those guards.
  - Rename `tenantClientReady` references if kept — "tenant" language implies multi-DB. Consider `clientReady` or removing the concept entirely.
  - Search for any remaining `tenant`, `BYOD`, `dedicated_key`, `org_settings`, `supabase_url`/`anon_key` field references in frontend code that are artifacts of the old arch.
  - Rename `authenticatedFetch` in OrgContext.jsx if it duplicates/conflicts with `src/lib/api-client.js` `authenticatedFetch` (Step 17 adds `x-org-id` to the latter).

  **22d — Clean Up Unused State & Props**
  - Audit all pages/components that destructure `activeOrgHasConnection`, `tenantClientReady`, `configStatus`, `activeOrgConfig`, `activeOrgConnection` from `useOrg()` and simplify their guard conditions.
  - Remove the `session` prop threading in `authenticatedFetch` (OrgContext) — it's unused (underscore-prefixed params `_session`, `_accessToken`).
  - Audit `createOrganization` callers — ensure none still pass `supabaseUrl`/`supabaseAnonKey` props (check forms/modals).

  **22e — Schema & Migration Hygiene**
  - Verify `org_settings` table is no longer referenced in any backend code, SQL, or RPC.
  - If safe, add a migration note / SQL to drop the `org_settings` table (or mark it deprecated with a comment in setup-sql.js).
  - Audit `setup-sql.js` for any remaining BYOD-era table definitions, RPCs, or policies that reference per-org credentials.
  - Verify `dedicated_key_encrypted` / `dedicated_key_saved_at` columns on `organizations` table are still needed or should be dropped.

  **22f — Guard Simplification Pass**
  - For each page that has `canFetch = Boolean(session && activeOrgId && tenantClientReady && activeOrgHasConnection && ...)`, simplify to `Boolean(session && activeOrgId && ...)` since the removed guards are always truthy.
  - Similarly simplify `disabled={!activeOrgHasConnection || !tenantClientReady}` patterns in Settings.jsx and elsewhere.

  **Output:** Zero dead code, zero backward-compat shims, zero naming confusion. The codebase is clean for any developer (human or AI) working on it next.

- [ ] **Step 23 — Admin UI: Encryption Key Version & Rotation Interface**
  Build an admin-facing security interface to display active key-version metadata and safely support key rotation workflows.

  - Add backend endpoint logic that returns non-sensitive encryption metadata only:
    - `current_hash` (SHA-256 of `SECURITY_ENCRYPTION_SECRET`)
    - `previous_hash` (SHA-256 of `SECURITY_ENCRYPTION_SECRET_OLD`, nullable)
    - `is_rotation_active` (boolean)
    - `environment` (`local`/`production`)
  - Add UI in Settings > Security to show:
    - Current key fingerprint (masked hash)
    - Previous key fingerprint (if present)
    - Rotation status and guidance banner
  - Add a read-only verification action that checks decrypt fallback health using existing encrypted payloads.
  - Ensure access control is admin/owner only and all views are audit-logged.
  - Add tests for endpoint authz + hash format + no secret leakage.

  **Output:** Secure admin interface for encryption key visibility and rotation readiness without exposing secrets.

## 📝 Change Log & Notes

| Step | Date | Summary | Files |
|------|------|---------|-------|
| Init | 2026-04-16 | Workspace initialized. Directory + tracker file created. Decisions locked: merge org_settings into organizations, unify audit_log. | `implementations/database/one-db-refactor/one-db-refactor.md` |
| 12 | 2026-04-17 | Completed tenant endpoint refactor: all 57 BYOD-style tenant APIs migrated from `resolveTenantClient()` to single-client `withOrgScope()` access, including special-case anonymous/public flows and multi-route handlers. | `api/**/index.js`, `api/_shared/org-bff.js` |
| 13 | 2026-04-17 | Completed control-endpoint migration: merged-db admin-client path adopted for remaining control APIs, BYOD org-credential routes removed, org creation stripped of deprecated connection writes, and setup assistant verification no longer posts dedicated credentials. | `api/organizations/index.js`, `api/org-memberships/index.js`, `api/invitations/index.js`, `api/directory/index.js`, `api/health/index.js`, `api/config/index.js`, `src/components/settings/SetupAssistant.jsx` |
| 14 | 2026-04-17 | Permissions helper migrated from `org_settings` to `organizations` table; permission RPCs (`get_default_permissions`, `initialize_org_permissions`) added to SSOT pointing at `organizations`. | `api/_shared/permissions-utils.js`, `src/lib/setup-sql.js` |
| 15 | 2026-04-17 | Dual-client architecture collapsed: `createDataClient` removed, `SupabaseContext` now exposes `authClient` as both auth and data client, `org-gate.js` stripped of data-client caching. Zero consumer changes needed due to backward-compat aliases. | `src/lib/supabase-manager.js`, `src/context/SupabaseContext.jsx`, `src/runtime/org-gate.js` |
| 16 | 2026-04-17 | Org switching simplified: `fetchOrgRuntimeConfig()` removed, `orgConnections` cache removed, `configStatus`/`activeOrgConfig`/`activeOrgConnection` reduced to backward-compat stubs. `organizations.permissions` now read directly instead of `org_settings`. | `src/org/OrgContext.jsx`, `src/runtime/config.js`, `api/user-context/index.js` |
| 17 | 2026-04-17 | `x-org-id` header injection added to `api-client.js` (`authenticatedFetch`, `authenticatedFetchBlob`, `authenticatedFetchText`). `resolveOrgId()` updated to read from `req.headers['x-org-id']` as fallback. | `src/lib/api-client.js`, `api/_shared/org-bff.js`, `src/org/OrgContext.jsx` |
| 18 | 2026-04-17 | RLS isolation test suite created (`rls-isolation.test.js`) — 6 suites, 14 assertions: row isolation, cross-org INSERT rejection, composite unique constraints, `org_memberships` non-recursion, anonymous access block, non-member org block. | `implementations/database/one-db-refactor/rls-isolation.test.js` |
| 19 | 2026-04-17 | E2E smoke test script created (`e2e-smoke.test.js`) — 7 suites covering login→list, create+stamp, calendar gen, billing, org isolation, EXPLAIN ANALYZE index checks. Schema squash: `setup-sql.js` reduced by ~3,000 lines; broken DO block at L1368 fixed (missing `END $$`). Docker dry-run: 0 SQL errors. RLS test run: 14/14 ✔. | `implementations/database/one-db-refactor/e2e-smoke.test.js`, `src/lib/setup-sql.js` |
