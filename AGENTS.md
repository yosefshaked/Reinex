# AGENTS (Reinex)

Read this first. Detailed task docs live in [`./agents-docs`](agents-docs/).

## Global Rules
- Tenant DB schema is `public` only.
- Control DB is shared for organizations, memberships, and auth.
- Do not put `reinex` in API route names; keep routes domain-based.
- Instructors are self-scoped unless the membership role is `admin` or `owner`.
- Azure Functions must return through `respond(context, ...)`.
- Azure Functions must extract auth with `resolveBearerAuthorization(req)`.
- `supabase.auth.getUser(token)` returns `{ data, error }`; user is `result.data.user`.
- Services are enabled/disabled with `is_active`; do not model disablement as deletion.

## ⚠️ AI Rules of Engagement & The Escape Hatch
1. **Context Economy:** Read the specific `agents-docs/XX-domain.md` file for your task. Load ONLY the source files listed there to save tokens.
2. **Do Not Reinvent:** Strictly use the shared helpers, hooks, and utilities documented in the hub.
3. **Respect Coupling:** Never bypass side-effects (e.g., calendar triggering billing) documented in the domain files.
4. **💡 The Escape Hatch (Think Outside the Box):** If you believe the existing architecture/helpers are inadequate for a new feature, or if you see a significantly better, modern approach: DO NOT silently hack around the rules. Instead, stop and output `🚨 NEW PATTERN PROPOSAL:`. Briefly explain your idea and wait for human approval before coding.
5. **🔄 Keep the Hub Alive (Doc Updates):** The documentation must evolve with the code. If you create a new shared helper, establish a new architectural pattern, or introduce a new cross-domain side-effect (coupling), you MUST surgically update the relevant `agents-docs/XX-domain.md` file before considering your task complete. If you are unsure where the new rule belongs, output `📝 DOC UPDATE REQUIRED:` at the end of your response to flag it for human review.

## Read By Task
- Repo-wide rules and invariants: [`agents-docs/00-core-rules.md`](agents-docs/00-core-rules.md)
- Runtime config, auth, org switching: [`agents-docs/10-runtime-auth-org.md`](agents-docs/10-runtime-auth-org.md)
- Shared frontend helpers and API wrappers: [`agents-docs/20-frontend-shared-helpers.md`](agents-docs/20-frontend-shared-helpers.md)
- Shared backend endpoint helpers: [`agents-docs/30-backend-shared-helpers.md`](agents-docs/30-backend-shared-helpers.md)
- Students, client profiles, guardians: [`agents-docs/40-students-and-clients.md`](agents-docs/40-students-and-clients.md)
- Employees and instructors: [`agents-docs/50-employees-and-instructors.md`](agents-docs/50-employees-and-instructors.md)
- Calendar, templates, attendance, sessions: [`agents-docs/60-calendar-and-sessions.md`](agents-docs/60-calendar-and-sessions.md)
- Forms, shared blocks, waiting list: [`agents-docs/70-forms-and-waiting-list.md`](agents-docs/70-forms-and-waiting-list.md)
- Billing, HMO, commitments, payroll: [`agents-docs/80-finance-billing-payroll.md`](agents-docs/80-finance-billing-payroll.md)
- Finance workflow baseline contract (must read before finance behavior changes): [`implementations/finance/ledger/finance-workflow-contract-v1.md`](implementations/finance/ledger/finance-workflow-contract-v1.md)
- Finance workflow release hardening protocol (must read before finance rollout): [`implementations/finance/ledger/finance-workflow-release-hardening-v1.md`](implementations/finance/ledger/finance-workflow-release-hardening-v1.md)
- Settings, documents, storage, backup, audit: [`agents-docs/90-settings-documents-storage.md`](agents-docs/90-settings-documents-storage.md)

## Before Writing Code
- Read the matching `agents-docs` file first; if the task spans domains, read more than one.
- Check the helper docs before adding fetch, validation, date, currency, schema, or formatting utilities.
- Keep page code thin; prefer shared modules in `src/lib`, `src/hooks`, `src/api`, and `api/_shared`.
