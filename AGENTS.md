# AGENTS (Reinex)

Read this first. Detailed task docs live in [`./docs/project-rules`](docs/project-rules/).

## Global Rules
- **Architecture: Single-Database Multi-Tenant.** All tenant data lives in one Supabase project. Every tenant table has an `org_id uuid NOT NULL` column. RLS is the primary isolation mechanism.
- Tenant DB schema is `public` only.
- Backend APIs use the `service_role` key (RLS bypass); org isolation is enforced programmatically via `ensureMembership()` + `.eq('org_id', orgId)` or `withOrgScope(client, table, orgId)`.
- **Never use `resolveTenantClient()`** — it is a deprecated BYOD shim. Use `createSingleClient(env)` from `api/_shared/org-bff.js`.
- The frontend injects `x-org-id: activeOrgId` on every API call via `authenticatedFetch` in `src/lib/api-client.js`.
- Do not put `reinex` in API route names; keep routes domain-based.
- Instructors are self-scoped unless the membership role is `admin` or `owner`.
- Azure Functions must return through `respond(context, ...)` and extract auth with `resolveBearerAuthorization(req)`.
- `supabase.auth.getUser(token)` returns `{ data, error }`; user is `result.data.user`.
- Services are enabled/disabled with `is_active`; do not model disablement as deletion.

## ⚠️ AI Rules of Engagement & The Escape Hatch
1. **Context Economy:** Read the specific `docs/project-rules/XX-domain.md` file for your task. Load ONLY the source files listed there to save tokens.
2. **Do Not Reinvent:** Strictly use the shared helpers, hooks, and utilities documented in the hub.
3. **Respect Coupling:** Never bypass side-effects (e.g., calendar triggering billing) documented in the domain files.
4. **💡 The Escape Hatch (Think Outside the Box):** If you believe the existing architecture/helpers are inadequate for a new feature, or if you see a significantly better, modern approach: DO NOT silently hack around the rules. Instead, stop and output `🚨 NEW PATTERN PROPOSAL:`. Briefly explain your idea and wait for human approval before coding.
5. **🔄 Keep the Hub Alive (Doc Updates):** The documentation must evolve with the code. If you create a new shared helper, establish a new architectural pattern, or introduce a new cross-domain side-effect (coupling), you MUST surgically update the relevant `docs/project-rules/XX-domain.md` file before considering your task complete. If you are unsure where the new rule belongs, output `📝 DOC UPDATE REQUIRED:` at the end of your response to flag it for human review.

## Read By Task
- Repo-wide rules and invariants: [`docs/project-rules/00-core-rules.md`](docs/project-rules/00-core-rules.md)
- Runtime config, auth, org switching: [`docs/project-rules/10-runtime-auth-org.md`](docs/project-rules/10-runtime-auth-org.md)
- Shared frontend helpers and API wrappers: [`docs/project-rules/20-frontend-shared-helpers.md`](docs/project-rules/20-frontend-shared-helpers.md)
- Shared backend endpoint helpers: [`docs/project-rules/30-backend-shared-helpers.md`](docs/project-rules/30-backend-shared-helpers.md)
- Students, client profiles, guardians: [`docs/project-rules/40-students-and-clients.md`](docs/project-rules/40-students-and-clients.md)
- Employees and instructors: [`docs/project-rules/50-employees-and-instructors.md`](docs/project-rules/50-employees-and-instructors.md)
- Calendar, templates, attendance, sessions: [`docs/project-rules/60-calendar-and-sessions.md`](docs/project-rules/60-calendar-and-sessions.md)
- Forms, shared blocks, waiting list: [`docs/project-rules/70-forms-and-waiting-list.md`](docs/project-rules/70-forms-and-waiting-list.md)
- Billing, HMO, commitments, payroll: [`docs/project-rules/80-finance-billing-payroll.md`](docs/project-rules/80-finance-billing-payroll.md)
- Finance workflow baseline contract (must read before finance behavior changes): [`implementations/finance/ledger/finance-workflow-contract-v1.md`](implementations/finance/ledger/finance-workflow-contract-v1.md)
- Finance workflow release hardening protocol (must read before finance rollout): [`implementations/finance/ledger/finance-workflow-release-hardening-v1.md`](implementations/finance/ledger/finance-workflow-release-hardening-v1.md)
- Settings, documents, storage, backup, audit: [`docs/project-rules/90-settings-documents-storage.md`](docs/project-rules/90-settings-documents-storage.md)
- System-admin console (`/system-admin/*`), admin_data, email_log, announcement banner: [`docs/project-rules/95-system-admin-console.md`](docs/project-rules/95-system-admin-console.md)

## User-Facing Workflow Reference
- Complete page/action/dialog tree verified against pre-prod (May 2026): [`docs/app-workflow-tree.md`](docs/app-workflow-tree.md)

## After Writing Code — Required Validation

Run the relevant check(s) after every edit before considering the task done.

| Files changed | Command |
|---|---|
| `src/lib/setup-sql.js` | `npm run lint:sql` |
| `src/lib/setup-sql.js` + any migration | `npm run lint:sql && npm run lint:upsert-conflicts` |
| `api/**/*.js` — any `.upsert({ onConflict })` added or changed | `npm run lint:upsert-conflicts` |
| `scripts/validate-upsert-conflicts.js` | `npm run lint:upsert-conflicts` |
| `scripts/validate-setup-sql.js` | `npm run lint:sql` |
| `api/**/*.js` — general API logic | `npm run lint:api` |
| `src/**/*.js` or `src/**/*.jsx` | `npm run lint` |
| Finance/billing/payroll logic | `npm run test:finance-calendar` |
| Pre-deploy / full check | `npm run build` |

**Upsert contract rule:** Any table added to `withOrgScope().upsert({ onConflict: '...' })` in `api/` must also be:
1. Added to `EXPECTED_CONFLICTS_BY_TABLE` in `scripts/validate-upsert-conflicts.js`
2. Given a matching `CREATE UNIQUE INDEX IF NOT EXISTS` or named `UNIQUE` constraint in `src/lib/setup-sql.js`

Skipping either step causes a `42P10` PostgreSQL runtime error that is silent until the upsert is exercised.

## Before Writing Code
- Read the matching `docs/project-rules` file first; if the task spans domains, read more than one.
- Check the helper docs before adding fetch, validation, date, currency, schema, or formatting utilities.
- Keep page code thin; prefer shared modules in `src/lib`, `src/hooks`, `src/api`, and `api/_shared`.
