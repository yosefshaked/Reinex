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
- [`../api/_shared/time-grid.js`](../api/_shared/time-grid.js)
- [`../api/_shared/instructor-colors.js`](../api/_shared/instructor-colors.js)
- [`../api/_shared/metadata-utils.js`](../api/_shared/metadata-utils.js)
- [`../api/_shared/public-app-url.js`](../api/_shared/public-app-url.js)
- [`../api/_shared/account-profile.js`](../api/_shared/account-profile.js)

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
- `ceilClockTimeToGrid`, `normalizePreferredTimesToGrid` in [`../api/_shared/time-grid.js`](../api/_shared/time-grid.js) — use these for 15-minute calendar/waiting-list time normalization
- `findAuthUserByEmail`, `getAuthUserById`, `getAuthUsersByIds` in [`../api/_shared/auth-users.js`](../api/_shared/auth-users.js) — use these when auth user emails are needed; `profiles` is not the source of truth for auth email addresses
- `resolvePublicAppBaseUrl`, `buildPublicAppHashRouteUrl`, `normalizeAbsoluteRedirectUrl` in [`../api/_shared/public-app-url.js`](../api/_shared/public-app-url.js) — use these for public links sent from backend flows
- `resolveClientProfileDeliveryDestination` in [`../api/_shared/form-delivery-destination.js`](../api/_shared/form-delivery-destination.js) — use this for form invite destinations so WhatsApp/email delivery consistently falls back from explicit request values to client profile contact fields and then the primary guardian.
- `buildAccountDisplayName`, `extractAuthDisplayName`, `getAuthNameParts`, `buildAccountUserMetadata`, `isAccountSetupComplete`, `ensureAccountProfileRow` in [`../api/_shared/account-profile.js`](../api/_shared/account-profile.js) — use these for canonical user profile bootstrap, setup-state checks, auth metadata sync, and derived display names after `profiles.full_name` removal
- `deliverInvitationEmail` in [`../api/_shared/invitation-email.js`](../api/_shared/invitation-email.js) — use this for invitation email delivery; invite flows should use Brevo as the sender while keeping Supabase only as the source of secure generated invite links/tokens
- `deliverPasswordResetEmail` in [`../api/_shared/password-reset-email.js`](../api/_shared/password-reset-email.js) — use this for password reset delivery; recovery emails should be generated via Supabase Auth links and sent through Brevo
- `respondTrackedError`, `trackErrorEvent`, `attachErrorTracking`, `respondTracked` in [`../api/_shared/error-events.js`](../api/_shared/error-events.js) — use for 5xx API failures so the client receives a safe `error_id` while raw DB/provider/stack detail is stored in `error_events` for system-admin support. Prefer `respondTrackedError(...)` for local failures where `req`, `supabase`, `orgId`, and `userId` are all in scope; use `attachErrorTracking(...)` once after auth/org resolution plus `respondTracked(...)` inside nested endpoint helpers.
- `logSystemAuditEvent` in [`../api/_shared/audit-log.js`](../api/_shared/audit-log.js) — use this when a backend lifecycle transition must be audited without a real authenticated actor (for example public-token expiry)

## Known patterns / do not reinvent
- API dependencies are installed and linted on Node 20; keep `api/package.json` engines, GitHub integrity checks, and the Azure Functions app Node setting aligned before upgrading packages that raise the runtime floor.
- Standard endpoint flow is:
  - `readEnv(context)`
  - `createSingleClient(env)`
  - `resolveBearerAuthorization(req)`
  - `supabase.auth.getUser(token)`
  - `ensureMembership(...)`
  - `withOrgScope(...)` or explicit `.eq('org_id', orgId)`
  - `respond(context, ...)`
- Always set `context.res` through `respond`.
- JSON API responses sent through `respond` include default security headers (`nosniff`, referrer policy, permissions policy, HSTS). Keep endpoint-specific response headers additive unless a route has a concrete reason to override one.
- Keep frontend-facing error responses stable: never return raw DB/provider `message`, `details`, `stack`, `type`, or `debug` fields on 5xx responses. Use stable snake_case codes that the frontend can translate, or Hebrew user copy where direct copy is unavoidable. `npm run lint:api-responses` enforces the 5xx leak contract and reports legacy English prose; `npm run lint:api-responses:strict-ux` fails on English prose after that backlog is cleaned.
- 5xx responses that have a service-role client available should prefer `respondTrackedError(...)` or the attached-context `respondTracked(...)` wrapper. This stores full internal detail in service-role-only `error_events` for 90 days and returns `{ message, error_id }` to the frontend. Pre-client configuration failures may remain direct `respond(context, 500, ...)` because there is no reliable service-role client for tracking.
- Use `resolveOrgId` or `parseRequestBody` instead of ad hoc request parsing.
- Use body-size-aware parsing for write endpoints.
- Auth/membership checks happen first; tenant reads/writes must always be org-scoped in the shared single DB.
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
