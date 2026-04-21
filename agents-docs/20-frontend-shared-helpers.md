# 20 Frontend Shared Helpers

## When to read
- New page, dialog, hook, or frontend API call.
- Any task that needs shared fetch, formatting, date, currency, name, availability, or error helpers.

## Load these files first
- [`../src/lib/api-client.js`](../src/lib/api-client.js)
- [`../src/hooks/useOrgData.js`](../src/hooks/useOrgData.js)
- [`../src/api/`](../src/api/)
- [`../src/api/me.js`](../src/api/me.js)
- [`../src/features/settings/api/settings.js`](../src/features/settings/api/settings.js)
- [`../src/features/settings/api/storage.js`](../src/features/settings/api/storage.js)
- [`../src/lib/currency.js`](../src/lib/currency.js)
- [`../src/lib/date.js`](../src/lib/date.js)
- [`../src/lib/day-of-week.js`](../src/lib/day-of-week.js)
- [`../src/lib/format-name.js`](../src/lib/format-name.js)
- [`../src/lib/instructor-availability.js`](../src/lib/instructor-availability.js)
- [`../src/lib/utils.js`](../src/lib/utils.js)
- [`../src/lib/error-utils.js`](../src/lib/error-utils.js)
- [`../src/lib/error-mapping.js`](../src/lib/error-mapping.js)
- [`../src/lib/invite-tokens.js`](../src/lib/invite-tokens.js)
- [`../src/lib/external-links.js`](../src/lib/external-links.js)

## Shared helpers to reuse
- `cn` (classname merger via `clsx` + `tailwind-merge`) in [`../src/lib/utils.js`](../src/lib/utils.js) — use this for all conditional className composition
- `asError`, `SupabaseHttpError`, `MissingRuntimeConfigError` in [`../src/lib/error-utils.js`](../src/lib/error-utils.js)
- `authenticatedFetch`, `authenticatedFetchBlob`, `authenticatedFetchText`
- `useStudents`, `useInstructors`, `useServices`, `useClientProfiles`
- API wrappers in [`../src/api/`](../src/api/) and [`../src/features/settings/api/`](../src/features/settings/api/)
- `fetchMyAccount`, `updateMyAccount`, `deactivateMyAccount`, `reactivateMyAccount` in [`../src/api/me.js`](../src/api/me.js)
- `useAccount` in [`../src/account/AccountContext.jsx`](../src/account/AccountContext.jsx) — use this as the canonical frontend source for signed-in user profile/setup/disabled state
- Password reset requests should use [`../src/api/password-reset.js`](../src/api/password-reset.js) instead of calling `supabase.auth.resetPasswordForEmail(...)` directly from UI/auth context
- `toAgorot`, `toShekel`, `coerceAgorot`, `formatCurrency`
- `parseDateStrict`, `toISODateString`, `isValidRange`, `isFullMonthRange`
- `normalizeDayToken`, `dayLabel`, `daySortValue`
- `formatStudentName`, `formatInstructorName`, `formatName`
- `formatUserAccountName`
- `normalizeAvailabilityWindows`, `getAvailabilitySummary`, `buildAvailabilityTimeSlots`
- `mapLooseSessionError`
- `extractRegistrationTokens`, `extractInvitationToken`, `buildInvitationSearch`
- `normalizeExternalHttpUrl`

## Known patterns / do not reinvent
- Default to [`../src/lib/api-client.js`](../src/lib/api-client.js) for authenticated requests.
- Public auth-email initiation flows (for example password reset) should still use shared frontend API wrappers rather than direct Supabase email-sending methods, so delivery stays centralized on backend Brevo helpers.
- Personal-account screens should use `AccountContext` + `src/api/me.js`; do not read/write `profiles` directly from page components.
- First-join completion is handled as a blocking account flow, not a loose optional profile form. Reuse [`../src/features/account/components/AccountProfileForm.jsx`](../src/features/account/components/AccountProfileForm.jsx) for setup/edit screens before inventing another user-details form.
- `authenticatedFetch` automatically adds `x-org-id` from `active_org_id` local storage; do not hand-build this header in feature code.
- Prefer [`../src/hooks/useOrgData.js`](../src/hooks/useOrgData.js) for org-scoped lists before writing a new fetch hook.
- The private `authenticatedFetch` inside [`../src/org/OrgContext.jsx`](../src/org/OrgContext.jsx) is local to that provider; do not copy it elsewhere.
- [`../src/hooks/useDocuments.js`](../src/hooks/useDocuments.js) is a special-case raw-fetch hook for document upload/download flows; use it only for document work.
- Money is carried as agorot integers across API/DB boundaries.
- Treat account names as derived values. Use `formatUserAccountName` or the `displayName` returned by `useAccount()` / `fetchMyAccount()`; do not assume `profiles.full_name` exists on the frontend data model.
- [`../src/lib/selectors.js`](../src/lib/selectors.js) is deprecated; do not reuse or extend it.
- `createDataClient` is deprecated/removed in the single-DB model; do not reintroduce tenant client creation on the frontend.
