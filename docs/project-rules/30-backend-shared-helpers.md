# 30 Backend Shared Helpers

## When to read
- Any `api/*` endpoint change.
- Any auth, membership, tenant resolution, validation, audit, settings, or storage helper change.

## Start here
These files are an entry point, not a boundary: follow imports, callers (grep the symbol), dependencies, cross-domain effects and tests as far as the change needs.
- [`../../api/_shared/http.js`](../../api/_shared/http.js)
- [`../../api/_shared/org-bff.js`](../../api/_shared/org-bff.js)
- [`../../api/_shared/supabase-admin.js`](../../api/_shared/supabase-admin.js)
- [`../../api/_shared/validation.js`](../../api/_shared/validation.js)
- [`../../api/_shared/audit-log.js`](../../api/_shared/audit-log.js)
- [`../../api/_shared/tenant-audit.js`](../../api/_shared/tenant-audit.js)
- [`../../api/_shared/settings-utils.js`](../../api/_shared/settings-utils.js)
- [`../../api/_shared/permissions-utils.js`](../../api/_shared/permissions-utils.js)
- [`../../api/_shared/storage-encryption.js`](../../api/_shared/storage-encryption.js)
- [`../../api/_shared/currency.js`](../../api/_shared/currency.js)
- [`../../api/_shared/csv.js`](../../api/_shared/csv.js)
- [`../../api/_shared/day-of-week.js`](../../api/_shared/day-of-week.js)
- [`../../api/_shared/time-grid.js`](../../api/_shared/time-grid.js)
- [`../../api/_shared/instructor-colors.js`](../../api/_shared/instructor-colors.js)
- [`../../api/_shared/metadata-utils.js`](../../api/_shared/metadata-utils.js)
- [`../../api/_shared/public-app-url.js`](../../api/_shared/public-app-url.js)
- [`../../api/_shared/account-profile.js`](../../api/_shared/account-profile.js)

## Org isolation in the API
RLS protects requests made with a user's token. The API uses the service-role client, which bypasses RLS, so the API itself keeps each org's data apart, in two separate steps.

1. **Authorisation: who may act.** Each route uses its own verified mechanism:
   - **A member's request:** authenticate the caller, call `ensureMembership(client, orgId, userId)`, check the result and stop when it is `null`. Then enforce the role the action needs (`isAdminRole`, `isAdminOrOffice`, ...) and the instructor's self-scope (an instructor sees and changes only their own data unless the role is `admin` or `owner`).
   - **A system-admin request:** `ensureSystemAdmin(...)` (see [`95-system-admin-console.md`](95-system-admin-console.md)). When it acts on one org, it names that org explicitly.
   - **A public or token flow:** the verified token or record that the flow issued. The org comes from that record, never from the request body alone.
   - **A timer or machine call:** its trigger or its shared secret.
2. **Org scoping: which rows.** After authorisation, every operation on a tenant table is limited to the authorised org.
   - New or changed code uses `withOrgScope(client, table, orgId)` for every select, insert, update, upsert and delete it supports. It filters reads, updates and deletes by `org_id`, and sets the authorised `org_id` on every inserted or upserted row.
   - An upsert also keeps its `onConflict` contract: a matching unique index or constraint in the schema, and an entry in `scripts/validate-upsert-conflicts.js` (see "Upsert contract" in [`00-core-rules.md`](00-core-rules.md)).
   - An operation that needs another interface, such as an RPC, a storage call or an auth admin call, documents next to it where and how the org is enforced on that path. A plain CRUD query that the helper supports uses the helper.
   - An ID that was read in this org does not replace the org filter.

**Why:** one missing filter reads or changes another org's rows, and nothing below the API catches it. Guard test: [`../../tests/org-scope-reads.test.js`](../../tests/org-scope-reads.test.js).

## 5xx responses and the support code
- **Responses** go through `respond(context, ...)` or a helper built on it.
- **A 5xx is tracked.** Its detail is stored in `error_events`, and the user gets an `error_id` that support can find by that code. **Why:** a code shown to the user that support cannot find is worse than no code, and an untracked 5xx loses the detail.
  - **With a service-role client in hand:** `respondTrackedError(context, req, client, { status, message, error })`.
  - **`respondTracked(...)`** only after `attachErrorTracking(context, req, client, ...)` ran earlier in the same request. Attach it right after the client, the auth and the org are resolved, before any code path that can answer 5xx.
  - **A local wrapper `respond<Name>Error`** must call one of the two in its body. Its name proves nothing.
  - **Exception:** a failure before a suitable client exists (missing configuration, client creation failed) uses `respond(context, 500, ...)` with `// tracked-error-exempt: <reason>` on the same line or the line above. The reason must be a real one.
- **When `error_id` is returned.** `trackErrorEvent` returns the support code only after the `error_events` row was saved. The response then carries `{ message, error_id }`, and `error_id` equals the saved `support_code`; the system-admin search finds it by exact match.
- **When tracking fails** (no client, a failed or rejected insert, or `respondTracked` without `attachErrorTracking`):
  - the response is `{ message }`, with no `error_id`;
  - the operational log gets one `context.log.error('error-events: tracking failed', …)` entry with the original error and the reason tracking failed;
  - tracking is never attempted again, so a tracking failure cannot recurse;
  - the frontend then shows a Hebrew message without a support code (`20`, "Showing an error").
- **Enforcement today.** `npm run lint:error-tracking` flags a literal `respond(context, 5xx`. It only warns, both in `npm run build` and in the `integrity-checks` CI on `main`, so neither blocks. It misses a 5xx status held in a variable and local responders, and it accepts any `respond<Name>(` call by its name, without reading the wrapper. Follow the rules above in every endpoint you add or change; the check does not yet enforce them. The existing backlog and the move to a blocking check are the deferred plan [`strict-error-tracking.md`](../plans/api/strict-error-tracking.md).

## Shared helpers to reuse
- `resolveBearerAuthorization`, `json`
- `readEnv`, `respond`, `parseRequestBody`, `normalizeString`, `normalizeNullableId`
- `ensureMembership`, `isAdminRole`, `isAdminOrOffice`, `resolveOrgId`, `createSingleClient`, `withOrgScope`
- `readSupabaseAdminConfig`, `createSupabaseAdminClient`
- `parseJsonBodyWithLimit`, `validateSessionWrite`, instructor validators in [`../../api/_shared/validation.js`](../../api/_shared/validation.js)
- `logAuditEvent`, `logTenantAuditEvent`
- Settings/permissions/storage helper modules above
- `ensureInstructorColors` in [`../../api/_shared/instructor-colors.js`](../../api/_shared/instructor-colors.js)
- `mergeMetadata` in [`../../api/_shared/metadata-utils.js`](../../api/_shared/metadata-utils.js) — use for all nested metadata patch operations; do not hand-spread metadata
- Day-name/number utilities in [`../../api/_shared/day-of-week.js`](../../api/_shared/day-of-week.js) — backend counterpart to `src/lib/day-of-week.js`
- Dates and time zones in [`../../api/_shared/local-time.js`](../../api/_shared/local-time.js) — `localDateKey`, `todayKey`, `localDateRangeUtc`, `localMonthRangeUtc`, `localDateTimeToUtc`, date-only `addDays` / `enumerateDateKeys` / `firstDayOfMonth`, `formatInstant`, technical `utcDateKey`; the only place the org's zone is resolved (`resolveOrgTimeZone`). Rules in `00-core-rules.md` "Dates and time zones".
- `ceilClockTimeToGrid`, `normalizePreferredTimesToGrid` in [`../../api/_shared/time-grid.js`](../../api/_shared/time-grid.js) — use these for 15-minute calendar/waiting-list time normalization
- `findAuthUserByEmail`, `getAuthUserById`, `getAuthUsersByIds` in [`../../api/_shared/auth-users.js`](../../api/_shared/auth-users.js) — use these when auth user emails are needed; `profiles` is not the source of truth for auth email addresses
- `resolvePublicAppBaseUrl`, `buildPublicAppHashRouteUrl`, `normalizeAbsoluteRedirectUrl` in [`../../api/_shared/public-app-url.js`](../../api/_shared/public-app-url.js) — use these for public links sent from backend flows
- `resolveClientProfileDeliveryDestination` in [`../../api/_shared/form-delivery-destination.js`](../../api/_shared/form-delivery-destination.js) — use this for form invite destinations so WhatsApp/email delivery consistently falls back from explicit request values to client profile contact fields and then the primary guardian.
- `buildAccountDisplayName`, `extractAuthDisplayName`, `getAuthNameParts`, `buildAccountUserMetadata`, `isAccountSetupComplete`, `ensureAccountProfileRow` in [`../../api/_shared/account-profile.js`](../../api/_shared/account-profile.js) — use these for canonical user profile bootstrap, setup-state checks, auth metadata sync, and derived display names after `profiles.full_name` removal
- `deliverInvitationEmail` in [`../../api/_shared/invitation-email.js`](../../api/_shared/invitation-email.js) — use this for invitation email delivery; invite flows should use Brevo as the sender while keeping Supabase only as the source of secure generated invite links/tokens
- `deliverPasswordResetEmail` in [`../../api/_shared/password-reset-email.js`](../../api/_shared/password-reset-email.js) — use this for password reset delivery; recovery emails should be generated via Supabase Auth links and sent through Brevo
- `respondTrackedError`, `trackErrorEvent`, `attachErrorTracking`, `respondTracked` in [`../../api/_shared/error-events.js`](../../api/_shared/error-events.js) — use for 5xx API failures so the client receives a safe `error_id` while raw DB/provider/stack detail is stored in `error_events` for system-admin support. Prefer `respondTrackedError(...)` for local failures where `req`, `supabase`, `orgId`, and `userId` are all in scope; use `attachErrorTracking(...)` once after auth/org resolution plus `respondTracked(...)` inside nested endpoint helpers.
- `logSystemAuditEvent` in [`../../api/_shared/audit-log.js`](../../api/_shared/audit-log.js) — use this when a backend lifecycle transition must be audited without a real authenticated actor (for example public-token expiry)

## Known patterns / do not reinvent
- API dependencies are installed and linted on Node 20; keep `api/package.json` engines, GitHub integrity checks, and the Azure Functions app Node setting aligned before upgrading packages that raise the runtime floor.
- Standard endpoint flow is:
  - `readEnv(context)`
  - `createSingleClient(env)`
  - `resolveBearerAuthorization(req)`
  - `supabase.auth.getUser(token)`
  - authorisation: for a member's request `ensureMembership(client, orgId, userId)`, stop on `null`, then the role and instructor checks the action needs (other routes: see "Org isolation in the API" above)
  - org scoping: `withOrgScope(client, table, orgId)` for every select, insert, update, upsert and delete on a tenant table; an RPC, storage or auth-admin call documents its own org enforcement ("Org isolation in the API")
  - `respond(context, ...)`
- Always set `context.res` through `respond`.
- JSON API responses sent through `respond` include default security headers (`nosniff`, referrer policy, permissions policy, HSTS). Keep endpoint-specific response headers additive unless a route has a concrete reason to override one.
- Keep frontend-facing error responses stable: never return raw DB/provider `message`, `details`, `stack`, `type`, or `debug` fields on 5xx responses, and never put raw DB/provider or exception text in a 4xx `message`. A 4xx `message` written as Hebrew business copy for users goes out through `withUserMessage(body)` (`user-message.js`, re-exported by `org-bff.js`), which adds `message_kind: 'user'`; the frontend shows only marked messages as they are (`20`, "Showing an error"). Mark the body where the wording is written: inline in the `respond` call, or in the helper that composes a whole 4xx body (for example `checkRequestedLessonStart`, `validateInstructorRateForLesson`), so every endpoint that sends it as is stays marked. Never mark in a generic path: text from a `catch`, a provider or the DB is never marked. Use stable snake_case codes that the frontend can translate, or Hebrew user copy where direct copy is unavoidable. `npm run lint:api-responses` enforces the 5xx leak contract and reports legacy English prose; `npm run lint:api-responses:strict-ux` fails on English prose after that backlog is cleaned.
- 5xx responses follow "5xx responses and the support code" above. A tracked 5xx keeps its detail in service-role-only `error_events` for 90 days and returns `{ message, error_id }` to the frontend.
- Use `resolveOrgId` or `parseRequestBody` instead of ad hoc request parsing.
- Use body-size-aware parsing for write endpoints.
- Auth/membership checks happen first; tenant reads and writes are always org-scoped (see "Org isolation in the API" above).
- Exact user email lookup must go through the auth admin API (`auth.users`) via shared helpers. Do not query `profiles.email` — that column is not part of the canonical schema.
- `public.profiles` no longer stores `full_name`. Canonical user profile fields are `first_name`, `last_name`, `identity_number`, `phone`, `setup_completed_at`, `account_status`, and `deactivated_at`. Any display name returned from APIs should be derived from first/last name with auth/email fallback.
- User-scoped profile mutations should go through `/api/me`, not ad hoc writes in unrelated endpoints. If another flow needs to ensure a profile row exists or derive a user display name, use `account-profile.js` helpers instead of duplicating bootstrap logic.
- Public links generated by backend endpoints must prefer the actual request/browser origin (`origin` / `referer` / forwarded host) over static env values. Env-provided app URLs are fallbacks only, not the primary source of truth.
- Invitation resend flows should rotate the existing pending invitation token in place when possible, then audit the resend event. Do not create revoked chains of replacement rows for the same still-pending invite.
- Invitation email delivery should use Brevo as the actual sender. Supabase Auth remains the canonical token/link issuer via `auth.admin.generateLink(...)`, but backend invite flows should not depend on Supabase-delivered invite emails.
- For already-confirmed existing users, do not send them through the account-setup invite flow. Send a direct org-invitation email through Brevo that links into the in-app accept flow, while leaving Supabase Auth invite links for new or unconfirmed users.
- Password reset initiation should follow the same pattern: public backend endpoint, Supabase-generated recovery link, Brevo delivery, and a generic success response that does not disclose whether the email exists.
- Invitation flows should audit the full lifecycle when applicable: sent, resent, accepted, declined, revoked, expired, and send failures. Use `resourceType: 'invitation'` and the invitation id as the canonical audit resource.
- Account lifecycle flows should audit profile updates, setup completion, deactivation, reactivation, and blocked deactivation/reactivation attempts. Deactivation reason belongs in audit `details`, not on `profiles`.
- System-admin cross-tenant controls must be review-first: queue action requests (for example in `permission_registry` with `system.request.*` keys) and audit with `logAuditEvent` instead of executing destructive org changes inline.
- For `withOrgScope(...).upsert(...)`, the `onConflict` target must include `org_id` whenever the table unique key includes `org_id` (for example `org_id,key` or `org_id,employee_id,service_id`).
