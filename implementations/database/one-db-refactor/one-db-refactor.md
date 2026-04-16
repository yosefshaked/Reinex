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
* **Last Completed Task:** Step 11 — Create `withOrgScope()` Query Wrapper (Defense-in-Depth).
* **Currently Working On:** Step 12 — Bulk-Refactor 57 Tenant API Endpoints (Batch 1 of 4 complete: 15/57 files).
* **Next Immediate Step:** Step 12 Batch 2 — Continue refactoring remaining ~42 tenant API endpoints.
* **Known Issues / Technical Debt:**
  - `ledger_transactions` is defined twice in setup-sql.js (deprecated v1 then new finance ledger v2) — merge must preserve only v2.
  - Some tables use quoted identifiers (`"Employees"`, `"Services"`, `"RateHistory"`, `"Settings"`, `"Documents"`) — org_id addition must respect quoting.
  - `identity_number` on `client_profiles` has a single-column UNIQUE that must become `(org_id, identity_number)`.
  - `waiting-list-intake` endpoint supports anonymous/public access — needs special RLS handling.
  - Supabase Storage bucket isolation strategy NOT in scope (separate workstream).

## 📋 Execution Plan (21 Steps)

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

- [ ] **Step 12 — Bulk-Refactor 57 Tenant API Endpoints** *(Batch 1 complete: 15/57)*
  **Batch 1 Done (15 files):** calendar-conflicts, calendar-instructors, students-check-id, students-remove-tag, session-records, loose-sessions, hmo-authorizations, payroll-adjustments, employee-attendance, settings-student-tags, settings-medical-providers, dashboard-tasks, daily-compliance, sessions, students-compliance-summary.
  Mechanical replacement across all 57 endpoint `index.js` files:
  - Remove: `import { resolveTenantClient ... }` and the `await resolveTenantClient(...)` call + error handling block.
  - Replace: Use `createSingleClient(env)` (or the shared singleton) and change all `tenantClient.from('table')` to `withOrgScope(client, 'table', orgId)` (or `client.from('table').eq('org_id', orgId)`).
  - Ensure all INSERT payloads include `org_id: orgId`.
  **Affected endpoints (57):** calendar-attendance, backup, calendar-generate, calendar, calendar-corrections, billing, calendar-conflicts, consumption-entries, client-profiles, debug-uat-tools, dashboard-tasks, daily-compliance, calendar-instructors, documents-check, employee-attendance, documents, guardians, documents-download, form-blocks, employee-activity, forms, employee-leave, instructors-link-user, loose-sessions, payroll, instructors, lesson-templates, instructor-files-check, lesson-template-overrides, hmo-authorizations, lesson-instances, students-check-id, weekly-compliance, org-documents-check, waiting-list-suggestions, student-files-check, restore, settings, waiting-list-intake, sessions, waiting-list, payroll-adjustments, session-records, services, settings-student-tags, form-submissions, settings-medical-providers, storage-bulk-download, students-maintenance-export, students-search, students-compliance-summary, students-legacy-import, students-remove-tag, students-list, students-maintenance-import, students-merge, students-export.
  **Special case:** `form-submissions/index.js` has 6 separate `resolveTenantClient` calls.
  **Special case:** `waiting-list-intake/index.js` has 3 calls including anonymous-path routing.
  **Output:** All 57 endpoints use single client + org_id filter.

- [ ] **Step 13 — Refactor Control-DB-Only API Endpoints**
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
  **Output:** All control endpoints use `createSingleClient(env)`.

- [ ] **Step 14 — Update `api/_shared/permissions-utils.js`**
  Remove queries to `org_settings.supabase_url` / `org_settings.anon_key`. Update permission resolution to query `organizations` table (where permissions JSONB now lives) in the merged DB.
  **Output:** Clean permissions helper with no BYOD references.

### PHASE D: Frontend Refactor
> Goal: Remove the dual-client architecture. A single Supabase client serves both auth and data.

- [ ] **Step 15 — Collapse to Single Supabase Client**
  - `src/lib/supabase-manager.js`: Remove `createDataClient()` export entirely. `initializeAuthClient()` becomes the only client — rename to `initializeClient()` or keep name. This client handles auth AND data queries.
  - `src/context/SupabaseContext.jsx`: Remove `dataClient` state, `activeOrg` watcher that creates data clients. The auth client IS the data client. Simplify provider to expose one `client`.
  - `src/runtime/org-gate.js`: Remove `createDataClient` import and data client provisioning logic.
  **Output:** Single client used everywhere.

- [ ] **Step 16 — Simplify Org Switching Flow**
  - `src/org/OrgContext.jsx`: Remove `fetchOrgRuntimeConfig()` and all tenant credential fetching. Org switch = store `activeOrgId` in state/localStorage. No API call needed to rotate credentials.
  - `src/runtime/config.js`: Remove 'org' scope. Single config: one Supabase URL + anon key for the merged project.
  **Output:** Instant org switching (no network round-trip for credentials).

- [ ] **Step 17 — Add `x-org-id` Header to Frontend API Calls**
  Update `src/lib/api-client.js` → `authenticatedFetch()` to inject `x-org-id: activeOrgId` header on every request. This enables:
  1. Backend to read org context from headers (in addition to query params).
  2. Supabase RLS `get_active_org_id()` to work for any direct client queries.
  **Output:** Org context flows through headers end-to-end.

### PHASE E: Validation, Testing & Cleanup
> Goal: Prove the system is secure, performant, and correctly isolated.

- [ ] **Step 18 — Write RLS Isolation Integration Tests**
  Create test script (Node.js or SQL) that:
  1. Creates two test orgs (Org A, Org B) with test users.
  2. Inserts `client_profiles`, `lesson_instances`, `commitments` for each org.
  3. Authenticates as Org A user → asserts zero Org B rows visible.
  4. Attempts INSERT with wrong org_id → asserts rejection.
  5. Tests composite unique constraints (same identity_number in two orgs = OK, same org = violation).
  6. Tests `org_memberships` RLS (no recursion).
  7. Tests anonymous access path for waiting-list-intake.
  **Output:** Test file in `/implementations/database/one-db-refactor/`.

- [ ] **Step 19 — End-to-End Smoke Test All Major Flows**
  Manual/scripted test of:
  - Login → org selection → student list loads
  - Create student → verify org_id stamped
  - Calendar generation → lesson instances have org_id
  - Billing sync → ledger entries have org_id
  - Form submission (authenticated + public OTP flow)
  - Org switch → data swaps correctly
  - `EXPLAIN ANALYZE` on key queries to confirm index scans
  **Output:** Test results documented.

- [ ] **Step 20 — Update Documentation (AGENTS.md + agents-docs/)**
  - `AGENTS.md` global rules: Add "Single-DB multi-tenant: all tables have `org_id`. Backend must always filter by `org_id`."
  - `agents-docs/00-core-rules.md`: Rewrite architecture section.
  - `agents-docs/10-runtime-auth-org.md`: Rewrite BYOD → single-DB flow.
  - `agents-docs/20-frontend-shared-helpers.md`: Remove `createDataClient` references.
  - `agents-docs/30-backend-shared-helpers.md`: Replace `resolveTenantClient` with `createSingleClient` / `withOrgScope` docs.
  **Output:** All agent docs reflect new architecture.

- [ ] **Step 21 — Environment Variables & Deployment Config Cleanup**
  - Remove: `APP_ORG_CREDENTIALS_ENCRYPTION_KEY`, any per-tenant env vars.
  - Add/update: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` pointing to the new merged project.
  - Update `api/local.settings.json` for local dev.
  - Update Azure SWA / Functions app settings for production.
  - Update `staticwebapp.config.json` if route changes needed (e.g., remove `/api/org-keys` route).
  **Output:** Deployment-ready configuration.

## 📝 Change Log & Notes

| Step | Date | Summary | Files |
|------|------|---------|-------|
| Init | 2026-04-16 | Workspace initialized. Directory + tracker file created. Decisions locked: merge org_settings into organizations, unify audit_log. | `implementations/database/one-db-refactor/one-db-refactor.md` |
