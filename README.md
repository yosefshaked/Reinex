# Tuttiud Student Support Platform

Tuttiud is a Vite + React application for managing instructors, students, and instructional session records. Supabase provides tenant data storage while Azure Functions guard every privileged operation.

## 🚀 MVP priorities

The refactored codebase focuses on four launch stories:

1. **Instructor session logging** – members create and update `SessionRecords` for their assigned students.
2. **Instructor dashboard** – members only see students where `assigned_instructor_id` matches their profile.
3. **Administrator control actions** – admins back up tenant data, create students, and map students → instructors.
4. **Administrator roster visibility** – admins can review the full student list with instructor assignments.

## 🧭 Onboarding checklist

The onboarding wizard (`Settings → Supabase Setup`) leads every new organization through three steps:

1. **Run the canonical SQL** – copy the script exported from [`src/lib/setup-sql.js`](src/lib/setup-sql.js) into the Supabase SQL editor and execute it. Version 2.4 adds the `metadata` jsonb column to the `Settings` table for auxiliary configuration storage; version 2.5 adds `SessionRecords.is_legacy` (boolean, default `false`) and registers the `can_reupload_legacy_reports` permission in the control-plane registry for future legacy import flows. The latest script also adds `Students.intake_responses`, `Students.needs_intake_approval`, and settings keys for the Intake Bridge (`intake_field_mapping`, `intake_important_fields`, `intake_display_labels`, `external_intake_secret`).
2. **Paste the dedicated key** – grab the `APP_DEDICATED_KEY` JWT produced by the script and drop it into the wizard.
3. **Validate & store** – the wizard runs `tuttiud.setup_assistant_diagnostics()` (schema/RLS/policy/index checks), encrypts the JWT through `/api/save-org-credentials`, and the API now persists `dedicated_key_saved_at`, `verified_at`, and `setup_completed` before the UI records verification and unlocks the rest of the app.
   - If the diagnostics still flag missing tables or policies, `/api/settings` answers with HTTP 424 (`settings_schema_incomplete` / `settings_schema_unverified`) and echoes the failing checks so admins can rerun the SQL script before retrying writes.

All states (loading, error, success) are surfaced inline with accessible messages (`aria-live`). The wizard can be reopened at any time to re-run diagnostics or rotate the key.

## 🔑 Key UI behavior

- **Supabase Setup Assistant** (`src/components/settings/SetupAssistant.jsx`) is the single entry point for onboarding. It owns the SQL copy helpers, JWT capture, and validation flow.
- **App shell** (`src/components/layout/AppShell.jsx`) delivers the mobile-first navigation: a bottom tab bar with a central session FAB on phones and a desktop sidebar for wider screens.
- **Dashboard landing page** (`src/pages/DashboardPage.jsx`) greets authenticated users, surfaces the Weekly Compliance widget once the tenant database is reachable, and keeps quick links to `/my-students` (or `/admin/students`) alongside the session logging shortcut.
- **Intake Review Queue** (`src/features/dashboard/components/IntakeReviewQueue.jsx`) renders a half-page scorecard-style summary for students flagged with `needs_intake_approval`, with big-number tiles for new (unassigned) and existing (assigned) students. Clicking each tile (or the "פתח תור" action) opens the queue in a modal with the appropriate filter applied, while loading/error/empty states remain visible with retry support. Admins can assign an instructor and update contact details/notes from the modal so the assigned instructor can approve the intake via `/api/intake/approve` after confirming the agreement, can dismiss accidental intake submissions via `/api/intake/dismiss`, and restore dismissed intakes via `/api/intake/restore`. Admins can still filter by instructor/unassigned while seeing a streamlined single-row identity summary, and the "assigned to me" shortcut is reserved for admins who are also instructors.
- Intake notes for instructors are stored in `Students.metadata.intake_notes` so the main student `notes` remain reserved for student-level context.
- **Student Intake Card** (`src/features/students/components/StudentIntakeCard.jsx`) keeps intake details collapsed by default on the student profile, shows parsed intake key/value pairs, and renders the stored HTML summary on demand.
- **ComplianceHeatmap** (`src/features/dashboard/components/ComplianceHeatmap.jsx`) draws the compliance board using `/api/weekly-compliance`, keeps the SessionListDrawer drill-down per cell, and now behaves as a two-state widget. Desktop users see the full weekly heatmap by default, while screens below 1015px switch to a single-day focus with a date picker. Pressing "תצוגה מפורטת" swaps the widget into the inline day view, fetches `/api/daily-compliance`, and keeps the drill-down embedded in the dashboard instead of opening a modal.
- **SessionCardList** (`src/features/dashboard/components/SessionCardList.jsx`) renders the instructor-colored, time-grouped session chips with ✔/✖ status icons plus "פתח" / "תעד עכשיו" actions. Both the inline Day Detail view and the legacy SessionListDrawer reuse this component so status handling, timeline grouping, and button layouts stay consistent across contexts.
- **Instructor color palette** – `api/_shared/instructor-colors.js` maintains a 20-color bank with deterministic gradient fallbacks. Both `/api/instructors` and `/api/weekly-compliance` call `ensureInstructorColors()` so every instructor persists a unique `metadata.instructor_color`.
- **Admin Student Management** (`src/features/admin/pages/StudentManagementPage.jsx`) is the new mobile-first roster experience. It fetches `/api/students-list` on load, renders loading/error/empty states, opens `AddStudentForm` for creation, and drives instructor assignment through `AssignInstructorModal`.
- **Intake settings** (`src/components/settings/IntakeSettingsCard.jsx`) lets admins map Microsoft Forms question text (as it appears in the HTML summary) to the system fields and rotate the `external_intake_secret` that authenticates `/api/intake` calls.
- **Data Maintenance CSV** – the roster actions now surface a modal that downloads a maintenance CSV (`/api/students-maintenance-export`) with all editable fields (UUID, national ID, phone, instructor, tags, schedule defaults, notes, activity) and imports edited files (`/api/students-maintenance-import`) with per-row validation and conflict reporting.
- **Student deduplication safeguards** add real-time national ID blocking (`/api/students-check-id`) with profile shortcuts plus soft name suggestions from `/api/students-search`. The roster now highlights missing national IDs with a red badge to prioritize cleanup.
- **Instructor My Students** (`src/features/instructor/pages/MyStudentsPage.jsx`) presents members with only their assigned students. It composes `PageLayout`, loads `/api/my-students`, and surfaces loading, error, and empty cards before rendering each student inside a `Card` with name and contact details.
- **Password reset experience** (`src/pages/ForgotPassword.jsx` and `src/pages/UpdatePassword.jsx`) delivers the full Supabase Auth recovery flow. The request page sends `resetPasswordForEmail` links that target `/#/update-password`, and the update page verifies matching passwords before calling `AuthContext.updatePassword` and redirecting to the dashboard with success feedback.
- **Login feedback** (`src/pages/Login.jsx`) now surfaces Supabase authentication errors inline with the design system's error alert so users immediately understand when credentials are invalid.
- **Invitation confirmation** (`src/components/pages/CompleteRegistrationPage.jsx` & `AcceptInvitePage.jsx`) now asks invitees to explicitly confirm the Supabase invite token before redirecting to a state-aware acceptance screen. The acceptance page requires an authenticated session, reloads invitation status (`pending`, `accepted`, `revoked`, etc.), and responds with contextual messaging (accept/decline actions, dashboard shortcut, or invalid-link notice).
- **Reports navigation state** – the "דוחות" link is intentionally disabled (with a tooltip) until reporting ships, preventing dead ends in the main navigation.
- **Feature-sliced admin components** live in `src/features/admin/components/`. Each component is scoped to the admin feature (forms, modals) while shared primitives stay in `src/components/ui`.
- **Org context** (`src/org/OrgContext.jsx`) stores the encrypted dedicated key timestamp (`dedicated_key_saved_at`) and still toggles `setup_completed` after verification, complementing the server-side persistence added to `/api/save-org-credentials`.
- **Runtime verification helpers** (`src/runtime/verification.js`) expose `verifyOrgConnection({ dataClient })` which runs `tuttiud.setup_assistant_diagnostics()` and returns the diagnostic rows for custom UI messaging.
- Feature modules (students, instructors, sessions) must load data exclusively through secure `/api/*` endpoints. The frontend never uses the dedicated JWT directly.
- **Legacy import workflow (Phase 2 UI):** Admin/Owner users see an "ייבוא דוחות היסטוריים" button on `StudentDetailPage`. The dialog enforces a backup warning, asks whether the CSV matches the current session questionnaire, and renders either dropdown-based mappings against `session_form_config` or custom text fields with a required session-date column. It now also captures the service context either once for all rows or via a dedicated service column in the CSV. If a legacy import already exists and `can_reupload_legacy_reports` is false, the entry point is disabled.
- **Legacy import backend:** `/api/students/{id}/legacy-import` is now available for admins/owners. It checks `can_reupload_legacy_reports`, clears prior `is_legacy` rows when allowed, and ingests CSV text (`csv_text` + mapping payload) to create new `SessionRecords` flagged as legacy. Imports can set `service_context` globally or map it from a CSV column; blank values are persisted as no service.
- **Legacy import attribution:** Imported rows mirror normal session metadata: `metadata` stores `created_by`, `created_role`, `form_version`, and `source='legacy_import'`, and `instructor_id` is sourced from the student's assigned instructor. Uploads fail with `student_missing_instructor` when no assignment exists.
- **Legacy display logic:** Session renderers now branch on `is_legacy`, mapping structured answers through `session_form_config` for standard records and using raw column names for legacy imports. This applies to the student profile history, dashboard day detail view, and PDF export.
- **Legacy date parsing:** The importer accepts common date formats (`YYYY-MM-DD`, `DD/MM/YYYY`, `DD.MM.YYYY`) and Excel serial date numbers, normalizing each to ISO before persisting.

## 🎨 Design system foundations

- **Tailwind base theme** – `tailwind.config.js` now centers on the Nunito font family, a calm violet primary color ramp, balanced neutral grays, and dedicated success/warning/error accents. The spacing scale introduces tokens from `2xs` to `3xl` so mobile layouts feel open and touch-friendly.
- **Reusable primitives** – New mobile-first components live in `src/components/ui/Button.jsx`, `Card.jsx`, `Input.jsx`, and `PageLayout.jsx`. Compose them when building fresh views to guarantee consistent padding, typography, and contrast.
- **Adoption plan** – Existing screens will migrate in future tasks. For now, these primitives provide the foundation for the upcoming redesign.

## 🔐 Secure API endpoints (MVP)

- `GET /api/instructors` – admin/owner list of instructor IDs + names derived from `org_memberships` and `profiles`.
- `GET /api/students-list` – unified endpoint for all users; admins see all students, non-admins filtered by `assigned_instructor_id`; supports status filtering (`active`/`inactive`/`all`). Dismissed intakes are always excluded.
- `POST /api/students-list` – admin/owner creation of student records with optional instructor assignment.
- `PUT /api/students-list/{studentId}` – admin/owner updates to student metadata (name, contact info, instructor, tags, notes).
- `POST /api/intake` – public intake endpoint for Power Automate; requires `x-org-id` + `x-intake-secret` headers, parses `html_content`, and writes intake history + approval flag.
- `POST /api/intake/approve` – instructor-only approval endpoint that clears `needs_intake_approval` and records `metadata.last_approval` with agreement metadata once the intake is assigned.
- `POST /api/intake/dismiss` – admin-only endpoint that removes an intake submission from the queue.
- `POST /api/intake/restore` – admin-only endpoint that restores a dismissed intake back into the queue.
- `GET /api/intake/dismissed` – admin-only endpoint that returns dismissed intakes for the intake queue.
- `POST /api/students-merge` – admin-only endpoint that merges a pending intake into an existing student with field-by-field selection, reattaches intake responses, deletes the source row, and stores a `metadata.merge_backup` snapshot.
- `GET /api/weekly-compliance` – member/admin/owner weekly aggregation including instructor colors, scheduled chips, documentation status, and a dynamic hour range for the dashboard widget.
- `POST /api/sessions` – member/admin/owner insertion of `SessionRecords` with assignment verification for members.
- `GET /api/user-context` – authenticated fetch that returns the caller's organization memberships and pending invitations (with organization names) via the Supabase admin client so invitees bypass RLS limitations.

## 📚 Documentation

- English & Hebrew project docs live in [`ProjectDoc/Eng.md`](ProjectDoc/Eng.md) and [`ProjectDoc/Heb.md`](ProjectDoc/Heb.md). Update both together.
- Intake dashboard UX notes are additionally tracked in [`ProjectDocs/Eng.md`](ProjectDocs/Eng.md) and [`ProjectDocs/Heb.md`](ProjectDocs/Heb.md).
- Any onboarding or AI-related insights belong in [`AGENTS.md`](AGENTS.md).
- Legacy import progress is tracked in [`FEATURE_PROGRESS.md`](FEATURE_PROGRESS.md) at the project root.

## 🛠 Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `api/local.settings.json` with Supabase control credentials (URL, anon key, service role, and encryption key for `/api/save-org-credentials`).
3. Start Vite:
   ```bash
   npm run dev
   ```
4. In another terminal launch the Azure Static Web Apps emulator so `/api/config` and the secure proxies are available:
   ```bash
   swa start http://localhost:5173 --api-location api
   ```

## 🏗 Building for Azure Static Web Apps

```bash
npm run build
```

The command emits static assets into `dist/`. Configure Azure Static Web Apps with `app_location: "/"`, `output_location: "dist"`, `api_location: "api"`, and `npm run build` as the build command.

## ⚙️ Runtime configuration

At bootstrap the SPA calls `GET /api/config`. Without credentials the function returns the shared Supabase URL and anon key defined by `APP_SUPABASE_URL` / `APP_SUPABASE_ANON_KEY`.

After login the client requests `GET /api/org/<org-id>/keys` with `X-Supabase-Authorization: Bearer <supabase_access_token>`. The API verifies membership, returns the tenant Supabase URL + anon key, and the frontend instantiates an isolated data client. All writes continue to flow through the server-side proxies.

Visit `/#/diagnostics` during development to inspect the last runtime configuration payload. Sensitive values are masked except for the last four characters.

## 🧪 Guardrails

- Reuse the client helpers from `src/lib/supabase-manager.js` – do not instantiate Supabase clients manually inside components.
- Normalize thrown errors with `asError` (`src/lib/error-utils.js`).
- Run the following before committing changes that touch Supabase flows:
  ```bash
  npm run build
  node --test
  ```

## ❤️ Health check

`/api/healthcheck` responds with `{ "ok": true }` and can be used for deployment probes.
