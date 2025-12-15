# Project Documentation: Tuttiud Student Support Platform

**Version: 1.6.1**
**Last Updated: 2025-12-09**

> **Developer Conventions:** For folder structure, naming rules, API patterns, and feature organization, refer to [Conventions.md](./Conventions.md).

## 1. Vision & Purpose

Tuttiud helps education teams coordinate instruction, track student progress, and keep each organization in control of its data. The first public release focuses on the core daily workflows shared by every customer:

- Administrators provision the tenant database once, back up the org, create students, and assign each student to an instructor.
- Instructors sign in with their organization, view only the students they are responsible for, and capture structured session records after every meeting.
- Both roles rely on a secure onboarding wizard that guarantees every tenant starts from the exact same schema and role configuration.

## 2. Architecture & Technology Stack

- **Desktop shell:** Electron packaged with electron-builder for Windows/macOS. Launches the React SPA inside a dedicated window or the default browser.
- **Frontend:** React + Vite + Tailwind + shadcn/ui. Routing uses a `HashRouter` to remain desktop friendly. All secure operations funnel through context providers (`SupabaseProvider`, `OrgProvider`).
- **Backend/API:** Azure Functions host the `/api/*` proxy endpoints. Every handler validates the caller’s Supabase JWT, checks organization membership, decrypts the dedicated tenant key, and then performs reads/writes with a server-side Supabase client (`tenantClient`).
- **Data Platform:** Each organization owns a Supabase Postgres project. The canonical schema lives in the `tuttiud` namespace and is created through the setup wizard’s SQL script. Row Level Security is enforced for every table.

## 3. Canonical Database Setup

The **only** supported bootstrap path is the SQL script stored in [`src/lib/setup-sql.js`](../src/lib/setup-sql.js). It is exposed verbatim to admins in the onboarding wizard and may be re-run safely at any time.

Key characteristics:

1. Creates the `tuttiud` schema and the tables `Instructors`, `Students`, `SessionRecords`, and `Settings`.
2. Enables RLS for every table and installs permissive policies (`Allow full access...`) for the authenticated role during MVP phase.
3. Creates the reusable `app_user` role and grants usage/select privileges.
4. Defines `tuttiud.setup_assistant_diagnostics()` which now confirms schema + table existence, verifies RLS + policies on every MVP table, and checks the critical indexes used by instructor/student dashboards.
5. Applies `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements so rerunning the script will backfill newly required columns on existing tenants without dropping data.
6. Generates a five-year JWT named `APP_DEDICATED_KEY (COPY THIS BACK TO THE APP)` that the admin pastes back into the wizard. The key is later encrypted and stored in the Control DB via `/api/save-org-credentials`.

## 4. Data Model (MVP)

| Table | Purpose | Key Columns |
| :---- | :------ | :---------- |
| `tuttiud."Instructors"` | Directory of teaching staff. | `id` (uuid PK storing `auth.users.id`, enforced by the application layer), `name`, contact fields, `is_active`, `metadata` (`instructor_color` stores the permanent palette assignment) |
| `tuttiud."Students"` | Student roster for the organization. | `id`, `name`, `national_id` (optional, uniqueness enforced in app), `contact_info`, `contact_name`, `contact_phone`, `assigned_instructor_id` (FK → `Instructors.id`), `default_day_of_week` (1 = Sunday, 7 = Saturday), `default_session_time`, `default_service`, `is_active` (boolean, defaults to `true`), `tags`, `notes`, `metadata` |
| `tuttiud."SessionRecords"` | Canonical record of every instruction session. | `id`, `date`, `student_id` (nullable FK → `Students.id` for loose reports), `instructor_id` (FK → `Instructors.id`), `service_context`, `content` (JSON answers map), `deleted`, `is_legacy` (marks imported historical rows), timestamps, `metadata` (includes `unassigned_details` for loose reports until resolution) |
| `tuttiud."Settings"` | JSON configuration bucket per tenant. | `id`, `key` (unique), `settings_value` |

Supporting indexes:

- `SessionRecords_student_date_idx` for chronological student lookups.
- `SessionRecords_instructor_idx` for instructor dashboards.

> **Instructor identity mapping:** Because the tenant database lives in a separate project from the control-plane auth store, `tuttiud."Instructors".id` is not backed by a database-level foreign key. The application is responsible for writing the correct `auth.users.id` when creating instructors and for keeping those mappings in sync.

## 5. Security Model & Keys

- RLS is enabled for every table. During the MVP all authenticated users have full access. Instructors can still be scoped in the application layer (filters by `assigned_instructor_id`). Future releases can tighten RLS without altering client code.
- The wizard captures the dedicated JWT generated by the SQL script. The frontend never stores it in plaintext; `/api/save-org-credentials` encrypts the value with `APP_ORG_CREDENTIALS_ENCRYPTION_KEY` before saving it to the Control DB (`organizations.dedicated_key_encrypted`).
- Serverless endpoints decrypt the key only while creating the privileged `tenantClient`. The browser keeps using the anon key for read-only diagnostics (`tuttiud.setup_assistant_diagnostics`) and must proxy all writes through `/api/*`.

## 6. Setup Wizard Flow (Settings → Supabase Setup)

Implemented in [`src/components/settings/SetupAssistant.jsx`](../src/components/settings/SetupAssistant.jsx):

1. **Database Preparation** – Presents the canonical SQL, explains how to run it in the Supabase SQL Editor, and reminds the admin to copy the JWT output.
2. **Provide the Application Key** – Offers a dedicated textarea + clipboard helper for the JWT (`APP_DEDICATED_KEY`). The key stays local until the admin explicitly saves it.
3. **Validation** – Runs `tuttiud.setup_assistant_diagnostics()` via the anon Supabase client. The function returns pass/fail rows for schema, RLS, policy, and index coverage. When all checks succeed the wizard posts the JWT to `/api/save-org-credentials`, which encrypts the key, persists `dedicated_key_saved_at`, `verified_at`, and `setup_completed`, and the UI records the verification timestamp before unlocking the rest of the app. Errors surface in-line with actionable guidance and keep the wizard on the same step for retry.

The wizard always tracks loading, error, and success states, ensuring accessibility (`aria-live`) and RTL support.

## 7. Core API Endpoints & MVP Feature Support

### 7.1 Serverless API Contracts

| Route | Method | Audience | Purpose |
| :---- | :----- | :------- | :------ |
| `/api/instructors` | GET | Admin/Owner | Reads `tuttiud."Instructors"` (defaulting to active rows) and returns instructor records keyed by their Supabase auth user ID (`id`). |
| `/api/students-list` | GET | All Users | Unified endpoint; admins see all students, non-admins filtered by `assigned_instructor_id`. Returns active students by default (`status=active`), with `status=inactive` and `status=all` options plus `include_inactive=true` for legacy callers. Responses echo the `is_active` flag so the UI can render lifecycle state. Replaces legacy `/api/students` and `/api/my-students` endpoints. |
| `/api/students-list` | POST | Admin/Owner | Inserts a student (name + optional contact data, scheduling defaults, instructor assignment) and echoes the created row. |
| `/api/students-list/{studentId}` | PUT | Admin/Owner | Updates mutable student fields (name, contact data, scheduling defaults, instructor, `is_active`, tags, notes) and returns the refreshed row or 404. |
| `/api/students-check-id` | GET | All Users | Validates a national ID for uniqueness, optionally excluding a student ID during edits. Returns `{ exists, student }` so the UI can block duplicates and deep-link to the profile. |
| `/api/students-search` | GET | Admin/Owner | Fuzzy name search that surfaces `{ id, name, national_id, is_active }` for quick deduplication hints beneath the name input. |
| `/api/students/maintenance-export` | GET | Admin/Owner | Returns a CSV with `system_uuid`, name, national ID, contact info, assigned instructor, schedule defaults, tags, and `is_active` for bulk cleanup. |
| `/api/loose-sessions` | GET/POST | Admin/Owner | Lists unassigned session records (`student_id IS NULL`) and resolves them by assigning to an existing student or creating a new student; strips only `metadata.unassigned_details` on resolution and preserves other metadata. |
| `/api/students/maintenance-import` | POST | Admin/Owner | Accepts edited maintenance CSV text keyed by `system_uuid`, updates only changed fields, enforces national ID uniqueness per row and against the database, and reports per-row failures. |
| `/api/my-students` | GET | Member/Admin/Owner | Filters the roster by `assigned_instructor_id === caller.id` (Supabase auth UUID) and hides inactive students unless the organization enables instructor visibility; supports optional `status` query parity with the admin endpoint. |
| `/api/weekly-compliance` | GET | Member/Admin/Owner | Returns the aggregated “Weekly Compliance View” data set with instructor color identifiers, weekly schedule chips, dynamic time window metadata, and per-session documentation status (✔ complete / ✖ missing). |
| `/api/sessions` | POST | Member/Admin/Owner | Inserts a `SessionRecords` entry (JSON answer payload + optional service context) after confirming members only write for students assigned to them. |
| `/api/settings` | GET/POST/PUT/PATCH/DELETE | Admin/Owner (read allowed to members) | Provides full CRUD for tenant settings, supporting creation of new keys like `session_form_config`. |
| `/api/user-context` | GET | Authenticated users | Returns the caller's organization memberships (with connection flags) and pending invitations, using the Supabase admin client to bypass RLS so invitees can still see organization names. |

- **Weekly compliance status timing:** The `/api/weekly-compliance` handler marks undocumented sessions scheduled for the current day as `missing` immediately after midnight UTC. Only future-dated sessions remain `upcoming`, so today's column instantly reflects whether a record exists even before the scheduled time occurs.
- **Daily compliance status timing:** `/api/daily-compliance` follows the same rule. Undocumented sessions with `isoDate` less than or equal to today's UTC date are flagged as `missing`, keeping the daily timeline aligned with the heatmap and preventing same-day gaps from appearing as `upcoming`.
- **Permission registry:** Control DB registry now includes `can_reupload_legacy_reports` (default `false`) for gating repeated legacy session imports at the organization level.
- **Legacy import UI (student detail):** Admin/Owner roles see an "Import Legacy Reports" action on the student detail page. The button is disabled once a legacy upload exists unless the `can_reupload_legacy_reports` permission is enabled. The modal flow enforces a backup warning, asks whether the CSV matches the current questionnaire, and renders the appropriate mapping UI (dropdowns against `session_form_config` or custom label inputs) with a required session-date column plus a re-upload warning when replacing prior legacy data. It also prompts for service context: either pick one service for all rows (or leave it blank) or select a CSV column that supplies the service per row.
  - UI refinements (2025-11-19): the backup notice keeps the “continue” CTA on the visual left with the backup link above it, navigation arrows now point toward the target step (back → right, continue → left), structure choice buttons use descriptive icons with right-aligned Hebrew labels, the CSV file picker disappears after selection (users return to the structure step to change it) with helper text mirrored for RTL, and column exclusion now uses an explicit “Do not include” checkbox (date columns default to hidden until unchecked).
  - Mobile dropdown stability (2025-11-20): All Select dropdowns inside the legacy import dialog render with `modal={true}` so taps outside an open list close only the dropdown, not the surrounding Dialog, on real mobile devices.
  - Wizard polish (2025-11-21): refined spacing and alignment across all steps, added an in-place “Remove file” control to clear or replace the uploaded CSV without closing the dialog, and expanded the preview step with an explicit session-date translation table so admins can confirm how the chosen date column is interpreted.
  - Wizard layout fixes (2025-11-22): unified white card backgrounds across every step, stacked the session-date selector above service assignment for clearer grouping, added outlined/colored states to selection buttons (including refresh/remove actions) to make the active choice obvious, tightened date column widths in the preview, and improved date parsing to recognize single-digit day/month inputs.
  - Mobile preview cards (2025-11-24): the preview step now shows two example rows as stacked cards on small screens for easier reading, while keeping the full table on tablets/desktops.
- **Legacy import backend (`POST /api/students/{id}/legacy-import`):** Admin/Owner-only endpoint that checks `can_reupload_legacy_reports` before allowing replacements. When uploads are permitted it purges prior `is_legacy` rows for the student, then ingests the submitted CSV (expects JSON body with `csv_text`, `structure_choice`, `session_date_column`, and either `column_mappings` or `custom_labels`) and writes new `SessionRecords` rows flagged with `is_legacy=true`. Requests may also include either `service_strategy=fixed` with `service_context_value` or `service_strategy=column` with `service_context_column` to populate `service_context` (blank values remain unset).
- **Legacy import attribution:** Imported rows mirror standard session metadata. `metadata` records `created_by`, `created_role`, `form_version`, and `source='legacy_import'`, and each row sets `instructor_id` from the student's assigned instructor. Uploads fail with `student_missing_instructor` when no assignment exists.
- **Legacy display logic:** Session renders now check `is_legacy` for every record. Non-legacy rows resolve question labels from the active `session_form_config` (including versioned lookups), while legacy rows display the raw column keys provided in the import. The shared renderer covers the student profile history, dashboard day detail views, and PDF export.
- **Legacy date parsing:** The importer normalizes common CSV date inputs to ISO, supporting `YYYY-MM-DD`, `DD/MM/YYYY`, `DD.MM.YYYY`, and Excel serial date numbers before writes.

> **Schema guardrails:** `/api/settings` now inspects `tuttiud.setup_assistant_diagnostics()` whenever Supabase reports missing tables or insufficient permissions. Schema or policy gaps surface as HTTP 424 with `settings_schema_incomplete` / `settings_schema_unverified` and include the failing diagnostic rows so admins can rerun the setup script before retrying.

All endpoints expect the tenant identifier (`org_id`) in the request body or query string. Authentication is enforced with the Supabase JWT provided by the desktop/web client, and every handler builds the tenant Supabase client through `api/_shared/org-bff.js` to reuse encryption, membership, and error handling routines.

### 7.2 Invitation onboarding flow (2025-11 update)

1. **Azure Function invite (`POST /api/invitations`)** – Admins trigger an invite email that embeds the Supabase `token_hash` and the control-plane `invitation_token` inside the redirect URL.
   - The handler now blocks invitations when the email already belongs to an active `org_memberships` row for the same organization, returning HTTP 409 with the `user already a member` message so the UI can surface a precise error.
  - The handler now resolves existing accounts by matching the normalized email against the `profiles` table and reuses the resulting `id` to verify whether an `org_memberships` row already exists for the same organization.
   - If the Supabase admin client finds an existing auth user for the requested email, the function still creates the control-plane invitation but skips `inviteUserByEmail`, returning `{ userExists: true }` so the UI can confirm the member may sign in immediately.
   - Invitation rows are written to `org_invitations` only after Supabase confirms the invite email was sent. When an account already exists (no email dispatch), the row is created immediately so the member can accept without waiting for a new message.
2. **Manual confirmation (`CompleteRegistrationPage.jsx`)** – When invitees open the email link the SPA loads `/complete-registration`, fetches the control-plane invitation by token, shows the target email in a read-only field, and collects the desired password plus confirmation in the same view. Submitting the form verifies the Supabase invite (`verifyOtp`) and immediately updates the password (`auth.updateUser`) in one step, enforcing the 6-character minimum and surfacing inline errors for expired/used tokens or password validation failures.
3. **State-aware acceptance (`AcceptInvitePage.jsx`)** – Successful verification redirects to `/accept-invite?invitation_token=…`. The page requires an active Supabase session; unauthenticated visitors are redirected to `/login` with the invitation token preserved.
4. **Status-driven UI** – The acceptance page fetches `/api/invitations/token/:token` which now returns `{ status: 'pending' | 'accepted' | 'revoked' | 'declined' | 'expired' | 'failed', ... }`. The UI renders:
   - `pending`: accept/decline buttons with mismatch handling and API-backed actions.
   - `accepted`: success message + “Go to dashboard” shortcut.
   - Any other status: non-blocking info panel explaining that the link is no longer valid.
5. **Email guardrails** – If the logged-in Supabase account email does not match the invitation email the page blocks actions and offers a “Sign out and switch accounts” CTA.
6. **Org selection context (`GET /api/user-context`)** – After authentication the `OrgProvider` calls the new endpoint to retrieve both accepted memberships and pending invitations with organization names, avoiding client-side RLS denials that previously produced “ארגון ללא שם”.

- **Team member management (`OrgMembersCard.jsx`)** – Admins and owners can edit a member’s full name directly from the Team Members card. Saving the change patches `/api/org-memberships/{membershipId}` with `fullName`, which updates both the `profiles.full_name` column and the Supabase Auth user metadata (`full_name`, `fullName`, `name`) so the refreshed display name appears across the control plane and future sessions.

### 7.3 User Story Mapping

| User Story | Implementation Notes |
| :--------- | :------------------- |
| **Instructor creates & manages session records** | `/api/sessions` writes into `SessionRecords` after verifying (for members) that the student belongs to them. Future endpoints can extend to edit/delete using the same helper. |
| **Instructor sees only assigned students** | `/api/students-list` automatically scopes the roster by `assigned_instructor_id = caller.id` for non-admin users, so instructors never receive other students even before frontend filtering. |
| **Administrator manages roster & assignments** | `/api/students-list` (POST/PUT) plus `/api/instructors` give admins the CRUD surface to create students and assign them to instructors. |
| **Administrator views full roster + instructor pairing** | `/api/students-list` (GET) returns the entire roster and includes assignments, allowing the admin UI to render organization-wide dashboards. |

## 8. Developer Notes

- Keep `SETUP_SQL_SCRIPT` as the single source of truth; import it anywhere the script must be displayed (wizard, docs, etc.).
- The setup script now includes `Students.is_active boolean default true` (with backfill) to support inactive lifecycle flows; rerunning it on legacy tenants is safe because every `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` stays idempotent.
- SessionRecords now allows `student_id` to be NULL to support unassigned ("loose") session reports. Loose writes must add `metadata.unassigned_details` without overwriting existing metadata keys, and downstream queries/endpoints must tolerate NULL student_ids.
- `verifyOrgConnection` (`src/runtime/verification.js`) now expects a Supabase data client and returns the diagnostics array so callers can render pass/fail status.
- All onboarding status updates should call `recordVerification(orgId, timestamp)` to persist `setup_completed` / `verified_at` on the control-plane organization row.
- `api/_shared/instructor-colors.js` exposes the permanent color bank and gradient fallback generator used to populate `metadata.instructor_color`. Call `ensureInstructorColors()` before returning instructor lists from new endpoints.
- `/api/weekly-compliance` aggregates default student schedules, cross-references `SessionRecords`, and returns the dynamic time window + legend consumed by the dashboard widget.
- Documentation must remain bilingual (see `ProjectDoc/Heb.md`) and the README should highlight the onboarding checklist for quick reference.
- OAuth flows call `supabase.auth.signInWithOAuth` with `options.redirectTo`, resolving to the full browser URL (`origin + pathname + search + hash`) when `window.location` is available or falling back to `VITE_PUBLIC_APP_URL`/`VITE_APP_BASE_URL`/`VITE_SITE_URL` so each shell returns users to the exact page that initiated the Tuttiud login after third-party authentication.
- `bootstrapSupabaseCallback()` (`src/auth/bootstrapSupabaseCallback.js`) executes before `<HashRouter>` mounts, shifting Supabase callback parameters into the `#/login/?…` hash format and caching the payload in `sessionStorage` so the login screen always loads instead of the marketing page.
- `src/pages/Login.jsx` reads the stored payload (or hash query), surfaces friendly Hebrew error messages, clears loading states, and normalizes the browser URL to the canonical `#/login/?…` pattern without Supabase-specific parameters.
- `resolveRedirectUrl()` in `src/auth/AuthContext.jsx` strips Supabase callback parameters, merges any remaining query values, and always returns a hash-first `#/login/` redirect when callbacks are present so failed attempts do not pollute future OAuth requests.
- **Manual QA checklist – OAuth callbacks**: simulate a Supabase redirect with only `code` and confirm the login screen loads without an error banner; repeat with `error=access_denied` to verify the translated alert appears and the URL normalizes to `#/login/?error=access_denied` before retrying.
- `AuthLayout` (`src/components/layouts/AuthLayout.jsx`) standardizes the visual shell for every auth flow (login, password reset, registration completion) by applying the TutTiud background, linked logo header, and centered card container. Each page renders only its specific form content inside the shared wrapper.
- Password reset is a two-step Supabase Auth flow: `/Pages/ForgotPassword.jsx` calls `resetPasswordForEmail` with a redirect to `/#/update-password`, and `/Pages/UpdatePassword.jsx` verifies matching credentials before calling the new `updatePassword` helper exposed by `AuthContext`. Both views use the refreshed design system components and RTL-friendly alerts for loading, success, and error states.
- The login form surfaces Supabase authentication failures inline using the red error alert pattern so users immediately see when credentials are invalid.

## 9. Admin Student Management UI

- **Feature slice** – all admin-only UI now lives in `src/features/admin/`. Components scoped to this feature sit under `components/` while page-level containers are housed in `pages/`.
- **StudentManagementPage.jsx** – renders the `/admin/students` route. It reads the active organization from `OrgContext`, fetches `/api/students-list` on mount (defaulting to `status=active`), surfaces loading/error/empty states, and keeps an instructor map in memory for display. Dialog state is managed locally for add/edit flows, while a sessionStorage-persisted filter control toggles between Active/Inactive/All states and badges inactive rows inline.
- **DataMaintenanceModal.jsx** – available from the roster actions to download the maintenance CSV (`/api/students-maintenance-export`) covering all editable fields (UUID, national ID, phone, instructor, tags, schedule defaults, notes, activity) and re-import edited CSVs (`/api/students-maintenance-import`). The importer updates only changed fields, enforces national ID uniqueness per row and against the database, reports per-row failures, and refreshes the roster + instructor list.
- **AddStudentForm.jsx** – collects contact details, scheduling defaults, tag selection, and free-form notes; enforces client-side validation, and raises `onSubmit` with trimmed values so notes persist through `/api/students-list`. The form is rendered inside a dialog launched from the Student Management page.
- **AssignInstructorModal.jsx** – opens from each roster row, requests `/api/instructors` when displayed, and submits the chosen instructor through `PUT /api/students-list/{id}`. It blocks dismissals while saving and emits `onAssigned` so the page can refresh the roster.
- **EditStudentForm.jsx** – exposes an Active/Inactive toggle guarded with confirmation copy, and lets admins update the same contact, scheduling, tag, and notes fields while ensuring the trimmed notes propagate to the API.
- **Roster deep links** – student names now link to `/students/:id`, sending admins directly into the dedicated detail page without leaving the management workflow.
- **App shell & routing** – `src/main.jsx` redirects `/Employees` to `/admin/students` and wraps authenticated routes with `src/components/layout/AppShell.jsx`. The shell renders a bottom tab bar + FAB on mobile and a left sidebar on desktop while keeping the student management view front and center.

## 10. Instructor "My Students" Dashboard

- **Feature slice** – the instructor experience now lives under `src/features/instructor/`. Shared-only components stay in
  `components/`, while the `MyStudentsPage.jsx` container resides in `pages/` and wires the full view state.
- **Page layout & routing** – `MyStudentsPage.jsx` composes the shared `PageLayout` shell, calls `GET /api/my-students` once the
  organization connection is ready, and renders loading, error, and empty states. Successful fetches map each student to a
  `Card` showing their name and contact details, including an inactive badge when the organization allows visibility.
- **Lifecycle-aware filtering** – Instructor rosters hide inactive students by default. When the organization enables visibility,
  the page surfaces the same Active / Inactive / All selector used by admins while keeping Active as the default.
- **Drill-down access** – each card includes a "צפייה בפרטי התלמיד" link to `/students/:id`, giving instructors a one-click path into the shared detail page while keeping the roster lightweight.
- **Navigation updates** – `AppShell.jsx` derives the Students destination from the member role so admins/owners keep
  `/admin/students` while instructors are routed to `/my-students`. The router (`src/main.jsx`) exposes the `/my-students`
  path so instructors land on their filtered roster.

## 11. Focused Navigation Dashboard

- **ComplianceHeatmap** – `src/features/dashboard/components/ComplianceHeatmap.jsx` now behaves as an integrated drill-down.
  The widget still consumes `/api/weekly-compliance`, paints the hour-by-day heatmap, and exposes `SessionListDrawer` per cell,
  but it also tracks an internal view state so "תצוגה מפורטת" swaps the content into an inline day timeline instead of opening a
  modal. Desktop users default to the full weekly board, while sub-1015px screens render a single-day heatmap with a date
  picker. When the detail view is active the component fetches `/api/daily-compliance`, shows loading/error/empty states inline,
  and lets admins and instructors review the instructor-colored session list without leaving the dashboard. Both compliance
  endpoints continue enforcing role-based filtering on the backend so members only receive their assigned students.
- **SessionCardList** – `src/features/dashboard/components/SessionCardList.jsx` renders the reusable vertical timeline that both
  the inline day view and `SessionListDrawer` rely on. It groups sessions by time slots, paints each card with the instructor’s
  palette, surfaces ✔/✖/• status icons, and keeps the "פתח" / "תעד עכשיו" actions wired into the rest of the dashboard. Reusing
  this component keeps the design language and action affordances identical whether the user opens the drawer or drills down
  inline.
- **Dashboard actions** – `DashboardPage.jsx` still greets the user and surfaces the quick cards for “My Students” / “All Students”
  and “New Session Record”. The compliance widget now renders beneath those quick actions once the tenant connection is available;
  until then a placeholder card explains why the grid is hidden.
- **Navigation glue** – the `AppShell` "ראשי" link continues pointing to `/`, and `/Dashboard` redirects to the landing page so
  the enhanced home experience remains the default after login. Auth redirects (login, org selection, invite acceptance) still
  converge on `/`, and the disabled "דוחות" item keeps its roadmap tooltip.

## 12. Design System Foundations (Mobile-First UI Kit)

- **Tailwind configuration** – `tailwind.config.js` now defines a Nunito-based typography stack, a calm violet primary palette (`primary`), accessible neutral grays (`neutral`), and dedicated status colors for success, warning, and error states. The spacing scale introduces tokens (`2xs` → `3xl`) sized for generous touch targets and breathing room on small screens.
- **UI primitives** – Generic components for the new design live in [`src/components/ui/Button.jsx`](../src/components/ui/Button.jsx), [`Card.jsx`](../src/components/ui/Card.jsx), [`Input.jsx`](../src/components/ui/Input.jsx), and [`PageLayout.jsx`](../src/components/ui/PageLayout.jsx). Use them when building new flows to guarantee consistent padding, typography, and contrast across mobile and desktop breakpoints.
- **Progressive adoption** – Existing pages remain unchanged for now. Future tickets will migrate feature screens to the new layout by composing these primitives.

## 13. Student Detail & Session Registration Flow

- **StudentDetailPage.jsx** – new route `/students/:id` shared by admins and instructors. It fetches the selected student via the appropriate roster endpoint (forcing `status=all` so inactive records stay reachable), renders contact + scheduling defaults, flags inactive students with a banner, and displays session history with graceful fallbacks when the history endpoint is not yet available.
- **Session history rendering** – the page loads `session_form_config` through `/api/settings?keys=session_form_config`, normalizes questions with `parseSessionFormConfig`, and maps stored JSON answers back to their Hebrew labels. A 404 from the forthcoming `/api/session-records` endpoint is treated as “no sessions recorded” so UI scaffolding is testable today.
- **SessionModalContext.jsx** – provided by `AppShell.jsx`, exposing `openSessionModal({ studentId, onCreated })` to any routed page. It keeps modal state in a single location so the FAB, desktop CTA, and Student Detail page all share the same creation flow.
- **NewSessionModal.jsx** – orchestrates data dependencies: loads the student roster (admin vs. instructor scope) while honoring the inactive visibility setting, fetches `session_form_config`, and surfaces loading/error states. On submit it posts to `/api/sessions` with `{ student_id, date, service_context, content }` and triggers any supplied `onCreated` callback before closing.
- **NewSessionForm.jsx** – Hebrew UI for the session questionnaire. It pre-selects the active student when invoked from the detail page, shows each student’s default day/time beside their name, pre-fills the service field, mirrors the Active / Inactive filter so dropdowns stay focused on current students, and collects answers for every configured question (text, textarea, select, radio/button groups, numeric fields, and range scales). The session date input now renders blank by default, requiring instructors to actively choose the correct day, and the form leverages native validation so the "Save session" button remains disabled until the date and all other required fields are valid. Empty responses are stripped before sending the payload.
- **Shared utilities** – `src/features/students/utils/schedule.js` centralizes day/time formatting, `src/features/students/utils/endpoints.js` standardizes roster endpoint selection, and `src/features/sessions/utils/form-config.js` parses question configs so both the modal and detail view stay in sync.
- **Student tags catalog** – tenant-wide tag definitions now live in the `tuttiud."Settings"` row keyed by `student_tags`. The Azure Functions endpoint `GET /api/settings/student-tags` returns the normalized catalog for any member of the active organization, while `POST /api/settings/student-tags` (admin/owner only) appends a `{ id, name }` entry with a generated UUID. Front-end consumers use `useStudentTags()` (`src/features/students/hooks/useStudentTags.js`) to load the catalog and `StudentTagsField.jsx` to render the select + modal combo inside both add/edit student forms. Each student stores an array of tag UUIDs in the `Students.tags` column (`uuid[]` type). To migrate legacy tenants run:
  ```sql
  ALTER TABLE tuttiud."Students"
    ALTER COLUMN tags TYPE uuid[]
    USING CASE
      WHEN tags IS NULL THEN NULL
      ELSE ARRAY(
        SELECT value::uuid
        FROM unnest(tags) AS value
      )
    END;
  ```
  The student detail page resolves tag IDs against the catalog and displays the names as badges. When the catalog entry is missing the badge falls back to the raw UUID with an outline style so admins can reconcile stale data.

## 14. Session Form Management in Settings

- **Modernized Settings page** – `/Pages/Settings.jsx` now focuses on diagnostics, Supabase connectivity, invitations, and the new session form manager. Legacy leave policy, holiday, and employment scope panels were removed to keep the page scoped to Tuttiud’s current feature set.
- **Role-based access** – only administrators and organization owners render the management surface. Members/instructors still see the debugging card but no longer receive any administrative controls.
- **SessionFormManager.jsx** – located at `src/components/settings/SessionFormManager.jsx`, this card loads the existing `session_form_config`, lists all questions, and lets admins add, edit, reorder, or delete entries before saving. Each question tracks `id`, `label`, `type`, `placeholder`, `required`, `options`, and (for range scales) numeric bounds. A dedicated “Save changes” button persists updates via `upsertSetting`, while inline validation prevents duplicate IDs, missing labels, or invalid option/range data.
- **Improved parsing utilities** – `parseSessionFormConfig` now preserves `required`, `options`, and `range` metadata so runtime consumers (session modal/detail views) can render richer controls while staying backward compatible with minimal configs.
- **Option persistence** – Server-side normalization (`api/settings/index.js`) now keeps option objects with their `value`, `label`, and optional `id` fields when saving configurations, preventing `[object Object]` strings and ensuring the SessionFormManager reloads distinct labels/values exactly as entered.
- **Session capture parity** – `NewSessionForm.jsx` honors the expanded question types, rendering selects, radio/button groups, numeric/date inputs, and sliders alongside the existing text areas. Required fields are enforced client-side and the payload continues to trim empty responses before submission.

## 15. Admin Tools

### Backup Verification Script

A Node.js script is provided for super admins/system administrators to verify backup file integrity and decryptability:

- **Location:** `test/verify-backup.cjs`
- **Usage:**
  ```
  node test/verify-backup.cjs <backup-file-path> <password>
  ```
- **Features:**
  - Loads and decrypts a backup file using the provided password
  - Prints manifest summary if successful
  - Prints error if file is invalid or password is incorrect

This tool is essential for validating backups before restore or for compliance checks.

## 16. Organization Setting: Instructor Visibility for Inactive Students

- **Setting key** – `instructors_can_view_inactive_students` lives in the tenant `tuttiud."Settings"` row and defaults to `false` so instructors never see inactive roster entries unless an admin opts in.
- **Settings UI** – `StudentVisibilitySettings.jsx` adds a dedicated card (eye-off icon) to `Settings.jsx`. Admins/owners can review the current value, read the guard copy, and toggle the permission through `upsertSetting` while instructors only see the status if they have manage rights.
- **API integration** – `/api/students-list` checks the setting server-side and only includes inactive rows when the flag is enabled or the caller holds admin privileges. Query parameters (`status=active|inactive|all`) apply to all user roles with a unified filtering model.
- **Frontend consumers** – `MyStudentsPage.jsx`, `NewSessionModal.jsx`, and `NewSessionForm.jsx` load the setting via `fetchSettingsValue` and adjust local filters + UI affordances accordingly. The preference for showing inactive students in admin lists persists per tab via `sessionStorage`.

## 17. Legacy Import Wizard UI polish (2025-12)

- **Better alignment** – The mapping step stacks the full-width session date card above the service assignment card so both use the available width without cramped headers.
- **Button readability** – Selected structure/service buttons use a purple highlight with an outline that matches the New Session design, and utility actions such as “remove file”/“refresh” now use a clear outlined treatment so they read as buttons.
- **Preview clarity** – The preview callout keeps a single heading (to avoid duplicate step titles), and the confirmation summary uses RTL-friendly arrows (←) to show column-to-field direction.
- **Mobile safety margin** – The dialog content now caps its height on small screens and adds safe-area padding so the wizard always floats above the bottom navigation/FAB even after selecting a file.
