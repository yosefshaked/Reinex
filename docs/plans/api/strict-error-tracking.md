# Strict 5xx error tracking as a blocking CI check

## Resume here

Read this block first when you continue this plan in a new conversation.

- **Plan status:** the overall status of this plan is recorded only in [`docs/plans/index.csv`](../index.csv).
- **Current stage:** deferred. It starts only after the [repository restructure](../repository/directory-restructure.md) is completed (its stage 8), and then only by an owner decision. The first subtask is F3.2.
- **Origin:** split on 2026-11-26 out of the restructure plan's stage 3F (F3). F3.1 (the baseline and the classification) was done there; its evidence stays in that plan's Progress log, entry "2026-11-26, F2 published and F3.1". F3.2–F3.6 moved here unchanged.
- **Until then:** the rule in [`docs/project-rules/30`](../../project-rules/30-backend-shared-helpers.md) "5xx responses and the support code" applies to every endpoint that is added or changed. Only the sweep over the existing findings and the strict CI check wait for this plan.
- **Last update:** 2026-11-26. Plan created, deferred.

---

## Goal

Every 5xx response the API sends is tracked: its detail is saved in `error_events`, and the user gets a support code that support can find. A blocking CI check keeps it that way.

## Decisions already taken (owner)

1. **2026-11-24:** moving the error-tracking check to blocking enforcement is approved (restructure plan, 3.1 C2). The work is F2 (the runtime support-code bug), then F3 (strict static enforcement). F2 is done.
2. **2026-11-26:** F3.2–F3.6 are deferred until the repository restructure is finished. The cross-cutting fixes and the strict CI check wait. New or changed code follows the rule now.

## The mapping (F3.1, at `f21742d`)

- **The validator's findings:** `npm run lint:error-tracking` reports 276 untracked 5xx in 100 files (270 × 500, 5 × 501, 1 × 502). There are no `tracked-error-exempt` markers.
- **By handling** (a heuristic by enclosing function; confirm each site when fixing it):

  | Handling | Count | Fix |
  |---|---|---|
  | Before a client exists (`server_misconfigured`) | 94 | no event can be saved; see open question 1 |
  | A client is in scope | 139 | `respondTrackedError` |
  | Tracking is already attached | 12 | `respondTracked` or the file's tracked wrapper |
  | A handler that receives the client as a parameter, or `config`'s catch | 31 | `respondTrackedError` with that client |

- **What the validator misses** (untracked 5xx outside the 276):
  - **A status held in a variable:**
    - `ensureSystemAdmin` throws `statusCode: 500`, which 21 system-admin endpoints and both org-purge endpoints send with `respond(context, err.statusCode || 403, …)`.
    - `user-context` (4) and `users-me` (1) send `error.status || 500`.
    - `invite-load` (1).
    - `settings` (`mapped.status` 9, `cancelled.status` 1), `employee-rates` (1) and `employee-leave` (1).
    - `system-admin-backups` `result.status` (to confirm).
  - **A local responder:** `organizations` `jsonResponse(context, 500, …)` (2).
  - **Wrappers by name:** all 33 local `respond…Error` wrappers call a tracked helper today. The validator would also accept one that does not.
- **By area, for the F3.3 commits:**

  | Area | Literal findings | Hidden (variable status, local responder) |
  |---|---|---|
  | A: system-admin, org-purge | 63 | 23 |
  | H: org, auth, settings and the rest | 47 | 17 |
  | C: students and clients | 54 | 0 |
  | G: finance, employees, services | 37 | 2 |
  | D: documents and storage | 31 | 0 |
  | E: calendar and sessions | 25 | 0 |
  | F: forms and waiting list | 10 | 1 |
  | B: import, backup, restore | 9 | 0 |

- **Related, outside this plan:**
  - `org-purge/prepare` returns `detail: err?.message` in a 500, a leak that `lint:api-responses` does not catch.
  - `billing` maps an unknown exception to 400 `invalid_billing_action`, so an internal failure is neither a 5xx nor tracked.

## Open questions

1. **The 94 `server_misconfigured` sites.** NEW PATTERN PROPOSAL (2026-11-26, not approved): one shared responder that logs and returns 500 without a code, as the single audited exemption with its reason, instead of 94 `tracked-error-exempt` comments. The owner decides at F3.3.

## Subtasks

- [ ] F3.2 Audit and strengthen the validator. It should report a non-literal status that can be 5xx, local responders (`jsonResponse`, `context.res`) and wrapper bodies that do not track, with tests. The count grows from 276 to about 320 before it shrinks. **Never close a finding by:**
  - renaming;
  - blanket exemptions;
  - hiding warnings.
- [ ] F3.3 Fix the routes with the helpers, one reviewable commit per area (table above). Give each `tracked-error-exempt` a real reason.
- [ ] F3.4 Give the validator a directory option and tests, like `lint:plans`:
  - a clean fixture exits 0;
  - a fixture with a bare `respond(context, 500, …)` exits 1;
  - a fixture with a wrapper that does not track also exits 1.
- [ ] F3.5 Make it blocking in CI. **Proposal, confirmed at this subtask's review:**
  - **Workflow:** a new `.github/workflows/error-tracking.yml`, named "Error tracking", following "Plan registry":
    - **Events:** `pull_request` (opened, synchronize, reopened) and `push`, to `staging` and `main`. No path filter.
    - **Setup:** Node 20, `permissions: contents: read`, no install; the validator uses only Node built-ins.
    - **Steps:** `npm run lint:error-tracking:strict` and the F3.4 tests.
  - **Effect on the job:** any finding exits non-zero, so the step and the job fail. There is no `continue-on-error`.
  - **Left unchanged:**
    - the warn-only step in `integrity-checks.yml` keeps reporting;
    - `npm run build` keeps the warn-only command, so the deploy build does not run this gate twice.
- [ ] F3.6 Update the enforcement line in `docs/project-rules/30-backend-shared-helpers.md` "5xx responses and the support code" and in `AGENTS.md`.

## Acceptance

- The tree after F3.3 passes `npm run lint:error-tracking:strict`: exit 0, 0 findings.
- A controlled invalid case (the F3.4 fixture) fails the check.
- After a push, GitHub runs the "Error tracking" job. It is recorded green on the valid tree and red on a controlled invalid commit (on a throwaway branch, never merged).
- **A failing job is not the same as a required check.** It blocks merging only if "Error tracking" is set as a required status check in the branch rules. That is a separate owner decision, like "Plan registry".

**Rollback:** revert per subtask. F3.5 is reverted alone if the workflow needs to be withdrawn.

## Progress log

- **2026-11-26, plan created.** F3.2–F3.6 and their acceptance moved here from the restructure plan's stage 3F, with the F3.1 mapping. Nothing in the API changed.
