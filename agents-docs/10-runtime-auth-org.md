# 10 Runtime Auth Org

## When to read
- Login issues.
- Runtime config boot issues.
- Org selection, active org, tenant client, or auth lifecycle changes.

## Load these files first
- [`../src/main.jsx`](../src/main.jsx)
- [`../src/runtime/config.js`](../src/runtime/config.js)
- [`../src/context/SupabaseContext.jsx`](../src/context/SupabaseContext.jsx)
- [`../src/lib/supabase-manager.js`](../src/lib/supabase-manager.js)
- [`../src/auth/AuthContext.jsx`](../src/auth/AuthContext.jsx)
- [`../src/auth/AuthGuard.jsx`](../src/auth/AuthGuard.jsx)
- [`../src/org/OrgContext.jsx`](../src/org/OrgContext.jsx)
- [`../src/pages/Login.jsx`](../src/pages/Login.jsx)
- [`../src/pages/OrgSelection.jsx`](../src/pages/OrgSelection.jsx)
- [`../src/api/organizations.js`](../src/api/organizations.js)

## Shared helpers to reuse
- `loadRuntimeConfig`, `activateConfig`, `getCurrentConfig`, `waitConfigReady` in [`../src/runtime/config.js`](../src/runtime/config.js)
- `initializeAuthClient`, `getAuthClient`, `createDataClient` in [`../src/lib/supabase-manager.js`](../src/lib/supabase-manager.js)
- `useSupabase`, `useAuth`, `useOrg`
- Org creation wrapper in [`../src/api/organizations.js`](../src/api/organizations.js)

## Known patterns / do not reinvent
- App boot starts in [`../src/main.jsx`](../src/main.jsx); auth/org providers are part of the main route tree.
- Control DB auth client is initialized from runtime config once; do not create extra global Supabase auth clients.
- Active org handling is separate from auth handling:
  - control DB session/memberships come from `AuthContext` + `OrgContext`
  - tenant data client is built from active org config in `SupabaseContext`
- `OrgContext` loads memberships from control DB, stores `active_org_id`, and fetches tenant runtime config separately.
- If you need org-aware frontend data, use `useOrg()` and existing wrappers instead of rebuilding org/session lookup.
