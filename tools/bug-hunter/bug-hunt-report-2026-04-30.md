# Bug-hunt report — 2026-04-30

Summary of automated exploratory session (user-like interactions): opened the app, reached the login screen, waited 10s, then exercised the authenticated UI (Calendar, New Lesson modal, Students list, Student profile + Edit dialog). Captured console warnings and network failures.

Findings
- **Missing FullCalendar scheduler license** (High):
  - Evidence: console warning on /#/calendar — "FullCalendar scheduler license key is missing. Set VITE_FULLCALENDAR_SCHEDULER_LICENSE_KEY or provide it via runtime config."
  - Impact: scheduler features may be limited or produce warnings; set the runtime config or build-time env var with a valid license key.

- **Dialog accessibility missing description** (Medium):
  - Evidence: console warning when opening dialogs — "Missing `Description` or `aria-describedby={undefined}` for {DialogContent}."
  - Impact: screen readers won't receive adequate context for dialogs. Recommend adding `aria-describedby` or a descriptive element for DialogContent components.

- **Analytics / network errors** (Medium):
  - Evidence: multiple `net::ERR_ABORTED` failures observed for PostHog endpoints (e.g., `eu.i.posthog.com/*`) during page load, and a failed supabase auth logout POST.
  - Impact: analytics events lost; investigate network/CSP/third-party availability or client-side error handling.

- **Missing/aborted asset(s)** (Low):
  - Evidence: initial load showed a 404 / aborted request for an assets file (index-*.js). This may be a cache/manifest mismatch on static hosting.
  - Impact: possible JS bundle mismatch; verify deployment artifact names and CDN/browser caches.

- **Currency display / sign formatting** (Low):
  - Evidence: student financial card shows negative amount formatted like `₪-375.00` in one place and other balances elsewhere; review currency formatting rules for consistency.

Notes about PII: some pages rendered test PII (phone, ID). I redacted any sensitive values from this report. If you want the raw captures, I can save them to a secure artifact store or share privately.

Artifacts captured during the session (available in the interactive session):
- Screenshots: login, dashboard, calendar, students list, student profile (edit dialog)
- Page snapshots and recent console/network events captured while navigating Calendar and Students sections

Suggested next steps
- Fix runtime config for FullCalendar scheduler (set `VITE_FULLCALENDAR_SCHEDULER_LICENSE_KEY` or provide license at runtime).
- Add `aria-describedby`/description to DialogContent components to satisfy accessibility requirements.
- Investigate aborted analytics requests and supabase logout failures (network, CSP, or blocked third-party requests).
- Verify static asset manifest and deployment to ensure no stale 404/aborted assets remain.
- Optionally: allow me to test OAuth flows (Google/Microsoft) or the "forgot password" flow — I will need credentials or consent to exercise auth flows.

If you'd like, I can:
- run a focused automation to reproduce and capture logs for any single issue above, or
- open a PR with an accessibility patch for dialogs and/or a runtime config guard for FullCalendar.

-- automated bug-hunt tool
