# AGENTS (Reinex)

The binding entry point for every agent working in this repository. `CLAUDE.md` only loads this file.

## What Reinex is
A multi-tenant management system for therapeutic riding farms and clinics: scheduling, students and clients, billing and HMO claims, staff payroll, forms and messaging. The UI is in Hebrew (right to left); every text the product shows a user is Hebrew (the full rule is in [`20`](docs/project-rules/20-frontend-shared-helpers.md) "The product speaks Hebrew"). The API is Azure Functions (Node, ESM) in `api/`; the frontend is React and Vite in `src/`; data is in one Supabase Postgres project.

## Hard limits
- **`main` needs explicit owner approval.** Never push to `main` or merge into it without the owner's explicit approval for that push or merge. **Why:** a push to `main` runs the Azure Static Web Apps deployment workflow.

## Always-on rules
- **Where to start.** Read the [`docs/project-rules/`](docs/project-rules/) document for your task (routing table below) and start from its "Start here" files. Continue as far as the change needs: imports, callers (grep the symbol), dependencies, cross-domain effects and tests. **Why:** a fixed file list misses callers and existing tests.
- **One database, many orgs.** Every tenant table has `org_id`; tenant schema is `public` only. The frontend sends `x-org-id` on every API call through `authenticatedFetch` (`src/lib/api-client.js`). **Why:** all orgs share one project, so the org travels with every request.
- **Org isolation in the API.** Authorise first (for a member: `ensureMembership`, stop on `null`, then role and instructor limits), then scope every tenant table operation with `withOrgScope(client, table, orgId)`. Full rule: [`30`](docs/project-rules/30-backend-shared-helpers.md) "Org isolation in the API". **Why:** the API's service-role client bypasses RLS, so one missing filter crosses orgs.
- **5xx responses are tracked** through `respondTrackedError`, or `respondTracked` after `attachErrorTracking`, or a local wrapper that calls one of them. Full rule and today's gaps: [`30`](docs/project-rules/30-backend-shared-helpers.md) "5xx responses and the support code". **Why:** support finds a failure only by its saved `error_id`.
- **Endpoint shape.** Return through `respond(context, ...)`; read auth with `resolveBearerAuthorization(req)`; a new function needs `function.json`. Details: [`00`](docs/project-rules/00-core-rules.md). **Why:** shared response headers, auth parsing and host loading depend on it.
- **Routes are domain-based.** No `reinex` in route names, and none that start with `admin`. **Why:** routes name the domain, and Azure reserves `/admin/*`.
- **Instructors are self-scoped** unless the membership role is `admin` or `owner`. **Why:** an instructor's access is limited to their own data.
- **Disable, don't delete.** Services are enabled and disabled with `is_active`. **Why:** history and reports keep pointing to them.
- **Dates and money.** Local days and months come from `api/_shared/local-time.js` in the org's zone; money is agorot integers through the currency helpers. ESLint enforces both. Details: [`00`](docs/project-rules/00-core-rules.md). **Why:** a UTC date cut moves a lesson to the wrong day or month, and float shekels drift.
- **Do not reinvent.** Check the helper docs in `docs/project-rules/` before adding fetch, validation, date, currency, schema or formatting utilities, and keep page code thin: shared logic goes in `src/lib`, `src/hooks`, `src/api` and `api/_shared`. **Respect coupling:** never bypass a documented side effect (for example, a calendar change that triggers billing). **Why:** duplicates and bypasses break the invariants the domain files describe.
- **Escape hatch.** If the existing helpers are inadequate, or you see a clearly better approach, do not hack around the rules: stop, write `NEW PATTERN PROPOSAL:` with a short explanation, and wait for approval.
- **Tests for every behaviour change.** Identify which test proves the behaviour that changed. Update or add a Node test for logic, and a tester scenario (`tests/automatic-tester/`) when a user flow is affected; if both are affected, cover both. If existing coverage already proves the requirement, run it. A documentation change gets the verification that fits it. How to find and run tests: [`00`](docs/project-rules/00-core-rules.md) "Finding and running tests". **Why:** a change is done only when something proves it.
- **Keep documentation current.** When a change makes an existing instruction, product rule, command, path, or plan checkpoint inaccurate, update its authoritative document in the same change. Record new shared contracts and cross-domain effects in the relevant domain guide. Review the documents referenced by the work you touched. If they remain accurate, no documentation edit is needed. If you are unsure where a rule belongs, end your response with `DOC UPDATE REQUIRED:` and what is missing.
- **Commits** use Conventional Commits; the policy is [`docs/project-rules/commits.md`](docs/project-rules/commits.md).

## Routing: read by task

| Task | Rules | Tests to start from |
|---|---|---|
| Any task; tenant access, invitations, functions, services, dates, money, schema | [`00-core-rules.md`](docs/project-rules/00-core-rules.md) | `tests/org-scope-reads.test.js`, `api/_shared/local-time.test.js` |
| Runtime config, auth, org switching | [`10-runtime-auth-org.md`](docs/project-rules/10-runtime-auth-org.md) | `src/runtime/config.test.js`, `api/config/index.test.js` |
| Frontend helpers and API wrappers | [`20-frontend-shared-helpers.md`](docs/project-rules/20-frontend-shared-helpers.md) | `tests/round.test.js` |
| Backend endpoint helpers, org isolation, 5xx | [`30-backend-shared-helpers.md`](docs/project-rules/30-backend-shared-helpers.md) | `api/_shared/error-events.test.js` |
| Students, client profiles, guardians | [`40-students-and-clients.md`](docs/project-rules/40-students-and-clients.md) | `git grep` the module in `*.test.js` |
| Employees and instructors | [`50-employees-and-instructors.md`](docs/project-rules/50-employees-and-instructors.md) | `tests/instructor-capabilities.test.js`, `tests/employee-overview.test.js` |
| Calendar, templates, attendance, sessions | [`60-calendar-and-sessions.md`](docs/project-rules/60-calendar-and-sessions.md), [`finance-calendar-change-checklist.md`](docs/project-rules/finance-calendar-change-checklist.md) | `tests/finance-calendar-workflows.test.js` |
| Forms, shared blocks, waiting list | [`70-forms-and-waiting-list.md`](docs/project-rules/70-forms-and-waiting-list.md) | `api/_shared/waiting-list-matching.test.js` |
| Billing, HMO, commitments, payroll, leave | [`80-finance-billing-payroll.md`](docs/project-rules/80-finance-billing-payroll.md); before a change to finance behaviour, the [finance workflow contract](implementations/finance/ledger/finance-workflow-contract-v1.md); before a finance rollout, the [release hardening protocol](implementations/finance/ledger/finance-workflow-release-hardening-v1.md) | `tests/payroll-rules.test.js`, `tests/pay-calculation.test.js` |
| Settings, documents, storage, backup, audit | [`90-settings-documents-storage.md`](docs/project-rules/90-settings-documents-storage.md) | `api/_shared/backup-history.test.js` |
| System-admin console, `admin_data`, `email_log`, banner | [`95-system-admin-console.md`](docs/project-rules/95-system-admin-console.md) | `api/_shared/email-log.test.js` |
| Committing work | [`commits.md`](docs/project-rules/commits.md) | — |
| Continuing a plan | the plan's "Resume here" block; overall status in [`docs/plans/index.csv`](docs/plans/index.csv) | `npm run lint:plans` |

User-facing page, action and dialog tree: [`docs/app-workflow-tree.md`](docs/app-workflow-tree.md).

## After writing code — required validation
Run the matching npm scripts (defined in `package.json`) before the task is done. This is the only copy of this table.

| Files changed | Command |
|---|---|
| `src/lib/setup-sql.js` | `npm run lint:sql` |
| `src/lib/setup-sql.js` plus a migration | `npm run lint:sql && npm run lint:upsert-conflicts` |
| `api/**/*.js`, any `.upsert({ onConflict })` added or changed | `npm run lint:upsert-conflicts` (contract: [`00`](docs/project-rules/00-core-rules.md) "Upsert contract") |
| `scripts/validate-upsert-conflicts.js` | `npm run lint:upsert-conflicts` |
| `scripts/validate-setup-sql.js` | `npm run lint:sql` |
| `api/**/*.js`, general | `npm run lint:api` |
| `src/**/*.js`, `src/**/*.jsx` | `npm run lint` |
| Finance, billing or payroll logic | `npm run test:finance-calendar`, plus the tests of the changed module |
| A plan or `docs/plans/index.csv` | `npm run lint:plans` |
| `AGENTS.md` or `docs/project-rules/**` | `npm run lint:doc-links` (every relative link, resolved from its own file, must reach an existing file or folder) |
| Before a deploy, or a full check | `npm run build` (its steps are the `build` script in `package.json`; it runs no tests and not `lint:upsert-conflicts`) |
