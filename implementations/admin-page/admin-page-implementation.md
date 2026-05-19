# System Admin Console — Implementation Record

**Completed:** 2026-04-22
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
- Email log: full history of every outbound platform email
- Announcement banner: admin-authored platform-wide notice shown in the product app shell

---

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | [Refine](https://refine.dev/) + React Router v6 | Already in the codebase; provides authProvider, resource routing, and data hooks |
| Auth guard | AAL2 (MFA/TOTP) + `profiles.is_system_admin = true` | Two independent checks — token strength + explicit DB flag. Flag only settable via direct DB access, not via any API. |
| API auth | Bearer token from Supabase session, validated server-side via `supabase.auth.getUser()` | Service-role client validates and then checks profile flag |
| Audit logging | Every system-admin action writes to `audit_log` table | Failures are non-fatal (swallowed) so they never break the primary action |
| Admin module storage | `admin_data` table (service-role only, no GRANT to app_user) | Replaced per-browser localStorage for Incidents, Knowledge Base, Future Ideas, Compliance, Announcements — all admins share the same data regardless of browser |
| Email log storage | `email_log` table (service-role only, no GRANT to app_user) | Immutable append-only log of every outbound Brevo email for admin visibility |
| Announcement storage | `admin_data` module='announcements', record_id='active-banner' | Public `/api/announcement` endpoint reads it with service_role; no user auth required |
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
| `src/components/AnnouncementBanner.jsx` | Compact chip rendered in the center of the AppShell header (flex-1 area between org name and accessibility button); fetches from `/api/announcement`; renders nothing when no banner is active |

### Frontend — Modules

| File | Route | Backend | Storage |
|---|---|---|---|
| `src/admin/SystemHealthView.jsx` | `/system-admin/system-health` | `system-admin-health` | — |
| `src/admin/SupabaseConnectionView.jsx` | `/system-admin/supabase-connection` | `system-admin-health` | — |
| `src/admin/MfaPage.jsx` | `/system-admin/mfa` | Supabase Auth client | — |
| `src/admin/modules/GlobalSettingsView.jsx` | `/system-admin/global-settings` | `system-admin-global-settings` | DB (`permission_registry`) |
| `src/admin/modules/ProductAnalyticsView.jsx` | `/system-admin/product-analytics` | PostHog iframe embed | — |
| `src/admin/modules/FeatureFlagsView.jsx` | `/system-admin/feature-flags` | PostHog JS SDK (`featureFlags.getFlags()`) | — |
| `src/admin/modules/OrganizationsView.jsx` | `/system-admin/organizations` | `system-admin-users-orgs` | DB |
| `src/admin/modules/UsersView.jsx` | `/system-admin/users` | `system-admin-users`, `system-admin-user-detail` | DB |
| `src/admin/modules/ImpersonationQueueView.jsx` | `/system-admin/impersonation-queue` | `system-admin-impersonation-list` | DB |
| `src/admin/modules/AuditLogView.jsx` | `/system-admin/audit-log` | `system-admin-audit-log` | DB |
| `src/admin/modules/AnnouncementsView.jsx` | `/system-admin/announcements` | `system-admin-store` (module=announcements) | DB (`admin_data`) |
| `src/admin/modules/EmailLogView.jsx` | `/system-admin/email-log` | `system-admin-email-log` | DB (`email_log`) |
| `src/admin/modules/IncidentsView.jsx` | `/system-admin/incidents` | `system-admin-store` (module=incidents) | DB (`admin_data`) |
| `src/admin/modules/KnowledgeBaseView.jsx` | `/system-admin/knowledge-base` | `system-admin-store` (module=knowledge_base) | DB (`admin_data`) |
| `src/admin/modules/FutureIdeasView.jsx` | `/system-admin/future-ideas` | `system-admin-store` (module=future_ideas) | DB (`admin_data`) |
| `src/admin/modules/ComplianceView.jsx` | `/system-admin/compliance` | `system-admin-store` (module=compliance) | DB (`admin_data`) |
| `src/admin/modules/IntegrationHealthView.jsx` | `/system-admin/integration-health` | — | — |
| `src/admin/modules/DataQualityView.jsx` | `/system-admin/data-quality` | — | — |
| `src/admin/modules/OnboardingPipelineView.jsx` | `/system-admin/onboarding-pipeline` | — | — |

### Frontend — Impersonation

| File | Purpose |
|---|---|
| `src/admin/impersonation/ImpersonateUserDialog.jsx` | Reason + duration + typed-confirm dialog. Maps API error codes to human-readable messages. On success, swaps session and routes to `/` |
| `src/admin/impersonation/ImpersonationContext.jsx` | React context tracking active impersonation state across the app |
| `src/admin/impersonation/impersonation-client.js` | `startImpersonation()` — calls API, then calls `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` to swap the browser session |

### Backend — API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `api/system-admin-health/` | GET | admin | Platform health probes (DB ping, env checks) |
| `api/system-admin-global-settings/` | GET / POST | admin | Feature flags via `permission_registry`. Announcement removed (now in admin_data). |
| `api/system-admin-users-orgs/` | GET | admin | Organizations list + system admins |
| `api/system-admin-users/` | GET | admin | All platform users from `auth.users`, enriched with profiles + org count |
| `api/system-admin-user-detail/` | GET / POST | admin | Per-user detail: MFA factors, active sessions, org memberships. POST: force sign-out |
| `api/system-admin-audit-log/` | GET | admin | Query audit_log with filters |
| `api/system-admin-impersonation-start/` | POST | admin | Creates session, returns `hashed_token` for client-side session swap |
| `api/system-admin-impersonation-exit/` | POST | admin | Marks session as exited |
| `api/system-admin-impersonation-list/` | GET | admin | Active, pending, and historical impersonation sessions |
| `api/system-admin-store/` | GET / POST / DELETE | admin | Generic CRUD for admin_data modules (incidents, knowledge_base, future_ideas, compliance, announcements) |
| `api/system-admin-email-log/` | GET | admin | Paginated read of email_log table. Supports filters: email_type, status, search (recipient) |
| `api/announcement/` | GET | **none** | Public endpoint: returns `{ active, text }` from admin_data. Used by AnnouncementBanner in AppShell |

### Backend — Shared Utilities (`api/_shared/`)

| File | Key exports |
|---|---|
| `org-bff.js` | `ensureSystemAdmin`, `parseRequestBody`, `respond`, `normalizeString`, `readEnv`, `withOrgScope`, `createSingleClient` |
| `supabase-admin.js` | `createSupabaseAdminClient`, `readSupabaseAdminConfig` |
| `audit-log.js` | `logAuditEvent` |
| `http.js` | `resolveBearerAuthorization`, `json` |
| `email-log.js` | `logEmailSent`, `sendAndLogBrevoEmail` — drop-in replacement for `sendBrevoEmail` that also writes to `email_log` |

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

### `admin_data` and `email_log` Tables — Security Boundary

Both tables intentionally have **no GRANT to app_user**. A non-service-role connection receives a hard `permission denied` error before RLS even runs. This is a stronger boundary than GRANT + deny-all RLS policy. Both tables are in `TABLES_WITHOUT_APP_USER_GRANT` in `scripts/validate-setup-sql.js` to suppress the lint check that otherwise enforces a GRANT for every table.

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

## Email Log

### How It Works

Every outbound Brevo email is now logged to the `email_log` table via `sendAndLogBrevoEmail` in `api/_shared/email-log.js`. This is a drop-in replacement for `sendBrevoEmail` that wraps the call in a try/finally and records the outcome (sent or failed) in a fire-and-forget insert.

### Call Sites Updated

| File | Email type logged |
|---|---|
| `api/_shared/invitation-email.js` | `invitation_existing_user`, `invitation_auth_invite` |
| `api/_shared/password-reset-email.js` | `password_reset` |
| `api/form-submissions/index.js` | `form_submission` |
| `api/waiting-list-intake/index.js` | `waiting_list` |

### `email_log` Table Schema

```sql
CREATE TABLE IF NOT EXISTS public.email_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_type    text        NOT NULL,
  to_email      text        NOT NULL,
  subject       text        NULL,
  status        text        NOT NULL DEFAULT 'sent',  -- 'sent' | 'failed'
  error_message text        NULL,
  org_id        uuid        NULL,
  actor_user_id uuid        NULL,
  metadata      jsonb       NOT NULL DEFAULT '{}',
  sent_at       timestamptz NOT NULL DEFAULT now()
);
```

No GRANT to app_user — service_role only. The `system-admin-email-log` endpoint exposes a paginated, filterable read view.

---

## Announcements

### Storage Migration

Previously stored in `permission_registry` under key `system.announcement.banner`. Now stored in `admin_data` with `module='announcements', record_id='active-banner'`. The `system-admin-global-settings` endpoint no longer handles announcements.

### Banner Display in Product

`AnnouncementBanner.jsx` is mounted in `AppShell.jsx` inside the header (center flex-1 area, between the org name chip on the left and the accessibility button on the right). It:
1. Fetches `/api/announcement` (public, no auth) on mount
2. Renders a compact amber chip if `{ active: true, text: "..." }` is returned
3. Renders nothing when `active` is false — the header layout is unaffected

The public `/api/announcement` endpoint reads `admin_data` via service_role and returns `{ active, text }` — safe for anonymous callers since it only returns the sanitized banner text.

### Admin UI

`AnnouncementsView.jsx` uses `useAdminStore('announcements')`. The active banner is a single record with `id='active-banner'`. Publishing overwrites the record; clearing sets `active: false`.

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

### 6. Admin modules persisting data only in the current admin's browser (localStorage)

**Problem:** Incidents, Knowledge Base, Future Ideas, Compliance, and Announcements all used `localStorage`. Different admins on different machines had completely separate data sets — incidents opened on one machine were invisible on another.

**Fix:** Migrated all five to `admin_data` (a new service-role-only Postgres table) via a shared `useAdminStore` hook and `system-admin-store` endpoint. Each module uses `upsert` with optimistic updates for instant UI response.

---

### 7. Knowledge Base flashing seed articles on every mount

**Symptom:** Entering `/system-admin/knowledge-base` briefly showed two hardcoded articles (a Supabase-outage runbook and an impersonation-escalation runbook) for one render frame before they disappeared.

**Root cause:** `useAdminStore` accepts an optional `seed` array that is passed directly to `React.useState(seed)` as the initial value. `KnowledgeBaseView` was calling `useAdminStore('knowledge_base', { seed: SEED })` with two hardcoded articles. They rendered immediately, then the API fetch completed with an empty response (empty DB) and replaced them with `[]`.

**Fix:** Removed the `SEED` constant and the `{ seed: SEED }` option. The module now starts empty and populates only from the database. Also removed stale comments mentioning localStorage and updated the `ModuleShell` description and `ConfirmActionDialog` copy.

**File:** `src/admin/modules/KnowledgeBaseView.jsx`

---

## Module Detail Notes

### AuditLogView (`/system-admin/audit-log`)
- Calls `GET /api/system-admin-audit-log` with filters: event_type, category, org_id, actor_user_id, since/until
- PAGE_SIZE = 100 with Previous/Next pagination
- CSV export via `Blob + URL.createObjectURL`
- Row drawer shows raw `details` and `metadata` JSON blocks
- 4 MetricCards: rows in view, total matches, control-plane count, distinct categories

### EmailLogView (`/system-admin/email-log`)
- Calls `GET /api/system-admin-email-log` with filters: email_type, status, recipient search
- PAGE_SIZE = 50 with Previous/Next pagination
- Row drawer: type, recipient, subject, sent_at, error message (if failed), metadata JSON
- Handles `501 table_not_found` gracefully with an instructional EmptyState

### FeatureFlagsView (`/system-admin/feature-flags`)
- Reads live flags from `posthog.featureFlags.getFlags()` and variant values
- Subscribes to `posthog.onFeatureFlags()` for reactive updates when PostHog finishes loading
- "Open PostHog" deep-link uses `posthog.config.api_host`
- Renders EmptyState when PostHog not configured (no `VITE_POSTHOG_KEY`)

### `useAdminStore` hook (`src/admin/lib/useAdminStore.js`)
- Fetches on mount from `system-admin-store?module=<name>`
- Exposes `{ items, loading, error, upsert, remove }`
- Optimistic updates: `upsert`/`remove` update state immediately, fire API in background
- No localStorage fallback — if the table doesn't exist, the UI shows loading/error state

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
  Onboarding Pipeline ✅
  Billing (coming soon)

Operations
  Audit Log ✅
  Incidents ✅
  Impersonation Queue ✅
  Email Log ✅
  Integration Health ✅
  Data Quality ✅

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
| Billing | Internal ledger, plan assignments, invoice history |
| Impersonation approval workflow | High-sensitivity orgs require a second admin to approve |
| Organizations — detail drawer | Members, billing status, recent audit events, feature flags |
| Announcement scheduling | Start/end windows, per-plan targeting, acknowledgement tracking |

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
| `admin_data` | system-admin-store (Incidents, Knowledge Base, Future Ideas, Compliance, Announcements). Service-role only — no GRANT to app_user. |
| `email_log` | system-admin-email-log (read); email-log.js writes on every outbound email. Service-role only — no GRANT to app_user. |
| `permission_registry` | system-admin-global-settings (feature flags only — announcement removed) |

---

*Implementation record authored by Claude Sonnet 4.6 (`claude-sonnet-4-6`) — last updated 2026-04-23*
