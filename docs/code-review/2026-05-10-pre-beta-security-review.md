# Code Review: Pre-Beta Security (SWA + Azure Functions + Supabase)
**Ready for Production**: No (after critical fixes)
**Critical Issues**: 1

## Scope
- Backend APIs in `api/*` (authn/authz, tenant isolation, error handling)
- Frontend API client and runtime config (`src/lib/api-client.js`, `src/runtime/config.js`)
- Edge configuration (`staticwebapp.config.json`, `public/staticwebapp.config.json`)

## Priority 1 (Must Fix) ⛔
- Secret material present in local settings file in workspace (`api/local.settings.json`).
  - Risk: accidental commit or copy to logs/issues can leak `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS and enables full data access.
  - Evidence: `api/local.settings.json` contains populated `SUPABASE_SERVICE_ROLE_KEY`.
  - Fix:
    - Ensure `api/local.settings.json` is never committed and rotate any leaked key.
    - Keep only placeholders in `api/local.settings.example.json`.
    - Add CI secret scanning (for example Gitleaks/TruffleHog) and block pushes on key patterns.

## Priority 2 (Should Fix Before Broad Beta) ⚠️
- API gateway allows anonymous access to all `/api/*`, relying only on per-function checks.
  - Risk: one missed auth check in any endpoint becomes a public data/API exposure.
  - Evidence: `staticwebapp.config.json` and `public/staticwebapp.config.json` route `/api/*` with `allowedRoles: ["anonymous", "authenticated"]`.
  - Fix:
    - Default `/api/*` to `authenticated`.
    - Explicitly allowlist truly public endpoints (`/api/config`, `/api/announcement`, optionally `/api/health`).
    - Keep public endpoints minimal and read-only.

- Insufficient edge hardening headers.
  - Risk: increased XSS/clickjacking/MIME-sniffing blast radius if UI or dependency issue appears.
  - Evidence: no `globalHeaders` with CSP/HSTS/frame/sniff protections in `staticwebapp.config.json` and `public/staticwebapp.config.json`.
  - Fix:
    - Add strict `Content-Security-Policy`.
    - Add `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
    - Enable HSTS in production domain path.

- Internal error messages are returned to clients in some endpoints.
  - Risk: information disclosure (schema internals, provider internals, stack hints).
  - Evidence:
    - `api/documents-download/index.js` returns `details: driverError.message` and `details: error.message`.
    - `api/guardians/index.js` returns `message: error.message` in several 500 responses.
  - Fix:
    - Return stable generic messages externally (e.g., `internal_error`), log details server-side only.
    - Add error code mapping for expected classes (`storage_unavailable`, `validation_failed`, etc.).

## Priority 3 (Can Follow in Early Beta) ℹ️
- Health endpoint leaks secret-presence telemetry publicly.
  - Risk: reconnaissance signal for attackers (which secret classes are configured).
  - Evidence: `api/health/index.js` returns booleans for `SUPABASE_SERVICE_ROLE_KEY`, `SECURITY_ENCRYPTION_SECRET` presence.
  - Fix:
    - Restrict `api/health` to authenticated admin/system-admin or only return a generic `ok` externally.

- Broad CORS on announcement endpoint.
  - Risk: low for current payload, but pattern can spread to sensitive endpoints.
  - Evidence: `api/announcement/index.js` sets `Access-Control-Allow-Origin: *`.
  - Fix:
    - Keep only if endpoint is intentionally public and non-sensitive; otherwise pin origin.

## Positive Findings
- Most sensitive endpoints follow a strong pattern: bearer validation + `supabase.auth.getUser(token)` + membership check + org-scoped queries (`ensureMembership`, `withOrgScope`).
- System-admin endpoints enforce MFA (`aal2`) + `is_system_admin` flag checks (`ensureSystemAdmin`), which is a strong control.
- Admin clients disable token persistence and refresh in server runtime.

## Recommended Changes (Code Examples)
```json
{
  "routes": [
    { "route": "/api/config", "allowedRoles": ["anonymous"] },
    { "route": "/api/announcement", "allowedRoles": ["anonymous"] },
    { "route": "/api/health", "allowedRoles": ["authenticated"] },
    { "route": "/api/*", "allowedRoles": ["authenticated"] }
  ],
  "globalHeaders": {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co https://*.posthog.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  }
}
```

```js
// Example error sanitation pattern
try {
  // operation
} catch (error) {
  context.log?.error?.('documents-download failed', {
    message: error?.message,
    code: error?.code,
  });
  return respond(context, 500, { error: 'internal_error' });
}
```

## Verification Checklist
- Run secret scan in CI and local pre-push.
- Validate all public endpoints are intentionally public and documented.
- Confirm CSP does not break Supabase/PostHog traffic.
- Re-test key endpoints with invalid tokens and cross-org IDs.
- Verify no API returns raw exception text in production mode.
