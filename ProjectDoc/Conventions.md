# TutTiud Repository Conventions

**Version:** 1.0  
**Last Updated:** 2025-10-26

This document defines the folder structure, naming rules, API patterns, and feature organization conventions for the TutTiud codebase. Refer to this when adding new features, endpoints, or refactoring to ensure consistency and clarity.

---

## 1. Top-Level Layout and Intent

```
TutTiud-Refactored/
├── api/                     # Azure Functions grouped by feature; shared utilities under _shared/
│   ├── _shared/             # Shared server-side helpers (org-bff, supabase-admin, http)
│   ├── sessions/            # POST /api/sessions – session creation
│   ├── session-records/     # GET /api/session-records – session history
│   ├── students/            # GET/POST/PUT /api/students – student roster
│   ├── instructors/         # GET/POST/PUT/DELETE /api/instructors – instructor management
│   ├── settings/            # GET/POST /api/settings – tenant settings
│   └── ...
├── src/                     # Frontend app, organized by feature slices
│   ├── features/            # Feature-first code: components, pages, hooks, utils
│   │   ├── admin/           # Admin-only UI: pages, components
│   │   ├── sessions/        # Session creation modal, forms, utilities
│   │   ├── students/        # Student roster, detail pages, forms
│   │   └── ...
│   ├── components/
│   │   ├── ui/              # Reusable primitives: Button, Card, Input, etc.
│   │   ├── layout/          # AppShell, navigation components
│   │   └── ...
│   ├── pages/               # Top-level route components or shared pages
│   ├── context/             # React contexts (Supabase, Auth, Org)
│   ├── lib/                 # Shared utilities: api-client, setup-sql, leave logic
│   ├── hooks/               # Shared custom hooks
│   ├── org/                 # Org-switching logic, org selector
│   └── ...
├── ProjectDoc/              # Project documentation: Eng.md, Heb.md, Conventions.md
├── public/                  # Static assets, runtime config, SPA routing config
├── scripts/                 # Node scripts (e.g., checkSchema.js)
├── test/                    # Tests mirroring features and utilities
├── supabase/                # Supabase-specific functions or migrations
└── [config files]           # eslint.config.js, vite.config.mjs, tailwind.config.js, etc.
```

**Key Principles:**
- **Feature-first organization:** Group related code by feature (students, sessions, admin) under `src/features/` and `api/`.
- **Shared code:** Reusable UI primitives go in `src/components/ui/`; shared server logic in `api/_shared/`.
- **Avoid duplication:** Extract common patterns to shared helpers instead of copying across features.

---

## 2. Naming, Casing, and File Conventions

### Folders
- Use **kebab-case** for API routes and general directories: `session-records`, `work-sessions`.
- In `src/`, prefer **lowercase** folder names: `features`, `pages`, `lib`, `context`, `org`, `runtime`.
- Feature folders: `src/features/<feature>/` with lowercase names (e.g., `students`, `sessions`, `admin`).

### Files
- **React components:** PascalCase `.jsx` – `StudentDetailPage.jsx`, `NewSessionModal.jsx`, `Button.jsx`.
- **Hooks:** camelCase `.js` or `.jsx` – `useStudentRoster.js`, `useSessionModal.jsx`.
- **Utilities and helpers:** camelCase or kebab-case – `endpoints.js`, `form-config.js`, `api-client.js`.
- **Tests:** Mirror the file being tested with `.test.js` – `reports.test.js`, `time-entry.test.js`.

### Imports
- Always match **actual casing on disk** to avoid CI/build issues (e.g., `pages` vs `Pages`).
- When renaming for case only, use a two-step Git move or GitHub UI to ensure Git records the change correctly.

### Language and Style
- **ES modules** (`import`/`export`), **2-space indentation**.
- Follow **ESLint** rules defined in `eslint.config.js`.
- Keep components focused; extract reusable logic to hooks or utilities.

---

## 3. Frontend Feature-Slice Structure

Organize frontend code by feature to keep related logic together and improve maintainability.

### Feature Organization
```
src/features/<feature>/
  ├── components/      # Feature-specific components
  ├── pages/           # Full-page components for this feature
  ├── hooks/           # Custom hooks specific to this feature
  ├── utils/           # Helper functions and utilities
  └── context/         # Feature-specific contexts (if needed)
```

**Examples:**
- **Admin UI:** `src/features/admin/components/`, `src/features/admin/pages/`
- **Students:** `src/features/students/components/`, `src/features/students/pages/StudentDetailPage.jsx`
- **Sessions:** `src/features/sessions/components/NewSessionModal.jsx`, `src/features/sessions/utils/form-config.js`

### Shared UI Primitives
- Reusable components: `src/components/ui/{Button,Card,Input,PageLayout}.jsx`
- App shell and navigation: `src/components/layout/AppShell.jsx`
- Avoid duplicating primitives; extract to `ui/` or `layout/` when used across features.

### Session Entry Flow
- New session modal and form: `src/features/sessions/components/`
- Questions loaded from `settings.session_form_config.current.questions`
- Services suggestions from `settings.available_services` with free-typing via `input` + `datalist`

---

## 4. API Azure Functions by Feature

Each API route lives in its own folder under `api/` with an `index.js` handler and a `function.json` binding config.

### Route Structure
```
api/<route-base>/
  ├── index.js         # Handler function (export default async function)
  ├── function.json    # Route, methods, bindings
```

### Route Naming
- Use **plural-noun** and **kebab-case** for multi-word routes: `sessions`, `session-records`, `students`, `instructors`.
- Stick to one base route per feature; add subroutes via query params or a separate function only if responsibilities are distinct.

**Examples:**
- `POST /api/sessions` – Create a SessionRecords entry
- `GET /api/session-records?student_id=<uuid>` – Fetch session history for a student
- `GET /api/students-list` – Unified roster endpoint (role-based filtering; replaces legacy `/api/students` and `/api/my-students`)

### Shared Server Helpers
Located in `api/_shared/`:
- **org-bff.js:** Org membership checks, `org_id` resolution, tenant client creation, `respond`, `ensureMembership`, etc.
- **supabase-admin.js:** Control-plane Supabase client for auth and org lookups.
- **http.js:** Bearer token parsing (`resolveBearerAuthorization`).

### Security and Org Context
Every API must:
1. **Require a bearer token:** Return 401 if missing or invalid.
2. **Resolve `org_id`:** Use `resolveOrgId(req, body)` from org-bff helpers.
3. **Validate membership:** Call `ensureMembership(supabase, orgId, userId)` to get the user's role.
4. **Return specific message codes** in `snake_case` for the UI to map (see Error Messages section).

### Example Alignment
- **POST /api/sessions:** Insert `SessionRecords` row after membership and assignment checks.
- **GET /api/session-records:** Fetch `SessionRecords` by `student_id`; return 404 when none (members must be assigned to that student).

---

## 5. Error Messages and UI Mapping

### Server Error Codes
Prefer **validation errors (4xx)** with precise, machine-readable message codes:
- `student_not_assigned_to_user` – Member trying to access a student not assigned to them
- `student_missing_instructor` – Student has no assigned instructor, blocking session creation
- `invalid student id`, `invalid date`, `invalid service context` – Validation failures (human-friendly strings)
- `failed_to_verify_membership`, `failed_to_load_student`, `failed_to_load_sessions` – Internal 5xx issues

### UI Mapping
- Map known codes to friendly Hebrew messages (as done in `NewSessionModal.jsx`):
  ```javascript
  if (serverMessage === 'student_missing_instructor') {
    friendly = 'לא ניתן לתעד מפגש: לתלמיד זה לא משויך מדריך פעיל. נא לשייך מדריך תחילה.';
  }
  ```
- Avoid leaking raw DB errors; handle FK/constraint collisions by checking first and returning 4xx with a clear code.

---

## 6. Settings and Versioned Configuration

### Session Form Config
- **Key:** `session_form_config`
- **Structure:**
  ```json
  {
    "current": {
      "version": 2,
      "questions": [...]
    },
    "history": [
      { "version": 1, "questions": [...], "archived_at": "..." }
    ]
  }
  ```
- **When updating:**
  - Write new `current`; push previous `current` into `history` array with timestamp.
  - Frontend always reads `current.questions`; `history` is for admin UI and audits.

### Available Services
- **Key:** `available_services`
- **Type:** Array of strings
- **Usage:** Rendered as `datalist` suggestions in session form; allows free-typing.

---

## 7. Data Model Guidelines

### Instructors
- **Table:** `tuttiud."Instructors"`
- **Soft-disable:** Set `is_active = false`; never delete.
- **Admin UI:** Under Settings; GET defaults to active instructors only elsewhere.
- **Foreign keys:** `Instructors.id` references `auth.users.id` (same UUID).

### Students
- **Table:** `tuttiud."Students"`
- **Creation:** Must select an active instructor on create.
- **Assignment:** If assigned instructor is later disabled, show warning and allow reassignment (quick action).

### Sessions
- **Table:** `tuttiud."SessionRecords"`
- **Insert fields:**
  - `student_id` (required, FK to Students)
  - `date` (required, date format YYYY-MM-DD)
  - `content` (JSON of answers)
  - `service_context` (optional text)
  - `instructor_id` (FK to Instructors)
  - `is_legacy` (boolean, defaults to false; marks imported historical records)
- **Instructor resolution:**
  - **Members:** Must be the student's assigned instructor.
  - **Admins/owners:** Prefer student's assigned instructor; fallback to acting user only if they're a valid Instructor in this tenant. Otherwise, return `student_missing_instructor`.
- **History:** Return 404 when a student has no records (UI shows empty state).

---

## 8. Build, Lint, and Schema Checks

### Pre-Commit Checks
- **Lint:** Run `npx eslint <changed-files>` or use VS Code lint tasks.
- **Build:** Run `npm run build` before pushing to ensure no syntax/import errors.
- **Schema:** Run `npm run check:schema` before adding new persistence logic. If it reports missing columns/tables, add a checklist note to the PR—don't code around the gap.

### Testing
- No `npm test` script is configured per AGENTS.md.
- Tests live under `test/` and are executed in CI as configured.
- When adding features, consider adding test coverage for complex logic (e.g., `reports.test.js`, `time-entry.test.js`).

---

## 9. Routing and Auth Specifics

### App Shell
- Use `src/components/layout/AppShell.jsx` to wrap routes.
- Provides mobile bottom tabs + FAB and desktop sidebar.
- Session modal context is provided by AppShell.

### OAuth Redirects
- **Must always pass `options.redirectTo`** when calling `supabase.auth.signInWithOAuth`.
- Resolve from full `window.location` URL (`origin + pathname + search + hash`).
- Fallback: `VITE_PUBLIC_APP_URL`, `VITE_APP_BASE_URL`, or `VITE_SITE_URL`.

### Password Reset Flow
- **Endpoint:** `supabase.auth.resetPasswordForEmail` with redirect landing on `/#/update-password`.
- **Update form:** Relies on `AuthContext.updatePassword` so Supabase finalizes session before returning users to dashboard.

### Login Form
- **Error handling:** Set inline error state when Supabase rejects credentials; render design system's red alert with failure message.

---

## 10. Checklists

### Adding a New Frontend Feature
- [ ] Create `src/features/<feature>/{components,pages,hooks,utils}`
- [ ] Reuse primitives from `src/components/ui`
- [ ] Wire to AppShell routes if needed
- [ ] Add i18n strings or UI copy as needed
- [ ] Lint changed files: `npx eslint <files>`

### Adding a New API Route
- [ ] Create `api/<route-base>/{index.js,function.json}`
- [ ] Use org-bff helpers for `org_id`, membership, and responses
- [ ] Validate inputs and return precise message codes (snake_case)
- [ ] Write tests or a minimal manual verification note
- [ ] Ensure route naming matches feature (plural-noun, kebab-case)

### Changing Settings-Backed Forms
- [ ] Update `session_form_config.current` and append prior `current` to `history`
- [ ] Keep frontend reading from `current.questions`
- [ ] Test form rendering and submission with new schema

### Refactoring or Renaming
- [ ] Match casing on disk exactly in imports
- [ ] Use two-step Git move for case-only renames or GitHub UI
- [ ] Update all references to renamed files/folders
- [ ] Run build and lint to verify

---

## 11. References

- **Main engineering docs:** [Eng.md](./Eng.md), [Heb.md](./Heb.md)
- **Agent instructions:** [AGENTS.md](../AGENTS.md)
- **Schema setup script:** [src/lib/setup-sql.js](../src/lib/setup-sql.js)

When this document or Eng.md/Heb.md are updated, keep them in sync and update the **Last Updated** date.

---

**End of Conventions.md**
