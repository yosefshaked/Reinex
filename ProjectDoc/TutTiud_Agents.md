## Legacy notes (Tuttiud) — DO NOT FOLLOW

## Code Style
- Use 2 spaces for indentation.
- Prefer ES module syntax.

## Azure Logging and Diagnostics
- **Finding Azure Function logs**: Navigate to Azure Portal → Application Insights → Investigate → Search.
  - Set view to "Individual items"
  - Filter by "Trace Severity level = Error" when looking for error logs
  - Filter by "Trace Severity level = Information" for general logs
  - Use time range selector (last 24 hours, custom, etc.) to narrow results
  - Search specific function names in the search box (e.g., "student-files-download")
- **Documents API Debugging** (2025-11): Comprehensive debug logging added to trace complete request flow for organization documents (מסמכי הארגון):
  - **Backend logging** (`api/documents/index.js`):
    - Step-by-step flow: Environment read → Admin config → Client creation → Auth → Membership → Tenant client → Handler routing
    - Each step logs success/failure with detailed context (env vars, credentials presence, user info, org info)
    - handleGet logs entity validation, table queries, result counts, error details including table existence checks
    - All logs prefixed with `[DEBUG]`, `[WARN]`, `[ERROR]` for easy filtering in Application Insights
  - **Shared utilities logging** (`api/_shared/supabase-admin.js`):
    - `readSupabaseAdminConfig`: Logs available environment variables, credential resolution, result details
    - `createSupabaseAdminClient`: Logs client creation attempts, credential validation
  - **Frontend logging** (`src/hooks/useDocuments.js`):
    - Request preparation: entity context, session validation
    - HTTP call details: URL, headers presence, response status/headers
    - Response parsing: success data structure, error text extraction
    - All logs prefixed with `[DEBUG-FRONTEND]`, `[WARN-FRONTEND]`, `[ERROR-FRONTEND]`
  - **Log search tips**: In Application Insights, search for:
    - `[DEBUG] ========== Documents API Request Started ==========` - Beginning of request
    - `[DEBUG] Step X:` - Specific workflow steps (1-9)
    - `[ERROR]` - Any error conditions
    - `entity_type` or `organization` - Org documents specific calls

## Workflow
- **Database Schema Backwards Compatibility (CRITICAL)**: When adding new columns or features that require schema changes:
  - Always use `ADD COLUMN IF NOT EXISTS` in the setup script for idempotent migrations
  - API endpoints must gracefully handle missing columns without throwing 500 errors
  - Return clear error messages (e.g., `schema_upgrade_required`) instead of database errors
  - Consider using `setup_assistant_diagnostics()` to detect missing columns before queries
  - Document required schema versions in AGENTS.md and update setup script version
  - Example: The `national_id` column for Students was added in setup script v2.5 - older databases without it should receive a clear upgrade prompt, not a 500 error
- **Azure Functions Response Pattern (CRITICAL)**: All Azure Functions HTTP handlers MUST set `context.res` before returning:
  ```javascript
  // ✅ CORRECT (use respond helper):
  return respond(context, 200, { data: results });
  
  // ✅ CORRECT (manual):
  const response = { status: 200, body: { data: results } };
  context.res = response;
  return response;
  
  // ❌ WRONG (missing context.res, returns empty body):
  return { status: 200, body: { data: results } };
  ```
  - Without setting `context.res`, Azure returns HTTP 200 with an **empty body**, causing `JSON.parse()` errors in frontend.
  - Use existing endpoints like `/api/students-list`, `/api/instructors`, `/api/settings`, `/api/documents`, `/api/documents-download` as reference for correct patterns.
- **Bearer Token Extraction (CRITICAL)**: Always use `resolveBearerAuthorization()` helper from `http.js` to extract JWT tokens:
  ```javascript
  // ✅ CORRECT (checks all header variations):
  import { resolveBearerAuthorization } from '../_shared/http.js';
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { error: 'missing_auth' });
  }
  const token = authorization.token;
  
  // ❌ WRONG (case-sensitive, misses alternative headers):
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const token = authHeader.substring(7);
  ```
  - Frontend sends tokens in multiple headers (`Authorization`, `X-Supabase-Authorization`, `x-supabase-auth`) for compatibility.
  - `resolveBearerAuthorization()` checks all variations (`'x-supabase-authorization'`, `'x-supabase-auth'`, `'authorization'`) and handles case sensitivity.
  - Manual header reading causes JWT verification failures when token is sent in alternative headers.
  - Always follow the pattern in `/api/org-logo/index.js` for token extraction.
- **Supabase Auth Response Structure (CRITICAL)**: `supabase.auth.getUser(token)` returns `{ data, error }`, access user via `result.data.user`:
  ```javascript
  // ✅ CORRECT:
  const authResult = await supabase.auth.getUser(token);
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_token' });
  }
  const userId = authResult.data.user.id;
  
  // ❌ WRONG (incorrect destructuring):
  const { data: authResult, error } = await supabase.auth.getUser(token);
  const userId = authResult.user.id; // TypeError: authResult is already .data
  ```
  - Always follow the pattern in `/api/students/index.js`, `/api/instructors/index.js`, `/api/settings/index.js` for auth verification.
- **API Validation**: Before deploying API changes, run validation to catch common issues:
  - `npm run lint:api` - ESLint validation for API endpoints (industry standard, catches import/export issues, undefined variables, etc.)
  - `node scripts/validate-api-endpoints.js` - Azure Functions-specific validation (function.json, scriptFile alignment, JSON validity)
  - ESLint rules enforce:
    - No importing from deprecated modules (supabase-tenant.js, wrong storage-drivers path)
    - Correct import/export matching with `import/named`, `import/no-unresolved`
    - No undefined variables, unused imports
    - Proper Node.js globals for API files
  - Custom validation script checks:
    - **function.json existence**: Every endpoint directory must have function.json or Azure ignores it
    - **scriptFile alignment**: If function.json specifies scriptFile, the file must exist (defaults to index.js)
    - **Valid JSON**: Detects invalid JSON in function.json (trailing commas, syntax errors)
    - **HTTP bindings**: Validates httpTrigger and http output bindings are present
    - Handler signatures, CommonJS/ESM import conflicts, deprecated patterns
  - Run both tools before deploying: `npm run lint:api && node scripts/validate-api-endpoints.js`
- For premium features, always check permissions in both frontend (UI) and backend (API) before allowing access.
- PDF export feature uses Puppeteer with `@sparticuz/chromium` for serverless Azure Functions deployment.
- Lint any changed JavaScript or JSX files with `npx eslint <files>`.
- Run `npm run build` to ensure the project builds.
- No test script is configured; note this in your testing summary.
- Run `npm run check:schema` before adding new persistence logic; if it reports missing columns, add a checklist note to the PR instead of coding around the gap.
- **API Authentication Headers**: All frontend API calls to backend endpoints MUST include Supabase-specific authentication headers in addition to the standard `Authorization` header:
  - `Authorization: Bearer ${token}`
  - `X-Supabase-Authorization: Bearer ${token}`
  - `x-supabase-authorization: Bearer ${token}`
  - `x-supabase-auth: Bearer ${token}`
  - The backend expects these headers for authentication. Missing them will result in 401 Unauthorized errors even with a valid token.
  - See `src/lib/api-client.js`, `src/org/OrgContext.jsx`, or `src/api/students-export.js` for reference implementations.
  - When using `fetch()` or `XMLHttpRequest`, always include all four headers.
- Instructor color assignments live in `api/_shared/instructor-colors.js`. Use `ensureInstructorColors()` before returning instructor records or aggregations so every row keeps a unique `metadata.instructor_color` (solid or gradient).
- `/api/weekly-compliance` powers the dashboard widget with aggregated schedules, legend entries, and dynamic hour ranges. Frontend work should consume its payload instead of duplicating aggregation logic.
- Weekly compliance status logic: `/api/weekly-compliance` marks undocumented sessions scheduled for the current day as `missing`; only future days are returned as `upcoming`.
- Daily compliance status logic: `/api/daily-compliance` also marks undocumented sessions scheduled for today (UTC) as `missing`; `upcoming` applies strictly to future dates.
- Intake approvals now require an assigned instructor: admins assign the intake (and optional contact details/notes) in the dashboard queue before the assigned instructor confirms reading the intake.
- Admins can dismiss accidental intake submissions through `/api/intake/dismiss`, which clears `needs_intake_approval` and logs `metadata.intake_dismissal.active=true`.
- Admins can restore dismissed intakes through `/api/intake/restore`, which reopens the queue entry and marks `metadata.intake_dismissal.active=false`.
- `/api/students-list` always filters out dismissed intakes; use `/api/intake/dismissed` to load them for the intake queue.
- Admins can merge intake submissions into existing students via `/api/students-merge`, selecting per-field values to keep.
- `/api/students-merge` reattaches intake responses to the target student and stores any previous target intake payload in `metadata.intake_merge_backup`.
- `/api/students-merge` deletes the source student row and stores full source/target snapshots in `metadata.merge_backup` for recovery.
- Intake instructor notes are stored in `Students.metadata.intake_notes` so the main `notes` field remains for student-level notes.
- Add any important information learned into this AGENTS.md file.
    - If global lint is run across the entire repo, there are legacy violations unrelated to recent changes; follow the workflow and lint only the files you touched in a PR. Address broader lint cleanup in a dedicated maintenance pass.
    - When preserving a function signature for temporarily disabled exports, mark intentionally unused parameters as used with `void param;` (and/or prefix with `_`) to satisfy `no-unused-vars` without altering the public API.
  - Control DB access is now lazy and stateless. The team directory fetch (members + invites) is only enabled while the Settings → Team Members dialog is open. Backend endpoints create a fresh Supabase admin client per request (no global caching) so connections are “woken” on demand and naturally closed after the response. Tenant data client remains unaffected.
- Use ProjectDoc/Eng.md to understand the overall project.
- **Refer to [ProjectDoc/Conventions.md](ProjectDoc/Conventions.md)** for folder structure, naming conventions, API patterns, and feature organization. Update it when adding new patterns or changing structure (with approval).
- SessionRecords now includes `is_legacy boolean NOT NULL DEFAULT false` for marking imported historical session rows. Control DB registry adds `can_reupload_legacy_reports` (default false) to gate repeated legacy imports per organization.
- **Loose Reports Feature** (2025-12, Phase 6 Complete):
  - SessionRecords `student_id` is now nullable to support unassigned ("loose") session reports. When creating loose reports, write `metadata.unassigned_details` additively (do not clobber existing metadata) and ensure downstream queries tolerate `student_id` being NULL.
  - **Backend Endpoint** (`/api/loose-sessions`):
    - `GET`: Lists pending `student_id IS NULL` records with role-based filtering:
      - **Admin/Owner**: See all pending loose reports for the organization (only non-deleted)
      - **Instructor (non-admin)**: See their own submitted loose reports (filtered by `instructor_id`) including both pending AND rejected reports
      - Rejected reports marked with `isRejected: true` flag and include `metadata.rejection` with reason, rejected_by, rejected_at
    - `POST`: Admin-only resolution operations with three action types:
      - `action=assign_existing` (`student_id`): Assign pending report to existing student
      - `action=create_and_assign` (`name`, `assigned_instructor_id`, optional `default_service`): Create new student and assign report
      - `action=reject` (`reason`, optional `reason_other` for custom text): Reject pending report with predefined or custom reason
    - Resolution removes only `metadata.unassigned_details`, preserves other metadata, and updates `service_context` using the session payload or student default
    - Rejection marks report as `deleted: true` while preserving all original metadata plus `metadata.rejection` details
    - Audit logging uses `SESSION_RESOLVED`/`SESSION_REJECTED` actions in `AUDIT_CATEGORIES.SESSIONS`
  - **Frontend Components**:
    - `PendingReportsPage.jsx`: Admin interface with search/filter UI (free text, service, reason, date range), bulk selection with checkboxes, individual/bulk reject via `RejectReportDialog`, bulk assign/create via `BulkResolvePendingReportsDialog`
    - `MyPendingReportsCard.jsx`: Instructor view of own pending, rejected, and recently resolved reports with resubmit capability
      - Shows three sections: Pending (amber), Rejected (red with rejection reason), Resolved (green)
      - Rejected reports include full rejection details and "שלח מחדש" button
      - Badge counts in header show both pending and rejected report totals
    - `ResubmitRejectedReportDialog.jsx`: Dialog for resubmitting rejected reports with pre-filled data
      - Shows original rejection reason in red banner
      - Automatically loads and pre-fills all original data: name, reason, date, time, service, AND session content (questions/answers)
      - Allows editing all fields including full session content before resubmission
      - Includes optional "הערות למנהל" (Admin Notes) field - notes visible only to admins on pending reports page, not shown in student profile
      - Creates new loose report with `metadata.resubmitted_from`, `metadata.original_rejection`, and optional `metadata.instructor_notes` for audit trail
    - `PendingReportsPage.jsx` admin view enhancements:
      - Blue "הערות" badge displayed on reports that include instructor notes
      - Instructor notes shown in blue banner within report detail dialog
      - Helps admins understand instructor's context or corrections when reviewing resubmitted reports
    - `MyStudentsPage.jsx`: Instructor access button in CardHeader showing pending reports count badge; click opens dialog with `MyPendingReportsCard`
    - Bulk operations use sequential processing with real-time feedback
  - **Form Changes (2025-12)**:
    - Loose session form requires: name, reason (predefined + custom), service, date, **time** (new for loose only)
    - Regular session form: no time input required (field is hidden when not in loose mode)
    - Time field only renders when `looseMode === true` with `required` attribute
    - Backend validation: `if (looseMode && !sessionTime.trim()) return;` blocks submission without time for loose reports
    - **Admin instructor selection (2025-12)**: When admin has `canFilterByInstructor` permission, loose report form shows instructor selector with strict permission rules:
      - **Non-instructor admins**: REQUIRED field - must specify which instructor is submitting (cannot submit in their own name)
      - **Instructor admins**: OPTIONAL field - can submit as themselves OR on behalf of other instructors
      - **Member instructors**: No selector shown - can only submit in their own name
      - Frontend validates selection before submission; backend enforces permission boundaries
      - Backend returns `admin_must_specify_instructor` if non-instructor admin tries to submit without selecting an instructor
      - Backend returns `members_cannot_specify_instructor` if non-admin member tries to specify a different instructor
      - Helps with data attribution while maintaining strict role-based access control
    - **Duplicate Detection (2025-12)**: Name input includes real-time duplicate checker:
      - Hook: `useLooseReportNameSuggestions(unassignedName, looseMode)` with 300ms debounce
      - API: `/api/students-search?query=...` with role-based filtering (members see only assigned students, admins see all)
      - UI: Shows matching students below name input with status indicators (active/inactive)
      - Action: Click suggestion switches from loose mode to regular mode while preserving form data (service, time, answers, date)
      - Permission: Members only see students assigned to them; admins see all matches
      - UX: Helps prevent duplicate submissions by suggesting existing students as you type
- Legacy import UI: `StudentDetailPage.jsx` shows an "Import Legacy Reports" button for admin/owner users only. The button disables when a legacy import already exists unless `can_reupload_legacy_reports` is true. The modal (`src/features/students/components/LegacyImportModal.jsx`) walks through backup warning → structure choice → CSV mapping (dropdowns vs. custom labels, session date required) → confirmation with re-upload warning.
- Legacy import backend: `/api/students/{id}/legacy-import` accepts JSON (`csv_text`, `structure_choice`, `session_date_column`, and either `column_mappings` or `custom_labels`), enforces admin/owner role + `can_reupload_legacy_reports`, deletes prior `is_legacy` rows for the student, and writes new `SessionRecords` with `is_legacy=true`.
- Legacy importer normalizes session dates from `YYYY-MM-DD`, `DD/MM/YYYY`, `DD.MM.YYYY`, or Excel serial numbers before writing rows. Invalid dates return `invalid_session_date` with the 1-based row index.
- Legacy import now captures service context: send `service_strategy=fixed` with `service_context_value` to apply one service (or leave blank) to all rows, or `service_strategy=column` with `service_context_column` to read the service per CSV row. Empty values persist as "no service".
- Legacy import rows include standard session attribution: `metadata` stores `created_by`, `created_role`, `form_version`, and `source='legacy_import'`, and each row writes `instructor_id` from the student's assigned instructor. Uploads fail with `student_missing_instructor` when the student lacks an assignment.
- OAuth redirects must always include `options.redirectTo` when calling `supabase.auth.signInWithOAuth`. Resolve it from the full `window.location` URL (`origin + pathname + search + hash`) and fall back to `VITE_PUBLIC_APP_URL`, `VITE_APP_BASE_URL`, or `VITE_SITE_URL` when a browser location is unavailable.
- Password reset flows must call `supabase.auth.resetPasswordForEmail` with a redirect that lands on `/#/update-password`, and the update form must rely on `AuthContext.updatePassword` so Supabase finalizes the session before returning users to the dashboard.
- Login form submissions must set inline error state whenever Supabase rejects credentials so the page renders the design system's red alert with the failure message.
- **Dashboard Layout Pattern (2025-11)**: The Weekly Compliance View uses a unified sticky header design. The InstructorLegend is integrated directly into the calendar widget (not a separate floating component) and appears as a horizontal bar at the top of the sticky header, above the day column headers. The entire header block (legend + day headers) uses `position: sticky` with `top: 0` and stays anchored while the calendar body scrolls. No complex JavaScript positioning logic is needed.
  - **Day view integration**: The DayScheduleView (both mobile and desktop day mode) also includes the InstructorLegend in a sticky header that stays visible while scrolling through time slots.
  - **Solid backgrounds**: Both week and day view sticky headers use solid `bg-surface` (no transparency or backdrop blur) to ensure clean visual separation when scrolling. Day header backgrounds changed from `bg-muted/30` to `bg-muted` for consistency.

### Invitation and Password Reset Flow Improvements (2025-11)
- **CompleteRegistrationPage** now distinguishes between different OTP error types:
  - Expired tokens: "ההזמנה פגה. נא לבקש מהמנהל לשלוח הזמנה חדשה."
  - Already-used tokens: Shows message with "Forgot Password?" link to `/forgot-password`.
  - Generic errors: Helpful fallback messages guiding users to appropriate recovery path.
- **OrgMembersCard** (Settings → Team Members):
  - Displays visual indicators for expired pending invitations (amber badge with clock icon).
  - Shows expired invites count in card header badge when admin/owner has expired invitations.
  - Each expired invite displays amber-highlighted row with explanation and "שלח הזמנה מחדש" button.
  - Reinvite handler calls `createInvitation` with same email; backend auto-handles expired invites by marking old as expired and creating new token + sending new email.
  - Helper function `isInvitationExpired()` checks if `expires_at` timestamp has passed.
  - Admins can edit a member’s display name inline; saving updates `profiles.full_name` and Supabase Auth metadata so future sessions show the refreshed name.
- **UpdatePassword** page improved error handling:
  - Distinguishes between expired recovery tokens vs already-used tokens.
  - Shows appropriate messages: expired → request new reset; used → try logging in or request new reset.
- **OrgSelection** page now includes logout button:
  - Positioned in top-left corner (RTL: top-right visually).
  - Uses `useAuth().signOut()` to log out and redirect to `/login`.
  - Provides escape path for users who want to sign out during org selection.
- **Backend invitation flow** (`/api/invitations`):
  - When creating new invitation for same email, automatically marks expired pending invites as expired before creating new one.
  - Returns 409 "invitation already pending" only if existing invitation is still valid (not expired).
  - Reinvitation effectively creates new Supabase OTP token and sends new email with updated expiry.
  - `GET /api/invitations/token/:token` now enriches the payload with `auth` state when available:
    `{ auth: { exists, emailConfirmed, lastSignInAt } }`. This is resolved via the control DB RPC below.

### Control DB RPC: user_verification_state (2025-11)
- New script: `scripts/control-db-auth-utils.sql` creates a SECURITY DEFINER SQL function:
  - `public.user_verification_state(user_email text)` → returns one row `{ user_exists, email_confirmed, last_sign_in_at }` from `auth.users`.
  - Used by `/api/invitations` to disambiguate "invalid or expired" links (already-used vs truly expired) without exposing service role to the client.
- Deployment: run this script once against the control database in Supabase SQL editor.
- Admin API endpoint: `GET /api/invitations/check-auth?email=...` allows admins to query user verification state by email.
  - Requires admin/owner role in at least one organization.
  - Returns `{ email, auth: { exists, emailConfirmed, lastSignInAt } }`.
  - Frontend client helper: `src/api/check-auth.js` exports `checkAuthByEmail(email, { session, signal })`.
  - Useful for admin UIs to display user status (e.g., "pending verification", "verified", "not registered") before reinviting or troubleshooting invitation issues.

### Request validation and payload limits (2025-10)
- A shared server-side validation helper lives at `api/_shared/validation.js`.
  - `parseJsonBodyWithLimit(req, limitBytes, { mode, context, endpoint })` safely parses JSON and logs when payloads exceed a soft limit. Default rollout uses `mode: 'observe'` to avoid breaking clients.
  - Centralized validators expose SOT for specific flows (e.g., `validateSessionWrite`, `validateInstructorCreate`, `validateInstructorUpdate`). Prefer using these from API routes instead of inlining validation logic.
- Endpoints updated to use the helper in observe-mode: `api/sessions`, `api/settings`, `api/instructors`.
- History quota scaffold: `api/_shared/history-quota.js` provides `ensureCapacity` in observe-only mode to collect size telemetry for settings histories without enforcing limits yet.
- Future phases will introduce per-key quotas and pruning/archival for history-like settings. Until then, do not hard-reject large settings writes without product sign-off. Document changes in PRs and update this section when enforcement is enabled.

### Backup and restore (2025-01)
- `/api/backup` (POST) creates encrypted local backups with weekly cooldown (7 days). Requires admin/owner role and `permissions.backup_local_enabled = true` in `org_settings`.
- `/api/restore` (POST) decrypts and restores backups. Requires admin/owner role and same permission flag. Supports optional `clear_existing` flag for clean restore.
- Shared backup utilities in `api/_shared/backup-utils.js`:
  - `encryptBackup(data, password)`: AES-256-GCM + gzip compression, returns encrypted Buffer
  - `decryptBackup(encryptedData, password)`: reverses encryption, returns manifest object
  - `exportTenantData(tenantClient, orgId)`: queries all tenant tables (Students, Instructors, SessionRecords, Settings), returns manifest v1.0
  - `validateBackupManifest(manifest)`: checks version/schema compatibility
  - `restoreTenantData(tenantClient, manifest, options)`: transactional restore with optional `clearExisting` flag in dependency order
- Backup manifests are JSON with structure: `{ version: '1.0', schema_version: 'tuttiud_v1', org_id, created_at, metadata: { total_records }, tables: [{ name, records }] }`
- Password generation: System auto-generates a human-friendly product-key style password (e.g., ABCD-EF12-3456-7890-ABCD, ~80-bit entropy). The user must save it from the response to decrypt later.
- Cooldown enforcement: checks `org_settings.backup_history` array for last successful backup within 7 days; 429 response includes `next_allowed_at` and `days_remaining`. Can be bypassed once by setting `permissions.backup_cooldown_override = true` in control DB; the flag is automatically reset to `false` after a successful backup.
- Audit trail: all backup/restore operations appended to `org_settings.backup_history` JSONB array (last 100 entries kept) with type, status, timestamp, initiated_by, size_bytes/records_restored, error_message.
- Control DB schema: run `scripts/control-db-backup-schema.sql` to add `org_settings.permissions` (jsonb) and `org_settings.backup_history` (jsonb) columns.
- Permissions model: Centralized in `permission_registry` table (control DB). Run `scripts/control-db-permissions-table.sql` to create the registry with default permissions for all features. Use `initialize_org_permissions(org_id)` DB function to auto-populate `org_settings.permissions` from registry defaults when null/empty.
  - Available permissions: `backup_local_enabled`, `backup_cooldown_override`, `backup_oauth_enabled`, `logo_enabled`.
  - Shared utilities: `api/_shared/permissions-utils.js` provides `ensureOrgPermissions()`, `getDefaultPermissions()`, `getPermissionRegistry()`.
  - API endpoint: `GET /api/permissions-registry` returns permission metadata (optionally filtered by category) or defaults-only JSON.
  - New (2025-10): `session_form_preanswers_enabled` (boolean) and `session_form_preanswers_cap` (number, default 50) control the preconfigured answers feature and per-question cap. The registry now stores `default_value` as JSONB to support non-boolean defaults.
- Frontend: Backup card in Settings page shows grayed-out state when `backup_local_enabled = false` with message "גיבוי אינו זמין. נא לפנות לתמיכה על מנת לבחון הפעלת הפונקציה". Uses `initialize_org_permissions` RPC on load to ensure permissions exist.
 - Frontend: Backup card now consumes `GET /api/backup-status` to determine `enabled`, cooldown, and one-time override; the card is disabled with the above message when `enabled=false`, and shows a cooldown banner with an "override available" badge when applicable.
- OAuth backup destinations (Google Drive, OneDrive, Dropbox) planned but not yet implemented; permission flags reserved.
- Admin tool: `test/verify-backup.cjs` allows super admins to verify backup file integrity and decryptability.
  - Usage: `node test/verify-backup.cjs <backup-file-path> <password>`
  - Prints manifest summary if successful, error if invalid or wrong password.
  - Use for compliance, restore validation, and support troubleshooting.

### Custom Logo Feature (2025-10)
- `/api/org-logo` (GET/POST/DELETE) manages organization custom logos. Requires `permissions.logo_enabled = true` in `org_settings`.
  - GET: Returns `logo_url` (URL string or null). Available to all org members.
  - POST: Admin/owner only. Accepts `logo_url` (URL string). Validates URL format.
  - DELETE: Admin/owner only. Removes logo by setting `logo_url` to null.
- Control DB schema: run `scripts/control-db-logo-schema.sql` to add `org_settings.logo_url` (text) column.
- Frontend: `LogoManager.jsx` in Settings page allows setting/removing custom logo URL when `logo_enabled = true`.
  - Disabled state shown with message "לוגו מותאם אישית אינו זמין. נא לפנות לתמיכה" when `logo_enabled = false`.
  - Accepts public image URLs (PNG, JPG, SVG, GIF, etc.).
  - Stores logo URL as plain text in control DB (no file upload, references external images).
- Global display: `OrgLogo.jsx` component fetches and displays custom logo in AppShell header (desktop sidebar + mobile header). Falls back to TutTiud logo (`/icon.svg`) when no logo is set.
- Logo refresh: Component refetches when `activeOrgId` changes, ensuring correct logo displays after org switch.
- Logo sizing: Uses `object-contain` with white background padding to ensure logos fit nicely in all display locations (48px container).

### Cross-System Storage Configuration (2025-11)
- **Storage profile** is a cross-system capability stored in `org_settings.storage_profile` (control DB).
  - Supports two modes: **BYOS** (Bring Your Own Storage) and **Managed Storage**
  - System-agnostic design: reusable by TutTiud, Farm Management System, and future systems
- **BYOS credentials encryption** (`api/_shared/storage-encryption.js`):
  - Encrypts `access_key_id` and `secret_access_key` before storing in database
  - Uses AES-256-GCM authenticated encryption (same as tenant credentials)
  - Encrypted format: `v1:gcm:iv:authTag:cipherText` (base64-encoded)
  - **CRITICAL**: Uses snake_case field names (access_key_id, secret_access_key) to match normalizeStorageProfile() output
  - Decrypts automatically when loading storage profile (admin/owner only)
  - Uses same encryption key as org credentials (`APP_ORG_CREDENTIALS_ENCRYPTION_KEY`)
  - Public fields (provider, endpoint, bucket, region) stored unencrypted for admin visibility
- **Security model**:
  - **Admin/Owner**: GET endpoint decrypts and returns full profile including credentials
  - **Non-admin members**: GET endpoint strips sensitive fields (access_key_id, secret_access_key, _encrypted, _credentials)
  - **Rationale**: Only admins need credentials to configure/troubleshoot storage; regular members only need to know storage is configured
  - Never expose decrypted credentials to non-admin users to prevent storage bucket takeover
- Control DB schema: run `scripts/control-db-storage-profile-schema.sql` to add `storage_profile` JSONB column
- **Shared validation module**: `api/cross-platform/storage-config/`
  - `validateStorageProfile(profile)` - validates complete profile structure
  - `validateByosCredentials(byosConfig)` - validates S3-compatible provider credentials
  - `validateManagedConfig(managedConfig)` - validates managed storage namespace
  - `normalizeStorageProfile(rawProfile)` - normalizes and sanitizes input, outputs snake_case credentials
  - No TutTiud-specific logic; pure cross-system validation
- **API endpoints**:
  - `/api/user-context` now includes `storage_profile` in organization data (credentials stripped for non-admin)
  - `/api/org-settings/storage` (GET/POST/DELETE/PATCH) manages storage profile
    - GET: All members can read (credentials only for admin/owner)
    - POST: Admin/owner only, encrypts before saving
    - DELETE: Admin/owner only, marks as disconnected
    - PATCH: Admin/owner only, reconnects storage
- **BYOS configuration**:
  - Supports S3, Azure, GCS, Cloudflare R2, and generic S3-compatible providers
  - Required fields: provider, endpoint, bucket, access_key_id, secret_access_key
  - Optional: region (depends on provider)
  - Validation checks URL format, non-empty credentials, valid provider names
- **Managed Storage configuration**:
  - Required fields: namespace (alphanumeric + hyphens/underscores), active status
  - Namespace format validated: `[a-z0-9-_]+`
- **Error handling**: Missing or invalid storage profile returns clear error state; no silent fallbacks
- See `api/cross-platform/README.md` for architectural principles and usage guidelines

### File Upload and Document Management (2025-11)
- **File Upload and Document Management**: All file operations now use the unified `/api/documents` endpoint (see Polymorphic Documents Table Architecture section above).
  - **Backend validation**: Enforces 10MB max file size and allowed MIME types (PDF, images, Word, Excel) server-side
  - **File metadata**: Each file record includes `{id, name, original_name, relevant_date, expiration_date, resolved, url, path, storage_provider, uploaded_at, uploaded_by, definition_id, definition_name, size, type, hash}`
  - **Hebrew filename encoding**: Properly decodes UTF-8 filenames from multipart data by detecting latin1 mis-encoding and converting back to UTF-8
  - **Bulk upload support**: File inputs accept `multiple` attribute, allowing users to select and upload multiple files at once
  - **Sorting functionality**: Additional files section includes sort controls for name (alphabetical) and date (chronological), with ascending/descending toggle
  - **Progress tracking**: Frontend uses XMLHttpRequest with upload progress events for real-time feedback
  - **Background uploads**: Uploads continue in background with toast notifications; users can navigate away while files upload
  - **Error messages**: Hebrew localized error messages for file size, type validation, and upload failures
  - **Naming convention**: Files with `definition_id` are named "{Definition Name} - {Entity Name}" (e.g., "אישור רפואי - יוסי כהן")
  - **Definition name preservation**: Stores `definition_name` in file metadata so orphaned files (deleted definitions) maintain proper display name
  - **Pre-upload metadata editor**: Dialog opens before upload, allowing user to edit name, add relevant_date, and add expiration_date
  - **Post-upload metadata editor**: Dialog to update metadata after file is uploaded (admin/owner or own files only)
  - **Resolved status for expired documents**: Files with expiration dates can be marked as "taken care of"
  - **Configuration changes handling**: When admins modify document definitions after files are uploaded, files automatically show new definition names or become orphaned with amber "הגדרה ישנה" badge
  - **Tag-based filtering**: Shows only document definitions relevant to entity's tags
  - **Duplicate detection**: Pre-upload MD5 hash check searches across all entities in organization
  - **Download URLs**: RFC 5987 encoding for Hebrew filenames, 1-hour expiration on presigned URLs
- File restrictions communicated to users via blue info box with bullet points (10MB, allowed types, Hebrew filenames supported)

### Polymorphic Documents Table Architecture (2025-11)
- **Schema**: Centralized `tuttiud.Documents` table is the **source of truth** for all file metadata. Legacy JSON columns (`Students.files`, `Instructors.files`, `Settings.org_documents`) have been fully deprecated and removed.
- **API Endpoint**: `/api/documents` is the unified endpoint for all document operations (GET/POST/PUT/DELETE). Legacy endpoints have been removed.
- **Discriminator pattern**: `entity_type` ('student'|'instructor'|'organization') + `entity_id` (UUID) identifies which entity owns each document.
- **Columns**: id (UUID PK), entity_type (text), entity_id (UUID), name, original_name, relevant_date, expiration_date, resolved, url, path, storage_provider, uploaded_at, uploaded_by, definition_id, definition_name, size, type, hash, metadata (JSONB).
- **Indexes**: Composite index on (entity_type, entity_id) for fast entity-scoped queries; individual indexes on uploaded_at, expiration_date, hash.
- **Note**: No `org_id` column needed since Documents table lives in tenant database (one tenant = one organization).
- **RLS Policies**: Row-level security enabled with policies for SELECT, INSERT, UPDATE, DELETE
  - All authenticated users can view documents (org-level permission checks in API layer)
  - INSERT requires `uploaded_by` matches authenticated user ID
  - UPDATE/DELETE allowed for authenticated users (entity-level permission checks in API layer)
  - API layer (`validateEntityAccess`) enforces org membership and entity-specific permissions
- **Migration strategy**:
  - Fresh deployments: Setup script creates only the Documents table (no legacy columns)
  - Existing deployments: Legacy JSON columns should be manually migrated to Documents table before upgrading
  - Documents table is the ONLY file storage mechanism
  - All legacy API endpoints have been removed - use `/api/documents` exclusively
- **API Endpoints**:
  - **`/api/documents`** (GET/POST/PUT/DELETE): Unified polymorphic endpoint for all document types
    - GET: `?entity_type=student&entity_id=<uuid>` returns all documents for that entity
    - POST: Multipart upload with `entity_type`/`entity_id` in query params or body; validates permissions via `validateEntityAccess()`
    - PUT: Update metadata (name, relevant_date, expiration_date, resolved) by document ID
    - DELETE: Remove document by ID after permission validation
  - **`/api/documents-download`** (GET): Unified download URL generation
    - Query params: `entity_type`, `entity_id`, `document_id`, `preview` (boolean)
    - Returns presigned URL (1-hour expiration) with proper Content-Disposition
    - Permission validation enforced before URL generation
- **Permission model** (enforced in `validateEntityAccess` function):
  - **Students**: All org members can view/upload documents for any student
  - **Instructors**: Admin/owner can access all; non-admin instructors only their own (userId === entityId check)
  - **Organizations**: Admin/owner only (member visibility controlled separately via settings)
- **React Hook**: `useDocuments(entityType, entityId)` provides entity-agnostic document management
  - Auto-fetching on mount with loading/error states
  - Functions: `fetchDocuments()`, `uploadDocument(file, metadata)`, `updateDocument(id, updates)`, `deleteDocument(id)`, `getDownloadUrl(id, preview)`
  - Uses AuthContext for session, OrgContext for orgId
  - Handles all API calls with proper error handling and toast notifications
- **Frontend components refactored**:
  - `StudentDocumentsSection.jsx`: Uses `useDocuments('student', student.id)`
  - `InstructorDocumentsSection.jsx`: Uses `useDocuments('instructor', instructor.id)` with trust boundary validation (enforces userId === instructor.id for non-admin self-service via `isOwnDocuments` prop)
  - `OrgDocumentsManager.jsx`: Uses `useDocuments('organization', orgId)`
  - `MyInstructorDocuments.jsx`: Uses `useDocuments('instructor', instructor.id)` for instructor self-service document portal
  - All components updated to use unified /api/documents endpoints, replacing old entity-specific endpoints
  - **Deprecation (2025-12)**: Legacy upload/download endpoints removed (`/api/student-files`, `/api/student-files-download`, `/api/instructor-files`, `/api/instructor-files-download`, `/api/org-documents`, `/api/org-documents-download`). Duplicate check endpoints preserved but refactored to use Documents table (`/api/student-files-check`, `/api/instructor-files-check`, `/api/org-documents-check`). All file operations now use `/api/documents` for CRUD operations; check endpoints remain for backward compatibility with existing frontend code.
- **Audit logging**: All document operations (upload/update/delete) logged via `logAuditEvent()` with:
  - Action types: FILE_UPLOADED, FILE_METADATA_UPDATED, FILE_DELETED
  - Category: FILES
  - Resource type: `{entity_type}_file` (e.g., "student_file", "instructor_file", "organization_file")
  - Details include: entity_type, entity_id, file_name, file_size, storage_mode, updated_fields
- **Unified duplicate check endpoint (2025-12)**: `/api/documents-check` provides polymorphic pre-upload MD5 hash duplicate detection.
  - **Query params**: `entity_type` ('student'|'instructor'|'organization') + `entity_id` (UUID or org_id)
  - **Body**: multipart/form-data with `file` field
  - **Permission model**:
    - Student documents: All org members can check duplicates
    - Instructor documents: Admins see all; non-admins only their own
    - Organization documents: Admin/owner only
  - **Response**: `{ hash, has_duplicates, duplicates: [{ file_id, file_name, uploaded_at, entity_id, entity_name }] }`
  - **Benefits**: Single endpoint handles all entity types, reduces code duplication, cleaner API design
- **Legacy duplicate check endpoints (deprecated)**: `/api/student-files-check`, `/api/instructor-files-check`, `/api/org-documents-check`
  - Still active for backward compatibility, now query Documents table instead of legacy JSON columns
  - Frontend components should migrate to `/api/documents-check` when convenient
  - No hard deprecation timeline yet; existing code continues to work
- **Benefits of polymorphic approach**:
  - Single source of truth for all document storage
  - Consistent permission validation across entity types
  - Unified audit trail for compliance
  - Simplified code maintenance (one endpoint vs many)
  - Easy to extend to new entity types without duplicating logic
- **Backward compatibility**: JSON columns in Students/Instructors/Settings remain intact; migration copies data without deletion, allowing gradual transition and rollback if needed.

- **Breaking change (2025-12)**: Upload and download endpoints removed (`/api/student-files`, `/api/student-files-download`, `/api/instructor-files`, `/api/instructor-files-download`, `/api/org-documents`, `/api/org-documents-download`). Use `/api/documents` exclusively for all file CRUD operations. Duplicate check endpoints remain active (`/api/student-files-check`, `/api/instructor-files-check`, `/api/org-documents-check`) but refactored to query Documents table instead of legacy JSON columns.
- `/api/org-documents` - Organization-level documents: REMOVED. Use `/api/documents` with `entity_type=organization` instead.
  - All organization document operations now use the unified `/api/documents` endpoint
  - **Storage paths**:
    - Managed R2: `managed/{org_id}/general-docs/{file_id}.{ext}`
    - BYOS: `general-docs/{org_id}/{file_id}.{ext}`
  - **Member visibility control**: Setting `org_documents_member_visibility` (boolean, default false) controls whether non-admin members can view org documents
    - Admin/owner can always view and manage documents
    - Non-admin members require the setting to be enabled to view documents
    - GET endpoint checks this setting and returns 403 `members_cannot_view_org_documents` error when disabled
    - Frontend hides the org documents card from non-admin members when visibility is disabled
    - Backend enforces restriction as security layer in case of UI bugs
  - Frontend (`OrgDocumentsManager.jsx`):
    - **Pre-upload metadata editor**: Dialog opens before upload, allowing user to edit name, add relevant date, and add expiration date
    - **Post-upload metadata editor**: Dialog to update metadata after file is uploaded (admin/owner only)
    - **Document separation**: Expired documents displayed in separate section with red badges
    - **Sorting**: Three-way sort by upload date, name, or expiration date with asc/desc toggle
    - **Visibility toggle (admin-only)**: Checkbox to enable/disable member access
  - **Use cases**: Organization licenses, veterinary approvals, business permits, insurance certificates, general documentation not tied to specific students or instructors

### PDF Export Feature (2025-11)
- `/api/students/export` (POST) generates professional PDF reports of student session records. Premium feature requiring `permissions.can_export_pdf_reports = true`.
  - Validates admin/owner role and permission before processing
  - Generates Hebrew/RTL-ready PDF with student info, session history, and custom branding
  - Uses Puppeteer with `@sparticuz/chromium` for serverless Azure Functions deployment
  - Co-branding: Always displays TutTiud logo; optionally includes custom org logo if `permissions.can_use_custom_logo_on_exports = true`
  - File naming: `[Student_Name]_Records_[Date].pdf`
  - Resource management: Browser instance always closed in finally block to prevent memory leaks
- Permissions added to `scripts/control-db-permissions-table.sql`:
  - `can_export_pdf_reports` (boolean, default false) - Controls access to PDF export feature
  - `can_use_custom_logo_on_exports` (boolean, default false) - Controls custom logo on exports
- Frontend: Export button on `StudentDetailPage` for admin/owner roles only
  - Conditional rendering: enabled button for permitted orgs, disabled with tooltip for non-permitted orgs
  - Tooltip message: "ייצוא ל-PDF הוא תכונת פרימיום. צור קשר עם התמיכה כדי להפעיל תכונה זו."
  - Uses toast notifications for success/error feedback
  - API client: `src/api/students-export.js` exports `exportStudentPdf()` and `downloadPdfBlob()`

### Storage Grace Period & File Deletion (2025-11)
- **Storage provider field consistency**: All file upload endpoints store `storage_provider` as the mode value (`'managed'` or `'byos'`), NOT as specific provider names like `'cloudflare_r2'` or `'managed_r2'`. This allows storage backend changes without breaking file metadata.
- **Configurable grace period**: `permission_registry.storage_grace_period_days` (default 30) controls how many days users have to download files after storage is disconnected before permanent deletion.
- **Database schema**: `org_settings.storage_grace_ends_at` (timestamptz) tracks when grace period expires and files should be deleted.
- **Storage disconnection**: Preserves configuration with `disconnected: true` flag instead of deleting profile.
  - Allows easy reconnection without reconfiguring credentials
  - For BYOS: Users can maintain read-only access to their storage if desired
  - For managed: Triggers grace period in separate endpoint
  - Audit trail maintained with `disconnected_at`, `disconnected_by` metadata
  - **File operations during disconnection**:
    - Uploads (`POST /api/student-files`): Blocked with 403 error
    - Downloads (`GET /api/student-files-download`): Allowed for BYOS (user owns storage); for managed, only during grace period when `storage_access_level = 'read_only_grace'`
    - Bulk download (`POST /api/storage-bulk-download`): Allowed for BYOS anytime; for managed, only during grace period
- **Reconnection**: `PATCH /api/org-settings/storage` removes disconnected flag and restores full access
- **Grace period lifecycle**:
  1. **Start grace period**: `/api/storage-start-grace-period` (POST) - Admin/owner triggers grace period
     - Fetches grace period days from `permission_registry`
     - Calculates `grace_ends_at = current_date + grace_period_days`
     - Sets `permissions.storage_access_level = 'read_only_grace'`
     - Updates `org_settings.storage_grace_ends_at`
  2. **During grace period**: Users can download files but cannot upload new ones
  3. **Cleanup job**: `/api/storage-cleanup-expired` (POST) - Runs daily to delete expired files
     - Finds orgs where `storage_grace_ends_at < NOW()`
     - **Managed storage**: Deletes files from YOUR R2 bucket using `driver.deletePrefix()`
     - **BYOS**: Skips file deletion (user owns the storage)
     - Updates `org_settings`: sets `storage_profile = null`, `storage_grace_ends_at = null`, `storage_access_level = false`
- **Data ownership principles**:
  - ✅ Delete files from YOUR managed R2 bucket
  - ❌ Do NOT force-delete from user's tenant database Documents table
  - ℹ️ Documents table is the source of truth; legacy JSON columns are deprecated
  - 📧 Send email notifications at grace period start and after deletion
- **S3 driver enhancement**: `deletePrefix(prefix)` method lists and deletes all objects with given prefix in batches of 1000 (S3 limit).
- **Permission**: `storage_grace_period_days` in registry allows system-wide control of deletion timeline without code changes.
- **Deployment**: Run `scripts/control-db-storage-grace-period.sql` to add `storage_grace_ends_at` column and index.

### Audit Logging for Compliance (2025-11)
- **Audit log table**: `public.audit_log` in control DB tracks all critical admin and system actions for legal compliance and dispute resolution.
- **Schema**: Includes org_id, user_id, user_email, user_role, action_type, action_category, resource_type, resource_id, details (JSONB), metadata (JSONB), performed_at, expires_at.
- **Retention**: 7 years by default (configurable via `expires_at`); required for GDPR and legal compliance.
- **RLS policies**: Users can read audit logs for their own organizations; only service role can insert/modify.
- **Helper function**: `public.log_audit_event()` - Use this from API endpoints to log actions.
- **Shared utilities**: `api/_shared/audit-log.js` provides `logAuditEvent()` and action type constants (`AUDIT_ACTIONS`, `AUDIT_CATEGORIES`).
- **CRITICAL**: `logAuditEvent()` requires a **control DB Supabase client**, NOT a tenant client. Always pass the control DB admin client (typically named `supabase` in `/api/*` endpoints that use `createSupabaseAdminClient()`). Passing a tenant client will write to the wrong database and fail silently.
- **Implementation status**:
  - ✅ **Implemented**: Storage operations, Membership operations, Invitations, Backup (create/restore), Students (create/update), Instructors (create/update/delete), Settings (upsert/delete), Logo (upload/delete), Files (student/instructor upload/delete/metadata_update)
  - ❌ **Not yet implemented**: Permissions changes (no dedicated endpoint yet)
  - When adding audit logging to new endpoints, ensure you pass the control DB client and follow the pattern in `api/backup/index.js`, `api/students/index.js`, or `api/org-memberships/index.js`.
- **Logged actions**:
  - **Storage**: configured, updated, disconnected, reconnected, grace_period_started, files_deleted, migrated_to_byos, bulk_download
  - **Permissions**: enabled, disabled (constants defined, not yet used in code)
  - **Membership**: invited, removed, role_changed
  - **Backup**: created, restored
  - **Students**: created, updated (with student_name, assigned_instructor_id, updated_fields)
  - **Instructors**: created, updated, deleted (with instructor_name, instructor_email, soft_delete flag)
  - **Settings**: updated (with operation type, keys array, count)
  - **Logo**: updated (with action: upload/delete, logo_url)
  - **Files**: uploaded, deleted, metadata_updated (with resource_type: student_file/instructor_file, file_name, file_size, storage_mode, updated_fields)
- **Usage pattern**:
  ```javascript
  await logAuditEvent(supabase, { // ← MUST be control DB client
    orgId, userId, userEmail, userRole,
    actionType: AUDIT_ACTIONS.STORAGE_CONFIGURED,
    actionCategory: AUDIT_CATEGORIES.STORAGE,
    resourceType: 'storage_profile',
    resourceId: orgId,
    details: { mode: 'managed' }
  });
  ```
- **Deployment**: Run `scripts/control-db-audit-log.sql` to create audit_log table and helper function.

### File Migration and Bulk Download (2025-11)
- **Bulk download**: `/api/storage-bulk-download` (POST) - Creates ZIP archive of all organization files.
  - Admin/owner only
  - Fetches all student files from tenant DB
  - Downloads files from storage using `driver.getFile(path)` method
  - Packages files into ZIP organized by student folders
  - Returns as `application/zip` download
  - Logs audit event with file count, success/failure counts, and ZIP size
  - Sanitizes filenames to prevent path traversal attacks
- **Storage drivers**: All drivers (S3, Azure, GCS) implement `getFile(path)` method that returns file data as Buffer.
  - S3 adapter: Converts readable stream to Buffer using async iteration
  - Handles large files efficiently with streaming
- **BYOS migration** (planned): Export all files → User uploads to their S3/R2 → Reconfigure storage profile
- **Use cases**: Before grace period ends, manual backup, migration from managed to BYOS

### Collapsible Table Rows Pattern
- When a table needs drill-down details, manage expansion manually with `useState` keyed by row id.
- Render the summary information in the base `<TableRow>` and immediately follow it with a conditional second `<TableRow>` that holds the drawer content inside a single spanning `<TableCell>` (e.g., `colSpan={totalColumns}`).
- Place the toggle affordance (e.g., a chevron button) inside the summary row; avoid wrapping table semantics in `<Collapsible>` primitives so the DOM remains a valid `<table>` composed of sibling `<tr>` elements.

### Dialog Footer Pattern (2025-10)
- `DialogContent` accepts an optional `footer` prop to render sticky footer buttons outside the scrollable content area.
- Forms inside dialogs should:
  - Accept a `renderFooterOutside` prop (default `false` for backward compatibility).
  - Export a separate `*FormFooter` component that renders the action buttons.
  - Add an `id` attribute to the `<form>` element for programmatic submission.
  - Conditionally render the inline footer when `renderFooterOutside={false}`.
- Parent dialogs pass the footer to `DialogContent` via the `footer` prop and trigger submission using `document.getElementById('form-id')?.requestSubmit()`.
- This pattern ensures footers remain visible at the bottom of the dialog on both mobile and desktop without being hidden by scrolling content.
- Footer styling: `sm:rounded-b-lg` matches dialog's bottom corners on desktop; mobile dialogs are positioned from top with proper spacing (`top-[2rem]`) and reserve space for bottom navigation (`max-h-[calc(100vh-12rem)]`).
- Mobile browser compatibility (2025-11): The 12rem (192px) vertical reserve (2rem top + 10rem bottom) accounts for mobile browser UI chrome (including floating scroll buttons), app's bottom navigation, and safe spacing. Dialog is anchored from top to maximize usable space while keeping buttons visible on browsers like Samsung Galaxy.
- FAB button (mobile navigation): positioned at `-top-8` to float above the bottom nav bar.
- Examples: `NewSessionForm`/`NewSessionFormFooter`, `AddStudentForm`/`AddStudentFormFooter`, `EditStudentForm`/`EditStudentFormFooter`.

### Mobile Bottom Navigation (2025-11)
- The mobile navigation bar (`MobileNavigation` in `AppShell.jsx`) uses `position: fixed` with `bottom-0` and `inset-x-0` to stay anchored at the bottom.
- Performance optimizations for smooth scrolling on mobile browsers:
  - Uses solid `bg-surface` (100% opacity) instead of translucent to avoid rendering issues during fast scrolling.
  - Removed `backdrop-blur` which can cause performance issues on some mobile devices.
  - Added `willChange: 'transform'` CSS hint to optimize browser rendering and prevent jitter/jumping during scroll.
  - Added `translateZ(0)` transform to force GPU acceleration and keep navigation in its own compositing layer, preventing scroll jank.
  - Explicitly sets `position: 'fixed'` in inline style to reinforce fixed positioning behavior.
  - Added `isolation: 'isolate'` to create a new stacking context and prevent interference from browser's floating UI elements (e.g., scroll-to-top buttons).
- The navigation responds to keyboard visibility via `useKeyboardAwareBottomOffset` which translates it upward when the virtual keyboard is shown.
- Z-index is set to `z-[60]` to ensure it stays above dialogs and other UI elements.

## Documentation
- When editing files in `ProjectDoc/`, keep `Eng.md` and `Heb.md` in sync and update their version and last-updated fields.
- See `docs/AI-Coder-Gotchas.md` for a concise checklist of common pitfalls (RTL/Hebrew alignment,
  dialog footers, Select/Popover inside dialogs, CSV/Forms patterns). Keep it updated when you
  discover recurring issues so future AI coding passes avoid regressions.

## Notes
- Instructors are managed in the tenant `tuttiud."Instructors"` table. Records are not deleted; set `is_active=false` to disable. Clients should hide inactive instructors from selection.
- Student creation requires selecting an active instructor. If a student's assigned instructor is later disabled, surfaces a warning in the roster and prompts reassignment; historical reports remain attributed via `assigned_instructor_id`.
- `/api/instructors` returns only active instructors by default. Use `include_inactive=true` to fetch disabled ones for admin UIs.
- WorkSessions inserts should omit `id` so the database can generate it; include `id` only when updating existing records.
- `/api/work-sessions` now returns full inserted rows (not just IDs) so leave flows can capture the generated `id` for `LeaveBalances.work_session_id`.
- Payroll calculations now rely solely on `WorkSessions.rate_used` and `total_payment`; avoid adding external salary adjustments in reports.
- Global employees use `working_days` for daily rate proration and `paid_leave` rows for paid days off.
- `paid_leave` days are saved without `hours` and the table editor opens them with no hour segments.
- Reports date filters accept `DD/MM/YYYY`, `D/M/YY`, or ISO strings and hours KPIs count only hourly employees.
- WorkSessions deletions verify at least one row was removed; a zero-row delete should surface an error.
- When inserting WorkSessions, avoid duplicates by comparing `employee_id`, `date`, `entry_type`, and `hours`; allow updates to the same row by matching `id`.
- Leave policy settings live in the `Settings` table under the `leave_policy` key; read and write the JSON via the `settings_value` column and reuse the helpers in `src/lib/leave.js` for normalization and calculations.
- `LeaveBalances` is the canonical ledger for allocations (positive `balance`) and usage (negative values, including `-0.5` for half-day when enabled). Always persist the `effective_date` (YYYY-MM-DD) and the descriptive `leave_type`, let Supabase generate timestamps, and surface the toast "חריגה ממכסה ימי החופשה המותרים" when blocking a deduction beyond the configured floor.
- Half-day leave is persisted with `WorkSessions.entry_type = 'leave_half_day'`; metadata no longer carries a `leave.half_day` flag.
- System-paid leave is selected via the "על חשבון המערכת" switch in Time Entry; dropdowns now present only the paid, unpaid, and half-day labels.
- Shared selectors `selectHolidayForDate` and `selectLeaveRemaining` must be the single source of truth for date disabling, payroll totals, and UI badges so reports, employees, and settings stay in sync.
    - Legacy note (2025-10): The old selectors module at `src/lib/selectors.js` has been deprecated and replaced with no-op stubs to prevent accidental usage during the WorkSessions → SessionRecords migration. Do not import from `src/lib/selectors.js` or `src/selectors.js`. When reintroducing equivalents, implement them under feature slices using `SessionRecords` as the data source and update this note accordingly.
- The Employees → Vacations & Holidays tab is read-only; use the Time Entry flow for any leave creation or adjustments and rely on the collapsible history rows for review.
- Reports CSV export (`Reports.jsx`) now uses `buildCsvRows` with the column order defined in `CSV_HEADERS`; update that helper when adding or reordering export columns.
- `/api/invitations` is the control-plane API for organization invites. It uses `APP_CONTROL_DB_URL` and `APP_CONTROL_DB_SERVICE_ROLE_KEY` for the Supabase admin client, enforces admin/owner membership before writes, auto-expires pending rows once `expires_at` passes, and updates statuses to `accepted`, `declined`, `revoked`, `expired`, or `failed`.
- `/api/invitations` is the control-plane API for organization invites. It uses `APP_CONTROL_DB_URL` and `APP_CONTROL_DB_SERVICE_ROLE_KEY` for the Supabase admin client, enforces admin/owner membership before writes, auto-expires pending rows once `expires_at` passes, and updates statuses to `accepted`, `declined`, `revoked`, `expired`, or `failed`.
  - Invitation expiry is calculated automatically using smart precedence (global):
    1. **Registry override (global)**: `permission_registry.invitation_expiry_seconds` (integer, seconds) takes priority if set.
    2. **Supabase auth config**: Reads `MAILER_OTP_EXP` from `auth.config` via `get_auth_otp_expiry_seconds()` RPC (seconds).
    3. **Hardcoded fallback**: 24 hours (86400 seconds) if both above are unavailable or fail.
  - Backend uses `calculate_invitation_expiry(org_id)` RPC (control DB) to compute `expires_at` timestamp when client doesn't explicitly provide expiration.
  - Control DB schema: Run `scripts/control-db-invitation-expiry.sql` to deploy the RPC functions (`get_auth_otp_expiry_seconds` and `calculate_invitation_expiry`).
  - Permission registry: `invitation_expiry_seconds` (integer, default null) in `permission_registry` table allows global customization without modifying Supabase auth settings.
  - Clients can still explicitly provide `expiresAt`/`expires_at` in the POST request body to override automatic calculation.
- `/api/settings` surfaces HTTP 424 (`settings_schema_incomplete` / `settings_schema_unverified`) when `tuttiud.setup_assistant_diagnostics()` reports missing tenant tables or policies, and the response includes the failing diagnostic rows so admins rerun the setup script instead of retrying blindly.
- Invitation completion emails land on `/#/complete-registration` with `token_hash` (Supabase invite) and `invitation_token` (control-plane token). The page must display the invited email, wait for the user to click the manual confirmation button, then call `supabase.auth.verifyOtp({ type: 'invite', token_hash })` before redirecting to `/#/accept-invite` while forwarding the original `invitation_token`.
- The `/components/pages/AcceptInvitePage.jsx` route requires an authenticated session, reloads invitation status via `/api/invitations/token/:token`, blocks mismatched accounts until they sign out, and surfaces state-specific UI (pending actions, accepted success CTA, or invalid-link notice) while wiring accept/decline buttons to the secure `/api/invitations/:id/(accept|decline)` endpoints.
- TutTiud rebranding placeholder assets live in `public/icon.svg`, `public/icon.ico`, and `public/vite.svg` until final design delivery.
- `tuttiud.setup_assistant_diagnostics()` now validates schema, RLS, policies, and indexes. Keep `SETUP_SQL_SCRIPT` (v2.4) as the source of truth when extending onboarding checks.
- Shared BFF utilities for tenant access (`api/_shared/org-bff.js`) centralize org membership, encryption, and tenant client creation. Reuse them when building new `/api/*` handlers.
- Admin UI is migrating to feature slices. Place admin-only components under `src/features/admin/components/` and mount full pages from `src/features/admin/pages/`. Reusable primitives still belong in `src/components/ui`.
- The refreshed design system lives in `tailwind.config.js` (Nunito typography, primary/neutral/status palettes, spacing tokens) with base primitives in `src/components/ui/{Button,Card,Input,PageLayout}.jsx`. Prefer these when creating new mobile-first UI.
- `src/components/layout/AppShell.jsx` is the new navigation shell. It renders the mobile bottom tabs + FAB and a desktop sidebar, so wrap future routes with it instead of the legacy `Layout.jsx`.

### Weekly Compliance Calendar Layout (2025-11) - Heatmap Implementation
- The Weekly Compliance View uses a **compliance heatmap** approach optimized for high-density session tracking.
- Main view (`ComplianceHeatmap.jsx`): Grid showing days × time slots with color-coded cells indicating documentation compliance percentage:
  - 🟢 Success Green (#22C55E, 100%): Excellent compliance
  - 🟡 Warning Yellow (#FACC15, 76-99%): Needs attention
  - � Warning Orange (#F97316, 0-75%): Requires action
  - ⚪ Neutral Gray (#E5E7EB): No sessions scheduled / Upcoming sessions (not yet due)
- **UI Design Principles (2025-11)**:
  - Each cell uses larger padding (p-4), border-2, and bold text for better visual hierarchy
  - **Color saturation (2025-11)**: Upgraded from -100/-950 to -200/-900 for bolder, more visible states; text upgraded to -950/-50 for maximum contrast
  - **Tight spacing (2025-11)**: Cell content uses gap-1 and leading-tight to reduce whitespace and improve density
  - "תצוגה מפורטת" button styled with outline variant, primary color accents, 📊 icon prefix for visibility
  - Instructor legend removed from week view to reduce visual clutter
  - Cell spacing increased (px-3 py-3) for better touch targets and readability
- Each cell displays: status icon counts (✓×N ✗×N ⚠×N), ratio (documented/total), and percentage.
- Click any cell opens `SessionListDrawer.jsx` showing detailed session list for that hour with:
  - **Drawer placement (2025-11)**: Opens on left side (RTL convention: primary content right, secondary left)
  - Sessions grouped by exact time (handles :15/:45 naturally)
  - Status icons (✓ documented, ✗ missing, ⚠ upcoming)
  - **Instructor colors displayed** (2025-11): Color bar on right edge of card + color dot next to instructor name
  - Instructor color rendering handles both solid colors and gradients (gradient- prefix converted to linear-gradient CSS)
  - **Quick documentation (2025-11)**: "תעד עכשיו" button opens `NewSessionModal` with pre-filled student + date; default service auto-selected if configured
  - **RTL layout (2025-11)**: Cards use `dir="rtl"` with text on right, status icon center, buttons on left; proper Hebrew reading flow
- "תצוגה מפורטת" button per day opens `DayTimelineView.jsx` - resource timeline showing instructor lanes with sessions positioned precisely by time.
- **Day timeline RTL fixes (2025-11)**:
  - Timeline flows right-to-left (RTL): latest hour on right, earliest on left (Hebrew reading direction)
  - Hours array reversed (maxHour → minHour) for proper RTL display
  - Position calculated from right edge: `(maxHour - timeMinutes) * 120px`
  - Session chips contain RTL content (`dir="rtl"`) for Hebrew text display
  - Grid lines use `border-r` (right border) for RTL layout
  - Instructor column reduced from 192px to 128px for more timeline space and better student name visibility
  - Vertical spacing optimized: py-1 for rows, minHeight 60px (was 120px) to eliminate unused space
  - Container includes `overflow-hidden` to prevent chips from sliding outside bounds
  - **Session duration (2025-11)**: Chip width = 110px (30-minute sessions, allowing full student names); positioned at 120px per hour scale
  - **Smart stacking (2025-11)**: `calculateStackPosition` detects time overlaps and fills gaps; sessions stack only when overlapping, reusing vertical space when prior sessions end
  - Stacking uses 36px per row for comfortable spacing
- Day timeline uses instructor rows with horizontal time grid (dynamic hours based on actual sessions, 120px per hour).
- Sessions positioned as clickable chips at exact times, stacking intelligently to avoid wasted vertical space.
- Scales infinitely: works with any number of instructors/students/sessions without overlap issues.
- Mobile: Week heatmap remains functional; day timeline best viewed in landscape.
- Legacy: React Big Calendar approach (ModernWeeklyCalendar.jsx) deprecated due to event density issues.
- Demo: `demo-resource-timeline-week.html` shows what a full week resource timeline would look like (horizontal scroll, all days visible).

### Onboarding Tour System (2025-10)
- Custom tour implementation lives in `src/features/onboarding/`:
  - `customTour.js`: Singleton tour bus with `openTour()`, `closeTour()`, `nextStep()`, `prevStep()`, `subscribe()`, `getState()`
  - `components/CustomTourRenderer.jsx`: Portal-based overlay with SVG mask for spotlight effect, popover with RTL support, smart placement (top/bottom/left/right based on available space)
  - `components/WelcomeTour.jsx`: Auto-launches tour for new users, marks onboarding completed on close
  - `components/OnboardingCard.jsx`: Manual tour launcher in Settings (does NOT mark as completed)
  - `components/TourSteps.jsx`: Tour step definitions with role-based steps (admin vs member)
  - `styles/tour.css`: Custom tour styling with premium shadows, gradients, responsive breakpoints, RTL support
- Tour features:
  - SVG masking creates spotlight effect (grayed overlay with cutout around target element)
  - Smart positioning algorithm chooses best placement based on available viewport space
  - ESC key, X button, and Done button all close the tour
  - Overlay click closes only on the last step
  - Mobile-optimized with touch-friendly 44px minimum button heights
  - Welcome/no-target steps position center-high (~35% viewport height) on both desktop and mobile
  - Progress bar with gradient fill and smooth transitions
  - Scroll/resize listeners update layout dynamically
  - Centers gracefully when target element not found
- Accessibility: ARIA roles, keyboard navigation (ESC), proper z-index layering, RTL text alignment
- Note: Replaced driver.js dependency with custom implementation for better control and professional UX

- Frontend API clients are being colocated under feature slices:
    - Sessions: `src/features/sessions/api/work-sessions.js`
    - Settings: `src/features/settings/api/{settings.js,index.js}` (server API + client helpers)
    Legacy files under `src/api/` now re-export from the new paths to ease migration. Prefer importing from the feature locations going forward.

### Forms UI Layer (2025-10)
- Centralized form field components live in `src/components/ui/forms-ui/` to provide consistent RTL-first design, error handling, and labeling across all forms.
- Available field components:
  - **`FormField`**: Base wrapper that handles label, description, and error display. All other field components use this internally. Automatically applies `dir="rtl"` and right-aligned text to all child elements.
  - **`TextField`**: Text input with support for various types (text, email, number, date, etc.). Includes dir prop for RTL/LTR control.
  - **`TextAreaField`**: Multi-line text input with configurable rows.
  - **`SelectField`**: Dropdown using Radix Select with options array `[{ value, label }]`.
  - **`PhoneField`**: Israeli phone input with LTR dir (correct for phone numbers) and RTL-aligned label/description.
  - **`DayOfWeekField`**: Day-of-week selector using DayOfWeekSelect component.
  - **`ComboBoxField`**: Free text + suggestions dropdown (service selection, etc.).
  - **`TimeField`**: Time picker with 15-min snapping and HH:MM display.
- All field components accept consistent props: `id`, `label`, `value`, `onChange`, `required`, `disabled`, `description`, `error`, `placeholder`.
- Import from barrel: `import { TextField, SelectField, ... } from '@/components/ui/forms-ui';`
- **RTL Form Structure Requirements**:
  - Form elements must have `dir="rtl"` on the `<form>` tag itself.
  - All `<Label>` components need `className="block text-right"` for proper Hebrew text alignment.
  - Description and error text should include `text-right` class.
  - Form footers with buttons should use `flex-row-reverse` to ensure proper RTL button ordering (primary action on right).
  - Phone inputs remain LTR (`dir="ltr"`) as phone numbers are universally left-to-right, but labels and descriptions stay RTL-aligned.
- Dialog components (`src/components/ui/dialog.jsx`) updated for RTL:
  - Close button positioned on left (RTL standard).
  - DialogHeader text aligned right.
  - DialogFooter uses flex-row-reverse with gap for proper RTL button ordering.
  - Content scrolling contained within dialog body using `.dialog-scroll-content` class with custom scrollbar styling (thin, natural appearance, hover feedback).
- Custom scrollbar styles in `src/index.css` under `.dialog-scroll-content` class provide thin, semi-transparent scrollbars that match design system colors.
- Forms fully migrated to RTL structure: `AddStudentForm`, `NewSessionForm`.
- Migration strategy: All new forms must follow RTL patterns from the start; existing forms should be updated to match the RTL structure during maintenance.

### Student Lifecycle & Visibility (2025-11)
- Tenant students now include an `is_active` boolean (default `true`). The setup script (`src/lib/setup-sql.js`) adds the column with `ADD COLUMN IF NOT EXISTS` and backfills existing rows, so rerunning the script on legacy tenants is safe.
- **Student metadata tracking**: Students now automatically track creator and updater information in the `metadata` jsonb column:
  - On creation (POST): `{ created_by: userId, created_at: ISO timestamp, created_role: role }`
  - On update (PUT): Preserves existing metadata and adds `{ updated_by: userId, updated_at: ISO timestamp, updated_role: role }`
  - Metadata is populated server-side in `/api/students-list` endpoint, frontend doesn't need to send these fields
- `/api/students-list` defaults to `status=active`; pass `status=inactive`, `status=all`, or `include_inactive=true` (legacy) when maintenance flows need archived rows. `PUT` handlers accept `is_active` alongside the existing roster fields.
- `/api/students-list` respects the org setting `instructors_can_view_inactive_students`. Instructors only see inactive records when the flag is enabled; admins/owners always see them when requesting `status=all` (replaced legacy `/api/my-students` endpoint).
- Admin UI (`StudentManagementPage.jsx`) persists the Active/Inactive/All filter in `sessionStorage`, badges inactive rows, and exposes the toggle in `EditStudentForm.jsx`. Instructor surfaces (`MyStudentsPage.jsx`, `NewSessionModal.jsx`, `NewSessionForm.jsx`) automatically hide inactive students unless the setting is on.
- Settings page adds `StudentVisibilitySettings.jsx` (eye-off card) so admins control the instructor flag through `fetchSettingsValue`/`upsertSetting`. Keep the copy bilingual and honor API permission checks when extending the card.

### Student Tags Catalog (2025-11)
- Tenant tag definitions live in the `tuttiud."Settings"` row keyed `student_tags` (JSONB array of `{ id, name }`).
- Backend: `GET /api/settings/student-tags` returns the catalog for any org member; `POST /api/settings/student-tags` appends a tag (admin/owner only) and regenerates the row via Supabase upsert.
- Frontend: use `useStudentTags()` (`src/features/students/hooks/useStudentTags.js`) to load/create tags and render `StudentTagsField.jsx` for the dropdown + admin-only creation modal in student forms.
- Tag normalization helpers live in `src/features/students/utils/tags.js`; reuse `normalizeTagIdsForWrite` and `buildTagDisplayList` whenever sending or displaying student tags to keep the uuid[] contract authoritative.
- **Tag Management UI** (2025-11): Admin/owner users can manage tags via Settings page card (`TagsManager.jsx`):
  - Create new tags with duplicate name validation
  - Edit existing tag names (updates propagate to all tagged students via settings catalog)
  - Delete tags with confirmation guard; deletion removes tag from catalog and all student rows via `/api/students-remove-tag`
  - Backend uses `tuttiud.remove_tag_from_students(tag_uuid)` PostgreSQL function for efficient bulk removal with fallback to manual iteration
  - Tag deletion is permanent; confirmation dialog warns users that operation cannot be undone
  - Full RTL support with proper Hebrew text alignment and flex-row-reverse layouts

### Instructor Types and Document Management (2025-11)
- **Instructor Types**: Similar to student tags, instructors can be categorized by type (e.g., "Therapist", "Volunteer", "Staff")
  - Tenant type definitions live in `tuttiud."Settings"` row keyed `instructor_types` (JSONB array of `{ id, name }`)
  - **Database schema**: `Instructors.instructor_types` (uuid array) column added in setup script. The legacy `Instructors.files` (jsonb) column is **DEPRECATED** and no longer created on fresh deployments.
  - Frontend hook: `useInstructorTypes()` (`src/features/instructors/hooks/useInstructorTypes.js`) provides load/create/update/delete operations
  - Management UI: **Unified `TagsManager.jsx`** in Settings manages both student tags and instructor types via mode toggle
    - Card renamed to "ניהול תגיות וסיווגים" (Manage Tags and Classifications)
    - Toggle buttons switch between student tags and instructor types modes
    - Single component handles CRUD for both entity types with mode-aware UI labels
  - Instructor editing: `InstructorManager.jsx` includes type selector dropdown in expanded edit form
- **Dual-Mode Document Definitions**:
  - `DocumentRulesManager.jsx` now supports both students and instructors via target type selector
  - Settings keys: `document_definitions` (students) and `instructor_document_definitions` (instructors)
  - Student documents can be filtered by `target_tags` (student tags)
  - Instructor documents can be filtered by `target_instructor_types` (instructor types)
  - If no tags/types specified, document applies to all students/instructors
  - UI shows appropriate badges and icons (Tag for students, Briefcase for instructors)
- **File Upload for Instructors**:
  - Backend endpoints: `/api/instructor-files` (POST/PUT/DELETE) and `/api/instructor-files-download` (GET)
  - Storage path: `instructors/{org_id}/{instructor_id}/{file_id}.{ext}`
  - **File metadata**: Each file record includes `{id, name, original_name, relevant_date, expiration_date, resolved, url, path, storage_provider, uploaded_at, uploaded_by, definition_id, definition_name, size, type, hash}`
  - **PUT endpoint**: Updates file metadata (name, relevant_date, expiration_date, resolved) post-upload
    - Admin/owner only (instructors can update their own files)
    - Logs audit event with updated fields
  - **Admin UI**: `InstructorDocumentsSection` component integrated into `InstructorManager` via tabs (Details/Documents)
  - **Instructor Self-Service**: `MyInstructorDocuments` component in Settings page modal
    - Modal trigger: "המסמכים שלי" card appears for instructor role (non-admin users)
    - Modal features: Upload required/additional documents, view/download own files, background progress tracking
    - No delete capability: Instructors cannot delete files to preserve important documentation
  - Document validation: Filters by `instructor_type` matching `target_instructor_types` in definitions
  - Upload features: Background progress tracking, duplicate detection (MD5 hash), Hebrew filename support
  - File management: Upload, download (presigned URLs), delete (admin-only), edit metadata (admin or own files)
  - **Pre-upload metadata editor**: Dialog opens before upload (same pattern as student files)
    - Name auto-populated from filename or definition name
    - Name locked for required documents
    - Both dates optional
  - **Post-upload metadata editor**: Dialog to update metadata after file is uploaded
    - Edit name, relevant_date, expiration_date
    - Admin/owner or instructor (own files only)
    - Edit button next to each file
  - **Resolved status for expired documents**: Same pattern as student files
    - Green "טופל" badge for resolved, red "פג תוקף" for expired unresolved
    - Toggle button for files with expiration_date
  - Orphaned files: Files from deleted definitions display with amber badge "הגדרה ישנה"
  - Storage integration: Works with both managed R2 and BYOS storage profiles
  - **Permission model** (enforced in backend):
    - Admin/Owner: Can manage files for all instructors (via `InstructorManager`)
      - Full CRUD: Upload, download, delete any instructor's files
    - Instructor (non-admin): Can only upload/download their own files
      - Upload: ✅ Own files only
      - Download: ✅ Own files only
      - Edit metadata: ✅ Own files only
      - Delete: ❌ Blocked (admin-only for data integrity)
    - `GET /api/instructors`: Non-admin users can only fetch their own instructor record (`builder.eq('id', userId)`)
    - `POST /api/instructor-files`: Validates `instructorId !== user.id` for non-admins, blocks cross-instructor uploads
    - `PUT /api/instructor-files`: Validates `instructorId !== user.id` for non-admins, blocks cross-instructor edits
    - `DELETE /api/instructor-files`: Blocked for all non-admin users regardless of file ownership
    - `GET /api/instructor-files-download`: Validates `instructorId !== userId` for non-admins, blocks cross-instructor downloads
  - **Data isolation**: Instructors cannot see other instructors' files, names, or technical information; only admins have roster visibility
  - **Rationale for admin-only deletion**: Files (medical certificates, credentials, etc.) are critical documentation that should only be removed with administrative approval to prevent accidental or unauthorized deletion

### Session Form Question Types (2025-10)
- Session form questions are managed via `SessionFormManager.jsx` (Settings page) and rendered in `NewSessionForm.jsx`.
- Question type definitions in `QUESTION_TYPE_OPTIONS`:
  - `textarea` - Multi-line text input
  - `text` - Single-line text input
  - `number` - Numeric input
  - `date` - Date picker
  - `select` - Dropdown menu
  - `radio` - Traditional radio buttons with visible circular inputs (vertical stack)
  - `buttons` - Modern button-style selection with hidden radio inputs (horizontal flex wrap, full button is clickable with primary color fill when selected)
  - `scale` - Numeric range slider with min/max/step configuration
- Visual distinction between `radio` and `buttons`:
  - **`radio`**: Displays as a vertical list with visible radio button circles; uses subtle hover and border highlight when selected
  - **`buttons`**: Displays as horizontally wrapped button group; radio input is hidden (`sr-only`); selected button gets primary background with white text and shadow; unselected buttons have neutral border with hover effects
- Both types use the same data structure (options array) and validation rules (minimum 2 options required).
- **Metadata support**: The `Settings` table includes a `metadata` jsonb column for storing auxiliary configuration. For `session_form_config`, this holds preconfigured answer lists for `text`/`textarea` questions under `metadata.preconfigured_answers[question_id]`. The cap is enforced server-side using control DB permissions and respected in the editor UI.
- **Session form versioning** (2025-11):
  - Backend (`/api/sessions`) saves `SessionRecords.metadata.form_version` by extracting from `Settings.session_form_config.current.version` (primary) or `Settings.session_form_config.version` (legacy fallback).
  - **Shared version lookup utility**:
    - `extractQuestionsForVersion(formConfig, version)` contains the core logic for extracting questions from versioned config
    - Frontend: `src/features/sessions/utils/version-lookup.js`
    - Backend: `api/_shared/version-lookup.js` (copy kept in sync with frontend)
    - Handles nested structure `config.current.questions`, legacy `config.current` array, and flat `config.questions`
    - Searches history array for specific versions
    - Note: Two copies needed because Azure Static Web Apps deploys API and frontend separately; keep them synchronized
  - Frontend (`StudentDetailPage.jsx`) uses `getQuestionsForVersion` helper (`src/features/sessions/utils/version-helpers.js`):
    - Calls shared `extractQuestionsForVersion` to get raw questions
    - Then normalizes via `parseSessionFormConfig` (adds `key` field from `id`, proper structure, etc.)
  - PDF export (`api/students-export/index.js`):
    - Imports and uses shared `extractQuestionsForVersion` directly (no normalization needed)
    - Uses `buildAnswerList` with question map that looks up by `id`, `key`, or `label` to match raw questions
  - When displaying session records:
    1. Checks `session.metadata.form_version` for each record
    2. If version is set, retrieves matching questions from `session_form_config.current.questions` or `session_form_config.history[].questions`
    3. If version is null/missing, falls back to current form configuration
  - This gracefully handles legacy records (no version) while supporting future versioned forms when history tracking is implemented.
  - Database structure: `session_form_config` is stored as `{"current": {"version": N, "saved_at": "...", "questions": [...]}, "history": [...]}`

### Session Report Success Flow (2025-11)
- **Success state UX**: After successfully saving a session report, the modal stays open and shows a success state instead of closing immediately.
- **Date Selection Enhancement (2025-12)**: After completing a report, users choose their next action through a **two-step workflow**:
  1. **Action selection**: Choose between "דיווח נוסף - [Student Name]" (same student, displays actual student name) or "דיווח נוסף - תלמיד אחר" (different student)
  2. **Date selection**: Once action is chosen, three date options are displayed:
     - **אותו התאריך** (Same date) - Uses the date from the just-completed report (only shown if different from today)
     - **היום** (Today) - Current date, shown with DD/MM/YYYY format
     - **תאריך אחר** (Other date) - Opens form with empty date field for manual selection
  - Each date button displays both the Hebrew label and the actual date that will be used (e.g., "03/12/2025")
  - User can navigate back from date selection to action selection using "חזור" button
  - Benefits: **Universal date selection** for both same-student and different-student workflows, prevents date entry errors, speeds up bulk documentation
- **Implementation** (`NewSessionModal.jsx` + `NewSessionForm.jsx`):
  - Modal tracks success state: `{ studentId, studentName, date }`
  - Toast displayed with enhanced configuration for mobile: `toast.success('...', { duration: 2500, position: 'top-center' })`
  - Date choice footer (`DateChoiceFooter` component) manages two-step workflow with internal state:
    - Mode state: `'choose'` (action selection) → `'same-student'` or `'other-student'` (date selection)
    - Uses `formatDateForDisplay()` helper to show dates in DD/MM/YYYY format
    - `getTodayDate()` helper provides current date in YYYY-MM-DD format
    - Each date option button shows icon (CalendarCheck, CalendarClock, Calendar) + label + formatted date
    - Navigation: Initial screen has two action buttons + close; date screen has continue + back + close buttons
  - Form reset via `formResetRef` using `useImperativeHandle`:
    - Resets all fields: answers, service, filters
    - Accepts `date` parameter: if provided, pre-fills the date field; if null, leaves empty for user selection
    - Accepts `keepStudent` parameter: if true, preserves student selection (for same-student workflow)
    - Called from parent: `formResetRef.current({ keepStudent: true, studentId, date: '2025-12-03' })`
  - Both `handleNewReport` and `handleNewReportSameStudent` accept `{ date }` parameter
- **Mobile optimization**:
  - Toast duration increased to 2500ms (from default) for better visibility
  - Toast positioned `top-center` on mobile for maximum visibility
  - Success state prevents race condition where modal closes before toast renders on mobile browsers
  - All buttons use proper RTL layout with `dir="rtl"` and right-aligned text
- **User benefits**:
  - **Consistent workflow**: Same date selection experience whether documenting same student or switching students
  - **No confusion**: Success state stays visible, clear two-step process
  - **Speed**: Quick date selection in 1-2 clicks instead of manual date entry
  - **Flexibility**: Can still choose custom date or navigate back to change action
  - **Error prevention**: Visual date display prevents date entry mistakes
  - **Bulk documentation**: Optimized for instructors documenting multiple sessions in sequence
- **Advanced Filters Pattern (2025-11)**:
  - Filter section now separates basic search (always visible) from advanced filters (collapsible)
  - Advanced filters section includes: instructor scope selector (admin only), day-of-week filter, and active/inactive status filter
  - Toggle button shows/hides advanced filters with "סינון מתקדם" label and chevron icons (up when expanded, down when collapsed)
  - Visual indicator (blue dot) appears on toggle button when advanced filters are collapsed but active
  - State persistence: Advanced filter visibility persists when creating additional reports from success window, but resets when modal is closed/reopened
  - Controlled state pattern: `showAdvancedFilters` state managed in `NewSessionModal` and passed to `NewSessionForm` via props
  - Implementation uses `animate-in fade-in slide-in-from-top-2` classes for smooth expansion animation

- **Unified Student Management Page (2025-12)**:
  - **StudentsPage** (`src/features/students/pages/StudentsPage.jsx`): Single component for both admin and instructor views
    - **Role-based rendering**: Uses `isAdminRole()` to determine admin vs instructor mode
    - **Unified API**: All users use `/api/students-list` endpoint with server-side role filtering
    - **Admin features**:
      - Full student roster with instructor assignment column
      - Add new students, edit existing students, data maintenance tools
      - Instructor filter to view specific instructor's students
      - Status filter (active/inactive/all) always available
      - Compliance summary and expired documents tracking
      - Pending reports management for loose session assignments
    - **Instructor features**:
      - View only assigned students (enforced server-side via `/api/my-students`)
      - Cannot add/edit students or access data maintenance
      - No instructor filter (only sees own students)
      - Status filter conditional on `instructors_can_view_inactive_students` setting
      - Pending reports dialog showing own submitted loose reports
    - **Shared features**:
      - Search by name/phone/national_id with RTL support
      - Filter by day of week, tags, and sort options
      - Filter state persistence (separate for admin/instructor modes)
      - Session creation event listener for real-time pending reports updates
      - Compliance badges and document expiration warnings
    - **Security boundaries**:
      - Server-side enforcement: API automatically filters by `assigned_instructor_id` for non-admin users
      - Filter mode separation: `filterMode = isAdmin ? 'admin' : 'instructor'`
      - Permission checks for visibility settings and admin-only features
      - No data leakage between admin and instructor contexts
      - Trust boundary at API layer - frontend cannot bypass role restrictions
  - **StudentFilterSection** (`src/features/students/components/StudentFilterSection.jsx`): Unified filter component
    - Shared component supporting both admin and instructor views
    - `showInstructorFilter` prop controls instructor filter visibility (admins only)
    - Basic search (always visible): name/phone/national_id with RTL support
    - Advanced filters toggle: Collapsible section with "סינון מתקדם" label
    - Advanced controls: status (conditional), day of week, instructor (conditional), sort, reset
    - Smooth animations: `animate-in fade-in slide-in-from-top-2` on expand/collapse
  - **Smart Fetching Strategy (2025-11)** - Optimized server calls:
    - **Server-side filtering**: Status parameter sent to API (`status='active'` | `'inactive'` | `'all'`)
    - **Only fetches needed data**: Admin filters control server query, reducing unnecessary data transfer
    - **Client-side filtering**: Search, day, instructor (admin), tags applied client-side
    - **No spam**: Only one request per statusFilter change
    - **Refetch trigger**: When statusFilter changes, `fetchStudents` called via useEffect dependency
    - **Benefits**: Reduces network traffic, no race conditions, instant client-side filtering
  - **Unified API Endpoint** (`/api/students-list`):
    - **Single endpoint replaces** `/api/students` and `/api/my-students` (eliminated 801 lines of duplicate code)
    - **Full CRUD operations**: GET (all users), POST (admin only), PUT (admin only)
    - **GET handler**:
      - Server-side role-based filtering: non-admin users automatically filtered to assigned students only
      - Admins can optionally filter by instructor via `assigned_instructor_id` query parameter
      - Status filter (`active`/`inactive`/`all`) supported for all users
    - **POST handler** (admin/owner only):
      - Creates new student with full validation via `buildStudentPayload()`
      - National ID uniqueness check via `findStudentByNationalId()`
      - Metadata tracking: `created_by`, `created_at`, `created_role`
      - Audit logging: `AUDIT_ACTIONS.STUDENT_CREATED`
    - **PUT handler** (admin/owner only):
      - Updates existing student with partial updates via `buildStudentUpdates()`
      - National ID conflict detection (excludes current student)
      - Changed fields detection for audit log
      - Metadata preservation and update: `updated_by`, `updated_at`, `updated_role`
      - Audit logging: `AUDIT_ACTIONS.STUDENT_UPDATED` with `changed_fields` detail
    - **Validation**: Uses shared helpers from `api/_shared/student-validation.js`
      - `coerceDayOfWeek`, `coerceSessionTime`, `validateIsraeliPhone`, `coerceNationalId`, `coerceTags`, `validateAssignedInstructor`
    - **Permission model**:
      - GET: All authenticated org members (non-admin filtered by `assigned_instructor_id`)
      - POST/PUT: Admin/owner only (403 Forbidden for non-admin)
    - **Benefits**: No code duplication, consistent caching, simpler maintenance, complete feature parity with original endpoints
  - **Routing**:
    - Primary route: `/students-list` → `StudentsPage` (role-based rendering)
    - Legacy redirects: `/admin/students` → `/students-list`, `/my-students` → `/students-list`
    - Pending reports: `/pending-reports` (accessible to all users)
    - Legacy redirect: `/admin/pending-reports` → `/pending-reports`
  - **Migration from separate pages**:
    - Replaced `StudentManagementPage.jsx` (755 lines) and `MyStudentsPage.jsx` (442 lines)
    - Replaced two API endpoints with single unified endpoint
    - Eliminated code duplication while maintaining all features from both pages
    - Filter state preserved separately for admin/instructor modes
    - Automatic redirects ensure existing bookmarks/links continue working

### Tenant schema policy (Reinex)
- All tenant database access must use the `public` schema.
- Supabase tenant clients must set `db: { schema: 'public' }`.

### Legacy: WorkSessions vs SessionRecords
- WorkSessions is a legacy construct kept temporarily for compatibility with existing import and payroll flows.
- New session data entry uses `SessionRecords` via `/api/sessions` and history reads via `/api/session-records`.
- Plan to migrate remaining WorkSessions consumers (e.g., import flows) to `SessionRecords` once mapping and reporting requirements are finalized.

### UI Tokens: Popover/Select backgrounds
- Our Select/Popover primitives use classes like `bg-popover` and `text-popover-foreground`. Ensure Tailwind maps these tokens to CSS variables. We extended `tailwind.config.js` colors to include `popover`, `popover-foreground`, `muted`, `accent`, `secondary`, `destructive`, and `card` using `hsl(var(--token))` so dropdown lists render with a visible background.
- CSS variables are defined in `src/index.css` under `:root` and `.dark`. If adding new shadcn tokens, update both `index.css` and `tailwind.config.js` accordingly.

### Popover/Select scroll and input patterns (2025-10)
- When using overlays inside `Dialog`, body scroll is locked by react-remove-scroll. To allow dropdowns to scroll:
  - Add `data-scroll-lock-ignore` and/or `data-rs-scroll` on the overlay content element.
  - Add `pointer-events-auto` and `overscroll-behavior: contain` to the content.
  - Prefer the scroll container (`Viewport` or list wrapper) with `max-height` and `overflow-y-auto`.
- Do not wrap editable `<Input>` controls in `PopoverTrigger`. It makes the field behave like a button and can block typing.
  - Preferred structure: render `<Input>` normally; wrap only the chevron button with `PopoverTrigger asChild`.
  - Use an "auto-commit on close" pattern to save free text:
    - Track `query` (typed text) and `lastCommitted` via ref.
    - Commit on Enter and in a `useEffect` that runs when `open` goes false.
- Components aligned to this pattern:
  - `src/components/ui/ComboBoxInput.jsx` (generic string combobox; suggestions + free text)
  - `src/components/ui/TimePickerInput.jsx` (HH:MM snapping to 15-min increments; persists as `HH:MM:SS`)

### Accessibility Controls (2025-10)
- In-app Accessibility menu adds persistent controls for:
  - Font scale (90%–140%) via `--a11y-font-scale` (applied on `html`).
  - High-contrast theme toggle (adds `a11y-hc` class on `html`).
  - Text spacing toggle (adds `a11y-text-spacing` class; increases letter/word spacing and line-height).
  - Underline links toggle (adds `a11y-underline-links` class; underlines all anchors with offset + thickness).
  - Dyslexia-friendly font toggle (adds `a11y-dyslexia-font` class; uses Atkinson Hyperlegible font loaded from Google Fonts with Comic Sans MS fallback; includes extra letter-spacing and word-spacing for improved readability).
- Styles are injected once at runtime by `AccessibilityProvider` (style tag `#a11y-dynamic-styles`) to avoid global CSS churn. If we later prefer static CSS, move the rules into `src/index.css` under `@layer base` and remove the injector.
- Persistence uses localStorage keys `a11y:*`. The provider exposes `useAccessibility()` for UI wiring.

## Future Implementation: Organization Switching
- The legacy AppShell sub-header (removed in the cleanup that consolidated the global header) previously hosted the organization-switching dropdown. When it rendered, it embedded the logic now housed in `src/org/OrgSwitcher.jsx` (see the git history for the pre-removal `AppShell.jsx` block) to list orgs, handle focus, and persist selection. When reintroducing org switching into the refreshed header, reuse that approach instead of recreating it from scratch.

### Student deduplication (2025-02, Enhanced 2025-12)
- New API helpers: `/api/students-check-id` enforces national ID uniqueness (supports `exclude_id`), and `/api/students-search` surfaces fuzzy name matches with `id`, `national_id`, and `is_active`.
- **Route pattern (2025-12)**: Uses `students-check-id` (not `students/check-id`) to avoid conflict with `students/{id}` wildcard route
- **Permission model (2025-12)**: `/api/students-check-id` is available to ALL org members (not just admin/owner) to prevent duplicate national IDs and improve data quality. This is safe because non-admin members cannot create students or access other instructors' rosters - it's a read-only validation check.
- Admin student forms now require checking these endpoints for duplicate alerts; national ID conflicts must block submission with a profile shortcut.
- The roster surfaces a red badge when `national_id` is missing so admins can prioritize cleanup.

### Student data maintenance CSV (2025-02, Enhanced 2025-12)
- **Export API** (`/api/students-maintenance-export`):
  - Returns user-friendly CSV with Hebrew headers, preserving Excel compatibility
  - **Route pattern**: Uses `students-maintenance-export` (not `students/maintenance-export`) to avoid conflict with `students/{id}` route
  - **CSV formatting for Excel**:
    - UTF-8 BOM (`\uFEFF`) ensures Hebrew text displays correctly
    - Phone numbers use `="0546341150"` Excel formula to preserve leading zeros
    - Day of week shows Hebrew names (ראשון, שני, etc.) instead of numbers
    - Active status shows כן/לא instead of TRUE/FALSE
    - Times display as HH:MM without timezone (strips +00)
    - UUID column appears last for user convenience
  - **Three export modes** accessed via dropdown menu:
    1. **Export All** (`?filter=none`): All students, downloads as `student-data-maintenance.csv`
    2. **Export Problematic** (`?filter=problematic`): Students with missing national_id, inactive/missing instructor, or schedule conflicts (same instructor + day + time), downloads as `students-problematic.csv`
    3. **Export Filtered** (`?filter=custom&instructors=X,Y&tags=A,B&day=3`): Filter by instructor IDs, tag IDs, and/or day of week (0-6), downloads as `students-filtered.csv`
  - **Instructor column**: Exports instructor NAME (not UUID) for user-friendly editing
  - Uses `papaparse` library for reliable CSV generation with proper escaping
- **Import API** (`/api/students-maintenance-import`):
  - **Preview/dry-run mode (2025-12)**: Supports `dry_run: true` parameter to return preview without applying changes
    - Preview response includes old vs. new values for each field change
    - Returns student name, ID, line number, and detailed change breakdown
    - Validation errors included in preview before any data is modified
  - **Selective application (2025-12)**: Accepts `excluded_ids` array to skip specific students when applying changes
  - Ingests edited CSV text keyed by `system_uuid` (required for all rows)
  - **Column name flexibility (2025-12)**: Accepts both English and Hebrew column names for ALL fields:
    - UUID: `system_uuid`, `student_id`, `id`, `מזהה מערכת (uuid)`, `מזהה מערכת`
    - Name: `name`, `student_name`, `שם התלמיד`
    - National ID: `national_id`, `nationalId`, `מספר זהות`
    - Contact: `contact_name`, `contactName`, `שם איש קשר` + `contact_phone`, `contactPhone`, `טלפון`
    - Instructor: `assigned_instructor_name`, `assigned_instructor`, `instructor_name`, `instructor`, `שם מדריך`
    - Service: `default_service`, `service`, `שירות ברירת מחדל`
    - Day: `default_day_of_week`, `day`, `יום ברירת מחדל` (supports Hebrew day names and numbers)
    - Time: `default_session_time`, `session_time`, `sessionTime`, `שעת מפגש ברירת מחדל`
    - Notes: `notes`, `Notes`, `הערות`
    - Tags: `tags`, `tag_ids`, `Tags`, `תגיות`
    - Active: `is_active`, `active`, `status`, `פעיל` (supports Hebrew כן/לא)
  - **Round-trip compatibility**: CSVs exported with Hebrew headers can be re-imported without modification
  - **Column name validation (2025-12)**: Import validates all column names and rejects CSVs with unrecognized columns
    - Returns `unrecognized_columns` error with list of invalid column names and helpful hint
    - Prevents confusion from typos in column headers (e.g., "namee" instead of "name")
    - Frontend displays detailed error message showing which columns are invalid
    - Recognized columns: All English/Hebrew field names listed above, plus metadata columns (extraction_reason, סיבת ייצוא)
  - **Empty cell behavior (2025-12)**: Empty CSV cells are treated as "no change" - only cells with values update the database
  - **Clearing optional fields (2025-12)**: Use sentinel value `CLEAR` or `-` to explicitly clear optional fields (notes, default_service, contact_name)
  - **Instructor name matching** (2025-12): Accepts both UUID and instructor name in `assigned_instructor_name` column
    - Name matching is case-insensitive and uses exact match against `Instructors.name` or `Instructors.email`
    - Helpful errors when name not found: "מדריך בשם 'X' לא נמצא. מדריכים זמינים: [list of 5 active names]..."
    - Blocks assignment to inactive instructors with error listing active alternatives
    - Falls back to UUID matching if cell contains valid UUID format
  - **Hebrew input validation** (`api/_shared/student-validation.js`):
    - `coerceDayOfWeek`: Accepts Hebrew day names (ראשון→1, שני→2, etc.), 1-7 numbers (canonical format), or 0-6 (converted to 1-7 for backward compatibility)
    - `coerceSessionTime`: Accepts HH:MM format (exported format) and normalizes to HH:MM:SS (database format), also accepts full HH:MM:SS with optional timezone
    - `validateIsraeliPhone`: Strips Excel formula wrapper `="..."` before validation
    - `coerceBooleanFlag`: Accepts כן→true, לא→false, in addition to TRUE/FALSE/1/0
  - Updates only changed fields, enforces national ID uniqueness per row and against database
  - Returns per-row failure details with line numbers, student names, error codes, and Hebrew messages
  - **Max limit**: 2000 rows per import to prevent timeout
- **Frontend components**:
  - `DataMaintenanceMenu.jsx`: Dropdown menu with 4 options (export all, export problematic, export filtered, import)
  - `FilteredExportDialog.jsx`: Dialog with day/instructor/tag filter controls, requires at least one filter selection
  - `DataMaintenanceModal.jsx`: Import modal with three-stage workflow:
    1. Upload CSV → Backend validates and returns preview
    2. Preview & Select → User reviews changes, can deselect specific students
    3. Apply & Summary → Only approved changes written to database
  - `DataMaintenancePreview.jsx` (2025-12): Interactive preview component showing:
    - Side-by-side comparison: current value (red X) vs. new value (green checkmark)
    - Expandable cards per student with detailed field-by-field changes
    - Checkbox selection: individual students or "select all"
    - Smart formatting: instructor names, Hebrew days, active status in Hebrew
    - Visual indicators: change counts, validation errors in red
  - `DataMaintenanceHelpDialog.jsx`: Comprehensive help with instructions about preview workflow, empty cells, CLEAR sentinel, and Excel best practices
  - `StudentManagementPage.jsx`: Integrates menu, passes instructors and tags data, refreshes roster after import
- **Radix UI dependencies**: Uses `@radix-ui/react-dropdown-menu` for menu and `@radix-ui/react-checkbox` for filter selection and preview
- **API client helper**: `authenticatedFetchBlob()` in `lib/api-client.js` preserves UTF-8 BOM and binary encoding for CSV downloads
- **Comprehensive QA documentation**: See `docs/student-data-maintenance-qa.md` for full test plan covering all scenarios, edge cases, and validation rules

### Intake Bridge (2025-12)
- **Settings keys** (tenant DB `tuttiud."Settings"`):
  - `intake_field_mapping` stores the Microsoft Forms → Tuttiud field mapping.
  - `intake_important_fields` stores the Hebrew question labels to surface in quick views.
  - `intake_display_labels` stores the manually imported dictionary for form question IDs (legacy; not used with HTML parsing).
  - `external_intake_secret` stores the shared secret expected in the `x-intake-secret` header.
- **Database columns** (tenant DB `tuttiud."Students"`):
  - `intake_responses` jsonb stores `{ current, history }` intake payloads.
  - `intake_responses.current.intake_html_source` preserves the original HTML summary for rendering on the student profile.
  - `needs_intake_approval` boolean flags pending intake reviews.
- **API endpoints**:
  - `POST /api/intake` is public (Power Automate) and requires `x-org-id` plus `x-intake-secret` before inserting/updating student intake data. The request provides `html_content` which is parsed into Hebrew question/answer pairs.
  - `POST /api/intake/approve` requires Supabase auth; admins can approve any student, members only their assigned students. Updates `needs_intake_approval=false`, appends `metadata.last_approval`, and stores agreement metadata under `metadata.last_approval.agreement`.
- **Frontend**:
  - `IntakeSettingsCard.jsx` in Settings allows admins to manage mappings and rotate secrets.
  - `IntakeReviewQueue.jsx` on the dashboard surfaces pending intake approvals, keeps student cards collapsed by default, and requires an agreement confirmation before calling `/api/intake/approve`.
  - The dashboard intake widget uses a half-page scorecard summary with large-number tiles for new (unassigned) vs existing (assigned) pending students, stays visible with loading/error/empty states, and opens the detailed queue in a modal when clicking a tile or "פתח תור" (matching filters applied).
  - The "assigned to me" shortcut appears only for admins who are also instructors (non-admin instructors see a single combined queue, and non-instructor admins cannot be assigned).
