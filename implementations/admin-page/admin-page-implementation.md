# System Admin Console — Implementation Record

**Completed:** 2026-04-20
**Implemented by:** Claude Sonnet 4.6 (`claude-sonnet-4-6`)
**Branch:** `Refactor-Continue`
**Base work started from:** Step 23 of the one-db-refactor plan (admin console stub)

---

## Overview

This document records the full design, decisions, and implementation of the Reinex system-admin console — a purpose-built internal control panel at `/system-admin/*` for platform operators.

The console is layered on top of the completed single-DB multi-tenant refactor and provides:
- Global visibility across all organizations and users
- Real user impersonation with MFA gating and full audit trail
- Incident management, compliance request tracking, knowledge base, announcements
- Live integration with PostHog for analytics and feature flags
- Audit log query surface with CSV export

---

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | [Refine](https://refine.dev/) + React Router v6 | Already in the codebase; provides authProvider, resource routing, and data hooks |
| Auth guard | AAL2 (MFA/TOTP) + `profiles.is_system_admin = true` | Two independent checks — token strength + explicit DB flag. Flag only settable via direct DB access. |
| API auth | Bearer token from Supabase session, validated server-side via `supabase.auth.getUser()` | Service-role client validates and then checks profile flag |
| Audit logging | Every system-admin action writes to `audit_log` table | Failures are non-fatal (swallowed) so they never break the primary action |
| localStorage modules | FutureIdeas, Incidents, KnowledgeBase, Compliance | Zero-backend, immediately useful, scoped to the admin's browser; upgrade path to DB exists |
| User source of truth | `auth.users` via admin API | `profiles` has no `email` column — email only lives in `auth.users` |
| Impersonation mechanism | `supabase.auth.admin.generateLink` (magiclink) → client redeems `hashed_token` via `verifyOtp` | Server never sends an email; hashed_token is returned to the admin client directly for local session swap |

---

## File Map

### Frontend — Shell & Routing

| File | Purpose |
|---|---|
| `src/admin/AdminApp.jsx` | Top-level React app. Mounts Refine, defines all routes under `AdminGate`, maps `LIVE_ELEMENTS` to path segments, renders `ComingSoon` for unbuilt paths |
| `src/admin/ui/AdminShell.jsx` | Collapsible sidebar shell (full-screen layout). Renders `ImpersonationBanner` when session is active |
| `src/admin/ui/DashboardView.jsx` | Landing dashboard — metric tiles linking out to every live module |
| `src/admin/ui/navConfig.js` | Single source of truth for navigation: groups, labels, icons, routes, `live`/`coming-soon` status, descriptions |
| `src/admin/authProvider.js` | Refine auth provider — calls `ensureSystemAdmin` path, redirects to `/login` on failure |

### Frontend — Reusable UI Components

| File | Purpose |
|---|---|
| `src/admin/ui/ModuleShell.jsx` | Standard page wrapper: title, subtitle, description, optional banner slot, children |
| `src/admin/ui/DataTable.jsx` | Generic table with loading skeleton, error state, empty state, row click handler |
| `src/admin/ui/FilterBar.jsx` | Search input + submit/clear buttons |
| `src/admin/ui/StatusBadge.jsx` | Tone-mapped inline badge (`success`, `warning`, `danger`, `info`, `accent`, `neutral`) |
| `src/admin/ui/MetricCard.jsx` | KPI card: label + value |
| `src/admin/ui/Drawer.jsx` | Right-side detail panel (shadcn Sheet underneath) |
| `src/admin/ui/ConfirmActionDialog.jsx` | Reason-gated confirmation dialog used across destructive/sensitive actions |
| `src/admin/ui/ComingSoon.jsx` | Placeholder page for unbuilt modules with planned-features list |
| `src/admin/ui/EmptyState.jsx` | Empty table/list state |
| `src/admin/ui/ErrorState.jsx` | Error display with retry button |
| `src/admin/ui/LoadingSkeleton.jsx` | Animated placeholder rows |
| `src/admin/ui/ImpersonationBanner.jsx` | Persistent amber banner across the top of the product shell when impersonating |

### Frontend — Modules

| File | Route | Backend | Storage |
|---|---|---|---|
| `src/admin/SystemHealthView.jsx` | `/system-admin/system-health` | `system-admin-health` | — |
| `src/admin/SupabaseConnectionView.jsx` | `/system-admin/supabase-connection` | `system-admin-health` | — |
| `src/admin/MfaPage.jsx` | `/system-admin/mfa` | Supabase Auth client | — |
| `src/admin/modules/GlobalSettingsView.jsx` | `/system-admin/global-settings` | `system-admin-global-settings` | DB |
| `src/admin/modules/ProductAnalyticsView.jsx` | `/system-admin/product-analytics` | PostHog iframe embed | — |
| `src/admin/modules/FeatureFlagsView.jsx` | `/system-admin/feature-flags` | PostHog JS SDK (`featureFlags.getFlags()`) | — |
| `src/admin/modules/OrganizationsView.jsx` | `/system-admin/organizations` | `system-admin-users-orgs` | DB |
| `src/admin/modules/UsersView.jsx` | `/system-admin/users` | `system-admin-users` (**new**) | DB |
| `src/admin/modules/ImpersonationQueueView.jsx` | `/system-admin/impersonation-queue` | `system-admin-impersonation-list` | DB |
| `src/admin/modules/AuditLogView.jsx` | `/system-admin/audit-log` | `system-admin-audit-log` (**new**) | DB |
| `src/admin/modules/AnnouncementsView.jsx` | `/system-admin/announcements` | `system-admin-global-settings` (key: `announcement_banner`) | DB |
| `src/admin/modules/IncidentsView.jsx` | `/system-admin/incidents` | — | `localStorage` |
| `src/admin/modules/KnowledgeBaseView.jsx` | `/system-admin/knowledge-base` | — | `localStorage` |
| `src/admin/modules/FutureIdeasView.jsx` | `/system-admin/future-ideas` | — | `localStorage` |
| `src/admin/modules/ComplianceView.jsx` | `/system-admin/compliance` | — | `localStorage` |

### Frontend — Impersonation

| File | Purpose |
|---|---|
| `src/admin/impersonation/ImpersonateUserDialog.jsx` | Reason + duration + typed-confirm dialog. Maps API error codes to human-readable messages. On success, swaps session and routes to `/` |
| `src/admin/impersonation/ImpersonationContext.jsx` | React context tracking active impersonation state across the app |
| `src/admin/impersonation/impersonation-client.js` | `startImpersonation()` — calls API, then calls `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` to swap the browser session |

### Backend — API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `api/system-admin-health/` | GET | Platform health probes (DB ping, env checks) |
| `api/system-admin-global-settings/` | GET / POST | Read and write named global settings via `permission_registry` or equivalent settings store |
| `api/system-admin-users-orgs/` | GET | Organizations list + system admins (legacy, still used by OrganizationsView) |
| `api/system-admin-users/` | GET | **New.** All platform users from `auth.users`, enriched with `profiles` + `org_memberships` count. Supports search (`?q=`) and pagination (`?page=&per_page=`) |
| `api/system-admin-audit-log/` | GET | **New.** Query `audit_log` with filters: `q`, `event_type`, `category`, `actor_user_id`, `org_id`, `resource_type`, `since`, `until`, `limit`, `offset`. Returns rows + total |
| `api/system-admin-impersonation-start/` | POST | Creates `impersonation_sessions` row, generates magic-link `hashed_token` via Supabase admin, returns token to client for local session swap |
| `api/system-admin-impersonation-exit/` | POST | Marks session as `exited`, logs audit event |
| `api/system-admin-impersonation-list/` | GET | Lists active, pending, and historical impersonation sessions |

### Backend — Shared Utilities (`api/_shared/`)

| File | Key exports |
|---|---|
| `org-bff.js` | `ensureSystemAdmin`, `parseRequestBody`, `respond`, `normalizeString`, `readEnv`, `withOrgScope`, `createSingleClient` |
| `supabase-admin.js` | `createSupabaseAdminClient`, `readSupabaseAdminConfig` |
| `audit-log.js` | `logAuditEvent` |
| `http.js` | `resolveBearerAuthorization`, `json` |

---

## Security Architecture

### `ensureSystemAdmin` (in `api/_shared/org-bff.js`)

Every system-admin endpoint calls this guard before touching any data:

```
1. resolveBearerAuthorization(req) → extract token from Authorization header
2. supabase.auth.getUser(token) → server-side token validation (no client trust)
3. decodeJwtPayload(token).aal → must equal 'aal2' (MFA completed)
4. supabase.from('profiles').select('is_system_admin').eq('id', userId)
   → must be true (flag set only via direct DB access, not via any API)
5. logAdminAttempt() → every attempt (pass or fail) written to audit_log
```

Failure at any step throws a structured error with `statusCode` (401/403/500). Callers catch and return the status code directly.

### Impersonation Flow

```
Admin UI (ImpersonateUserDialog)
  → POST /api/system-admin-impersonation-start
      { target_email, reason, duration_minutes, target_org_id? }

Server:
  1. ensureSystemAdmin → AAL2 + is_system_admin check
  2. lookupTargetUser → supabase.auth.admin.listUsers(filter: email) up to 5 pages
     + profiles.full_name enrichment by ID
  3. supabase.auth.admin.generateLink({ type: 'magiclink', email })
     → hashed_token (never sent via email — returned directly to admin)
  4. INSERT impersonation_sessions { admin_user_id, target_user_id, reason, status: 'active', expires_at }
  5. logAuditEvent(system_admin.impersonation_started)
  6. Return { session_id, hashed_token, target_user_id, target_email, expires_at }

Client (impersonation-client.js):
  supabase.auth.verifyOtp({ token_hash: hashed_token, type: 'magiclink' })
  → browser session is now running as target user

ImpersonationBanner:
  Pinned across top of product shell while impersonating.
  "Exit" button → POST /api/system-admin-impersonation-exit → session marked 'exited'
```

---

## Bugs Found & Fixed

### 1. `lookupTargetUser` querying `profiles.email` (non-existent column)

**Symptom:** `POST /api/system-admin-impersonation-start` → 500 `target_lookup_failed`

**Root cause:** The original `lookupTargetUser` function in `system-admin-impersonation-start/index.js` did:
```js
supabase.from('profiles').select('id, full_name, email').ilike('email', email)
```
The `profiles` table has NO `email` column (confirmed in `setup-sql.js`). Supabase returned a column-not-found error which was caught and re-thrown as `target_lookup_failed`.

**Fix:** Replaced with `supabase.auth.admin.listUsers({ page, perPage: 200, filter: normalizedEmail })` paging up to 5 pages, with exact-email match, followed by separate `profiles.full_name` enrichment by user ID.

**File:** `api/system-admin-impersonation-start/index.js` — `lookupTargetUser()`

---

### 2. `parseRequestBody` returning raw Buffer on Azure Node 18

**Symptom:** `POST /api/system-admin-impersonation-start` → 400 (body fields missing: `target_email_required` or `reason_required`)

**Root cause:** On certain Azure Functions + Node 18 combinations, `req.body` arrives as a `Buffer` (Uint8Array). The old code checked `typeof body === 'object'` and returned it directly — Buffers pass this check but are not parsed JSON. Downstream destructuring of `body.target_email` etc. returned `undefined`.

**Fix:** Added explicit `Buffer.isBuffer` + `instanceof Uint8Array` guards before treating the body as parsed:
```js
if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
  return body; // already parsed
}
// else decode bytes → string → JSON.parse
```

**File:** `api/_shared/org-bff.js` — `parseRequestBody()`

---

### 3. `UsersView` only showing `is_system_admin = true` users

**Symptom:** Admin console Users page showed only system admins, not all platform users. Also crashed on missing `primary_contact_email` field from `system-admin-users-orgs` response.

**Root cause:** `system-admin-users-orgs` endpoint explicitly filters `profiles WHERE is_system_admin = true` for the `system_admins` list, and returns organizations (not individual users). The org rows had no `primary_contact_email` field.

**Fix:** Built a new `system-admin-users` endpoint that calls `supabase.auth.admin.listUsers` (all users, no filter), then enriches with `profiles` (full_name, is_system_admin) and `org_memberships` count. Rewrote `UsersView.jsx` to consume this endpoint with proper pagination and search.

**Files:**
- `api/system-admin-users/function.json` — new
- `api/system-admin-users/index.js` — new
- `src/admin/modules/UsersView.jsx` — rewritten

---

### 4. `OrganizationsView.jsx` syntax error (stray JSX line)

**Symptom:** Vite build failure — unexpected token at end of `OrganizationsView.jsx`

**Root cause:** A stray `<Building2 /> // preserved import shield` line was left at the bottom of the file after a refactor, outside any component or function.

**Fix:** Removed the stray line and the corresponding unused `Building2` lucide import.

**File:** `src/admin/modules/OrganizationsView.jsx`

---

### 5. `ImpersonateUserDialog` showing raw API error codes to the user

**Symptom:** On impersonation failure, the dialog showed internal codes like `cannot_impersonate_self` or `mfa_required` as-is.

**Fix:** Added `IMPERSONATION_ERRORS` map in the dialog component translating every known API error code to a human-readable sentence.

**File:** `src/admin/impersonation/ImpersonateUserDialog.jsx`

---

## Module Detail Notes

### AuditLogView (`/system-admin/audit-log`)
- Calls `GET /api/system-admin-audit-log` with filters: event_type, category, org_id, actor_user_id, since/until
- PAGE_SIZE = 100 with Previous/Next pagination
- CSV export via `Blob + URL.createObjectURL`
- Row drawer shows raw `details` and `metadata` JSON blocks
- 4 MetricCards: rows in view, total matches, control-plane count, distinct categories

### FeatureFlagsView (`/system-admin/feature-flags`)
- Reads live flags from `posthog.featureFlags.getFlags()` and variant values
- Subscribes to `posthog.onFeatureFlags()` for reactive updates when PostHog finishes loading
- "Open PostHog" deep-link uses `posthog.config.api_host`
- Renders EmptyState when PostHog not configured (no `VITE_POSTHOG_KEY`)

### localStorage modules

All four use a versioned key pattern (`reinex.admin.<module>.v1`) with `JSON.parse/stringify`. Schema is simple JSON arrays. Seed data is injected once on first load (empty store check). No sync to backend — admin-browser-local only.

| Module | localStorage key | Seed data |
|---|---|---|
| IncidentsView | `reinex.admin.incidents.v1` | — |
| KnowledgeBaseView | `reinex.admin.knowledge.v1` | 2 runbooks (Supabase outage, impersonation escalation) |
| FutureIdeasView | `reinex.admin.future-ideas.v1` | 4 ideas (Background Jobs Monitor, Cost Analytics, Localisation Console, AI Support Assistant) |
| ComplianceView | `reinex.admin.compliance.v1` | — |

### `system-admin-users` endpoint — search strategy

When `?q=` is provided, two parallel lookups are performed:
1. `supabase.auth.admin.listUsers({ filter: q })` — scans auth.users by email/phone (up to 5 pages × 200)
2. `supabase.from('profiles').select('id').ilike('full_name', '%q%')` — name search

The two result sets are merged (deduped by user ID). Auth records for name-only matches that weren't in the email results are fetched by scanning up to 3 additional pages. Combined results are sorted with email-prefix matches first, then truncated to `per_page`.

When no `?q=`, standard page/per_page pagination is used directly against `listUsers`.

---

## Navigation Structure (`navConfig.js`)

```
Overview
  Dashboard ✅

Platform
  System Health ✅
  Supabase Connection ✅
  Release & Migrations (coming soon)
  Encryption & Keys (coming soon)

Customers
  Organizations ✅
  Users ✅
  Onboarding Pipeline (coming soon)
  Billing (coming soon)

Operations
  Audit Log ✅
  Incidents ✅
  Impersonation Queue ✅
  Email Log (coming soon)
  Integration Health (coming soon)
  Data Quality (coming soon)

Content
  Knowledge Base ✅
  Announcements ✅

Insights
  Product Analytics ✅
  Feature Flags ✅
  Compliance Requests ✅

Settings
  Global Settings ✅
  MFA Management ✅

Backlog
  Future Ideas ✅
```

---

## What Remains (Coming Soon)

| Module | Notes |
|---|---|
| Release & Migrations | Deploy history, pending migrations, one-click rollback |
| Encryption & Keys | Key rotation, vault view, emergency revocation |
| Onboarding Pipeline | Kanban of new orgs from signup → activation |
| Billing | Internal ledger, plan assignments, invoice history |
| Email Log | Outbound email stream with bounce/resend controls |
| Integration Health | 3rd-party integration status and webhook delivery rates |
| Data Quality | Orphan detection, schema drift, row-count anomaly alerts |
| Impersonation approval workflow | High-sensitivity orgs require a second admin to approve |
| Users — sessions & MFA factors panel | Detail drawer currently shows basic info only |
| Organizations — detail drawer | Members, billing status, recent audit events, feature flags |

---

## Database Dependencies

Tables the admin console reads/writes (all via service_role, bypassing RLS):

| Table | Used by |
|---|---|
| `audit_log` | AuditLogView read; every endpoint writes on sensitive actions |
| `profiles` | ensureSystemAdmin (is_system_admin flag); lookupTargetUser (full_name); UsersView enrichment |
| `organizations` | OrganizationsView; impersonation-start (org name lookup) |
| `org_memberships` | UsersView (org_count per user) |
| `impersonation_sessions` | ImpersonationQueueView; impersonation-start (INSERT); impersonation-exit (UPDATE) |
| `auth.users` (admin API) | system-admin-users endpoint; lookupTargetUser in impersonation-start |

The `impersonation_sessions` table must be created via the setup script before the impersonation flow will work. If missing, the start endpoint returns `501 impersonation_table_missing` with a hint pointing to `src/lib/setup-sql.js`.

---

*Implementation record authored by Claude Sonnet 4.6 (`claude-sonnet-4-6`) — 2026-04-20*
