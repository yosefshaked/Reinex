# 10 Runtime Auth Org

## When to read
- Login issues.
- Runtime config boot issues.
- Org selection, active org, or auth lifecycle changes.

## Load these files first
- [`../src/main.jsx`](../src/main.jsx)
- [`../src/runtime/config.js`](../src/runtime/config.js)
- [`../src/context/SupabaseContext.jsx`](../src/context/SupabaseContext.jsx)
- [`../src/lib/supabase-manager.js`](../src/lib/supabase-manager.js)
- [`../src/auth/AuthContext.jsx`](../src/auth/AuthContext.jsx)
- [`../src/auth/AuthGuard.jsx`](../src/auth/AuthGuard.jsx)
- [`../src/account/AccountContext.jsx`](../src/account/AccountContext.jsx)
- [`../src/org/OrgContext.jsx`](../src/org/OrgContext.jsx)
- [`../src/pages/Login.jsx`](../src/pages/Login.jsx)
- [`../src/pages/OrgSelection.jsx`](../src/pages/OrgSelection.jsx)
- [`../src/pages/AccountSetupPage.jsx`](../src/pages/AccountSetupPage.jsx)
- [`../src/pages/AccountReactivationPage.jsx`](../src/pages/AccountReactivationPage.jsx)
- [`../src/api/organizations.js`](../src/api/organizations.js)

## Shared helpers to reuse
- `loadRuntimeConfig`, `activateConfig`, `getCurrentConfig`, `waitConfigReady` in [`../src/runtime/config.js`](../src/runtime/config.js)
- `initializeAuthClient`, `getAuthClient` in [`../src/lib/supabase-manager.js`](../src/lib/supabase-manager.js)
- `useSupabase`, `useAuth`, `useAccount`, `useOrg`
- Org creation wrapper in [`../src/api/organizations.js`](../src/api/organizations.js)

## Known patterns / do not reinvent
- App boot starts in [`../src/main.jsx`](../src/main.jsx); auth/org providers are part of the main route tree.
- Single-DB auth client is initialized from runtime config once; do not create extra global Supabase auth clients.
- `SupabaseContext` exposes one runtime client for both auth and data access.
- `AccountProvider` is the canonical runtime source for the signed-in user's personal profile/setup state; load personal-account state through it instead of duplicating `/api/me` calls inside layout code.
- `OrgContext` loads memberships from the shared DB and stores `active_org_id`; no per-org credential fetch happens during org switching.
- Access-token rotation and short tab switches must not be treated as a signal to reload account/org/page data. React to meaningful auth identity changes (login/logout/user switch), not every session object refresh.
- Account setup gating happens before org selection. Authenticated users with incomplete personal profile data must be redirected to `/account/setup` before entering the app shell or org picker.
- Setup gating must preserve continuation context. If setup interrupts `/accept-invite` or another authenticated flow, route through `/account/setup?returnTo=...` and send the user back to the interrupted path after save.
- Disabled accounts are enforced at the app-account layer: authenticated disabled users are redirected to `/account/reactivate` until they reactivate themselves.
- Auth emails should not be sent directly from the frontend runtime client. Invitation and password-reset emails should go through backend endpoints that use Brevo for delivery, while the frontend continues to use Supabase only for session/token verification and password update.
- `organizations.setup_completed` is intentionally retained as an onboarding/readiness flag. Do not remove it as "legacy" even in single-DB mode.
- Frontend API calls carry org context using `x-org-id` (via [`../src/lib/api-client.js`](../src/lib/api-client.js)).
- If you need org-aware frontend data, use `useOrg()` and existing wrappers instead of rebuilding org/session lookup.
- Personal account management is a first-class header action under `/account`; org switching moved to the logo click target rather than living in org settings.
- The top-header account button is user-scoped, not org-scoped. Keep personal settings separate from organization settings and org switching.
- App-shell stale-data UX should prefer an explicit refresh prompt after meaningful inactivity (currently 5 minutes hidden) instead of forcing automatic refresh on every quick return to the tab.
- Keep `/system-admin/mfa` reachable as an admin recovery route even when the current session is `aal1` (lost/replaced authenticator scenario); do not redirect away from it during MFA enforcement.
