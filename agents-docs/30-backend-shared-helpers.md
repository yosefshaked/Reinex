# 30 Backend Shared Helpers

## When to read
- Any `api/*` endpoint change.
- Any auth, membership, tenant resolution, validation, audit, settings, or storage helper change.

## Load these files first
- [`../api/_shared/http.js`](../api/_shared/http.js)
- [`../api/_shared/org-bff.js`](../api/_shared/org-bff.js)
- [`../api/_shared/supabase-admin.js`](../api/_shared/supabase-admin.js)
- [`../api/_shared/validation.js`](../api/_shared/validation.js)
- [`../api/_shared/audit-log.js`](../api/_shared/audit-log.js)
- [`../api/_shared/tenant-audit.js`](../api/_shared/tenant-audit.js)
- [`../api/_shared/settings-utils.js`](../api/_shared/settings-utils.js)
- [`../api/_shared/permissions-utils.js`](../api/_shared/permissions-utils.js)
- [`../api/_shared/storage-encryption.js`](../api/_shared/storage-encryption.js)
- [`../api/_shared/currency.js`](../api/_shared/currency.js)
- [`../api/_shared/csv.js`](../api/_shared/csv.js)
- [`../api/_shared/day-of-week.js`](../api/_shared/day-of-week.js)
- [`../api/_shared/instructor-colors.js`](../api/_shared/instructor-colors.js)
- [`../api/_shared/metadata-utils.js`](../api/_shared/metadata-utils.js)

## Shared helpers to reuse
- `resolveBearerAuthorization`, `json`
- `readEnv`, `respond`, `parseRequestBody`, `normalizeString`, `normalizeNullableId`
- `ensureMembership`, `isAdminRole`, `isAdminOrOffice`, `resolveOrgId`, `createSingleClient`, `withOrgScope`
- `readSupabaseAdminConfig`, `createSupabaseAdminClient`
- `parseJsonBodyWithLimit`, `validateSessionWrite`, instructor validators in [`../api/_shared/validation.js`](../api/_shared/validation.js)
- `logAuditEvent`, `logTenantAuditEvent`
- Settings/permissions/storage helper modules above
- `ensureInstructorColors` in [`../api/_shared/instructor-colors.js`](../api/_shared/instructor-colors.js)
- `mergeMetadata` in [`../api/_shared/metadata-utils.js`](../api/_shared/metadata-utils.js) — use for all nested metadata patch operations; do not hand-spread metadata
- Day-name/number utilities in [`../api/_shared/day-of-week.js`](../api/_shared/day-of-week.js) — backend counterpart to `src/lib/day-of-week.js`
- `findAuthUserByEmail`, `getAuthUserById`, `getAuthUsersByIds` in [`../api/_shared/auth-users.js`](../api/_shared/auth-users.js) — use these when auth user emails are needed; `profiles` is not the source of truth for auth email addresses

## Known patterns / do not reinvent
- Standard endpoint flow is:
  - `readEnv(context)`
  - `createSingleClient(env)`
  - `resolveBearerAuthorization(req)`
  - `supabase.auth.getUser(token)`
  - `ensureMembership(...)`
  - `withOrgScope(...)` or explicit `.eq('org_id', orgId)`
  - `respond(context, ...)`
- Always set `context.res` through `respond`.
- Use `resolveOrgId` or `parseRequestBody` instead of ad hoc request parsing.
- Use body-size-aware parsing for write endpoints.
- Auth/membership checks happen first; tenant reads/writes must always be org-scoped in the shared single DB.
- Exact user email lookup must go through the auth admin API (`auth.users`) via shared helpers. Do not query `profiles.email` — that column is not part of the canonical schema.
- System-admin cross-tenant controls must be review-first: queue action requests (for example in `permission_registry` with `system.request.*` keys) and audit with `logAuditEvent` instead of executing destructive org changes inline.
- For `withOrgScope(...).upsert(...)`, the `onConflict` target must include `org_id` whenever the table unique key includes `org_id` (for example `org_id,key` or `org_id,employee_id,service_id`).
