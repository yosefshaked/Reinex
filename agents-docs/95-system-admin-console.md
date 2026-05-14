# 95 System Admin Console

## When to read
- Any work touching `/system-admin/*` routes, views, or API endpoints.
- Changes to `admin_data`, `email_log`, or `announcement` infrastructure.
- Changes to the `AnnouncementBanner` or `AppShell` header.
- Adding or wiring a new admin module.

## Load these files first
- [`../src/admin/AdminApp.jsx`](../src/admin/AdminApp.jsx)
- [`../src/admin/ui/navConfig.js`](../src/admin/ui/navConfig.js)
- [`../src/admin/lib/useAdminStore.js`](../src/admin/lib/useAdminStore.js)
- [`../api/_shared/org-bff.js`](../api/_shared/org-bff.js) — `ensureSystemAdmin`
- [`../implementations/admin-page/admin-page-implementation.md`](../implementations/admin-page/admin-page-implementation.md) — full design record

## Architecture Overview

The system-admin console is a separate React app mounted at `/system-admin/*`. It is completely isolated from the regular tenant app: different shell (`AdminShell`), different auth guard (`AdminGate` → AAL2 + `is_system_admin`), different API endpoints.

## Auth Guard — `ensureSystemAdmin`

Every system-admin API endpoint must call `ensureSystemAdmin` before touching data:
1. Extract Bearer token via `resolveBearerAuthorization(req)`
2. Validate token server-side: `supabase.auth.getUser(token)`
3. Check AAL2: `decodeJwtPayload(token).aal === 'aal2'`
4. Check DB flag: `profiles.is_system_admin = true` (only settable via direct DB — no API can set it)
5. Write audit attempt to `audit_log`

## API Naming Rule

All system-admin endpoints use the prefix `system-admin-*` (e.g., `system-admin-store`, `system-admin-users`).

**Do NOT** start route names with `admin` — Azure host reserves `/admin/*` for its management routes.

The one exception is the public announcement endpoint (`api/announcement/`) which has no auth and no prefix.

## Adding a New Live Module

1. Create the view at `src/admin/modules/<Name>View.jsx`
2. Create the API endpoint(s) at `api/system-admin-<name>/` (function.json + index.js)
3. In `navConfig.js`: set `status: 'live'` for the nav item
4. In `AdminApp.jsx`: add import, add to `LIVE_ELEMENTS`, add `<Route path="<name>" element={...} />`

Current example: `Admin Tools` lives at `/system-admin/admin-tools` and is backed by `api/system-admin-admin-tools/`.

If you only add to `LIVE_ELEMENTS` but forget the `<Route>`, navigation will hit the catch-all `path="*"` and redirect loop (triggers repeated `is_system_admin` checks visible as network spam).

## `admin_data` Table — Generic Module Storage

Modules that need shared persistent state (Incidents, Knowledge Base, Future Ideas, Compliance, Announcements) use the `admin_data` table via the `system-admin-store` endpoint and the `useAdminStore` hook.

- `module` + `record_id` = unique key
- `data` JSONB stores the full record
- **No GRANT to app_user** — service_role only. Hard permission-denied boundary.
- Listed in `TABLES_WITHOUT_APP_USER_GRANT` in `scripts/validate-setup-sql.js`

### `useAdminStore(module, options?)`

```js
const { items, loading, error, upsert, remove } = useAdminStore('incidents');
```

- `items` — array from DB, starts `[]` (never use a `seed` option — seed causes a visible flash on mount because it renders immediately before the API response arrives)
- `upsert(record)` — optimistic: updates state immediately, fires `POST system-admin-store` in background
- `remove(id)` — optimistic: removes immediately, fires `DELETE system-admin-store` in background
- Do NOT pass `{ seed: [...] }` — it will flash placeholder data on every mount

## `email_log` Table

Every outbound Brevo email is logged via `sendAndLogBrevoEmail` in `api/_shared/email-log.js`. It is a drop-in replacement for `sendBrevoEmail` that wraps the call and appends to `email_log`.

- **No GRANT to app_user** — service_role only
- Listed in `TABLES_WITHOUT_APP_USER_GRANT`
- Call sites: `_shared/invitation-email.js`, `_shared/password-reset-email.js`, `api/form-submissions/index.js`, `api/waiting-list-intake/index.js`

## `error_events` Table

Operational support/debug events are stored in `error_events` via `respondTrackedError` / `trackErrorEvent` in `api/_shared/error-events.js`.

- **No GRANT to app_user** — service_role only
- Listed in `TABLES_WITHOUT_APP_USER_GRANT`
- Retained for 90 days through `expires_at`; cleanup runs opportunistically from the helper.
- System admins inspect raw internal error detail in `/system-admin/error-events`.
- Frontend users receive only stable public codes plus `error_id`; raw DB/provider/stack detail must never be returned in normal API responses.

## Org Purge

The destructive org purge flow lives under `/system-admin/org-purge` and uses `api/org-purge/prepare` plus `api/org-purge/execute`.

- The deletion order is owned by `api/org-purge/purge-manifest.js`; update it whenever an org-scoped table is added.
- `implementations/admin-page/org-nuke/README.md` is the design record and must be kept in sync with the manifest version, phase table, and retained platform table list.
- `error_events`, `audit_log`, and `impersonation_sessions` are retained platform/support records whose org FK points to the tombstoned organization while retained.
- The C7 backup guard reads `organizations.backup_history` through `api/_shared/backup-history.js` and verifies that the referenced encrypted backup file still exists in managed storage. Do not treat a stale history row as enough to unblock purge.
- Run `node --test api/org-purge/purge-manifest.test.js` after manifest changes; it statically checks `src/lib/setup-sql.js` coverage so C1 drift is caught before deployment.

## Announcement Banner

- **Admin side:** `AnnouncementsView.jsx` uses `useAdminStore('announcements')`. Single record `id='active-banner'` with `{ active: boolean, text: string }`.
- **Public endpoint:** `api/announcement/index.js` — no auth, reads `admin_data` via service_role, returns `{ active, text }`. Fails silently (returns `{ active: false }`) on any error.
- **Product side:** `src/components/AnnouncementBanner.jsx` — renders a compact amber chip. Mounted in the **center of the AppShell header** (flex-1 area between org name chip and accessibility button). Renders nothing when `active` is false — no layout shift.

## `validate-setup-sql.js` — Exclusion Sets

When adding a new service-role-only table, register it in both sets:
```js
const TABLES_WITH_CUSTOM_RLS = new Set([..., 'your_table'])
const TABLES_WITHOUT_APP_USER_GRANT = new Set([..., 'your_table'])
```
Otherwise `npm run lint:sql` will fail with SQL005 (missing GRANT) and SQL006 (missing RLS policy loop entry).
