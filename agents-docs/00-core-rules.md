# 00 Core Rules

## When to read
- Start of any task.
- Any work that touches tenant access, instructors, invitations, Azure Functions, or services.

## Load these files first
- [`../AGENTS.md`](../AGENTS.md)
- [`../api/_shared/org-bff.js`](../api/_shared/org-bff.js)
- [`../api/_shared/http.js`](../api/_shared/http.js)
- [`../api/instructors/index.js`](../api/instructors/index.js)
- [`../api/services/index.js`](../api/services/index.js)
- [`../src/components/settings/employee-management/DirectoryView.jsx`](../src/components/settings/employee-management/DirectoryView.jsx)
- [`../src/components/settings/employee-management/InviteUserDialog.jsx`](../src/components/settings/employee-management/InviteUserDialog.jsx)

## Architecture: Single-Database Multi-Tenant
- All tenant tables live in one Supabase project. Every tenant table has `org_id uuid NOT NULL REFERENCES organizations(id)`.
- RLS is the primary isolation layer (policies use `get_active_org_id()` SECURITY DEFINER function that reads `x-org-id` from request headers and verifies `org_memberships`).
- The backend uses the `service_role` key (bypasses RLS). Org isolation is enforced programmatically — every query must filter by `org_id`.
- **Never** reintroduce per-org database credentials (`dedicated_key`, `supabase_url` on orgs), BYOD patterns, `resolveTenantClient()`, or `org_settings` table — all are deprecated and removed.
- Schema SSOT: `src/lib/setup-sql.js`.

## Shared helpers to reuse
- `respond`, `readEnv`, `ensureMembership`, `resolveOrgId`, `createSingleClient`, `withOrgScope` in [`../api/_shared/org-bff.js`](../api/_shared/org-bff.js)
- `resolveBearerAuthorization` in [`../api/_shared/http.js`](../api/_shared/http.js)
- `createDashboardTask` (idempotent), `listDashboardTasks`, `resolveDashboardTask` in [`../api/_shared/dashboard-tasks.js`](../api/_shared/dashboard-tasks.js)

## Known patterns / do not reinvent
- All tenant data is in the shared Supabase project; tenant schema is `public`.
- API route names are domain-based; do not add `reinex` to route paths.
- Instructors are self-scoped unless membership role is `admin` or `owner`.
- Current instructor shape is split across:
  - [`Employees`](../api/instructors/index.js): base row, including `working_days`
  - [`instructor_profiles`](../api/instructors/index.js): `break_time_minutes`, `metadata`
  - [`instructor_service_capabilities`](../api/instructors/index.js): `service_id`, `max_students`, `base_rate`, `availability_windows`, `metadata`
- `GET /api/instructors` manually loads those tables and returns merged rows with `instructor_profile` and `service_capabilities`.
- Invitation UI lives in Employees management via [`DirectoryView.jsx`](../src/components/settings/employee-management/DirectoryView.jsx) + [`InviteUserDialog.jsx`](../src/components/settings/employee-management/InviteUserDialog.jsx); do not move new invitation work back into Settings.
- Azure Functions must return through `respond(context, ...)`, must read auth with `resolveBearerAuthorization(req)`, and must use `supabase.auth.getUser(token).data.user`.
- Services use `is_active` for enable/disable; do not introduce delete-driven disablement.
- Use `createDashboardTask` (from `dashboard-tasks.js`) to push inbox tasks for domain operations that require user follow-up; it is idempotent — duplicate open tasks for the same `taskType` + `resourceType` + `resourceId` are suppressed automatically.
