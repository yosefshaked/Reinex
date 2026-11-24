# Repository directory restructure

## Resume here

Read this block first when you continue this plan in a new conversation.

- **Plan status:** the overall status of this plan is recorded only in [`docs/plans/index.csv`](../index.csv). Check it with `npm run lint:plans`.
- **Current stage:** 3F, F1 re-planned. The owner requires each user operation to commit whole or not at all; F1.6–F1.9 hold the boundary map, the atomic RPC proposal, the proof and the attempt measurement. Next: owner answers to F1-Q1 to F1-Q4, then F1.5. Approved but not yet executed: the 3.8 deletions, the D9 rules (`main`, straight quotes), and Q10 (`attribution.commit`).
- **Execution branch:** `repository-reconstruction`, based on `origin/staging` `dce8f2e790e939b7f0805803d7d44e71a23346ba`. See [Planning base](#planning-base) and [Q1](#q1-execution-branch).
- **Repository state:**
  - `test/` is now `tests/`; `agents-docs/` is now `docs/project-rules/`.
  - `AGENTS.md` is the binding entry point, and `CLAUDE.md` is `@AGENTS.md`.
  - `docs/plans/index.csv` and `npm run lint:plans` exist.
  - The raw evidence is outside the repository, in `$env:TEMP\reinex-restructure\stage0\`, `stage1\`, `stage2\` and `stage3\`.
  - Nothing has been pushed; the owner decides on the push together with Claude.
- **Last update:** 2026-11-24. F1 revised to atomic operations (awaiting scope approval); owner decisions on 3.8, required checks, `main`, straight quotes and Q10 recorded.

Each stage appends to the [Progress log](#progress-log), ticks its subtasks and records answers under [Open decisions](#open-decisions). Keep this block at five bullets. It is a pointer, not a history.

---

## Purpose

Most development and maintenance in Reinex is done by AI agents. A person or a new agent must be able to find five things for a task:

- the code;
- the development rules;
- the product decisions and why they were made;
- the plans;
- the matching tests.

They must also be able to continue a previous conversation's work from what is in the repository.

Today that knowledge is spread over seven documentation folders and two instruction files that contradict each other. Some decisions exist only outside the repository, in agent memory or the wiki.

**Scope rule for tests**, used consistently in every stage:

1. **Entry points.** Each stage compares the existing, relevant entry points before and after: the npm scripts users and tools actually run, and the tester's `--validate`.
2. **Affected files.** A stage also runs a test file directly, before and after, when that stage moves the file or changes a path the file reads. This applies even when no npm script runs the file. Examples:
   - stage 1 runs the 7 unscripted `test/*.test.js` files it moves;
   - stage 5 runs `api/org-purge/purge-manifest.test.js`, which reads the schema file by path.
3. **No coverage growth in the move stages.** Nothing else is added to what is run. The exception is stage 3F: each code fix there adds the tests that prove its own behaviour (3.1, D7 test rule).

**Non-goals.** Each of these is a separate initiative:

- adding `npm test`;
- running the unscripted test files as a whole;
- widening coverage. The coverage gap found in C7 stays tracked in this plan (3.1, C7); closing it is a separate initiative;
- changing CI triggers or behaviour. The owner-approved exceptions are:
  - the "Plan registry" workflow (Q9, stage 2);
  - the "Doc links" workflow (3.9), approved at the stage 3 review on 2026-11-24;
  - making error tracking a blocking CI check (3.1 C2, stage 3F subtask F3), approved on 2026-11-24;
- automating migrations in deployment. The research on it (stage 4R) is deferred by the owner;
- performance work;
- moving off Azure;
- commitlint, Git hooks or CI checks on commit messages (the commit policy itself is in stage 3).

## Legend

- **[V]**: verified while writing this plan, with read-only commands (`git ls-tree`, `git show`, `git grep`, `git check-ignore`, `git status --ignored`, `docker ps`), against `dce8f2e` unless stated.
- **[P]**: planned for execution. Not run yet.
- `path:line` refers to `dce8f2e` unless stated otherwise.
- **Owner decision** means it was approved by the owner. **Codex recommendation** means it was proposed in review and is not yet approved.

## Planning base

**[V] Facts, as of 2026-11-23.**

- **The base.** `origin/staging` is at `dce8f2e790e939b7f0805803d7d44e71a23346ba`: "Pay computed live from facts … (#55)", 2026-11-23 15:15 +0200. It includes PR #55. Its parent is `41c2897` (#53), which is `origin/main`.
- **How freshness was checked.** `git fetch origin`, then `git ls-remote origin refs/heads/staging refs/heads/repository-reconstruction refs/heads/main`:
  - `staging` and `repository-reconstruction` are at `dce8f2e…`;
  - `main` is at `41c2897…`;
  - all three equal their local remote-tracking refs.
- **The working directory** is `C:\Developement\Repositories\Reinex`.
  - **Branch.** `repository-reconstruction` is at `dce8f2e` and tracks `origin/repository-reconstruction`. Its reflog shows the owner switched it from `41c2897` to `dce8f2e` after the first draft of this plan. The working tree now matches the planning base.
  - **The only change** is this untracked file.
  - **Local `staging`** is at `dce8f2e` and tracks `origin/staging`. It was corrected on 2026-11-23; before that it tracked `origin/main`.
  - **Another worktree** exists: `C:\Developement\Repositories\Reinex-attendance-grid`, on `attendance-month-grid` at `616b645`. It is unrelated.
- **PR #62** (`staging` → `main`) is open by owner decision.
  - Every push to `staging` runs the integrity checks and the SWA build. It also redeploys a preview that uses the production DB.
  - PRs into `staging` themselves get no CI. Triggers are on `main` only [V]. Since stage 2 the exceptions are the "Plan registry" workflow and, since the stage 3 review, "Doc links". Both also run on PRs and pushes to `staging`.
- **Local machine.**
  - Node is `v25.2.1`; CI uses Node 20.
  - `NODE_OPTIONS` accepts `--test-reporter` and `--test-reporter-destination` on the local Node [V].
  - The running Supabase stack is project `automatic-tester` (containers `supabase_*_automatic-tester`). No `reinex-tenant` container exists.

---

## Target structure

```text
root/
├── README.md                 # what Reinex is, how to run it, where docs live (humans)
├── AGENTS.md                 # binding entry point for agents: always-on rules + routing
├── CLAUDE.md                 # one line: @AGENTS.md (plus Claude-only notes, if any)
├── LICENSE, SECURITY.md      # stay at root (GitHub conventions)
├── <build/deploy config>     # see "Root coverage": files tools expect at the root
├── .github/                  # workflows, composite action
├── api/                      # Azure Functions; unit tests may stay next to their module
├── src/                      # React frontend; unit tests may stay next to their module
├── public/                   # static files copied into dist/
├── tests/                    # shared tests, system scenarios, test infrastructure
│   ├── *.test.js             # node:test suites (today's test/*.test.js)
│   ├── support/              # mocks and helpers
│   ├── integration/          # tests that need a running DB/API (from implementations/)
│   └── automatic-tester/     # browser/API scenario runner
├── scripts/                  # repo maintenance and validation commands (npm / CI)
├── tools/                    # standalone tools with their own way to run (backup, legacy migration)
├── database/
│   ├── setup-sql.js          # schema snapshot (consumers in stage 5)
│   └── migrations/           # numbered one-time changes for existing databases
├── docs/
│   ├── project-rules/        # development rules per domain (today's agents-docs/)
│   ├── product/              # valid business behaviour + the decisions that explain it
│   ├── research/             # findings worth finding again
│   │   └── README.md
│   └── plans/
│       ├── index.csv         # path,title,status — the only place for overall plan status
│       ├── repository/
│       │   └── directory-restructure.md
│       ├── payroll/
│       └── calendar/         # topic folders are created when a plan belongs to them
└── local/                    # ignored by Git: local output, reports, backups, working data
```

**What belongs where:**

| Folder | Belongs here | Does not belong here |
|---|---|---|
| `AGENTS.md` | Always-on rules, each with a one-line reason; a routing table (task → rules → product doc → tests → start files); the validation table. | Domain detail, which goes to `docs/project-rules/`. |
| `docs/project-rules/` | How to change code safely in one domain: helpers, couplings, invariants, recommended start files. | Business rules (they go to `product/`) and plan history. |
| `docs/product/` | What the system does and why: rules with stable IDs (PAY-*), decisions with date and source, links to tests. | Function names, step-by-step plans, raw research. |
| `docs/research/` | Conclusions to questions that took real effort, with evidence and limits. | Transcripts, drafts, task logs. |
| `docs/plans/<topic>/` | Plans with sub-task checkboxes and evidence. The path never changes. Supporting files go in `<topic>/<plan-slug>/`. | Status folders. Status lives in `index.csv`. |
| `tests/` | Shared tests, scenario runners, mocks, integration tests. | Manual operator scripts such as `verify-backup.cjs`, which go to `tools/`. |
| `scripts/` | Commands run by npm or CI: deterministic, no production credentials. | Tools that touch real data. |
| `tools/` | Standalone tools with their own entry point, README and dependencies. | Anything CI runs. |
| `local/` | Reports, backups, local exports, scratch data. | Anything needed to reproduce a test (synthetic fixtures stay versioned). |

---

## Migration map

- **Stage** refers to [Stages](#stages).
- **Clarify** means the item stays where it is until the named question is answered in the named stage.
- File age alone is never a reason to delete.
- This map covers the Git tree. Ignored local items are listed separately in [Local items](#local-items-not-in-the-git-tree).

### Root files

| Source | Proposed target | Reason | Main consumers [V] | Verification | Stage |
|---|---|---|---|---|---|
| `README.md` | Stays; rewritten | Title is "Tuttiud Student Support Platform" [V]. It links `ProjectDoc/` [V]. | People, GitHub | Link check | 7 |
| `AGENTS.md`, `CLAUDE.md` | Stay; `CLAUDE.md` becomes `@AGENTS.md` | Owner decision 3 | Codex, Claude Code | Stage 3 acceptance | 3 |
| `LICENSE`, `SECURITY.md` | Stay | GitHub conventions. `SECURITY.md` still says "TutTiud-Refactored" [V]. | GitHub | — | 7 (text only) |
| `.gitignore` | Stays; edited | It carries path-specific rules for moved folders [V]. | Git | `git check-ignore` per stage | 1, 6 |
| `package.json`, `package-lock.json`, `index.html`, `eslint.config.js`, `jsconfig.json`, `tsconfig.typecheck.json`, `postcss.config.js`, `tailwind.config.js`, `components.json` | Stay | Tools look for them at the root. | npm, Vite, ESLint, tsc, shadcn | — | — |
| `vite.config.js` | Stays | Updated in #55 [V] | Vite | — | — |
| `vite.config.mjs` | Delete candidate | A stale near-copy, last changed `bd7c90a`. It uses `process.cwd()` where `.js` uses `__dirname` [V]. | Vite (if picked) | [P] `npx vite build --debug` names the loaded config; build passes after removal | 6 |
| `staticwebapp.config.json` | Clarify | Differs from `public/staticwebapp.config.json` by 8+/2− lines. Both last changed `1ac3f16` [V]. Which one SWA applies is not verified. | Azure SWA | [P] Diff both files; check the live rules with a read-only GET on the preview | 6 |
| `robots.txt` | Clarify | Not in `public/`, so probably not deployed [V]. `Disallow: /test/` is an HTTP path, not a file path. | Crawlers (if served) | [P] GET `/robots.txt` on the preview | 6 |
| `Reinex-PRD.md` | Clarify, see [Q8](#q8-original-prd) | Original requirements v1.0. Cited by `src/lib/setup-sql.js:3` and `SCHEMA_PRD_ALIGNMENT.md` [V]. | setup-sql header comment | Link check | 7 |
| `Reinex-Refactor-and-Migration-Plan.md` | `docs/plans/repository/tuttiud-to-reinex-refactor.md`, `completed` | A plan dated 2025-12-15 [V] | none [V] | — | 7 |
| `SCHEMA_PRD_ALIGNMENT.md`, `SECURITY_AUDIT_STUDENTS_ENDPOINT.md` | `docs/research/`, or delete after reading | Point-in-time analyses | `docs/guardian-integration-implementation-summary.md`, `reinex-docs/ROADMAP.md` [V] | Read; are the conclusions still current? | 7 |
| `PromptTemplate.md` | Clarify | An investigation prompt template [V] | none [V] | Owner: still used? | 7 |
| `_audit-setup-sql.cjs`, `_cleanup-enddo.cjs`, `_phase1-audit.cjs`, `_run-setup-sql-dry-run.cjs`, `_squash-greenfield.cjs`, `_squash2.cjs`, `_setup_sql.diff` | Delete candidates | One-time edits and audits of `src/lib/setup-sql.js` [V]. No npm or CI reference [V]. Git history keeps them. | none [V] | [P] `git grep` each name returns only itself | 6 |
| `refactor-phase1.js`, `refactor-phase1.py` | Delete candidates | One-time rewrite of listed `api/*` files [V] | none [V] | as above | 6 |

### Root folders

| Source | Proposed target | Reason | Main consumers [V] | Verification | Stage |
|---|---|---|---|---|---|
| `api/` | Stays (colocated tests stay). `.test.js` files: 21 in `api/`; 11 are run by `test:finance-calendar` [V]. | Owner decision 6 | SWA `api_location: "api"` [V] | — | — (comments edited in stages 4, 5, 7) |
| `src/` | Stays, except `src/lib/setup-sql.js`. Colocated tests `src/lib/analytics/posthog.test.js` and `src/runtime/config.test.js` stay [V]. | Owner decision 6 | Vite | — | 5 (setup-sql only) |
| `public/` | Stays | Copied into `dist/` | Vite, SWA `output_location: "dist"` [V] | — | — |
| `.github/workflows/*`, `.github/actions/run-integrity-checks/` | Stay | They never referenced `test/` [V]. Triggers at `dce8f2e`: `main` only [V]. Since stage 2, `plan-registry.yml` also runs on `staging` and runs `tests/validate-plans-index.test.js` directly. Since the stage 3 review, `doc-links.yml` does the same for `tests/check-doc-links.test.js`. Stage 3F (F3) adds a blocking error-tracking check. | GitHub Actions | — | 2, 3, 3F |
| `.github/chatmodes/Azure_function_codegen_and_deployment.chatmode.md` | Delete candidate | A competing instruction source: Copilot, naming "Claude Sonnet 4" [V] | Copilot chat | Owner confirms unused | 3 |
| `.vscode/extensions.json` | Stays | Editor recommendation | VS Code | — | — |
| `test/` (all of it) | `tests/` | Owner decision 1. Contents and consumers are in stage 1.1. | see 1.1 | Stage 1 | 1 |
| `test/verify-backup.cjs` | Moves with `test/` in stage 1, then to `tools/backup/` | Not a test: a manual check needing `<orgId> <date>` and a real backup [V] | Its own usage text | Stage 6 | 1, then 6 |
| `test/automatic-tester/supabase/.branches/_current_branch` | Moves with `test/` in stage 1; untracked in stage 6 | Tracked although its own `.gitignore` ignores `.branches` [V] | Supabase CLI | `git check-ignore` | 1, then 6 |
| `implementations/database/one-db-refactor/{e2e-smoke,rls-isolation}.test.js`, `isolation-stress-test.js` | `tests/integration/` candidates; confirmed per file by the [test classification](#test-classification) in 7.3 | Integration tests needing a running DB and API [V]. `e2e-smoke` was maintained in #55 [V]. | `package.json` `test:isolation-stress-test` [V]; they import `../../../api/…` [V] | [P] Fix import depth; `node --check`; npm script path exists; every consumer still resolves | 7 |
| `implementations/database/one-db-refactor/*.cjs` (3) | Delete candidates | One-time `setup-sql.js` rewrites [V] | none | `git grep` | 7 |
| `implementations/business-process/*` | Rules → `docs/product/payroll.md`; documents → `docs/plans/payroll/` | Owner decision 4; pilot domain | `test/payroll-rules.test.js:2`, `api/_shared/rate-history.js:4`, `src/lib/setup-sql.js:6801`, `agents-docs/80:120` [V] | Stage 4 | 4 |
| `implementations/session-reports/*` | Cited rules → `docs/product/session-reports.md`; the plan → `docs/plans/session-reports/` | 16 code-comment references in `api/` and `src/`, plus 3 in `setup-sql.js`, cite it as a spec [V] | Those comments | Link check | 7 |
| `implementations/admin-page/org-nuke/README.md` | `docs/project-rules/` (org purge) | Cited by `api/org-purge/purge-manifest.js:6` and `drift-check.js:5` [V] | Those comments | Link check | 7 |
| `implementations/finance/ledger/finance-workflow-contract-v1.md`, `…release-hardening-v1.md` | `docs/product/` (contract) and `docs/project-rules/` (hardening) | `AGENTS.md:34-35` marks them "must read" [V] | `AGENTS.md`, `agents-docs/80:4,10` | Link check | 7 |
| Rest of `implementations/` (91 files in total [V]) | `docs/plans/<topic>/` (mockups in `<topic>/<plan-slug>/`), `docs/research/`, or delete | Mixed content | various | Per-file triage, stage 7.1 | 7 |
| `agents-docs/` (12) | `docs/project-rules/`, same file names | Owner decision 3 | `AGENTS.md`, `CLAUDE.md`, `eslint.config.js:10` comment; 262 relative `../` links inside (`../api` ×146, `../src` ×121) change depth [V] | Link check | 3 |
| `docs/app-workflow-tree.md` | `docs/product/` | A page/action tree linked from `AGENTS.md` [V] | `AGENTS.md` | Link check | 7 |
| `docs/AI-Coder-Gotchas.md`, `docs/api-validation-*.md` | Merge into `docs/project-rules/` | Development rules | not checked | Read and dedupe | 3 or 7 |
| `docs/code-review/…`, `docs/code-duplication-*`, `docs/*-audit*`, `docs/employee-leave-ledger-reference-review.md` | `docs/research/` or delete | Analyses | various | Read; still current? | 4 (leave), 7 |
| Other `docs/*.md`, including `docs/README.md` (which says "TutTiud" [V]) | `docs/plans/<topic>/` (completed), product, or delete | Mixed | various | Per-file triage | 7 |
| `docs/ssot/` | Clarify, see [Q5](#q5-control-db-artefacts) | Written for a separate control DB. Its tables are now in `src/lib/setup-sql.js` [V]. | `scripts/export-control-db-schema.ps1:2` [V] | Q5 | 7 |
| `ProjectDoc/`, `ProjectDocs/` | Read, then extract or delete | TutTiud-era docs. `TutTiud_Agents.md` is a competing instruction file [V]. | `README.md`, `docs/README.md`, several plans [V] | Link check | 3 (instructions), 7 |
| `reinex-docs/` | API-NAMING, DB-NOTES and ENVIRONMENTS → `project-rules/`; MVP and ROADMAP → `product/` or plans | No inbound references [V] | none | Read | 7 |
| `issues/` (10) | Open a GitHub issue for each still-relevant item, then delete | GitHub Issues is the tracker | none [V] | Each mapped to its new issue link | 7 |
| `gen-suggest/` (6 HTML mockups) | `docs/plans/calendar/<plan>/` or delete | No references [V] | none | Owner glance | 7 |
| `scripts/validate-*.js`, `typecheck.js`, `audit-finance-calendar-invariants.js`, `test-validator.js` | Stay | Owner decision 6 | `package.json` | — | — |
| `scripts/checkSchema.js` and `check:schema` | Delete candidate | Checks `WorkSessions` and `LeaveBalances`, which appear 0 times in `setup-sql.js` [V]. It connects to a real DB. | npm only | Owner confirms unused. Never run it against production. | 6 |
| `scripts/decrypt-key.js` | Clarify, see [Q6](#q6-operator-scripts) | An operator utility. Its usage text names its own path [V]. | its usage text | — | 6 |
| `scripts/export-control-db-schema.ps1`, `scripts/archive/control-db/*.sql` (11) | Follow Q5 | Control-DB artefacts | `docs/ssot/README.md` [V] | — | 7 |
| `tools/Amir-System-Migration/` | Stays | A standalone tool with its own README, requirements and runner. It writes `output/` next to itself, which is ignored [V]. | owner | — | 6 (output only, Q4) |
| `tools/bug-hunter/bug-hunt-report-2026-04-30.md` | `docs/research/` or delete | A report, not a tool [V] | none | Read | 7 |
| `manual-db-backup/` | `tools/backup/` | A standalone tool. Writes to `SCRIPT_DIR / "backups"` (`backup.py:19-20`) [V]. | `.gitignore` `/manual-db-backup/backups`, `/manual-db-backup/supabase` [V] | Stage 6 | 6 |
| `migrations/` (5 SQL files + README) | `database/migrations/` | Owner decision 7 | `test/dated-settings.test.js:387`; `setup-sql.js` comments at 527, 529, 2852; agent docs [V] | Stage 5 | 5 |
| `src/lib/setup-sql.js` | `database/setup-sql.js` | Owner decision 7 | see stage 5 | Stage 5 | 5 |
| `supabase/functions/get_org_public_keys.sql` | Follow Q5 | Tracked although `/supabase` is ignored [V]. Referenced only by the control-DB docs and archive. Never called from `api/` or `src/` [V]. | docs/ssot | — | 7 |
| `supabase-tenant/` | Clarify, see [Q7](#q7-supabase-tenant) | `project_id = "reinex-tenant"`. Its CLI state (`.branches/`, `.temp/`) is tracked [V]. The running stack is `automatic-tester` [V], but tester messages still say "in the supabase-tenant directory" (`diagnostics.js:195,268`, `setup.js:1257`) [V]. | tester messages | Q7 | 6 |

### Test classification

Owner decision, 2026-11-24 (3.1, C7). Where a test file lives follows from three things, not from its suffix:

- **Purpose:** a unit test of one module, a contract or workflow test across modules, or an integration test.
- **Environment it needs:** none (pure Node), a running local DB, or a running DB and API.
- **Entry point:** an npm script, a CI workflow, the tester runner, or a direct `node --test <file>` only.

Rules:
- A unit test next to the module it tests is a valid location. It stays there (owner decision 1).
- A test that needs a running DB or API goes to `tests/integration/`.
- A move keeps every entry point and consumer: npm script paths, workflow steps, imports, and docs that cite the path.

**Counts at `0339f45` (C7):** 52 tracked `*.test.js` files.

| Group | Files | How they run |
|---|---|---|
| In `test:finance-calendar` | 30 | By hand, and through `verify:beta`, which runs `test:finance-calendar` first. Not in `npm run build`, not in CI. |
| In no npm script, run directly by CI | 1 | `tests/validate-plans-index.test.js`, in the "Plan registry" workflow |
| In no npm script and in no checked workflow | 21 | Only directly, with `node --test <file>`. Two of them (`tests/supabase-client.test.js`, `tests/whatsapp-message-templates.test.js`) fail at the stage 0 baseline. |

The count by suffix does not cover every test tool. It leaves out, for example:
- `isolation-stress-test.js` (`test:isolation-stress-test`);
- `scripts/test-validator.js` (`test:validator`);
- the tester scenarios under `tests/automatic-tester/`.

**To classify in 7.3** (purpose, environment, entry point and consumers checked per file before any move):

| File | Expected class | Entry point today | Consumers to keep |
|---|---|---|---|
| `implementations/database/one-db-refactor/e2e-smoke.test.js` | integration (DB and API) | direct only | imports of `../../../api/…`; any doc citing the path |
| `implementations/database/one-db-refactor/rls-isolation.test.js` | integration (DB) | direct only | as above |
| `implementations/database/one-db-refactor/isolation-stress-test.js` | integration (DB) | `npm run test:isolation-stress-test` | the npm script path; imports |

### Root coverage check [V]

`git ls-tree --name-only dce8f2e` lists **53 root entries**. Each one is named below with the table row that decides it:

| Root entry | Decided in |
|---|---|
| `.github` | Root folders (two rows) |
| `.gitignore` | Root files |
| `.vscode` | Root folders |
| `AGENTS.md`, `CLAUDE.md`, `LICENSE`, `SECURITY.md`, `README.md` | Root files |
| `PromptTemplate.md`, `Reinex-PRD.md`, `Reinex-Refactor-and-Migration-Plan.md`, `SCHEMA_PRD_ALIGNMENT.md`, `SECURITY_AUDIT_STUDENTS_ENDPOINT.md` | Root files |
| `_audit-setup-sql.cjs`, `_cleanup-enddo.cjs`, `_phase1-audit.cjs`, `_run-setup-sql-dry-run.cjs`, `_setup_sql.diff`, `_squash-greenfield.cjs`, `_squash2.cjs`, `refactor-phase1.js`, `refactor-phase1.py` | Root files |
| `components.json`, `eslint.config.js`, `index.html`, `jsconfig.json`, `package-lock.json`, `package.json`, `postcss.config.js`, `tailwind.config.js`, `tsconfig.typecheck.json`, `vite.config.js` | Root files (stay) |
| `vite.config.mjs`, `staticwebapp.config.json`, `robots.txt` | Root files |
| `agents-docs`, `api`, `docs`, `gen-suggest`, `implementations`, `issues`, `manual-db-backup`, `migrations`, `ProjectDoc`, `ProjectDocs`, `public`, `reinex-docs`, `scripts`, `src`, `supabase`, `supabase-tenant`, `test`, `tools` | Root folders |

- **Result:** 53 of 53 entries have a row. No root entry is undecided.
- **Entries marked Clarify:** `staticwebapp.config.json`, `robots.txt`, `Reinex-PRD.md`, `PromptTemplate.md`, `supabase-tenant`, and parts of `docs`, `scripts` and `supabase`. Each names its question and stage.

### Local items (not in the Git tree)

These are ignored local items found in the working directory with `git status --ignored` [V]. **They are not part of the Git tree and are not counted above.** Stages move them only where noted. Their contents are never read or printed.

| Item | Ignored by | Plan |
|---|---|---|
| `test/automatic-tester/.env` (credentials) | `.gitignore` `.env` | Moves with `test/` in stage 1 and must stay ignored |
| `test/automatic-tester/node_modules/` | `node_modules` | as above |
| `test/automatic-tester/reports/run-*` (186 runs on 2026-11-23) | `/test/automatic-tester/reports` (path-specific) | as above; the rule changes in stage 1 |
| `test/automatic-tester/supabase/.temp/` | nested `.gitignore` | as above |
| `api/local.settings.json`, `api/node_modules/`, `node_modules/`, `dist/` | `.gitignore` | Untouched |
| `supabase/.branches/`, `supabase/.temp/` | `/supabase` | Untouched (follow Q5 for the folder) |
| `manual-db-backup/backups/` (2 runs), `manual-db-backup/supabase/` | path-specific rules | Stage 6, see Q4 |
| `tools/Amir-System-Migration/output/`, `__pycache__/` | path-specific rules | Stage 6, see Q4 |
| `test-data/` (`students-active.csv`) | `/test-data` | Stage 6 → `local/data/`; owner says whether it is real data |
| `.aider*`, `.cache/`, `.claude/`, `.pki/`, `.local/` | various | Untouched. `.local/` (pipx) is not the planned `local/`, and `*.local` does not ignore `local/`. |

---

## Shared execution rules

These apply to every stage. Each stage adds only its own risks.

1. **Branch and PRs.**
   - Work only on the execution branch from [Q1](#q1-execution-branch).
   - One stage is one commit, or a short series of commits, and one PR into `staging`.
   - Never push or merge to `main`. Never open another PR to `main`.
   - PR #62 (`staging` → `main`) stays open by owner decision. Every push to `staging` re-runs its checks and redeploys its preview against the production DB. There are no users, and dedicated preview env vars are planned separately.
2. **Evidence.** Each stage's evidence is local:
   - the commands;
   - exit codes;
   - counts;
   - the Node version.

   The #62 run after a merge into `staging` is extra evidence, not a substitute.
3. **Measured baseline.**
   - Before a change, run the same commands on the same commit, with the same Node version and environment.
   - Compare the after-result with that measured baseline.
   - Never assume a check passed before it was measured. A known failure stays known.
   - **Any new regression stops the stage until it is explained.**
4. **Moves.**
   - Stage exactly the intended paths. Never use `git add -A` over a folder that holds local data.
   - Before committing, compare the full list of relative paths before and after.
   - A file meant to move unedited must show as `R100`.
   - A file that moved and was also edited must show only the expected reference updates in its diff.
5. **No bridges.** No re-export shims, symlinks or duplicate copies of moved files. Update the consumer, or the move does not happen.
6. **Database.**
   - No command against the production database.
   - Local writes are allowed only on the local `automatic-tester` stack.
7. **Secrets and local data.**
   - Never read or print `.env`, `api/local.settings.json` or backup contents. Record names and paths only.
   - Before any staging command, check with `git check-ignore` that local output under a moved path is still ignored.
8. **Out-of-repo consumers** are listed in the stage report for owner approval and not edited inside the stage. They are:
   - Claude memory files;
   - the wiki;
   - `.claude/launch.json`;
   - the owner's shell habits.
9. **End of every stage: joint review.** Claude stops and reports:
   - opinion;
   - the verification table (baseline vs after);
   - which tester mode ran;
   - the remaining gaps;
   - out-of-repo follow-ups.

   The owner and Codex review before the next stage starts.
10. **Reference rewriting.**
    - Rewrite a textual old path only if the referenced file existed at the baseline and moved.
    - List references that were already broken; do not fix them.
    - Never do a blanket replace of a path fragment. See the non-path strings in 1.1.

**Standard checks** (run from the repository root; record exit code, counts and output files):

```powershell
node -v
npm run lint
npm run lint:api
npm run lint:sql
npm run lint:upsert-conflicts
npm run test:finance-calendar
npm run build
```

**Test identity method** (used in stages 0, 1, 2 and 5):

1. **Reporter.** A small reporter module lives **outside the repository**, at `$env:TEMP\reinex-restructure\identity-reporter.mjs`. For each `test:pass` and `test:fail` event it writes one line:
   `<file relative to repo root>␟<ancestor names joined by " > ">␟<name>␟<pass|fail>␟<skip|todo|->`
   - **Suite events are excluded.** Test and suite events are told apart by `data.details.type`: an event whose type is `'suite'` is a suite (`describe`). A `test()` that has subtests is still a test, matching Node's own count.
   - It keeps the ancestor stack per file, from `test:start` events, by `nesting`.
   - It keeps the directive: `todo` when `data.todo` is set, otherwise `skip` when `data.skip` is set, otherwise `-`.
   - It excludes durations and test numbers.
   - **Count mapping to Node's spec summary:**
     - lines = `tests`;
     - `pass` with `-` = `pass`;
     - `fail` with `-` = `fail`;
     - `skip` lines = `skipped`;
     - `todo` lines = `todo`.
2. **Run the real command** with the reporter attached through the environment, so the npm script's own file list is what runs:

   ```powershell
   $out = "$env:TEMP\reinex-restructure\<stage>\<before|after>"
   New-Item -ItemType Directory -Force $out | Out-Null
   $env:NODE_OPTIONS = "--test-reporter=spec --test-reporter-destination=stdout --test-reporter=file:///$($env:TEMP -replace '\\','/')/reinex-restructure/identity-reporter.mjs --test-reporter-destination=$out\finance.ids"
   npm run test:finance-calendar *> "$out\finance.txt"; $LASTEXITCODE > "$out\finance.exit"
   Remove-Item Env:NODE_OPTIONS
   ```

3. **Normalise.**
   - Use forward slashes.
   - In "before" lists, map the moved prefix to its new name (`test/` → `tests/` in stage 1) **only at the start of the file field**.
   - **A file that fails to load** is reported by Node as one test whose *name* is the file path, written with OS separators (for example `test\supabase-client.test.js`). When the name, with slashes normalised, equals the file field, map it the same way. This was found in stage 0.
   - Sort.
   - Number repeated identical lines with an occurrence suffix, so that a duplicate name in one suite still counts.
   - Record the SHA-256 of the sorted list, and the spec summary (`tests`, `suites`, `pass`, `fail`, `cancelled`, `skipped`, `todo`) from `finance.txt`.
4. **Compare.** Run `Compare-Object` on the two normalised lists. It must be empty, and the summary counts and exit code must equal the baseline.
5. **Tooling check (owner requirement, 2026-11-23).** Subtask 0.3 checks the tool in two steps:
   - **First, a small sample outside the repository.** It holds nested suites, the same test name in several suites, a skip, a todo, one deliberate failure and a `test()` with a subtest. The reporter's counts must equal Node's spec summary.
   - **Then, through `npm run test:finance-calendar` itself.**

   If either step fails, fall back to `--test-reporter=tap` with an indentation-aware parser, and record the method used.
6. **Tools, outside the repository:**
   - `$env:TEMP\reinex-restructure\identity-reporter.mjs`;
   - `$env:TEMP\reinex-restructure\normalize-ids.ps1`, run as `-In <ids> -Out <norm> -FromPrefix test/ -ToPrefix tests/`. It prints the line count, the repeated identities and the SHA-256.

   If `TEMP` was cleared, recreate both from this description before stage 1.
7. **ESLint scan check.** ESLint here prints a `Processing: <file>` line for every file it lints. The sorted, de-duplicated list of those paths is the record of what ESLint scans. In stage 1, compare it with `test/` mapped to `tests/`.

---

## Stages

**Why this order:**
- **0:** read-only measurement.
- **1:** the pilot. The smallest move that has real consumers. It proves the method: baseline, move, compare.
- **2:** the plan registry, so stages 3–7 have somewhere to record themselves.
- **3:** the instructions. Every later stage then follows them.
- **4:** the first product and research domain. It needs the routing from stage 3.
- **5:** the database. It touches the app bundle and the validators.
- **6:** tools, local data and ignore rules.
- **7:** remaining legacy docs. They need all target folders to exist.
- **8:** fresh-agent validation.

### Stage 0: Baseline and dependency map (read-only)

**Goal:** a measured starting point and a confirmed consumer list for stage 1.

**Depends on:** approval of this plan, and Q1.

**Subtasks:**
- [x] 0.1 Verify the execution branch per Q1, and commit the approved plan in a dedicated commit. Record:
  - the branch;
  - its SHA;
  - the `git ls-remote origin refs/heads/staging` output;
  - `git status --porcelain --untracked-files=all`.
- [x] 0.2 Run the standard checks. Record the results as measured: exit codes, error and warning counts, the build result.
- [x] 0.3 Set up the identity reporter and check the tooling (method step 5). Record the identity baseline for `npm run test:finance-calendar`.
- [x] 0.4 Record the entry points and affected files for stage 1:
  - `node test/run-tests.js`: exit code and output;
  - `node test/automatic-tester/runner.js --validate`: exit code and summary;
  - each of the 7 unscripted `test/*.test.js` files, run directly with the identity reporter: `billing-claim-payment`, `calendar-generate-break-templates`, `calendar-generate-hmo-warning`, `settings.session-form`, `storage-config`, `supabase-client`, `whatsapp-message-templates`.
- [x] 0.5 Re-run the stage 1.1 inventory commands and note any drift since `dce8f2e`.
- [x] 0.6 Record `npx eslint --print-config` for `test/pay-calculation.test.js`: the `languageOptions.globals` keys, and the `import/*` and `no-restricted-imports` rule values.
- [x] 0.7 Record the SHA-256 of `SETUP_SQL_SCRIPT`, for stage 5.

**Affected paths:** none in the repository. Outputs go to `$env:TEMP\reinex-restructure\stage0\`.

**Acceptance:** a Progress log entry that gives the measured results, including any failures, and the drift list.

**Rollback:** not applicable.

**Evidence:**
- the baseline table;
- the identity hash and counts;
- the tooling check result;
- the drift list.

### Stage 1: Pilot `test/` → `tests/`

Written so an agent in a new conversation can run it from this section and the shared rules alone.

**Goal:** rename the root test folder. Keep test identity and results, lint behaviour, ignore behaviour and local tester data unchanged.

**Depends on:** stage 0.

**Out of scope:**
- `npm test`;
- running or adding other tests;
- CI changes;
- moving `verify-backup.cjs`, which happens in stage 6;
- untracking `.branches/`, which happens in stage 6.

#### 1.1 Inventory [V at dce8f2e; re-check in 0.5]

**Tracked under `test/`: 59 files at `dce8f2e`.** The number that counts on the day comes from `git ls-files test` in 1.3 step 1.
- 26 `*.test.js` files. 19 of them are listed in `test:finance-calendar`; 7 are in no npm script.
- `run-tests.js`, a plain `assert` script that no npm script runs.
- `verify-backup.cjs`.
- `support/mock-supabase-client.js`.
- 30 files under `automatic-tester/`:
  - `.env.example`, `Full First Time Workflow.txt`;
  - `engine/{diagnostics,executor,reporter,validator}.js`;
  - `package.json`, `package-lock.json`;
  - `reports/.gitkeep`;
  - `runner.js`, `setup.bat`, `setup.js`;
  - `supabase/{.branches/_current_branch,.gitignore,config.toml}`;
  - 15 `scripts/*.json`.

**Two tracked files that an ignore rule matches.** `git add` without `-f` would silently drop them:
- `automatic-tester/reports/.gitkeep`, matched by the reports rule;
- `automatic-tester/supabase/.branches/_current_branch`, matched by the nested `.gitignore`.

**Local items under `test/`:** see [Local items](#local-items-not-in-the-git-tree). They are `.env`, `node_modules/`, `reports/run-*` and `supabase/.temp/`.

**Consumers to update in the same commit:**

| Consumer | Location | Change |
|---|---|---|
| npm script | `package.json` `test:finance-calendar`, 19 `test/…` entries | `test/` → `tests/` at the start of each entry |
| ESLint block | `eslint.config.js:166` `files: ['test/**/*.{js,jsx,mjs}']` | `tests/**/*.{js,jsx,mjs}` |
| Ignore rule | `.gitignore:44` `/test/automatic-tester/reports` | `/tests/automatic-tester/reports` (order in 1.3) |
| Self-references (text) | `verify-backup.cjs` usage (3 lines); `automatic-tester/setup.js:7`; `engine/diagnostics.js:157`; `.env.example`; `Full First Time Workflow.txt` | rewrite the path |
| Agent docs | `agents-docs/50` (2), `60` (1), `80` (2), `finance-calendar-change-checklist.md` (2); one `](../test` link | rewrite the path |
| Other docs | `implementations/**` (about 30), `docs/storage-config-implementation.md`, `issues/*`, `ProjectDoc/*` | shared rule 10 |
| **Not this plan** | `docs/plans/repository/directory-restructure.md` mentions both `test/` and `tests/` on purpose | Never rewrite it mechanically. Exclude it from the inventory comparison with `':!docs/plans/**'`. |

**Inventory command.** This finds path-like occurrences. It is anchored on purpose:

```powershell
git grep -n -E "(^|[^A-Za-z0-9_.-])test/" -- . ':!**/package-lock.json'
```

**Strings that are not file paths and must not change:**
- **`https://app.test/…` URLs.** They are fixtures in `src/lib/analytics/posthog.test.js` (lines 36–82) and `api/_shared/error-events.test.js:36` [V]. The `.test` is a reserved test domain. A blanket replace of `test/` would turn them into `app.tests/` and silently change what those tests assert. The anchored grep above skips them because the character before `test/` is a dot. **This is why no blanket replacement is allowed.**
- `robots.txt` `Disallow: /test/`, an HTTP path.
- The storage key `_test/` in `api/storage-test-connection/index.js:79-80`.
- `.test(` regex calls, the `*.test.js` suffix, and npm script names such as `test:headed`.
- `test_otp` in `config.toml`, `test-data/`, and `.github/chatmodes/…:44` (which already says `tests/`).

**Consumers that need no change, with the reason:**
- **Test imports.** They use `../api`, `../src`, `../scripts` and `../migrations` at an unchanged depth.
- **Tester paths.** They come from `__dirname`:
  - `runner.js:42` (`.env`), `:146` (`scripts`), `:147` (`repoRoot = join(__dirname,'..','..')`), `:292` (`reports`);
  - `setup.js:30-31`;
  - `setup.bat:4` (`cd /d "%~dp0"`) and `:116` (`pushd "%~dp0..\.."`).
- **The Supabase CLI** keys containers by `project_id = "automatic-tester"`, not by folder.
- **CI and SWA** do not reference `test/`.

**Out-of-repo consumers,** listed for approval and not edited:
- memory files with `node test/automatic-tester/runner.js …` commands;
- `.claude/launch.json`, if it references the folder;
- the wiki.

#### 1.2 Baseline (already captured in stage 0)

Use the stage 0 outputs for:
- the test identity;
- `run-tests.js`;
- the 7 unscripted files;
- `--validate`;
- the ESLint config;
- the standard checks.

If anything was committed since stage 0, re-run stage 0 first.

#### 1.3 Exact order

All commands run in PowerShell from the repository root. Keep `$work = "$env:TEMP\reinex-restructure\stage1"`.

1. **Record the state (names only).**
   ```powershell
   New-Item -ItemType Directory -Force $work | Out-Null
   git rev-parse HEAD > "$work\head.txt"
   git status --porcelain --untracked-files=all > "$work\status-before.txt"
   git ls-files test > "$work\tracked-before.txt"
   git ls-files --others --exclude-standard -- test > "$work\untracked-before.txt"   # must be empty
   git ls-files --others --ignored --exclude-standard --directory -- ':(top,glob)test/**' > "$work\local-before.txt"
   if (Get-Content "$work\local-before.txt" | Where-Object { $_ -notlike 'test/*' }) { throw 'local-before.txt has a line outside test/ - stop' }
   (Get-ChildItem test\automatic-tester\reports -Directory).Count > "$work\report-runs.txt"
   Test-Path test\automatic-tester\.env > "$work\env-present.txt"                   # presence only
   ```
   - **Stop** if `untracked-before.txt` is not empty.
   - **Stop** if `status-before.txt` shows changes other than the expected ones (none, after Q1's plan commit).
2. **Stop processes holding files.** No tester run, func host, Vite or editor watch should use `test/`. Windows refuses to rename a folder with open handles.
3. **Add the new ignore rule next to the old one.** Do this before any move or staging, so the reports are ignored at both paths. Add `/tests/automatic-tester/reports` on the line after `.gitignore:44` and keep the old line for now.
4. **Check the target is free and move.** This is a filesystem rename, so local items move with the folder.
   ```powershell
   if (Test-Path -LiteralPath tests) { throw 'tests/ already exists - stop and inspect' }
   Move-Item -LiteralPath test -Destination tests
   if (Test-Path -LiteralPath test) { throw 'test/ still exists - stop and inspect' }
   ```
5. **Check local items are still ignored at the new path.** Each must print a matching rule:
   ```powershell
   $run = (Get-ChildItem tests\automatic-tester\reports -Directory | Select-Object -First 1).FullName
   git check-ignore -v tests/automatic-tester/.env tests/automatic-tester/node_modules $run tests/automatic-tester/supabase/.temp
   git ls-files --others --exclude-standard -- tests | Sort-Object > "$work\untracked-after-move.txt"
   ```
   **Compare.** Map `tracked-before.txt` to the new prefix (`tests/…`). It must equal `untracked-after-move.txt`, **except** for the two ignored-but-tracked files from 1.1, which must be absent. No other path may appear.
6. **Update the consumers** from the 1.1 table. Edit only the listed occurrences. Then remove the old ignore line, `/test/automatic-tester/reports`.
7. **Stage exactly the intended paths.**
   ```powershell
   git rm -r --cached --quiet -- test
   (Get-Content "$work\tracked-before.txt") -replace '^test/','tests/' | Set-Content "$work\tracked-after.txt"
   git add -f --pathspec-from-file="$work\tracked-after.txt"          # includes the two ignored-but-tracked files
   git add -- package.json eslint.config.js .gitignore <edited doc files>
   ```
   `-f` is used only with the explicit list of files that were already tracked. It never applies to a folder.
8. **Review what is staged.**
   ```powershell
   git diff --cached -M --name-status > "$work\staged.txt"
   git diff --cached --name-only --diff-filter=A    # must list nothing outside tests/ (renames show as R)
   git status --porcelain --untracked-files=all     # no '??' under tests/, no local outputs
   ```
   - Every line of `tracked-before.txt` appears in `staged.txt` as `R… test/<x> tests/<x>`.
   - Unedited files must be `R100`.
   - For each renamed file below 100%, run `git diff --cached -M -- tests/<x>` and confirm it shows only expected reference updates.
   - Every other entry is `M` on a file from the consumer table.
9. **Run the acceptance checks (1.4)** on the staged working tree, before committing.
10. **Commit** with the message `refactor(tests): move shared tests to tests/`. This follows the commit policy planned in stage 3.3, so the pilot already matches it. Record the SHA.

#### 1.4 Acceptance (compare with the stage 0 measurements)

| Check | Command | Pass when |
|---|---|---|
| Path list | `git ls-files tests` (index) with `tests/` removed, vs `tracked-before.txt` with `test/` removed | Identical; `git ls-files test` is empty |
| Renames | `staged.txt` | as in 1.3 step 8 |
| npm entry point | `npm run test:finance-calendar` with the identity reporter (shared method) | Same exit code, same spec summary counts, same normalised identity list and hash |
| Affected unscripted files | The 7 files from 0.4, run directly from `tests/` | Same identities and results as the baseline |
| `run-tests.js` | `node tests/run-tests.js` | Same exit code and output |
| ESLint applies | `npx eslint --print-config tests/pay-calculation.test.js` | Same globals keys and rule values as 0.6 |
| ESLint result | `npm run lint` | Same exit code and counts as 0.2 |
| Ignore | 1.3 step 5, repeated after step 6 | All four local items ignored; reports matched by the new line |
| Local data intact | `(Get-ChildItem tests\automatic-tester\reports -Directory).Count`; `Test-Path tests\automatic-tester\.env` | Equal to `report-runs.txt` and `env-present.txt` |
| No stale references | the inventory command from 1.1 | Only the allowed non-path strings and the listed already-broken references remain |
| Tester, path validation | `node tests/automatic-tester/runner.js --validate` | Same result as 0.4 |
| Tester, real run (optional) | `node tests/automatic-tester/runner.js --script leave-settings`. Needs the local stack, func host and Vite. | Same pass count as a baseline run of the same script, taken in stage 0 if this check is wanted |
| Build | `npm run build` | Same result as 0.2 |

**What each tester mode proves.**
- **`--validate`** launches no browser. It proves that the runner starts from `tests/` and that its 15 scripts still point to existing routes and API files.
- **A real `--script` run** is needed to prove that `.env` is read, that Playwright loads from the moved `node_modules`, and that a report is written under the new path.

The stage report states which mode ran, and what it proved.

#### 1.5 Rollback

**Before the commit** (the changes are staged or in the working tree). Other work is preserved.

```powershell
git restore --staged -- tests test package.json eslint.config.js .gitignore <edited doc files>
git restore -- package.json eslint.config.js .gitignore <edited doc files>
if (Test-Path -LiteralPath test) { throw 'test/ already exists - inspect before moving anything' }
if (-not (Test-Path -LiteralPath tests)) { throw 'tests/ missing - inspect' }
Move-Item -LiteralPath tests -Destination test
git restore -- test                             # undo the self-reference edits made inside the moved folder
git status --porcelain --untracked-files=all    # must equal status-before.txt
```

Then confirm that the local data is back, using the report count and the `.env` presence from step 1.

**After the commit.**

- **If the commit is the branch tip and has not been pushed:** run `git reset --soft HEAD~1`. That un-commits but keeps the changes staged and the working tree as it is. Then follow the "before the commit" procedure.
- **If the commit was pushed or later commits exist:**
  1. Run `git revert <sha>`. Git removes the tracked files under `tests/` and recreates them under `test/`. The ignored local items stay in `tests/`.
  2. Move each item from `local-before.txt` back, one at a time, only if the target does not exist:

  ```powershell
  foreach ($rel in Get-Content "$work\local-before.txt") {
    if ($rel -notlike 'test/*') { throw "unexpected line, stop: $rel" }
    $src = $rel -replace '^test/','tests/'; $dst = $rel.TrimEnd('/')
    if (Test-Path -LiteralPath $dst) { Write-Warning "exists, skipped: $dst"; continue }
    if (Test-Path -LiteralPath $src) { Move-Item -LiteralPath $src.TrimEnd('/') -Destination $dst }
  }
  Get-ChildItem tests -Recurse -Force | Measure-Object   # remove tests/ only if it is empty
  ```

  3. Restore the old ignore line, if the revert did not.
  4. Re-run the 1.4 ignore check at the old path.

#### 1.6 Evidence at the end of stage 1

- the 1.4 table, with numbers;
- the two identity hashes;
- the staged list summary;
- the references left as they were, with the reason for each;
- which tester mode ran and what it proved;
- out-of-repo follow-ups.

### Stage 2: Plan structure and the `index.csv` registry

**Goal:** every plan has one fixed path, and its overall status lives in one place.

**Depends on:** stage 1 approved.

**Subtasks:**
- [x] 2.1 `docs/plans/README.md` (at most 30 lines). It states:
  - a plan is a `.md` file directly under `docs/plans/<topic>/`;
  - supporting files go in `<topic>/<plan-slug>/` and are not registered;
  - a cross-domain plan lives under the topic that leads the change;
  - status changes only in `index.csv`;
  - a plan keeps its "Resume here" block, checkboxes, Progress log and answered questions.
- [x] 2.2 `docs/plans/index.csv`:
  - header `path,title,status`;
  - `path` is relative to `docs/plans/`, uses forward slashes and has no leading `./`;
  - `status` is one of `planned`, `active`, `completed`, `canceled`;
  - fields follow standard CSV quoting (RFC 4180): a field containing a comma, a double quote or a line break is wrapped in double quotes, and an inner double quote is written twice.
- [x] 2.3 `scripts/validate-plans-index.js`, run as the npm script `lint:plans`. It uses a small built-in quoted-CSV parser and adds no new dependency. It checks:
  - the header is exact;
  - each record has exactly 3 fields after quote handling;
  - no quote is left unterminated;
  - the status is valid;
  - there is no duplicate path and every path exists;
  - every `docs/plans/*/*.md` (depth exactly 2, excluding `README.md`) has exactly one row;
  - no row points outside that pattern.

  On failure it exits 1 and names the record number and the reason.
- [x] 2.4 Register this plan with `repository/directory-restructure.md,Repository directory restructure,active`. The "Resume here" status line then points to `index.csv`.
- [x] 2.5 `tests/validate-plans-index.test.js` runs the validator on fixtures in a temp directory.
  - **Must pass:**
    - a title with a comma (`"Payroll, leave and rates"`);
    - a title with escaped quotes (`"The ""no month close"" decision"`).
  - **Must fail:**
    - an unterminated quote;
    - a wrong field count;
    - a bad status;
    - a duplicate path;
    - a missing file;
    - a plan with no row.
- [x] 2.6 Joining `lint:plans` to `npm run build` is [Q9](#q9-plan-lint-in-build). The owner's final answer: it stays out of `build`, and CI enforces it through its own "Plan registry" workflow.
- [x] 2.7 `.github/workflows/plan-registry.yml` (owner request after the joint review):
  - check name "Plan registry";
  - runs on PRs to and pushes to `staging` and `main`, with no path filter;
  - Node 20, read-only permissions;
  - runs `npm run lint:plans` and `node --test tests/validate-plans-index.test.js`, with no dependency install.

**Affected paths:**
- `docs/plans/README.md`;
- `docs/plans/index.csv`;
- `scripts/validate-plans-index.js`;
- `package.json`;
- `tests/validate-plans-index.test.js`;
- this plan.

**Acceptance:**
- `npm run lint:plans` exits 0 on the real tree.
- Every fixture behaves as listed.
- `npm run lint` shows the stage 1 counts.
- The `test:finance-calendar` identity is unchanged. The new test is run directly, not added to that script.

**Rollback:** revert the commit.

**Evidence:** the validator output for the real tree and for each fixture.

### Stage 3: One instruction source; development rules into `docs/project-rules/`

**Goal:**
- `AGENTS.md` is the binding entry point, and `CLAUDE.md` loads it.
- Domain rules live once, in `docs/project-rules/`.
- Every substantive rule carries a short reason where it is maintained.

**Depends on:** stage 2.

#### 3.1 Decisions C1–C7 and D8–D9 (owner, 2026-11-24)

- **Process.** Claude proposed the decisions on 2026-11-23, against `0339f45` [V]. The owner and Codex reviewed them, and the owner decided on 2026-11-24.
- **Paths.** "Sources" gives today's paths. "Maintained in" gives the paths after 3.2, where `agents-docs/` becomes `docs/project-rules/` with the same file names.
- **Wording.** The quoted blocks are the binding wording for 3.4–3.6 and 3.11–3.12. They can still be shortened when written, as long as the meaning does not change.
- **Counts that depend on a version** carry their SHA here and in the Progress log.

##### C1 Org isolation and `withOrgScope`

**Sources [V at `0339f45`]:**
- **`CLAUDE.md:28`:** "All DB writes must go through `withOrgScope` — never raw `client.from`".
- **`AGENTS.md`:**
  - line 6: "RLS is the primary isolation mechanism";
  - line 8: `ensureMembership()` plus `.eq('org_id', orgId)`, or `withOrgScope`.
- **`agents-docs/00-core-rules.md:17-19`:** every query filters by `org_id`.
- **`agents-docs/30-backend-shared-helpers.md`:**
  - lines 50-57: the endpoint flow;
  - line 64: auth and membership first, then org-scoped reads and writes.
- **`api/_shared/org-bff.js`:**
  - `ensureMembership` (line 97) returns the member's role, or `null` when there is no active membership.
  - `withOrgScope` (lines 307-326) supports `select`, `insert`, `update`, `upsert` and `delete`. It adds `.eq('org_id', orgId)` to select, update and delete, and sets `org_id` on every inserted or upserted row.
- **Endpoints without `ensureMembership`:** 41 `api/*/index.js` files have no call to it. By pattern:
  - `ensureSystemAdmin`: the `system-admin-*` endpoints and `config`;
  - their own `org_memberships` lookup: `directory`, `invitations`, `org-memberships`;
  - a shared secret or a timer: `backup`, `storage-cleanup-expired`;
  - user-level endpoints: `me`, `user-context`, `users-me`, `organizations`, `health`, `announcement`, `password-reset`.

  They were classified by pattern only, not audited one by one.

**Decision (owner).** `withOrgScope` is the binding default, in new or changed code, for every CRUD operation on a tenant table that the helper supports.

**Wording:**

```md
- **Org isolation in the API.** RLS protects requests made with a user's token. The API uses the service-role client, which bypasses RLS, so the API itself keeps each org's data apart, in two separate steps.
  1. **Authorisation: who may act.** Each route uses its own verified mechanism:
     - **A member's request:** authenticate the caller, call `ensureMembership(client, orgId, userId)`, check the result and stop when it is `null`. Then enforce the role the action needs, and the instructor's self-scope.
     - **A system-admin request:** `ensureSystemAdmin(...)`. When it acts on one org, it names that org explicitly.
     - **A public or token flow:** the verified token or record that the flow issued. The org comes from that record, never from the request body alone.
     - **A timer or machine call:** its trigger or its shared secret.
  2. **Org scoping: which rows.** After authorisation, every operation on a tenant table is limited to the authorised org.
     - New or changed code uses `withOrgScope(client, table, orgId)` for every select, insert, update, upsert and delete it supports. It filters reads, updates and deletes by `org_id`, and sets the authorised `org_id` on every inserted or upserted row.
     - An upsert also keeps its `onConflict` contract: a matching unique index or constraint in the schema, and an entry in `scripts/validate-upsert-conflicts.js`.
     - An operation that needs another interface, such as an RPC, a storage call or an auth admin call, documents next to it where and how the org is enforced on that path. A plain CRUD query that the helper supports uses the helper.
     - An ID that was read in this org does not replace the org filter.
  - **Why:** one missing filter reads or changes another org's rows, and nothing below the API catches it.
```

**Maintained in:**
- The full rule: `docs/project-rules/30-backend-shared-helpers.md`.
- `AGENTS.md`: one always-on line with a link.
- `00-core-rules.md:19` becomes a link to it.
- Removed: `CLAUDE.md:28`, and the sentences at `AGENTS.md:6,8`.
- Guard test: `tests/org-scope-reads.test.js`.

**Why:**
- It describes the real mechanism (the service role bypasses RLS).
- It keeps authorisation apart from org scoping.
- It makes one form the default.

**Follow-up:** stage 3F, subtask F1. It covers the four writes in `ensureStudentForClientProfile`.

##### C2 5xx responses, the support code, and strict tracking

**Sources [V at `0339f45`]:**
- **The instructions:**
  - `AGENTS.md:13`: every response through `respond(context, ...)`.
  - `agents-docs/30-backend-shared-helpers.md:58,61`: a 5xx with a client prefers `respondTrackedError` or `respondTracked`; a pre-client configuration failure may use `respond` directly.
- **`scripts/validate-error-tracking.js:1-29`:**
  - It flags only a literal `respond(` with a 5xx. Any `respond<Name>(` passes by its name, and the wrapper's body is not checked.
  - It honours a `tracked-error-exempt` comment.
  - It is warn-only. It exits 0 unless `--strict` is passed.
- **`api/_shared/error-events.js`:**
  - `trackErrorEvent` (line 103) creates the support code first. It returns the code even when there is no client (lines 112-115), and even when the insert into `error_events` fails, after only a warning (lines 139-146).
  - `respondTrackedError` (line 150) returns that code to the user as `error_id`.
  - `respondTracked` (line 176) sends a plain `respond` when `attachErrorTracking` (line 161) did not run in that request.
- **Consumers of `error_id`:**
  - `src/lib/api-client.js:131-152` shows "קוד תמיכה: <id>" for a 5xx and attaches the code to the error.
  - Also `src/lib/error-support.js:4,50`, `src/pages/SubmitFormPage.jsx` and `src/components/ui/forms-ui/FormField.jsx`.
- **Support search:** `api/system-admin-error-events/index.js` and `src/admin/modules/ErrorEventsView.jsx`.
- **Enforcement today:**
  - `npm run build` runs `lint:error-tracking` warn-only.
  - `integrity-checks.yml` runs it as "Validate error tracking (warn-only)" with `continue-on-error`, on `main` only.
  - 276 untracked 5xx responses in 100 files, the same at `dce8f2e` and `0339f45`.
  - 0 `tracked-error-exempt` comments under `api/`.

**Decision (owner).** The writer rule below applies. Moving to blocking enforcement **is part of this initiative**. This replaces the earlier proposal to keep the validator warn-only and treat strict mode as a separate initiative.

The work is two separate units, in this order:
1. **F2:** the runtime bug in the support code.
2. **F3:** strict static enforcement in CI.

**Wording:**

```md
- **Responses** go through `respond(context, ...)` or a helper built on it.
- **A 5xx is tracked.** Its detail is stored in `error_events`, and the user gets an `error_id` that support can find by that code.
  - With a service-role client in hand: `respondTrackedError(context, req, client, { status, message, error })`.
  - `respondTracked(...)` only after `attachErrorTracking(context, req, client, ...)` ran in the same request. Without it, `respondTracked` sends an untracked response.
  - A local wrapper `respond<Name>Error` must call one of the two in its body. Its name proves nothing.
  - **Exception:** a failure before a suitable client exists (missing configuration, client creation failed) uses `respond(context, 500, ...)` with `// tracked-error-exempt: <reason>`. The reason must be a real one.
- **Enforcement:** `npm run lint:error-tracking:strict` is a blocking CI check (once F3 lands; until then the check only warns).
```

**Maintained in:**
- `docs/project-rules/30-backend-shared-helpers.md`;
- one always-on line in `AGENTS.md`.

The enforcement line is updated when F3 lands (D8).

**Why:**
- A code shown to the user that support cannot find is worse than no code.
- A name-only check lets untracked paths through.

##### C3 `createSingleClient` and the stale `resolveTenantClient` hints

**Sources [V at `0339f45`]:**
- `AGENTS.md:9` is correct: use `createSingleClient(env)`.
- **The name `createSingleClient` appears in 21 files under `api/`:**
  - 20 endpoint `index.js` files that call it;
  - `api/_shared/org-bff.js:272`, which defines it.

  The two counts describe different sets, and both are correct.
- **Stale hints,** found by their text:
  - `eslint.config.js:103` and `:143`: "Use resolveTenantClient from org-bff.js instead";
  - `scripts/validate-api-endpoints.js:27`: the same text;
  - `docs/api-validation-tool.md:49`: the same hint, with the names in backticks.

**Decision (owner).** Fix the four stale hints in 3.7. Find them by their text at execution time, not by line number.
- **The new hint:** `createSingleClient(env)` creates the client, and `withOrgScope(client, table, orgId)` scopes tenant table access. Each helper is named for its own role.
- **The rule "never `resolveTenantClient`"** is kept once, in `docs/project-rules/00-core-rules.md:20`. *Updated at the stage 3 review (owner, 2026-11-24):* the function no longer exists in any code, so the name was removed from `00`. The ban on per-org credentials and the `createSingleClient(env)` and `withOrgScope` guidance remain. See the review log entry.
- **`AGENTS.md:9`** is removed.

**Why:** a hint that names a removed function sends an agent looking for deleted code.

##### C4 Schema contract (current state) and the migration research

**Sources [V at `0339f45`]:**
- `CLAUDE.md:44` and `agents-docs/00-core-rules.md:21` call `setup-sql.js` the single source.
- `migrations/README.md` describes the snapshot plus numbered migrations. Migrations are applied by hand today, and applying them from CI is planned.
- **5 migration files.**
- **What checks the migrations:**
  - `lint:sql` checks only the snapshot;
  - `tests/dated-settings.test.js` reads a migration file (`:387`, migration 0002);
  - no general checker validates every migration file.

**Decision (owner).** Record the current state exactly. Add one research task (stage 4R). *Updated 2026-11-24: the owner deferred 4R and Q11; they are not preconditions for stage 5.*

**Wording:**

```md
- **Schema.**
  - `src/lib/setup-sql.js` is the target snapshot. A new database is set up from it alone.
  - On an existing database, run the new migrations from `migrations/` in order, then the snapshot.
  - `migrations/README.md` holds the procedure: migrations are applied by hand today; applying them from CI is planned.
  - `npm run lint:sql` checks the snapshot. Some tests read a migration file (for example `tests/dated-settings.test.js`). No general checker validates every migration file yet.
  - **Why:** a new database needs only the target state; an existing one must first lose what the snapshot no longer defines.
```

**Maintained in:**
- the schema rules in `docs/project-rules/00-core-rules.md`, in place of line 21;
- the procedure only in `migrations/README.md`.

Stage 5 updates both paths.

**Agent memory.** The plan to apply migrations from CI on deploy comes from agent memory (`db-migrations-decision`). Nothing beyond what `migrations/README.md` already says is written as fact.

**Follow-up:** stage 4R (deferred), and the practical check in 5.0.

##### C5 One validation table

**Sources [V]:** the validation table appears three times:
- `CLAUDE.md:3-15`;
- `AGENTS.md:42-62`;
- `agents-docs/00-core-rules.md:70-85`.

Two of the copies are out of date:
- `CLAUDE.md:15` lists 4 build steps, while the `build` script in `package.json` runs 6.
- `lint:upsert-conflicts` is not in `build`.

**Decision (owner).**
- The table is maintained once, in `AGENTS.md`, and names npm script names from `package.json`. It does not copy what a script runs.
- Every condition that requires `npm run lint:upsert-conflicts` is kept:
  - `setup-sql.js` plus a migration;
  - any `.upsert({ onConflict })` added or changed under `api/`;
  - an edit to `scripts/validate-upsert-conflicts.js`.
- The upsert contract (the three simultaneous changes) is kept once, in the domain rules (`00-core-rules.md`). `AGENTS.md` links to it.

**Why:** a list copied from a script goes stale, and here it did.

##### C6 Reading by task

**Source [V]:** `AGENTS.md:18`: "Load ONLY the source files listed there".

**Decision (owner).**
- `AGENTS.md` explains the reading rule once.
- Each domain document keeps its own "Start here" list.
- During the move, every rewritten link must resolve to the right target, including links between files that moved together (3.3).

**Wording** (in `AGENTS.md`):

```md
- **Where to start.** Read the `docs/project-rules/` document for your task and start from its "Start here" files. Continue as far as the change needs: imports, callers (grep the symbol), dependencies, cross-domain effects and tests.
```

**Why:** a fixed file list missed callers and existing tests.

##### C7 Where tests live, how they run, and the binding test rule

**Counts [V at `0339f45`]:** 52 tracked `*.test.js` files.
- 30 are in `test:finance-calendar`. They run by hand and through `verify:beta` (`package.json:34`), not in `build` and not in CI.
- 1 runs directly in the "Plan registry" CI.
- 21 are in no npm script and in no workflow that was checked. They can be run directly.

The count by suffix does not cover every test tool (see [Test classification](#test-classification)).

**Decision (owner):**
- **Location of the test guidance:**
  - the general guidance goes in `docs/project-rules/00-core-rules.md`;
  - `80-finance-billing-payroll.md` gets a short pointer for finance.
- **The guidance explains how to find and run tests.** The counts live in the Progress log, with their SHA, not in the guidance.
- **Classification:** the migration map classifies tests by purpose, environment and entry point ([Test classification](#test-classification)).
  - A unit test next to its module is a valid location.
  - The three `one-db-refactor` files are candidates for `tests/integration/`.
  - Entry points and consumers are kept when files move.
- **The coverage gap** stays tracked in this plan. No GitHub issue in this round.
- **The test rule is binding.** It was formerly agent memory only (`keep-tests-current`); the owner approved it on 2026-11-24 in this wording.

**Wording:**
- the test rule, in `AGENTS.md` among the always-on rules;
- the guidance, in `00`.

```md
- **Tests for every behaviour change.** Identify which test proves the behaviour that changed.
  - Update or add a Node test for logic.
  - Update or add a tester scenario (`tests/automatic-tester/`) when a user flow is affected. If both are affected, cover both.
  - If existing coverage already proves the requirement, run it.
  - A documentation change gets the verification that fits it.
```

```md
- **Finding and running tests.**
  - Node tests use `node --test`. A unit test may sit next to its module (`api/**`, `src/**`). Shared tests are in `tests/`, and browser scenarios are in `tests/automatic-tester/`.
  - `npm run test:finance-calendar` runs a fixed list; `verify:beta` runs it too. Neither `npm run build` nor CI runs it.
  - CI runs `tests/validate-plans-index.test.js` ("Plan registry").
  - Every other test file has no entry point: run it with `node --test <file>` when you change the code it covers.
```

**Why:**
- "Not in an npm list" is not the same as "never run".
- "In an npm list" is not the same as "run automatically".

##### D8 Keep documentation current

**Decision (owner).** One binding rule in `AGENTS.md`. It extends "Keep the Hub Alive":

```md
- **Keep documentation current.** When a change makes an existing instruction, product rule, command, path, or plan checkpoint inaccurate, update its authoritative document in the same change. Record new shared contracts and cross-domain effects in the relevant domain guide. Review the documents referenced by the work you touched. If they remain accurate, no documentation edit is needed.
```

**Acceptance** (part of stage 3 acceptance):
- A change to a run command updates the instruction that cites it.
- An approved product decision is recorded in its domain source.
- An internal refactor that keeps behaviour and instructions may finish with no documentation edit.

The aim is to fix what the change made stale. It does not require a full documentation scan on every task.

##### D9 Other decisions

- **`AGENTS.md`** stays the main entry point. `CLAUDE.md` points to it (3.5).
- **The commit policy** (Conventional Commits 1.0.0) is maintained in `docs/project-rules/commits.md`. `AGENTS.md` links to it (3.10, section 3.3).
- **The conversation language** is a personal preference, outside the repository. [Q10](#q10-co-authored-by-trailer) (`Co-authored-by`) is still open.
- **Claims about the preview and production environments** need a verified configuration source before they are written as rules.
- **Working rules about `main`,** and other preferences that come from agent memory, need an owner decision before they become policy.

**Rules found in only one file** must be kept once, in the right place. *Correction found in stage 3:* the `IF NOT EXISTS` DDL rules, the money ESLint rule, the general `function.json` rule and "`onConflict` explicitly" were **only** in `CLAUDE.md`, not in agents-docs as listed below. They were moved to `00` ("Schema", "Money in code", "Known patterns").
- **In `CLAUDE.md` and also in agents-docs**, keep them in agents-docs:
  - the `function.json` sibling (`95`);
  - the `IF NOT EXISTS` rules (`00`);
  - dates and time zones (`00`);
  - the money ESLint rule (`00`);
  - `toAgorot` (`20`, `80`).
- **Only in `AGENTS.md`:**
  - single-DB multi-tenant;
  - `x-org-id`;
  - no `reinex` in routes;
  - the instructor self-scope;
  - `is_active`;
  - the Escape Hatch;
  - Keep the Hub Alive (extended by D8).

**Instruction sources to retire** (merge any valid items first):
- `.github/chatmodes/…chatmode.md`;
- `ProjectDoc/TutTiud_Agents.md`;
- `ProjectDoc/Conventions.md`;
- `docs/AI-Coder-Gotchas.md`.

**Rules that came from agent memory, and their status after 3.1:**

| Rule (memory file) | Status |
|---|---|
| Every behaviour change is covered by tests (`keep-tests-current`) | **Binding**, in the C7 wording (owner, 2026-11-24) |
| Never push or merge to `main` without the owner | **Binding** (owner, 2026-11-24): every push or merge to `main` needs explicit owner approval. To be written in the `AGENTS.md` hard limits (3.4 item 2). |
| The preview environment uses the production DB (`pp-pr62-open`) | A claim about an environment. Written only with a verified configuration source (D9). |
| Straight quotes in UI terms (`straight-quotes-feedback`) | **Binding** (owner, 2026-11-24): in UI-writing guidance, a quoted Hebrew button, field or status name uses straight quotes, for example: לחצו על "בטל שיעור". To be written in `20-frontend-shared-helpers.md`. |
| Migrations applied from CI on deploy (`db-migrations-decision`) | Not written as fact; the research (4R) and the decision (Q11) are deferred |
| Conversation language (`narration-language-feedback`) | Personal preference; stays outside the repository |

**Still open after 3.1:**
- ~~Q10~~ (decided 2026-11-24);
- ~~the two memory rules above that need an owner decision~~ (both decided 2026-11-24);
- a verified source for the preview and production claims;
- the F1 fix design, after the callers are reviewed;
- the F3 workflow, confirmed at its review;
- making the F3 check a required check (F3). "Plan registry" and "Doc links" are decided (Q9, 2026-11-24);
- the migration workflow decision (Q11), deferred with 4R by the owner on 2026-11-24;
- Q2 and Q4–Q8.

#### 3.2 Subtasks

- [x] 3.1 Present the conflicts with the proposed wording; joint review; record the answers. Done: proposal on 2026-11-23 against `0339f45`, owner decisions on 2026-11-24, recorded in [3.1](#31-decisions-c1c7-and-d8d9-owner-2026-11-24).
- [x] 3.2 `git mv agents-docs docs/project-rules`, keeping the file names. Done in `c576742`.
- [x] 3.3 Rewrite the 262 relative links inside them (`../api` becomes `../../api`, and so on). Also rewrite every inbound link:
  - `AGENTS.md`;
  - `CLAUDE.md`;
  - the comment at `eslint.config.js:10`;
  - `implementations/**`.

  Verify that every rewritten link resolves to the right target. That includes links between files that moved together, whose relative form does not change (C6).

  Done in `c576742`. The current tree had 285 links inside the folder, not 262: 275 leave it and were rewritten, and 10 stay inside it and were left unchanged. All 393 links in the repository resolve to the same file as before. See the stage 3 Progress log entry.
- [x] 3.4 Rewrite `AGENTS.md`, at most about 100 lines. Done in `83d4b1a` and `0d52f96`: 58 lines. Item 2 is left open; see below.
  1. what Reinex is;
  2. hard limits: only limits the owner has decided, each claim about an environment backed by a verified configuration source (D9). **Open:** no limit had both an owner decision and a verified source when stage 3 ran, so `AGENTS.md` has no hard-limits section yet. *Update 2026-11-24:* the `main` rule is now decided (D9 table) and is written in the next approved round. The preview and production claim still needs a verified configuration source;
  3. always-on rules, each with a one-line why. These include the C1 and C2 lines, the binding test rule (C7) and "Keep documentation current" (D8);
  4. the reading rule (C6), written once;
  5. a routing table (task → `project-rules` → `product` → tests → start files), including "committing work → `docs/project-rules/commits.md`";
  6. the validation table, the only copy (C5): npm script names, with every `lint:upsert-conflicts` condition and a link to the upsert contract;
  7. how to continue a plan: "Resume here", then `docs/plans/index.csv`.
- [x] 3.5 Make `CLAUDE.md` exactly `@AGENTS.md`, plus Claude-only notes if any remain. Remove the validation table copy in `00-core-rules.md`, leaving a link (C5). Done in `83d4b1a`. No Claude-only notes remained.
- [x] 3.6 Add a "Start here" list to each `project-rules` file (C6). Write the full C1 and C2 rules in `30-backend-shared-helpers.md`. Done in `83d4b1a`: each "Load these files first" list was renamed "Start here" with the C6 sentence. In `0d52f96`, the deleted `api/backup-status/index.js` was removed from the list in `90`.
- [x] 3.7 Fix the four C3 hints, found by their text (`git grep -n "resolveTenantClient" -- eslint.config.js scripts docs/api-validation-tool.md`). Remove `AGENTS.md:9`. Done in `f74bdf4` (the hints) and `83d4b1a` (`AGENTS.md`). The output of `node scripts/validate-api-endpoints.js` is identical before and after; it exits 1 on both sides because of pre-existing findings.
- [ ] 3.8 Delete the retired instruction sources after owner confirmation. **Owner decisions (2026-11-24):**
  - `.github/chatmodes/Azure_function_codegen_and_deployment.chatmode.md`: **deletion approved**. Not executed yet.
  - `docs/AI-Coder-Gotchas.md`: **deletion approved** after checking that the valid guidance moved (done in `0eb74a2`) and after updating the references to it: `docs/README.md:71,94,140,156` and `ProjectDoc/TutTiud_Agents.md:574`. Not executed yet.
  - `ProjectDoc/TutTiud_Agents.md`, `ProjectDoc/Conventions.md`: still left to the stage 7.1 triage.
  - The preparation is in [3.8 Retirement candidates](#38-retirement-candidates).
- [x] 3.9 Decide whether the link check becomes `scripts/check-doc-links.js`. **Decided at the stage 3 review (owner, 2026-11-24): yes.** Done in `fdebc18` and `2d71c48`.
  - **Command:** `npm run lint:doc-links`, outside `npm run build`.
  - **Scope:** every relative Markdown link in `AGENTS.md` and `docs/project-rules/**/*.md`, resolved from the file that contains it, to a file or folder in the repository.
  - **CI:** `.github/workflows/doc-links.yml` ("Doc links"), on PRs and pushes to `staging` and `main`, with no path filter.
  - **Not covered yet:** paths cited in code comments, and Markdown outside the instructions. Widen it in stages 5–7 if they need it.
- [x] 3.10 Define one commit policy for every development agent in Reinex. The owner requested it on 2026-11-23. See 3.3. Done in `83d4b1a` (`docs/project-rules/commits.md`) and `0d52f96` (the pointer in `AGENTS.md`). Q10 stays open; the policy says nothing about trailers.
- [x] 3.11 Write the C7 test guidance ("Finding and running tests") in `00-core-rules.md`, with a short pointer from `80-finance-billing-payroll.md`. Put no counts in the guidance. Done in `83d4b1a`.
- [x] 3.12 Write the C4 schema contract in `00-core-rules.md`, in place of "Schema SSOT". Done in `83d4b1a`. The section also holds the DDL idempotency rules and the upsert contract.

#### 3.3 Commit policy (subtask 3.10)

**Where it lives.**
- The policy is maintained in **one place**: `docs/project-rules/commits.md`.
- `AGENTS.md` names it in its always-on rules and in the routing table ("committing work → `docs/project-rules/commits.md`"), as one line with a link. It does not copy the rules.
- The policy links to the specification: https://www.conventionalcommits.org/en/v1.0.0/

**What the policy says.** These are the points to write; the final wording is settled in the joint review.

1. **Format.** [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). Messages are written in English.
2. **Title.**
   - Shape: `<type>(<scope>): <description>`.
   - **Type:** one of the types from the specification and its common conventions: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, `style`, `revert`.
   - **Scope:** added when it helps to identify the area. It is optional; the policy lists the scopes in use, such as `payroll`, `leave`, `calendar`, `billing`, `tests`, `plans`, `db` and `api`.
   - **Description:** short, and starts with a verb in the imperative.
3. **Body.** Explain why the change was made, or what follows from it, when that is not clear from the title and the diff. Otherwise there is no body.
4. **One logical change per commit.** A commit can be reviewed and reverted as one unit. Two examples:
   - **Belongs together:** moving `test/` to `tests/` together with updating its npm scripts, the ESLint config and the ignore rules. Without those updates, the move alone breaks the build.
   - **Separate commits:** adding new tests to cover a missing scenario is its own change, not part of the move.
5. **Examples for Reinex:**
   - `docs(plans): add repository restructure plan`
   - `refactor(tests): move shared tests to tests/`
   - `fix(payroll): use the rate effective on the lesson date`
6. **Out of the policy's scope:**
   - **The conversation language.** It is a personal preference and stays outside the project settings.
   - **The `Co-authored-by` trailer.** It is decided separately, see [Q10](#q10-co-authored-by-trailer). Until then the policy says nothing about it.
7. **History.** The policy applies from its adoption on. Earlier commits are not rewritten, including this plan's own commits `0fec72c` and `3a5ad46`.

**Not in scope** (separate initiatives, listed with the other non-goals):
- commitlint;
- Git hooks;
- CI checks on messages.

**Acceptance:**
- A new agent with no memory gets a short task: a change that touches several files, for example "move `test/` to `tests/` and add one new test for a missing scenario". Through `AGENTS.md` alone, it must:
  - find `docs/project-rules/commits.md`;
  - propose a fitting title for each commit;
  - explain which files belong together in one commit and which go in a separate one, and why.
- The rules appear only in `docs/project-rules/commits.md`. `AGENTS.md` holds only the pointer.
  - `git grep -n "Conventional Commits" -- AGENTS.md CLAUDE.md docs/project-rules` finds the rules in one file and a single link line in `AGENTS.md`.
- The policy links to the 1.0.0 specification URL above.
- No commitlint configuration, hook or CI change is added.

#### 3.8 Retirement candidates

Prepared on 2026-11-24 against `0d52f96`. Nothing was deleted, because each file needs its own owner approval.

| Path | Kept from it, and where | Consumers left [V] | Recommendation |
|---|---|---|---|
| `.github/chatmodes/Azure_function_codegen_and_deployment.chatmode.md` (145 lines) | Nothing. It is a generic Copilot workflow for Azure Functions and IaC, naming "Claude Sonnet 4". It contains no Reinex rule: 0 mentions of Reinex, TutTiud, `org_id` or Supabase. | None | Delete |
| `docs/AI-Coder-Gotchas.md` (115 lines) | **Moved to `20-frontend-shared-helpers.md`** (`0eb74a2`), each checked against the code: the dialog `footer` prop, scrolling a `Select` or `Popover` inside a `Dialog` and `PopoverTrigger` with an input, and the mobile Select-in-Dialog guard. **Already covered:** `admin` route names (`00`, `AGENTS.md`), `ensureInstructorColors` (`30`), lint and build commands (`AGENTS.md`). **Dropped as stale or unverified:** `rtl-embed-text` (used in one component only); `org_settings.permissions` (table removed); `/api/backup-run` and `/api/backup-list` (no such endpoints); the auth-redirect line (points to routes `AGENTS.md` never had). | `docs/README.md:71,94,140,156`; `ProjectDoc/TutTiud_Agents.md:574` | Delete after the owner approves. In the same change, remove its 4 lines in `docs/README.md` (that file is triaged in stage 7) |
| `ProjectDoc/TutTiud_Agents.md` (1104 lines) | Nothing merged yet. Its first heading is "Legacy notes (Tuttiud) — DO NOT FOLLOW". Most of it is dated feature notes from 2025 (documents, storage, audit, forms, onboarding tour). Reading it fully belongs to the stage 7.1 triage of `ProjectDoc/`. | `implementations/backup/rebuild.md:100-164` (line references); `ProjectDoc/Conventions.md` | Do not delete in stage 3. Triage in 7.1, then ask again |
| `ProjectDoc/Conventions.md` (297 lines) | Nothing merged yet. These are the "TutTiud Repository Conventions" (2025-10-26): folder layout, naming, API, settings. `AGENTS.md` and `project-rules` now own these topics; any still-valid item is extracted in 7.1. | `ProjectDoc/Eng.md:6`, `ProjectDoc/Heb.md:6`, `ProjectDoc/TutTiud_Agents.md:135` | As above |

#### 3.13 Instruction mapping: old `CLAUDE.md` and `AGENTS.md` (at `0339f45`)

Every line of the two old files, and where it is maintained at the end of stage 3. `00`, `20`, `30` and `80` are files in `docs/project-rules/`.

**Old `CLAUDE.md` (45 lines):**

| Old lines | Content | Now |
|---|---|---|
| 1 | Title | Removed. `CLAUDE.md` is `@AGENTS.md`. |
| 3-15 | Validation table | `AGENTS.md` "After writing code — required validation", the only copy. The build step list (line 15) is replaced by a pointer to `package.json` (C5). |
| 19-23 | `IF NOT EXISTS` / guarded `UNIQUE` DDL rules | `00` "Schema". These were only in `CLAUDE.md`. |
| 24-25 | Upsert unique index and `EXPECTED_CONFLICTS_BY_TABLE` | `00` "Upsert contract"; the `AGENTS.md` table row links to it |
| 28 | Writes only through `withOrgScope` | `30` "Org isolation in the API" (C1 wording); one line in `AGENTS.md` |
| 29 | `onConflict` stated explicitly | `00` "Upsert contract", first sentence |
| 30 | `function.json` sibling | `00` "Known patterns"; `AGENTS.md` "Endpoint shape" |
| 32-33 | Dates and time zones | `00` "Dates and time zones" (unchanged); `AGENTS.md` "Dates and money" |
| 36 | Agorot and currency helpers | `00` "Money in code"; helper lists in `20` and `80` |
| 37 | `authenticatedFetch` | `AGENTS.md` "One database, many orgs"; `20` |
| 38 | ESLint money rule | `00` "Money in code" |
| 41-43 | `api/`, `api/_shared/`, `src/` | `AGENTS.md` "What Reinex is"; the helper lists in `30` |
| 44 | "`setup-sql.js` — single source of truth" | Replaced by `00` "Schema" (C4) |
| 45 | "`scripts/` — run as part of build" | Dropped as inaccurate: not every script is in `build`. The validation table names the scripts. |

**Old `AGENTS.md` (67 lines):**

| Old lines | Content | Now |
|---|---|---|
| 1-3 | Title and intro | `AGENTS.md` intro and routing |
| 6 | Single DB; "RLS is the primary isolation mechanism" | `AGENTS.md` "One database, many orgs". The RLS sentence is corrected in `00` "Architecture" and in `30` (C1). |
| 7 | Schema `public` only | `AGENTS.md` "One database, many orgs" |
| 8 | Isolation through `ensureMembership` and `.eq` / `withOrgScope` | `30` "Org isolation in the API"; one line in `AGENTS.md` (C1) |
| 9 | Never `resolveTenantClient` | `00` "Architecture", once (C3) |
| 10 | `x-org-id` | `AGENTS.md` "One database, many orgs" |
| 11 | No `reinex` in routes | `AGENTS.md` "Routes"; `00` |
| 12 | Instructors self-scoped | `AGENTS.md`; `00`; `30` (authorisation) |
| 13 | `respond`, `resolveBearerAuthorization` | `AGENTS.md` "Endpoint shape"; `30` "5xx responses and the support code" |
| 14 | `getUser` return shape | `00` "Known patterns" |
| 15 | `is_active` | `AGENTS.md` "Disable, don't delete"; `00` |
| 18 | Context economy ("Load ONLY") | Replaced by `AGENTS.md` "Where to start" (C6) and "Start here" in each file |
| 19-20 | Do not reinvent; respect coupling | `AGENTS.md` "Do not reinvent" |
| 21 | Escape hatch | `AGENTS.md` "Escape hatch". The marker is kept as `NEW PATTERN PROPOSAL:`, without the emoji. |
| 22 | Keep the Hub Alive | `AGENTS.md` "Keep documentation current" (D8), with `DOC UPDATE REQUIRED:` |
| 24-37 | Read by task, including the finance contract and hardening links | `AGENTS.md` routing table, which gains a tests column and rows for commits and plans |
| 40 | Workflow tree "verified against pre-prod (May 2026)" | The link is kept. The environment claim is dropped (D9). |
| 42-56 | Validation table | `AGENTS.md` table, the only copy (C5) |
| 58-62 | Upsert contract | `00` "Upsert contract" |
| 65-67 | Read the domain file; check helper docs; keep page code thin | `AGENTS.md` "Where to start" and "Do not reinvent" |

**Also removed:** the copy of the validation table in `00` (old lines 69-81). It now links to `AGENTS.md`.

**Acceptance (stage 3 as a whole):**
- A checklist maps every line of the old `CLAUDE.md` and `AGENTS.md` to its new location.
- The link check over `AGENTS.md`, `CLAUDE.md` and `docs/project-rules/**` finds 0 broken links.
- `npm run lint` and `npm run lint:api` show the stage 2 counts.
- The commit policy acceptance in 3.3 passes.
- Each rule decided in 3.1 appears in exactly one maintained place, with a pointer wherever else it is needed. For example, `git grep -n "withOrgScope(client, table, orgId)" -- AGENTS.md CLAUDE.md docs/project-rules` finds the rule in `30` and only a link line in `AGENTS.md`.
- **A new agent with no memory passes these short tasks through `AGENTS.md` alone:**
  - **(D8) Three cases:**
    - a renamed npm script: it updates the instruction that cites the script;
    - an approved product decision: it records the decision in its domain source;
    - an internal refactor that keeps behaviour and instructions: it ends with no documentation edit.
  - **(C7)** Given a behaviour change, it names the test that proves it. It picks a Node test, a tester scenario, or both, by what the change affects.
  - **(C1)** Given a new CRUD endpoint on a tenant table, it uses `ensureMembership` with a null check, then `withOrgScope`.

**Rollback:** revert.

**Evidence:**
- the line-mapping checklist;
- the link-check output;
- the resolved conflicts;
- the commit-policy agent test: the task given, and the agent's titles and grouping.

### Stage 3F: Code fixes decided in 3.1

**Goal:** the code matches the C1 and C2 rules written in stage 3.

**How the work is split:**
- Each subtask is a separate unit of work, with its own commits, evidence and joint review.
- No file moves here.
- Each fix adds the tests that prove its behaviour (C7), as the exception to scope rule 3.

**Depends on:** stage 3 reviewed, so the rules exist where agents read them.

**Order:**
- **F1** stands on its own.
- **F2 must land before F3.** F3 routes many more 5xx responses through the tracking helpers. Without F2, each of them could show the user a code that support cannot find.
- **Default sequence:** 3 → F1 → F2 → F3 → 4.
- **Possible change at the stage 3 review:** F3 is large (276 findings at `0339f45`), so the owner may move it after stage 4. Its commits never mix with a move stage.

#### F1 Org scoping of the four writes in `ensureStudentForClientProfile`

**Facts [V at `0339f45`]:**
- **The function:** `api/_shared/client-profiles.js:397-472`.
- **The four updates (lines 459-464).** They update `form_submissions`, `otp_challenges`, `waiting_list_entries` and `lesson_participants`:
  - with `tenantClient.from(...)`, by `client_profile_id` and `student_id IS NULL`;
  - with no `org_id` filter;
  - inside one `Promise.all`, without reading each Supabase result's `error`.
- **The comment above them** says the profile was "just read in this organisation". It was added in #55 (`dce8f2e`, per `git log -L`).
  - The evidence for that claim is the org-scoped read of the profile earlier in the function.
  - The original motive beyond that evidence is unknown.
- **Callers:**
  - the import, `api/import-commit-chunk/index.js:159`;
  - lesson templates, `api/lesson-templates/index.js:858`, `:894` and `:1434`.
- **The flow:**
  1. validate the IDs;
  2. return the student that already exists for the profile, if there is one (early exit, lines 412-422);
  3. otherwise read the profile in the org and create the student;
  4. link the profile's earlier rows in the four tables to the new student;
  5. re-read the student.

**Subtasks:**
- [x] F1.1 Record the existing explanation and its sources. Done 2026-11-24 against `e553f38`; see the F1 proposal below.
- [x] F1.2 Record the real user flow from each caller. Done; see below.
- [x] F1.3 Plan the four updates through `withOrgScope`. Done; see below.
- [x] F1.4 Examine partial failure and propose a solution. Done; see below. **Joint review before F1.5.**
- [x] F1.6 Map the operation boundary in each path (owner request, 2026-11-24). See F1.6 below.
- [x] F1.7 Propose one atomic transaction per operation. See F1.7; scope awaiting approval (F1-Q1).
- [x] F1.8 Define the proof against local PostgreSQL. See F1.8.
- [x] F1.9 Propose how a failed attempt and its retry are measured. See F1.9.
- [ ] F1.5 Implement the approved solution, test first. **Blocked on F1-Q1 to F1-Q4.**

##### F1 findings and proposal (for joint review)

**F1.1 The existing explanation [V at `e553f38`]:**
- The comment above the four updates in `api/_shared/client-profiles.js` reads: "Keyed by a profile just read in this organisation, so these touch only its own rows." It was added in #55 (`dce8f2e`).
- **The evidence for it:** the profile is read with `withOrgScope(…, 'client_profiles', scopedOrgId)` earlier in the same function.
- **Why that is not enough:** the comment assumes that no row of another organisation carries the same `client_profile_id`. The four tables have their own `org_id` column [V], and nothing in the update enforces it. Under C1, an ID read in the org does not replace the org filter.
- **Unknown:** any motive beyond that evidence. No commit message or document explains it.

**F1.2 The real flow [V]:**

| Caller | What the user did | What `ensureStudentForClientProfile` does there | What happens on failure today |
|---|---|---|---|
| `api/import-commit-chunk/index.js:159` (`commitCustomer`) | Commits an import whose customer type is "student", after `createOrReuseClientProfile`. A reused profile can already have form submissions, OTP challenges, waiting-list entries or lesson participants. | Creates the student, or returns the existing one, and links those earlier rows. | A returned `error` is thrown. Any throw marks the candidate `failed`, and the user can retry only the failed IDs (the header comment, and the `catch` near line 754). On a retry the import ledger records `link` instead of `create` for the student. |
| `api/lesson-templates/index.js:858` | Creates a fixed lesson template from a waiting-list entry, when the entry has no student yet. | Turns the entry's client profile into a student and links its rows, including that waiting-list entry. Then the entry is marked `matched` (near line 1140); `student_id` is not written there. | Returns `tracked500('failed_to_activate_student_from_waiting_list')`; no template is created. |
| `api/lesson-templates/index.js:894` | Creates a template for a client profile directly, without a waiting-list entry. | As above. | Returns `tracked500('failed_to_create_lesson_template')`. |
| `api/lesson-templates/index.js:1434` | Assigns a waiting-list entry to a template's free place (capacity assign). | Used only when `waitingEntry.student_id` is empty. | Returns `tracked500('failed_to_activate_student_from_waiting_list')`. |

**Today's behaviour in a partial failure.** The four updates sit in a `Promise.all`, and no result's `error` is read.
- A Supabase error comes back as `{ error }`, not as a rejection. A failed update is therefore silent: the student exists, some rows stay unlinked, and the caller receives `created: true` with no sign of a problem.
- A network failure rejects instead. The function then throws after the student was created, and the caller fails as shown in the table.
- **On any retry,** the early exit for an existing student (it returns before the link step) means rows that were left unlinked stay unlinked.
- **The practical effect:** a `lesson_participants` row without `student_id` is missing from everything keyed by student. A waiting-list entry without `student_id` sends the capacity-assign path back through `ensureStudentForClientProfile`, which returns the existing student but still links nothing.

**No second student is possible today, or after the change [V].** `src/lib/setup-sql.js` has `students_client_profile_id_uidx`, UNIQUE ON `students (org_id, client_profile_id)` WHERE `client_profile_id IS NOT NULL`. A concurrent second insert fails, and the function throws.

**F1.3 and F1.4 Proposed solution** *(rejected by the owner on 2026-11-24; kept as history, see "F1 revised" below)*:
1. **One link step, org-scoped.** Move the four updates into an internal `linkClientProfileRowsToStudent(client, orgId, clientProfileId, studentId)`. Each update is:

   `withOrgScope(client, table, orgId).update({ student_id }).eq('client_profile_id', clientProfileId).is('student_id', null)`

   Rows of another org, and rows that already have a student, are never touched.
2. **Read every result.** Use `Promise.allSettled`, so all four are attempted. Collect a table as failed when its Supabase result has an `error` or its promise rejected.
3. **Run the link step on both paths:**
   - after creating the student;
   - on the early exit for an existing student.

   It is safe to repeat because of `student_id IS NULL`. When there is nothing left to link it is a no-op, at the cost of four small updates per call.
4. **What the caller receives in a partial failure:** the function throws `Error('client_profile_link_failed')`, with `failedTables` and the first cause attached.
   - The student stays created. There is no rollback and no new transaction mechanism.
   - Every caller already treats a throw as failure: the import marks the candidate `failed` and allows a retry, and the template paths return a tracked 500 without creating the template.
   - A returned `error` stays reserved for the business cases it already covers (`invalid_client_profile_id`, `client_profile_not_found`).
5. **On a retry after the student was created:** the early exit finds the student, and the link step links the rows that are still unlinked. The function returns the same student with `created: false`. The unique index guarantees there is no second student.
   - **Visible consequence:** the import ledger records `link`, and the template response reports `student_created: false`, for a student that the failed attempt created. Today's behaviour is the same after any throw.
   - **Owner choice:** accept this, or add a follow-up that reports the original creation. The default proposal accepts it.
6. **Also:** replace the comment with one that states the C1 reason, and keep the `scopedOrgId` UUID check.

**How the proof works (Node tests, extending the fake client in `tests/org-scope-reads.test.js`):**
- **The fake client:** it records each write's table, payload and filters, and can be told to return `{ error }` or reject for one table.
- **Correct linking in the authorised org:** two orgs hold rows with the same `client_profile_id` value. After the call:
  - only org A's rows with `student_id IS NULL` carry the new id;
  - org B's rows and org A's already-linked rows are unchanged;
  - each of the four recorded updates carries `org_id = ORG_A`.
- **Partial failure:** `lesson_participants` returns `{ error }`. The call rejects with `client_profile_link_failed` and `failedTables: ['lesson_participants']`. The other three tables are linked, and exactly one student exists.
- **Retry:** a second call with the failure removed returns the same student id with `created: false`, links `lesson_participants`, and still leaves exactly one student in org A.
- **Existing student with leftovers:** the early-exit path links unlinked rows and creates nothing.
- **Network-style rejection:** a rejected promise for one table is reported the same way as an `{ error }` result.
- **Callers:**
  - The existing `org-scope-reads` case (org B's profile from org A gives `client_profile_not_found` and no writes) keeps passing.
  - The success path of a user flow does not change, so no tester scenario is needed (C7 rule). This is reviewed again if the review changes the caller contract.
- **Checks:** `npm run test:finance-calendar` (the test file is in it; the identity changes only by the added tests), `npm run lint:api`, `npm run lint:upsert-conflicts` and `npm run lint:doc-links`.

##### F1 revised: each user operation commits whole or not at all (owner decision, 2026-11-24)

**Decision.** The operation must succeed in full during the user's request. Leaving a new student, or some of the links, to be completed by a retry is **rejected**. The proposal above ("F1.3 and F1.4 Proposed solution") is kept only as history.

**What follows from it.** The four links cannot be made atomic on their own. In every path, `ensureStudentForClientProfile` sits in the middle of a longer chain of writes. A later step can fail, or can return a 4xx after the student already exists. So the unit that must be atomic is the **whole user operation**, not the helper.

###### F1.6 The operation boundary in each path [V at `a5c3819`]

**Path A: one import record** (`api/import-commit-chunk/index.js`, a `customer` candidate with `customer_type = 'student'`). Writes in order:

| # | Write | Code |
|---|---|---|
| A1 | `client_profiles`: fill-empty update of a linked profile (`link_to_existing`); or, through `createOrReuseClientProfile`, update an existing profile found by identity, or insert a new one | `commitCustomer` ~107-150; `client-profiles.js` ~139-175 |
| A2 | `students` insert (when the profile has no student) | `ensureStudentForClientProfile` |
| A3 | the four links (`form_submissions`, `otp_challenges`, `waiting_list_entries`, `lesson_participants`) | same |
| A4 | `students` update with the note (when `note_text` is set) | `commitCustomer` ~176-187 |
| A5 | `import_commit_ledger` rows, one per resource. Best effort: an error is ignored | `writeLedgerRow` |
| A6 | `import_candidates.status = 'committed'` | chunk loop ~748 |
| on throw | `import_candidates.status = 'failed'`. No reason is stored; the message goes only to `context.log` and the response's `failures[]`. No `error_events` row is written for a candidate failure. | `catch` ~754 |

- **Existed before the request:** the candidate (`ready` or `failed`), possibly the profile (link or reuse), and that profile's earlier rows in the four tables.
- **To undo if a later step fails:** A1–A5. The candidate must end as `failed`, with evidence (F1.9).
- **Example of today's state after a failure.** A new person; A3 fails on `lesson_participants` with a network error.
  - The new `client_profiles` row stays.
  - The new `students` row stays.
  - Three of four tables are linked, and there is no note and no ledger row.
  - The candidate is `failed`.
  - A retry reuses the profile (A1 becomes `update` or `link`) and the student (`link`). The ledger then never says the student was created.

**Path B: create a template** (`POST` in `api/lesson-templates/index.js`), either from a waiting-list entry (`~858`) or for a client profile (`~894`). Writes in order:

| # | Write or exit | Code |
|---|---|---|
| B1 | `ensureStudentForClientProfile`: `students` insert and the four links. The waiting-list entry's `student_id` is set here. | ~858 / ~894 |
| exits after B1 | 409 `duplicate_template_conflict`; 409 `required_form_missing`; **200 `required_form_warnings`** (the UI asks for acknowledgement and sends the request again); 500s | ~932, ~958, ~1006, ~1013 |
| B2 | `lesson_templates` insert (the DB trigger rejects an instructor overlap with 409) | ~1025 |
| B3 | `lesson_template_participants` insert; on error, `rollbackCreatedTemplate` | ~1060 |
| B4 | `client_profiles` reactivation (when the profile was inactive); on error, the template is rolled back | ~1098 |
| B5 | `waiting_list_entries.status = 'matched'` plus metadata; on error, the template and the reactivation are rolled back by hand | ~1140-1185 |
| B6 | tenant audit and `logAuditEvent` | ~1190-1240 |

- **Existed before the request:** the waiting-list entry (`open`), the profile (active or inactive), its earlier rows, and the instructor's other templates.
- **To undo:** B1–B5. B6 is written only after success.
- **Example of today's state after a "failure".** The office creates a template from a waiting-list entry, and a required form gives a warning.
  - The response is 200 with `required_form_warnings` and no template.
  - A new student exists, and the entry carries its `student_id` while its status stays `open`.
  - If the office then cancels, the student and the links stay.
  - Each manual rollback (B3–B5) leaves the student in place.

**Path C: assign a waiting-list entry to a free place** (`PATCH` in `api/lesson-templates/index.js`, with `waiting_list_entry_id`). Writes in order:

| # | Write or exit | Code |
|---|---|---|
| C1 | `ensureStudentForClientProfile`, **only when** `waiting_list_entries.student_id` is empty | ~1434 |
| C2 | `client_profiles` reactivation, when inactive. It runs **before** the later validations. | ~1465 |
| exits after C1/C2 | 400 `invalid_service_id`, `invalid_service_duration`, `invalid_valid_until`, `reactivation_requires_new_valid_range`; 409 availability and conflict; 500s | ~1489-1621 |
| C3 | `lesson_templates` update (the other fields in the same PATCH) | ~1634 |
| C4 | `lesson_template_participants` insert. **On error, C3 is not reverted.** | ~1664 |
| C5 | `waiting_list_entries.status = 'matched'`; on error, C4's rows are deleted, but C3 and C2 are not reverted | ~1683-1708 |
| C6 | participant removals in the same PATCH | ~1714 |
| C7 | `logAuditEvent` | ~1755 |

- **The path where the entry already has `student_id`** skips C1, but C2–C6 are just as non-atomic. It is covered by the same solution.
- **Existed before the request:** the entry (`open`, with or without `student_id`), the profile, the template and its participants.
- **To undo:** C1–C6.
- **Example of today's state after a failure.** The entry has no student, the profile is inactive, and availability returns 409.
  - A new student exists.
  - The entry carries its `student_id`.
  - The profile is now active.
  - The template is unchanged.

  With a C5 failure instead, the template's own field changes (C3) stay, the participant is removed, and the entry stays `open`.

###### F1.7 Proposed solution: one database transaction per user operation

**The shape:**
- **Validate first, write last.** Each endpoint keeps its business logic in JavaScript and runs every check that needs no lock *before* any write: conflicts, required forms, availability, service, dates and rates. It then builds the complete set of writes as data.
- **One RPC per operation applies that set in one PostgreSQL transaction.** A PL/pgSQL function runs in a single transaction, so any exception rolls back every write it made. The repository already uses this pattern: `complete_lesson_instance_with_participants`, `cancel_lesson_instance_with_participants` and `cancel_selected_scheduled_participants_and_reconcile_instance`, called through `client.rpc(...)` from `api/_shared/lesson-instance-status.js`.

**Three new functions in `src/lib/setup-sql.js`** (the snapshot only adds functions and grants, so no migration file is needed):

| Function | Applies, in one transaction |
|---|---|
| `commit_import_customer_candidate(p_org_id, p_workspace_id, p_candidate_id, p_actor_user_id, p_plan jsonb)` | lock the candidate row (`FOR UPDATE`), check `status IN ('ready','failed')`; the profile write (A1); ensure the student (A2) and link (A3); the note (A4); the ledger rows (A5, no longer best effort); `status = 'committed'` (A6). Returns the ids and the ledger actions. |
| `create_lesson_template_atomic(p_org_id, p_actor_user_id, p_plan jsonb)` | lock the waiting-list entry and the profile (`FOR UPDATE`), check the entry is still `open`; ensure the student and link (B1); insert the template (B2, the overlap trigger still runs) and its participants (B3); reactivate (B4); mark the entry matched (B5). |
| `assign_waiting_list_entry_to_template(p_org_id, p_actor_user_id, p_template_id, p_plan jsonb)` | lock the template, the entry and the profile; recheck that the entry is `open` and the template's capacity under the lock; ensure the student only when the entry has none (C1); reactivate (C2); update the template (C3); add (C4) and remove (C6) participants; mark the entry matched (C5). |

**Ensuring the student and the links** becomes one shared internal SQL function, `ensure_student_and_link_client_profile_rows(p_org_id, p_client_profile_id)`. The three functions call it. Every statement in it filters on `org_id = p_org_id` (C1 in SQL), and the links keep `client_profile_id = …` and `student_id IS NULL`. The JavaScript helper `ensureStudentForClientProfile` is removed, so there is one path, not two. Its other read callers, if any are found at implementation time, are listed for review first.

**Organisation isolation and authorisation:**
- The endpoints keep authorisation exactly as today: bearer token, `ensureMembership` with a stop on `null`, then the role checks. They pass only the authorised `orgId` and `userId` into the RPC.
- Inside each function, every read, insert, update and delete filters by, or sets, `p_org_id`. A row of another org is "not found" and raises an error that rolls the transaction back.
- **Grants:** `REVOKE ALL … FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE … TO service_role` only. The functions are **not** `SECURITY DEFINER`.
  - *Finding:* the three existing lesson RPCs revoke only `authenticated` and leave the default `PUBLIC` grant. That is outside F1 and is recorded as an open item for a separate fix.
- `onConflict` contracts are unaffected (no new upserts). `lint:sql` covers the new functions.

**What the caller and the user get:**
- **Success:** the same response shapes as today.
- **Any failure inside the function:** nothing is written. The endpoint returns its existing error (4xx for business codes raised in SQL, mapped from the exception code; a tracked 500 otherwise).
- **For the import,** the candidate ends as `failed` in a separate write after the rollback, with the failure evidence (F1.9). The chunk still returns 200 with `failures[]`.

**Two concurrent requests:**
- Each function takes its row locks (`FOR UPDATE`) in a fixed order: candidate or entry, then profile, then template.
- The second request waits, then sees the first request's committed state: the candidate is `committed`, or the entry is `matched`, or the student exists. It returns the matching outcome and writes nothing twice.
- The unique index `students (org_id, client_profile_id)` remains the last guard against a second student.
- **Not covered today:** the duplicate-student template check, which is JavaScript only; only the instructor overlap is a DB trigger. Under the template lock it becomes a recheck inside the function.

**A retry after the server committed but the response was lost:**
- **Import:** the candidate is `committed` in the same transaction, so a retry returns `already_committed` (existing behaviour). The ledger shows the real actions once.
- **Waiting-list paths (B from an entry, and C):** the entry is `matched`, with `matched_template_id` and `matched_by_user_id` in its metadata. **Proposed:** when the same user repeats the same operation on an entry that is already matched to the same template, return the existing result with `already_applied: true` instead of 409 `waiting_list_entry_not_open`.
- **A direct template create (B without an entry):** there is no natural key. A retry gets 409 `duplicate_template_conflict` with `conflicting_template_id`, so nothing is written twice, but the user sees a conflict instead of a success. A full fix needs a client request id (`Idempotency-Key`), which means a frontend change and somewhere to store the key. **This is outside F1 as defined and needs owner approval (F1-Q2).**

**Scope, for approval (F1-Q1).** This is wider than F1 as defined (four writes in one helper). It touches:
- `src/lib/setup-sql.js` (4 functions with their grants);
- `api/import-commit-chunk/index.js` (`commitCustomer` builds a plan; the profile matching stays in JavaScript);
- `api/lesson-templates/index.js` (POST and the capacity-assign PATCH are reordered to validate first; the manual rollbacks are removed);
- `api/_shared/client-profiles.js` (the helper is removed or reduced to building the plan);
- the docs `40`, `60` and `30` (the new atomic pattern, under D8).

The rest of each endpoint's behaviour, and the frontend, do not change, except for `already_applied`. Two alternatives were considered and rejected:
- **Compensating JavaScript rollbacks:** they cannot cover a crash or timeout between steps, and they repeat today's partial rollbacks.
- **Moving only the four links into SQL:** it does not meet the decision, because the student would still survive a later failure.

###### F1.8 Proof against the local PostgreSQL (the `automatic-tester` stack)

**Where.** New integration tests in `tests/integration/f1-atomic-student.test.js`, run directly (`node --test …`).
- They need the running local stack. They refuse to run unless `SUPABASE_URL` is `http://127.0.0.1:54321`, so production is never touched.
- They read the local keys from the environment at run time and never print them.
- Each test creates its own two orgs, a user with membership in org A, profiles and rows, and removes them at the end.

**A deliberate failure after an early write.** The test installs a temporary trigger, named per test run, on one late table: for example on `waiting_list_entries` (`BEFORE UPDATE … WHEN NEW.status = 'matched'`) for paths B and C, and on `import_commit_ledger` for path A. The trigger raises an exception for that test's row only, so earlier statements in the function, such as the student insert and the links, have already run when the error comes. The test drops the trigger afterwards. This is run against the local stack only, through `psql` in the `supabase_db_automatic-tester` container.

**Assertions, for each path:**
1. **Failure leaves the business data as it was.** After the failed call, compare before and after snapshots of:
   - the students for the profile;
   - the four link tables;
   - the profile's `is_active`, `onboarding_status` and `metadata`;
   - the template and its participants;
   - the waiting-list entry;
   - the candidate's profile and ledger rows.

   They must be identical. The only allowed change is the import candidate's `status = 'failed'`.
2. **What existed before the request is kept:** a pre-existing profile, earlier rows already linked to another student, and the entry's `student_id` in the "already has a student" case of path C.
3. **A successful attempt (trigger dropped) completes once:**
   - exactly one student for the profile;
   - all four tables linked in org A;
   - one template or participant;
   - the entry `matched`;
   - the ledger with `create` for the student.

   Calling again gives `already_committed`, or `already_applied`, with no new rows.
4. **Isolation:** org B holds rows with the same `client_profile_id` value, and a waiting-list entry and a template of its own. A row-by-row snapshot before and after both attempts is identical.
5. **Concurrency:** two simultaneous calls for the same candidate or entry end with one success, one "already" outcome, and one student.

**What the user receives.** Each path is also driven through its HTTP handler: the function's default export, imported and called with a request built from a real local auth token, against the local DB.
- **Path A** (`import-commit-chunk`): the failed attempt returns 200 with the candidate in `failures[]` and `outcome: 'failed'`. The retry returns `outcome: 'committed'`, and `GET` on the workspace shows the candidate as committed.
- **Path C** (`lesson-templates` PATCH): the failed attempt returns a tracked 500 with an `error_id`. Under F2, that code points to a saved `error_events` row; F1 asserts the row exists. The retry returns 200 with the participant and the entry `matched`.
- **Path B** is covered at the RPC level, plus one handler test for the `required_form_warnings` 200: no rows at all are written, because validation now runs first.

**Also:**
- the Node unit tests for the plan builders (pure functions) in `tests/`;
- a tester scenario (`tests/automatic-tester/scripts/`) for the waiting-list-to-template flow, because the user-visible behaviour on warnings and failures changes (C7 rule);
- `npm run lint:sql`, `lint:api`, `lint:upsert-conflicts`, `test:finance-calendar`, `lint:doc-links`.

###### F1.9 Measuring a failed first attempt and a successful retry

**What exists today [V]:**
- **Template paths:** a 500 goes through `tracked500`, so an `error_events` row exists, with `route`, `org_id`, `actor_user_id`, `metadata` (jsonb), and a 90-day retention. Success writes a tenant audit and `logAuditEvent`.
- **Import:**
  - a candidate failure writes **no** `error_events` row; it goes to `context.log` and the response only;
  - `import_candidates.status` is overwritten from `failed` to `committed`, and no reason or attempt count is kept;
  - `import_commit_ledger` records only the actions that were saved (and stays so).
- Nothing links one failed attempt to a later one.

**The smallest addition proposed** (no new table, no new column):
1. **Correlation metadata** on every failure and success record of the three operations:
   - `operation`: `import.customer_commit`, `lesson_template.create`, or `lesson_template.assign_waiting_list`;
   - `operation_key`: the candidate id; the waiting-list entry id, or the client profile id for a direct create; or the template id plus the entry id;
   - `input_fingerprint`: a SHA-256 of the normalised input the operation acted on (the candidate's `candidate_data` and `decisions`, or the relevant request fields).
2. **Failure evidence that survives the rollback.** After the RPC fails, the endpoint writes an `error_events` row outside the rolled-back transaction, through the shared tracking helpers, with that metadata and the failed step. For import candidates this is new: one row per failed candidate, with the chunk still returning 200.
3. **Success evidence:**
   - **Templates:** the existing audit rows get the same three fields.
   - **Import:** none is needed. The ledger already carries `candidate_id`, and `candidate_data` at commit time gives the fingerprint again. The business ledger keeps describing only what was saved.
4. **The measurement.** For each `operation_key`, count failure events followed by a success:
   - same fingerprint: **a retry with the same input**;
   - different fingerprint: **the user corrected the data**.

   This is a read-only query for the system-admin error view or for an ad-hoc report.

**Limits:**
- `error_events` keep 90 days.
- A failure before the client exists cannot be tracked (the C2 exemption).
- A user who edits the data and is then rejected by validation (4xx, no RPC call) is not counted as a failure. Tracking 4xx is outside the C2 rule.
- The success record depends on F2 being in place, so that the code the user sees is always saved.

###### Open questions for the owner (F1)

- **F1-Q1:** approve the widened scope in F1.7: three atomic RPCs, validate first, and the helper removed.
- **F1-Q2:** idempotency for a direct template create. Accept a 409 with `conflicting_template_id` on a lost-response retry, or add an `Idempotency-Key` (frontend and storage).
- **F1-Q3:** approve the `already_applied` replay response on the waiting-list paths.
- **F1-Q4:** order against F2. F1's handler tests assert the `error_events` row, which F2 guarantees. The proposal is to do F2 before F1.5, or to accept that F1 asserts the row only when the insert succeeded.

**Acceptance:** F1.8 replaces the earlier F1 acceptance list.

#### F2 The support code must point to a saved record

**Facts:** see [C2](#c2-5xx-responses-the-support-code-and-strict-tracking).
- `trackErrorEvent` returns a code when there is no client, and when the insert into `error_events` failed.
- `respondTrackedError` then shows the user an `error_id` that has no record.
- `respondTracked` without `attachErrorTracking` sends an untracked response.
- The only direct caller of `trackErrorEvent` outside `error-events.js` is its test, `api/_shared/error-events.test.js:89`. That test file is in no npm script.

**Contract:**
- When the user is shown an `error_id`, a saved record exists, and support can find it by that code.
- If saving failed, or there was no client:
  - the user gets a safe, useful response without a code;
  - the tracking failure is written to the operational log (`context.log`);
  - the original operation error is kept in that log;
  - the tracking failure is not tracked through the same mechanism.

**Subtasks:**
- [ ] F2.1 List every consumer and record each one's current behaviour:
  - the return value of `trackErrorEvent`;
  - the API response of `respondTrackedError` and `respondTracked`;
  - the UI message (`src/lib/api-client.js:131-152`, `src/lib/error-support.js`, `SubmitFormPage.jsx`, `FormField.jsx`);
  - the support search (`api/system-admin-error-events`, `ErrorEventsView.jsx`).
- [ ] F2.2 Write the tests first (acceptance below), and see them fail against the current code.
- [ ] F2.3 Fix the runtime path to the contract.
- [ ] F2.4 Check every local `respond<Name>Error` wrapper under `api/`. Each must call `respondTrackedError`, or call `respondTracked` after `attachErrorTracking` in that request. List each one with its result. Fix any that does not track.

**Acceptance:**
- **A successful write:** the response's `error_id` equals the saved `support_code`, and the support search finds it.
- **A failed write:** there is no `error_id`; the message is safe; the operational log holds the original error and the tracking failure; there is no recursive tracking.
- **No client:** the same as a failed write.
- **The UI:** with a code, it shows "קוד תמיכה: <code>"; without one, it shows the stable message with no code.
- `api/_shared/error-events.test.js` and the new tests pass when run directly, and `npm run lint:api` exits 0.

#### F3 Strict error tracking as a blocking CI check

**Subtasks:**
- [ ] F3.1 Measure again at execution time with `npm run lint:error-tracking`. The baseline at `0339f45` is 276 untracked 5xx in 100 files. Classify each finding by route and handling:
  - a client is available: `respondTrackedError`;
  - tracking is attached: `respondTracked`;
  - a failure before a suitable client exists: exempt, with the real reason;
  - other.
- [ ] F3.2 Audit the validator: what it detects and what it misses. Known: a literal `respond(` with a 5xx is flagged, and any `respond<Name>(` passes by its name. Check status values held in variables, and wrappers that look right by name only. Strengthen the validator where it misses, with tests. **Never close a finding by:**
  - renaming;
  - blanket exemptions;
  - hiding warnings.
- [ ] F3.3 Fix the routes with the helpers, in reviewable commits by area. Give each `tracked-error-exempt` a real reason.
- [ ] F3.4 Give the validator a directory option and tests, like `lint:plans`:
  - a clean fixture exits 0;
  - a fixture with a bare `respond(context, 500, …)` exits 1;
  - a fixture with a wrapper that does not track also exits 1, if F3.2 extends the validator to check wrapper bodies.
- [ ] F3.5 Make it blocking in CI. **Proposal, confirmed at this subtask's review:**
  - **Workflow:** a new `.github/workflows/error-tracking.yml`, named "Error tracking", following "Plan registry":
    - **Events:** `pull_request` (opened, synchronize, reopened) and `push`, to `staging` and `main`. No path filter.
    - **Setup:** Node 20, `permissions: contents: read`, no install; the validator uses only Node built-ins [V].
    - **Steps:** `npm run lint:error-tracking:strict` and the F3.4 tests.
  - **Effect on the job:** any finding exits non-zero, so the step and the job fail. There is no `continue-on-error`.
  - **Left unchanged:**
    - the warn-only step in `integrity-checks.yml` keeps reporting;
    - `npm run build` keeps the warn-only command, so the deploy build does not run this gate twice.
- [ ] F3.6 Update the C2 enforcement line in `30-backend-shared-helpers.md` and `AGENTS.md` (D8).

**Acceptance:**
- The tree after F3.3 passes `npm run lint:error-tracking:strict`: exit 0, 0 findings.
- A controlled invalid case (the F3.4 fixture) fails the check.
- After a push, GitHub runs the "Error tracking" job. It is recorded green on the valid tree and red on a controlled invalid commit (on a throwaway branch, never merged).
- **A failing job is not the same as a required check.** A red job marks the PR but blocks merging only if "Error tracking" is set as a required status check in the branch rules. That setting is a separate owner decision, like "Plan registry" (Q9), and this plan does not make it.
- The F2 behaviour and the F3 enforcement are verified separately, each with its own evidence.

**Rollback:** revert per subtask. F3.5 is reverted alone if the workflow needs to be withdrawn.

### Stage 4: `docs/product/` and `docs/research/`, first domain: payroll and leave

**Goal:** an agent who fixes a pay calculation can find the valid rule, the decision that explains it, and the test, months after the implementing plan was completed.

**Depends on:** stage 3.

**Sources [V]:**
- `implementations/business-process/payroll-scenarios.md`. It holds:
  - PAY-A to PAY-K;
  - a "Today" column from 2026-09-15;
  - PD1–PD10;
  - section K (legal research);
  - **sections H and I, which describe month closing.** No binding doc confirms or retires them.
- `payroll-prerequisites.md` and `business-process-map.md`.
- `agents-docs/80:110-147` and `agents-docs/50`. They mix rules into development notes; for example, line 126 holds the salaried half-day rule next to function names. Line 130 says "Pay is computed live, nothing derived is stored… never add a sync step or a stored copy".
- `docs/employee-leave-ledger-reference-review.md`.
- `implementations/finance/info-from-tuttiud-leaves.md`.
- `implementations/financial/investigation-report/2026-03-24-…`.

**Tests [V]:**
- `test/payroll-rules.test.js`: 62 PAY references; `it.todo` for unbuilt rules.
- `test/pay-calculation.test.js`: `:556` is PAY-G1; `:766` is "a paid half day with work recorded that day pays the full day".
- `test/pay-summary.test.js`.
- The tester scripts `employee-rates.json`, `pay-summary.json` and `leave-settings.json`.

**Subtasks:**
- [ ] 4.1 `docs/product/README.md` (at most 30 lines). It defines:
  - a product rule: true even if the code is rewritten;
  - the rule format: `ID · rule · why · status (built / not built, from tests) · tests`;
  - the decision format: `ID · decision · date · source · verified by`;
  - that "needs confirmation" items are not binding.
- [ ] 4.2 `docs/product/payroll.md`.
  - Keep the PAY-* IDs and PD1–PD10. New decisions get PD11 and up.
  - Drop the "Today" column.
  - Sections H and I are not copied as rules. They are listed under "Open: conflicts with the live-pay rule" until 4.7 settles them.
- [ ] 4.3 `docs/research/README.md`, from the draft below, and `docs/research/israel-payroll-components.md`, from section K. Keep the accountant disclaimer under Limits.
- [ ] 4.4 The decision table, with a source and status for each:

| Decision | Source found | Status |
|---|---|---|
| Pay is computed live; nothing derived is stored | `agents-docs/80:130` | verified in repo |
| No month close or reopening; changes show on the next read (would replace PAY-H, PAY-I) | Not in the repo: agent memory and a local plan file only | **needs owner confirmation** |
| Salaried half day: full day if work was recorded, otherwise half, with the amber tag | `agents-docs/80:126`; `test/pay-calculation.test.js:766` | verified in repo |
| An unmarked past lesson counts as attended for pay | agent memory; check `agents-docs/80` | [P] verify |
| A missing rate blocks lesson creation, not marking | agent memory | [P] verify in code and docs |
| "ממוצע מומלץ" legal formula (fullest 3-month window in 12, base ÷ 90 × 7 ÷ W, bonuses excluded) | agent memory; `api/_shared/employee-finance.js` | [P] verify against code; owner confirms the wording |
| Paid leave counts as work days; no carryover cap; 2 decimals; balance-change reasons | agent memory; `agents-docs/50` | [P] verify |
| 150-employee limit (L1) | wiki only, not read | **needs wiki check and the owner** |
| Waiver: the student does not pay and the instructor is not paid (#57; nuance in #60) | GitHub issues | [P] verify |

- [ ] 4.5 Shrink `docs/project-rules/80` and `50` to development content, linking to `docs/product/payroll.md`.
- [ ] 4.6 Move `payroll-scenarios.md` and `payroll-prerequisites.md` to `docs/plans/payroll/` as `completed`, each with a top line pointing to the product doc. Update:
  - `tests/payroll-rules.test.js:2` (a comment);
  - `api/_shared/rate-history.js:4` (a comment);
  - `src/lib/setup-sql.js:6801`. That SQL comment changes the text `SetupAssistant` shows; record the new `SETUP_SQL_SCRIPT` hash.
- [ ] 4.7 **Joint review.** Present the "needs confirmation" items. Write each as binding only after confirmation, and record PD-n with date and source.
- [ ] 4.8 The expansion recipe in `docs/product/README.md`:
  - **order:** billing and HMO, calendar, students and clients, forms, settings;
  - **per domain:** extract rules from `project-rules` and the `implementations` specs, assign IDs, link tests, mark unconfirmed decisions.

**Acceptance:**
- The set of PAY-* IDs in `tests/payroll-rules.test.js` equals the set in `docs/product/payroll.md`, checked by `git grep -o -h "PAY-[A-K][0-9]+"`.
- The `test:finance-calendar` identity is unchanged, because only comments changed.
- The link check is clean.

**Rollback:** revert.

**Evidence:**
- the ID comparison;
- the decision table with statuses;
- the link-check output.

#### Draft for `docs/research/README.md`

```markdown
# Research

Conclusions worth finding again. Not a place for transcripts, drafts or task logs.

## Write it down only when
- the question is likely to come back, AND
- the answer took real effort (external sources, measurement, reading a lot of code), AND
- it is not a decision. A decision goes to `docs/product/` (business) or
  `docs/project-rules/` (development), and may link here as its evidence.
Otherwise summarise the finding in the PR, the issue or the plan's progress log, and stop.

## Find before you write
1. `git grep -i -l "<two or three topic words>" -- docs/` (research, product, plans).
2. A document on the same topic or decision exists → add to it: a new sub-question is a new
   section in that document, not a new file.
3. Open a new document only for a different topic or a different decision, and link the two.
4. One document per topic. Never "-v2", "-final" or dated copies of the same topic.

## File
`docs/research/<topic>.md`, kebab-case, no date in the name (dates are inside).

## Shape
    # <Topic, or the decision being researched>
    Status: current | adopted into <link> | superseded by <link>
    Updated: YYYY-MM-DD

    ## <Sub-question, as a question>
    **Conclusion:** 1-5 lines a reader can act on.
    **Evidence:** sources (link + date read), files and commits checked, numbers measured.
    **Limits:** what was not checked, assumptions, who must confirm (e.g. the accountant).

    (repeat per sub-question)

    ## Changes
    - YYYY-MM-DD: what changed and why.

## When things change
- Adopted as a rule: write the rule in `docs/product/` or `docs/project-rules/` with a link
  back here as its evidence, and set `Status: adopted into <link>`. From then on the rule is
  the truth; this document is only its evidence.
- New evidence changes a conclusion: edit the conclusion in place and add a line under
  Changes. If the old conclusion had been adopted, update the rule in the same change.
- Outdated (the code, the law or the business moved on): set `Status: superseded by <link>`,
  or delete the document when nothing links to it. Git history keeps it.
  A wrong document is worse than none.
```

**Why these fields:**
- `Status` is there because a superseded document otherwise looks binding, as PAY-H does today.
- `Limits` keeps an unverified legal conclusion from becoming a rule.
- **There is no index:** it would go stale, and `git grep` covers search. The one-document-per-topic rule is what prevents overlap.

### Stage 4R: Migration workflow research (deferred)

**Status: deferred by the owner on 2026-11-24.**
- There is no plan today for another database beyond preprod.
- The research resumes only by a future owner decision.
- It is **not** a precondition for stage 5 or for any other stage.
- This plan continues, and its status in `index.csv` stays `active`.

The scope below is kept so that the research can resume without being planned again.

**Goal (when resumed):** the owner gets a recommendation and decides how Reinex identifies, shows and applies migrations. The decision is recorded in [Q11](#q11-migration-workflow).

**Depends on (when resumed):** `docs/research/README.md` exists (stage 4.3).

**Read-only.** No migration or other command runs against any non-local database. The research reads documentation and code only.

**Starting sources** (official Vikunja documentation):
- https://vikunja.io/docs/installing/#updating
- https://vikunja.io/docs/cli/#migrate
- https://vikunja.io/docs/security-hardening/#backups

Check the details in Vikunja's official code where needed. Record the version or the date read for each source.

**Questions about Vikunja:**
- How does it know which migrations already ran?
- What does a version upgrade trigger?
- What do `migrate list` and `migrate` show and do?
- What can a rollback really restore?
- When is a backup required?

**Questions for Reinex:**
- **A read-only `status` command.** It would show which database it is pointed at (environment identity), which migrations were applied (`schema_migrations`), and which are pending.
- **`apply` as an explicit deployment step,** separate from `status`.
- **The risk we care about:** a version that did not pass QA, or a preview run against an unexpected database, changes data. Examine:
  - QA on an isolated database;
  - promoting the same version that was tested;
  - verifying the target before applying;
  - recovery after a failure (backup and restore).

**Subtasks:**
- [ ] 4R.1 Research the Vikunja questions, with sources and versions or dates.
- [ ] 4R.2 Map the Reinex options, against today's procedure in `migrations/README.md`.
- [ ] 4R.3 Write `docs/research/migration-workflow.md`, in the research README shape: Status, Updated, a sub-question per section with Conclusion, Evidence and Limits. End with a recommendation and the decision the owner must make.
- [ ] 4R.4 **Joint review.** Record the owner's decision in Q11.

**Acceptance:**
- Every question above has a conclusion with a source and a version or date, or is listed under Limits.
- The document ends with one recommendation and one decision for the owner.
- Q11 holds the decision.
- Whatever is decided, moving the files to `database/` in stage 5 is possible without changing deployment behaviour. Building the chosen workflow is a separate initiative (Non-goals).

**Evidence:** the research document and the Q11 answer.

### Stage 5: Database assets into `database/`

**Goal:** the snapshot and the migrations live in `database/`.
- A new DB is still set up from the snapshot alone.
- An existing DB is still upgraded with the migrations first, then the snapshot.
- No bridge file is left behind.

**Depends on:**
- stage 3 (C4);
- stage 4, if it edited `setup-sql.js:6801`.

Stage 4R and Q11 are deferred and are **not** preconditions (owner, 2026-11-24). The move must keep today's way of applying the schema and the migrations unchanged.

**Consumers of `src/lib/setup-sql.js` [V]:**

| Consumer | Location | Kind | Change |
|---|---|---|---|
| App (bundled) | `src/components/settings/SetupAssistant.jsx:10` `import { SETUP_SQL_SCRIPT } from '@/lib/setup-sql.js'` | import through the `@` alias (`@/*` → `./src/*`) | relative import (Q2 default) |
| SQL validator | `scripts/validate-setup-sql.js:6` | import | path |
| | `:452` `normalized.endsWith('/src/lib/setup-sql.js')` | suffix exclusion while scanning `src/` for `.rpc(` names | remove it (moot once the file is outside `src/`) |
| | `:747` `::${type} file=src/lib/setup-sql.js,…` | GitHub annotation path; printed only when there are findings | path |
| | `:754` `file: 'src/lib/setup-sql.js'` in `printJsonOutput` | JSON report field; always printed | path |
| | `printTextOutput` (`:695-727`) | prints no file path [V] | none |
| Upsert validator | `scripts/validate-upsert-conflicts.js:4` | import | path |
| Purge test | `api/org-purge/purge-manifest.test.js:30` `new URL('../../src/lib/setup-sql.js', import.meta.url)` | file read; **in no npm script** | path; run directly (scope rule 2) |
| Tester setup | `test/automatic-tester/setup.js:479` `join(REPO_ROOT,'src','lib','setup-sql.js')`; messages at `:485`, `:585` | runtime path | path and messages |
| User-facing hints | `api/system-admin-impersonation-list/index.js:80`; `…-start/index.js:200,231` | text | path |
| Comments | `api/_shared/backup-utils.js:16,92`; `api/org-purge/purge-manifest.js:9` | text | path |
| Historical | root `_*.cjs` (6); `implementations/database/one-db-refactor/*.cjs` (3) | relative paths | removed in stages 6 and 7 instead |
| Docs | `CLAUDE.md`, `AGENTS.md`, `project-rules`, `migrations/README.md`, `SCHEMA_PRD_ALIGNMENT.md`, `docs/*` | text | path |

**Consumers of `migrations/` [V]:**
- `test/dated-settings.test.js:387`, which reads `../migrations/0002_…sql`;
- the `setup-sql.js` comments at `:527`, `:529` and `:2852`;
- `migrations/README.md`;
- the `project-rules` text.

**How databases are set up today [V]:**
- `SETUP_SQL_SCRIPT` is pasted from `SetupAssistant`, or applied by the tester's `setup.js` to the local container.
- Migrations are applied by hand. The tester does not apply them.

**Subtasks:**
- [ ] 5.0 **Practical check before the move** (owner, 2026-11-24):
  - Identify again every current consumer of the schema and of the migrations, starting from the two lists above, at the then-current HEAD.
  - Find which paths the preprod process uses to apply the schema and the migrations: workflows, scripts, documented manual steps, and any setting that names a path.
  - Record the result. If a path cannot be verified from a source, ask the owner before moving.
  - Read-only: no command runs against preprod or production.
- [ ] 5.1 Confirm Q2. The default is a relative import from `SetupAssistant.jsx`.
- [ ] 5.2 Measure the baseline for this stage:
  - the standard checks;
  - `npm run lint:sql:json` (record `file`);
  - `node --test api/org-purge/purge-manifest.test.js`;
  - `tests/dated-settings.test.js` (through the npm script's identity);
  - the `SETUP_SQL_SCRIPT` hash.
- [ ] 5.3 Run `git mv src/lib/setup-sql.js database/setup-sql.js` and `git mv migrations database/migrations`.
- [ ] 5.4 Update every consumer in the two lists above.
- [ ] 5.5 Update `database/migrations/README.md`, and add `database/README.md` (at most 15 lines) covering both cases: a new DB takes the snapshot only; an existing DB takes the migrations in order, then the snapshot.
- [ ] 5.6 Verify.

**Acceptance:**

| Check | How | Pass when |
|---|---|---|
| Same schema text | SHA-256 of `SETUP_SQL_SCRIPT` imported from `database/setup-sql.js`, vs 5.2 | Equal (the path edits are outside the SQL string), or the diff shows only the deliberately edited comment lines |
| Moves | `git diff --cached -M --name-status` | `R100` for `setup-sql.js` only if it was not edited, and for the five `0001–0005_*.sql` files. `README.md` (moved and edited) and any edited `setup-sql.js` are reviewed with `git diff --cached -M -- <path>`, and only the expected path or comment updates appear. |
| Text report | `npm run lint:sql` | Same output as 5.2 |
| JSON report | `npm run lint:sql:json`; parse `file` | `file` is `database/setup-sql.js`, and `Test-Path` on it is true |
| GitHub report | In a throwaway worktree outside the repository (`git worktree add $env:TEMP\reinex-gh-check HEAD`), add one deliberate violation to `database/setup-sql.js` (for example a `CREATE TABLE` without `IF NOT EXISTS`). Run `node scripts/validate-setup-sql.js --format=github`, then `git worktree remove --force` it. | Every `::error`/`::warning` line has `file=database/setup-sql.js`, and that path exists |
| No old path | `git grep -n "src/lib/setup-sql" -- scripts api tests src` and `git grep -n -E "(^\|[^/])migrations/0" -- tests api scripts` | No matches pointing to the old locations |
| Upsert validator | `npm run lint:upsert-conflicts` | Same output as 5.2 |
| Affected unscripted test | `node --test api/org-purge/purge-manifest.test.js` | Same identity and result as 5.2 |
| npm entry point | `npm run test:finance-calendar` with the identity reporter (it covers `dated-settings.test.js`) | Same as 5.2 |
| App bundle | `npm run build`, then search `dist/assets/*.js` for a marker from the SQL (for example `schema_migrations`) | Same build result as 5.2; marker present |
| Type check reach | `npx tsc -p tsconfig.typecheck.json --listFilesOnly` | Lists `database/setup-sql.js` (followed through the import) |
| Tester | `node tests/automatic-tester/setup.js --dry-run` | Reports the new path |
| Preprod paths | The paths found in 5.0 | Each one names the new location, or is documented as a manual step that now uses it; how preprod applies the schema and migrations is unchanged |
| Real local apply (optional) | Apply the snapshot twice to the local `automatic-tester` DB | No errors either time |

**Rollback:** revert. There is no data change.

**Evidence:**
- the hash comparison;
- the three report formats;
- the grep results;
- the bundle marker;
- the test identities.

### Stage 6: Scripts, tools, backups and local output

**Goal:**
- clear boundaries between `scripts/`, `tools/` and `tests/`;
- local output in `local/`;
- ignore rules and lint scope that match the new paths.

**Depends on:** stage 1. Stage 5 must also be done before the root `_*.cjs` files are removed.

**Boundaries (owner decision 6):**
- **`scripts/`**: repository maintenance and validation commands.
- **`tools/`**: standalone tools, each with its own README and entry point.
- **`tests/`**: tests and test infrastructure.

**Subtasks:**
- [ ] 6.1 Add `/local/*` and `!/local/README.md` to `.gitignore`, and create `local/README.md` describing its subfolders: `reports/`, `backups/`, `data/` and `tmp/`.
- [ ] 6.2 Move `manual-db-backup/` and `tests/verify-backup.cjs` to `tools/backup/`, and update the usage text and the README.
  - Either keep `backup.py`'s output path, with the ignore rules updated to `/tools/backup/backups` and `/tools/backup/supabase`, or redirect it to `local/backups/` ([Q4](#q4-redirect-tool-output)).
  - Move the existing local backup folders by hand, with the same record → move → `check-ignore` → explicit staging order as stage 1.3.
- [ ] 6.3 `test-data/` → `local/data/`. It is untracked, so this is a filesystem move. Remove the `/test-data` ignore line once nothing uses it.
  - No code reference was found in `api/`, `scripts/`, `test/`, `tools/` or `src/` [V]. Re-check before the move.
  - The owner says whether the CSV holds real data.
- [ ] 6.4 Delete the root one-time scripts after the `git grep` check.
- [ ] 6.5 Delete `scripts/checkSchema.js` and `check:schema` after owner confirmation.
- [ ] 6.6 Handle `scripts/decrypt-key.js` per [Q6](#q6-operator-scripts).
- [ ] 6.7 Delete `vite.config.mjs` after the `--debug` check. Apply the outcomes for the root `staticwebapp.config.json` and `robots.txt`.
- [ ] 6.8 Untrack the CLI state that is tracked but ignored:
  - `tests/automatic-tester/supabase/.branches/_current_branch`;
  - the `.branches/` and `.temp/` folders under `supabase-tenant/supabase/`, if that folder stays (Q7).
- [ ] 6.9 Lint scope:
  - Add a Node block for `tools/**/*.{js,mjs}` to `eslint.config.js` if JS lands there.
  - **Correction from stage 0:** `.cjs` and `.mjs` files **are** linted (`npm run lint` processes `test/verify-backup.cjs`, the root `_*.cjs` and `vite.config.mjs`), with the default config. A moved `.cjs` therefore stays in scope. Compare the ESLint scan list before and after.
- [ ] 6.10 Tester reports stay at `tests/automatic-tester/reports/` unless Q4 changes `runner.js:292`.

**Acceptance:**
- `git check-ignore -v` passes for every local output path.
- `git status` is clean after a tool run, such as a backup dry run or `--validate`.
- `npm run lint` matches the previous stage, plus any deliberate new block, with its findings listed.
- Each moved tool's documented command runs from its new location, at least as far as its usage or `--help` output.

**Rollback:**
- Revert the commit.
- Move the local folders back from the recorded list, checking that each target is free first.

**Evidence:**
- the ignore checks;
- the tool usage outputs;
- the lint comparison;
- the moved-folders list.

### Stage 7: Remaining legacy docs and folders; reference review

**Goal:** every migration-map item has reached its target, or has a recorded "stays" decision with the reason. No inbound reference is broken.

**Depends on:** stages 2–6.

**Subtasks:**
- [ ] 7.1 A triage table with one row per file. It covers:
  - `implementations/**`;
  - `docs/*.md`;
  - `ProjectDoc/`, `ProjectDocs/`, `reinex-docs/`;
  - `issues/`, `gen-suggest/`;
  - `tools/bug-hunter/`;
  - the root documents.

  For each file: what it is, its target (`product`, `project-rules`, `research`, `plans/<topic>` with a status, or delete), its inbound references and the reason. **Joint review before moving.**
- [ ] 7.2 Move the specs that code comments cite and update those comments:
  - 16 for session-reports in `api/` and `src/`;
  - 3 in the schema file;
  - 2 for org-nuke.
- [ ] 7.3 Classify `e2e-smoke.test.js`, `rls-isolation.test.js` and `isolation-stress-test.js` by purpose, environment and entry point ([Test classification](#test-classification)). Move those confirmed as integration tests from `implementations/database/one-db-refactor/` to `tests/integration/`:
  - keep every entry point and consumer;
  - fix the import depth;
  - update `test:isolation-stress-test`;
  - run `node --check` on each file.

  A real run needs the local stack. Never point them at production; their headers say so.
- [ ] 7.4 Recreate each still-relevant `issues/*.md` as a GitHub issue, with owner approval before posting. Then delete the file.
- [ ] 7.5 Apply Q5 and Q8.
- [ ] 7.6 Register every moved plan in `index.csv`. `npm run lint:plans` must pass.
- [ ] 7.7 Remove the empty legacy folders. Rewrite `README.md` as a short human entry point.

**Acceptance:**
- The link check over the repository shows no new broken links, and the old broken ones are listed.
- `lint:plans` exits 0.
- The standard checks match the previous stage.

**Rollback:** revert per commit. Keep moves and deletions in separate commits.

**Evidence:**
- the triage table with decisions;
- the link-check output;
- the `lint:plans` output.

### Stage 8: Findability and continuity validation

**Goal:** show that the structure works for a fresh agent.

**Depends on:** stage 7. The payroll domain can be tried after stage 4.

**Subtasks:**
- [ ] 8.1 Run success test 2 in a new conversation with no memory, and record a summary.
- [ ] 8.2 Run success test 3 in a new conversation, giving it only this plan's path.
- [ ] 8.3 Fix whatever was not found, and re-run once.
- [ ] 8.4 Set this plan to `completed` in `index.csv`.

**Evidence:** the agent's answers against the pass criteria.

---

## Dependencies beyond imports

`npm run build` can pass while something has silently stopped working. Every example below is real [V].

| Silent failure | Real example | Targeted check |
|---|---|---|
| A checker runs but stops scanning, or applies different rules to, a moved file | `eslint.config.js` per-folder blocks (`scripts/**`, `test/**`) set globals and rules. `validate-setup-sql.js:449-455` scans `src/` and excludes the schema by suffix. `tsconfig.typecheck.json` has `"include": ["src"]`. | Compare `npx eslint --print-config <moved file>` before and after; run `npx tsc -p tsconfig.typecheck.json --listFilesOnly`. |
| A report points to the old path | `validate-setup-sql.js:747` (GitHub annotations) and `:754` (JSON `file`). Tester messages name `supabase-tenant` and the schema path. API hints show the schema path to users. | Run each report format and check the reported path exists (stage 5 acceptance). `git grep` for old paths in `scripts/`, `api/`, `src/` and `tests/`. |
| A test leaves the run without failing | `test:finance-calendar` is an explicit list (30 files at `0339f45`). 21 `*.test.js` files are in no npm script and no checked workflow at `0339f45`, among them `purge-manifest.test.js`, which reads the schema by path. `tests/validate-plans-index.test.js` is in no npm script but runs in CI. `test:isolation-stress-test` points into `implementations/`. | Run the real npm script with the identity reporter and compare identities, not just exit codes. Run the stage's affected unscripted files directly (scope rule 2). Check that every file path named in `package.json` scripts exists. |
| A test passes but reads a different file | `dated-settings.test.js:387` (migration 0002); `pay-calculation.test.js:699` (`api/calendar-attendance/index.js`) | A missing file throws, so a pass after the move proves the new path. Confirm through the identity comparison. |
| A blanket replace corrupts a non-path string | `https://app.test/…` fixtures in `src/lib/analytics/posthog.test.js` and `api/_shared/error-events.test.js` | Only the anchored inventory grep and targeted edits are used. The identity and results of those two suites stay unchanged when they are in scope. |
| A tracked file drops out on staging | `reports/.gitkeep` and `supabase/.branches/_current_branch` are tracked but matched by ignore rules | Stage the explicit tracked list with `-f`, and compare the path lists (stage 1.3 steps 5, 7 and 8). |
| Local data gets staged after a move | `.gitignore:44` is path-specific. Also `/manual-db-backup/backups` and `/test-data`. | Add the new rule before the move; run `git check-ignore -v` at the new path; never use `git add -A` over the folder. |
| The app builds but bundles a different schema | `SetupAssistant.jsx` bundles `SETUP_SQL_SCRIPT` | Compare the hash, and check the `dist/assets` marker. |
| Docs and comments point to moved specs | 16 session-reports comment references (plus 3 in the schema), `purge-manifest.js:6`, `payroll-rules.test.js:2`, `AGENTS.md:34-35`, and 262 relative links in agents-docs | The stage 3 link check |
| An instruction names a helper that is gone | `eslint.config.js:103,143`, `validate-api-endpoints.js:27` and `docs/api-validation-tool.md:49` recommend the removed `resolveTenantClient` (fixed in 3.7) | `git grep` each helper named in the rules and check that it is exported. |
| A check passes by name only | `validate-error-tracking.js` accepts any `respond<Name>(` without reading the wrapper; `respondTracked` without `attachErrorTracking` is untracked | Stage 3F, F2.4 and F3.2 |

**npm scripts that execute code from `implementations/` [V]:** only `test:isolation-stress-test`.

---

## Open decisions

These are the questions whose answers change the plan. Record each answer directly under its question as `**Answer (date, who):** …`.

### Q1 Execution branch
- **Known [V]:** `repository-reconstruction` and `staging` both point to `dce8f2e`, the same as `origin/staging`. This plan is untracked.
- **Codex recommendation** (not yet approved):
  - At execution time, create a **new** branch from the then-verified tip of `origin/staging`.
  - Make its first commit add only the approved version of this plan. Later stages and fresh agents then read the plan from Git, and progress is committed with each stage.
  - Run the stages in the main working directory, `C:\Developement\Repositories\Reinex`, not in a separate worktree. A new worktree contains only tracked files. It would have:
    - no `test/automatic-tester/.env`;
    - no `node_modules` (root, `api/` and tester);
    - no tester reports;
    - no `api/local.settings.json`;
    - no `test-data/`;
    - no `supabase/.temp`.

    So stage 1 could neither preserve nor test the local items, and lint and the tester could not run without a reinstall.
- **Answer (2026-11-23, owner):** use the existing `repository-reconstruction` branch, after verifying it is still based on the current tip of `origin/staging`. Any gap is reported before the branch is changed.
  - **Verified 2026-11-23:**
    - `git fetch`;
    - `git ls-remote` shows `staging` and `repository-reconstruction` at `dce8f2e…`;
    - `git rev-list --left-right --count HEAD...origin/staging` = `0 0`.

    No gap.
  - The approved plan is saved in a dedicated commit on this branch.
  - Execution stays in the main working directory.

### Q2 Schema import style
- **Known:** `SetupAssistant.jsx` imports through `@/lib/…`, and `@` maps to `src/` in `jsconfig.json` and `tsconfig.typecheck.json`. Vite's root is the repository root, so `database/` is inside it.
- **Codex recommendation and plan default:** a relative import of `database/setup-sql.js` from `SetupAssistant.jsx`, with no new alias. Verify the path and the app's use of it in stage 5 (bundle marker, type-check reach, build).
- **Missing:** confirmation.
- **Who:** the owner or Codex.
- **When:** stage 5.

### Q3 Evidence without CI
- **Known:**
  - Stage PRs into `staging` get no CI before merge, apart from "Plan registry" (since stage 2) and "Doc links" (since the stage 3 review).
  - PR #62 runs CI after each push to `staging`.
- **Codex recommendation:** for the pilot, local evidence is enough when before and after record the same environment (Node version, OS), the same commands, and the test identities and results. No CI change is needed before the pilot.
- **Answer (2026-11-23, owner):** approved. Local evidence is enough for the pilot under the plan's comparison conditions.

### Q4 Redirect tool output
- **Known:**
  - Tester reports go to `tests/automatic-tester/reports/` (`runner.js:292`).
  - Backups go next to `backup.py` (`:20`).
  - The Amir migration writes to its own `output/`.
- **Missing:** whether to change these defaults to `local/…`, which would change behaviour, or only keep them ignored.
- **Who:** the owner.
- **When:** stage 6.

### Q5 Control DB artefacts
- **Known:**
  - The control tables are in `setup-sql.js`.
  - `docs/ssot/`, `scripts/archive/control-db/`, `scripts/export-control-db-schema.ps1` and `supabase/functions/get_org_public_keys.sql` describe a separate control DB.
  - `get_org_public_keys` is not called from `api/` or `src/`.
- **Missing:** whether any environment still has or applies a separate control DB.
- **Who:** the owner.
- **When:** stage 7.

### Q6 Operator scripts
- **Known:** `scripts/decrypt-key.js` decrypts a stored key from its arguments. It is not run by npm or CI.
- **Missing:** whether it stays in `scripts/` or moves to `tools/ops/` with a README.
- **Who:** the owner.
- **When:** stage 6.

### Q7 supabase-tenant
- **Known:** the running stack is `automatic-tester`. `supabase-tenant/` has another `project_id` and no running containers. The tester's messages still point to it.
- **Missing:** whether anyone still starts it.
- **Who:** the owner.
- **When:** stage 6.

### Q8 Original PRD
- **Known:** `Reinex-PRD.md` v1.0 is the original requirements, partly superseded (payroll, for example). The `setup-sql.js:3` header cites it.
- **Missing:** whether it goes under `docs/product/` with a "domain docs win" banner, goes to `docs/research/`, or is retired.
- **Who:** the owner.
- **When:** stage 7.

### Q9 Plan lint in build
- **Known:** adding `lint:plans` to `npm run build` makes CI and the SWA deploy fail on a registry error.
- **Missing:** whether that is wanted.
- **Who:** the owner.
- **When:** stage 2. The default is no.
- **First answer (2026-11-23, owner):** `lint:plans` stays a standalone command, not in `npm run build` and not in CI. *Replaced by the answer below.*
- **Current answer (2026-11-23, owner, after the stage 2 joint review):**
  - The registry is enforced in CI on every PR to `staging` or `main` and every push to them, through its own workflow, `.github/workflows/plan-registry.yml`. Its check is "Plan registry".
  - `npm run lint:plans` stays available locally and separate from `npm run build`.
  - **Decided (owner, 2026-11-24):** "Plan registry" and "Doc links" become required checks for merging into `staging` and `main`, after their first successful run on GitHub Actions. That needs a push first. The branch settings are changed only then, and the change is reported.

### Q10 Co-authored-by trailer
- **Known:** the owner decided on 2026-11-23 that this question is settled separately from the commit policy (stage 3.3). Claude currently appends a `Co-Authored-By:` trailer by default.
- **Missing:** whether the policy requires, allows or forbids the trailer for agents.
- **Who:** the owner.
- **When:** decided on 2026-11-24, see below.
- **Still open after 3.1 (2026-11-24).**
- **Answer (2026-11-24, owner):** Claude's commits in this project carry no `Co-Authored-By` line. This is set through `attribution.commit` as an empty string in the shared project settings (`.claude/settings.json`). It applies to commits only. The owner knows this changes how GitHub shows Claude as a co-author. **Not applied yet:** the settings change is an implementation step for the next approved round. Until then, the commit policy keeps saying nothing about trailers.
- **Earlier decision (2026-11-24):** the commit policy and 3.10 are completed without deciding this question. The existing attribution settings stay as they are. The policy says nothing about the trailer.

### Q11 Migration workflow
- **Known [V at `0339f45`]:**
  - migrations are applied by hand, after which `setup-sql.js` runs (`migrations/README.md`);
  - each migration records itself in `schema_migrations`;
  - applying them from CI is planned but not built.
- **Missing:**
  - whether Reinex gets a read-only `status` and an explicit `apply` step;
  - how QA, promotion of the tested version, target verification and recovery work.
- **Who:** the owner, on the stage 4R recommendation.
- **When:** deferred (owner, 2026-11-24). No plan today for another database beyond preprod. Not a precondition for stage 5.

**Recorded from the Codex review on `index.csv`.** The columns `path,title,status` and the four statuses stay as agreed. Titles may contain commas and quotes under standard CSV quoting. The earlier proposal to forbid them was dropped. The validator parses quoted fields itself, with no new dependency (stage 2).

**Reason to adjust an agreed decision.** For decision 7, `database/setup-sql.js` is workable, but `SetupAssistant` bundles the file into the app. The move therefore includes a frontend import change, and no bridge is allowed. Stage 5 covers it. No alternative is proposed.

---

## Success tests

### 1. Behaviour is preserved, after every stage

Compare each stage with its **measured** baseline:

- the full relative path list of the moved set: identical, with `R100` for unedited files and a reviewed diff for edited ones;
- the identity of `npm run test:finance-calendar`: the same normalised list, hash, spec summary counts (pass, fail, skipped, todo) and exit code;
- the affected unscripted test files that the stage moves or whose paths it changes: same identities and results;
- the same exit codes and counts for lint, `lint:api`, `lint:sql`, `lint:upsert-conflicts` and build;
- `eslint --print-config` identical for moved files;
- `git check-ignore` passing for local paths, and the local data counts unchanged;
- the same `SETUP_SQL_SCRIPT` hash (stage 5), and report paths that exist in every report format;
- the tester's `--validate` result unchanged, with the tester mode stated;
- 0 new broken links.

### 2. Findability

The same task is given to a new agent with no memory before the pilot, after stage 4, and after stage 7.

> The office reports: "An employee on a monthly salary took a paid half day of leave on 15.12 and recorded no hours. The monthly summary shows an amber tag. Also, please add a 'close month' button that locks November's pay so later lesson corrections do not change it."
> 1. Explain the tag and what the employee is paid for that day, and what changes if a lesson was counted that day.
> 2. Propose how to handle the second request.
> 3. Cite the product rule, the decision, the development rule and the test you relied on, with paths.

**Pass criteria, parts 1 and 3 (every run):**
- **The rule:** without recorded work the day pays half and shows "חצי יום חופשה בלי שעות"; with a counted lesson or office minutes it pays the full day.
- **The development rule:** `computeEmployeePay` / `collectWorkedDates`, and "never add a sync step or a stored copy".
- **The test:** `pay-calculation.test.js`, "a paid half day with work recorded that day pays the full day".
- **The paths:** before stage 3 they are today's paths (`agents-docs/80`, `test/…`). After stage 4 they are `docs/product/payroll.md`, `docs/project-rules/80…` and `tests/…`.

**Pass criteria, part 2. These depend on the decision's status:**
- **While "no month close" is not confirmed by the owner or an authoritative decision record:** the agent passes if it identifies the contradiction between the sources and asks for a decision before changing pay behaviour. The sources are:
  - PAY-H and PAY-I plus PD6, PD7 and PD10 in `payroll-scenarios.md`, which plan month closing;
  - the live-pay rule in `agents-docs/80:130` (later `docs/product/payroll.md`), under which "nothing derived is stored" and a locked month would need a stored copy.

  The agent fails if it silently builds month closing, or silently declares it rejected.
- **After the decision is confirmed and recorded (stage 4.7):** the agent passes if it finds the decision, explains its reason, applies it to the request (declining the lock and pointing to the existing impact warning for edits to past months), and does not treat PAY-H as current.

**Before the pilot:** run the task, record what the agent actually did, and grade it against the criteria for the current decision status. That record is the baseline for later runs. No outcome is assumed in advance.

### 3. Continuity between conversations

After any stage, give a new agent only the text "Continue `docs/plans/repository/directory-restructure.md`".

**Pass:** without asking, the agent states:
- what was decided and why: the owner decisions, the answered Q-items, and the Codex recommendations that are not yet approved, kept apart;
- what was done and verified, with the evidence;
- what is still open;
- the next unticked subtask;
- that overall status comes from `docs/plans/index.csv`.

**What supports this:**
- the five-bullet "Resume here" block;
- the ticked subtasks;
- one Progress log entry per stage: date, commit SHA, checks against baseline, tester mode, gaps, and the joint-review outcome;
- answers written under each Q-item.

---

## Progress log

Append one entry per stage. Newest last.

- **2026-11-23, planning.** The plan was written from `origin/staging` `dce8f2e`, read-only. Nothing was run or committed. Not verified during planning:
  - the wiki;
  - the live `robots.txt` and `staticwebapp.config.json` behaviour;
  - Vite config resolution;
  - the test identity reporter;
  - any test or build run.
- **2026-11-23, revision after the Codex review.** Still read-only; the only repository change is this file. Changes:
  - **Pilot order, staging and rollback.** The new ignore rule is added before the move. Staging uses the explicit tracked list with `-f`. The two ignored-but-tracked files are now covered. Rollback is targeted, with no `reset --hard`, and checks the target exists.
  - **Pilot acceptance.** It compares the path list and diff review, not a fixed rename count. It runs `npm run test:finance-calendar` itself. Test identity is checked with an identity reporter. Results are compared against measured baselines.
  - **Test-scope rule.** One scope rule now applies everywhere. The unscripted-file count is corrected from 17 to 21 (10 in `api/`, 2 in `src/`, 7 in `test/`, 2 in `implementations/`).
  - **C1 and C2.** Both were reworded.
  - **Stage 5.** The JSON `file` field was added, with an acceptance check for each report format. Migration moves are compared by path and content.
  - **Root coverage.** A coverage check was added: 53 of 53 entries. Local items are listed separately.
  - **Pilot non-path strings.** The `app.test` claim was corrected.
  - **Product test.** It now has criteria that depend on the decision's status.
  - **Codex recommendations.** Q1, Q2 and Q3 were recorded as recommendations.
  - **`index.csv`.** It now uses CSV quoting.
  - **Working directory.** It now matches the planning base.
- **2026-11-23, stage 0: baseline (measured).**
  - **Setup.**
    - Branch `repository-reconstruction`.
    - The plan commit is `0fec72c` on top of `dce8f2e`; there is no other change since `dce8f2e`.
    - `HEAD...origin/staging` = `0 0` before the plan commit.
    - Node `v25.2.1`, Windows 11.
    - The working tree was clean after the commit.
    - Raw outputs are in `$env:TEMP\reinex-restructure\stage0\`.
  - **Standard checks:**

    | Check | Exit | Measured |
    |---|---|---|
    | `npm run lint` | 0 | 0 problems; 717 files scanned (35 under `test/`); scan-list SHA-256 `c8bfca5c309e0ec3…` |
    | `npm run lint:api` | 0 | 0 problems; 220 files scanned |
    | `npm run lint:sql` | 0 | 0 errors, 21 warnings |
    | `npm run lint:upsert-conflicts` | 0 | "Org-scope write validation passed." |
    | `npm run test:finance-calendar` | 0 | tests 589, suites 107, pass 560, fail 0, cancelled 0, skipped 0, todo 29; 30 files |
    | `npm run build` | 0 | 113 s. Warn-only steps: error-tracking 276 untracked 5xx in 100 files; typecheck 3081 issues; SQL 21 warnings. Vite built 3559 modules. |

  - **Identity method:** works on the repository itself.
    - The sample (nested suites, repeated names, skip, todo, a failure, a subtest) matched Node's summary: tests 8 = 5 pass + 1 fail + 1 skip + 1 todo.
    - Through `npm run test:finance-calendar`, the 589 identity lines equal Node's `tests`, and pass/fail/skip/todo match exactly.
    - Two runs gave the same normalised SHA-256: `4BF71F113EF6D749245C138C9DDA4AC90ADEA444695EE1D7C43196983C0CC3E4` (with `test/` mapped to `tests/`). There are no repeated identities.
  - **Affected entry points for stage 1:**
    - `node test/run-tests.js`: exit 0, "All tests passed."
    - `runner.js --validate`: exit 0. All 15 scripts pass, with 15 "may be stale" warnings, which are pre-existing.
  - **Unscripted `test/*.test.js` files, run directly (exit; tests/pass/fail):**
    - `billing-claim-payment`: 0; 21/21/0.
    - `calendar-generate-break-templates`: 0; 28/28/0.
    - `calendar-generate-hmo-warning`: 0; 17/17/0.
    - `settings.session-form`: 0; 24/24/0.
    - `storage-config`: 0; 1/1/0.
    - **Pre-existing failures:**
      - `supabase-client`: exit 1. The file does not load: `../src/lib/supabase-manager.js` has no export `createDataClient`.
      - `whatsapp-message-templates`: exit 1, with 2 of 3 failing. The organisation signature (`נשלח מטעם חוות בדיקה`) is not at the end of the message.

      Both stay as baseline failures. They are not fixed in this plan.
  - **Inventory:**
    - 59 tracked files under `test/`, with 0 untracked non-ignored files.
    - 189 ignored local entries from the approved command, all starting with `test/`: `.env`, `node_modules/`, 186 report runs, `supabase/.temp/`. `.env` is present; its contents were not read.
    - 65 path-like `test/` references outside `docs/plans/`, the same set as at `dce8f2e`.
  - **ESLint config for `test/pay-calculation.test.js`:**
    - 1166 globals, Node and browser;
    - `import/no-unresolved`, `import/named`, `import/default`, `import/namespace` and `no-restricted-imports` all off; `import/no-cycle` on;
    - file SHA-256 `e46c65792dfccc52…`.
  - **`SETUP_SQL_SCRIPT`:** SHA-256 `fce6b94b5dbbfc65c71fa19762b7062ae57530f3e598aede0e2105d382465115`, length 259620.
  - **Plan corrections found while measuring:**
    - the file-load failure name rule (identity method step 3);
    - `.cjs` and `.mjs` files are linted (stage 6.9);
    - this plan is excluded from the stage 1 reference rewriting;
    - the ESLint scan list as a check (identity method step 7).
  - **Not run:** a real tester scenario. Only `--validate` was run.
  - **Joint review pending.**
- **2026-11-23, plan update (owner request).**
  - Added subtask 3.10 and section 3.3: a shared commit policy based on Conventional Commits 1.0.0, with its own acceptance.
  - Added Q10, the `Co-authored-by` trailer, to be decided separately.
  - Added commitlint, hooks and CI checks on messages to the non-goals.
  - The stage 1 commit message now follows the policy.
  - Only the plan was edited.
- **2026-11-23, stage 1: pilot `test/` → `tests/` (commit `415cce4`).** The owner approved the stage 0 baseline and stage 1 only.
  - **Before moving.**
    - Code, tests and config were unchanged since the baseline: `git diff 3a5ad46 HEAD -- . ':!docs/plans/**'` was empty.
    - The plan update was committed first, as `7a1bdab docs(plans): add commit policy to restructure plan`, so the tree was clean.
    - All stage 0 outputs and both tools were present in `$env:TEMP\reinex-restructure\`.
  - **Real scenario added to the baseline (owner request): the local target, checked first.**
    - Vite on `:5173` runs from this repository's `node_modules`.
    - The Functions host on `:7071` was started with `preview_start api`.
    - `/api/config` through Vite answers `source: api` with `supabaseUrl: http://127.0.0.1:54321`.
    - The tester `.env` has `BASE_URL=http://localhost:5173`, `SUPABASE_URL=http://127.0.0.1:54321` and `TEST_ORG_ID=c3893a4d-…`. Only those non-secret keys were printed.
    - That org exists in the local `supabase_db_automatic-tester` DB, as "Reinex Test Org (auto)".
    - **Exposure note:** a JSON parse error printed one non-secret line of `api/local.settings.json` (`SYSTEM_ADMIN_ALLOW_WITHOUT_MFA`). No key or password was shown.
  - **Real scenario, before (old path):** `node test/automatic-tester/runner.js --script leave-settings`: exit 0, 13 of 13 workflows passed, 70 s. Report: `test/automatic-tester/reports/run-2026-11-23T16-27-04/`.
  - **Recorded after that run** (1.3 step 1):
    - HEAD `7a1bdab`; clean status;
    - 59 tracked files; 0 untracked non-ignored;
    - 190 ignored local entries, all starting with `test/`: 187 report runs, `.env`, `node_modules/`, `supabase/.temp/`;
    - a per-entry inventory of file count and bytes.
  - **Order followed**, as in 1.3:
    1. Added `/tests/automatic-tester/reports` next to the old rule.
    2. Checked the target was free, then ran `Move-Item test tests`. It succeeded; Vite was running and did not block it.
    3. `check-ignore` showed all four local items ignored at the new path.
    4. The untracked set under `tests/` was the 59 tracked files minus the two ignored-but-tracked ones, which is 57, with 0 differences.
  - **Consumers.**
    - 73 occurrences across 25 files, using a scripted rewrite. It was anchored like the inventory grep, over an explicit file list, with line-level exceptions: `$env:TEMP\reinex-restructure\stage1-rewrite.cjs`.
    - The old ignore line was then removed.
    - **Left on purpose**, already broken or not paths:
      - `hmo-claims/technical-implementation-plan.md:968-969` (those test files never existed);
      - `info-from-tuttiud-leaves.md` (another repository's `test/`);
      - `implementation-to-do.md:103` ("UI test/assertion");
      - `students/implementation-plan.md:227` ("test/diagnostic mode");
      - `issues/improvement-suggestions.md:175` (`test/tour.test.js` never existed);
      - `robots.txt` (an HTTP path).
    - The `https://app.test/…` fixtures were untouched.
  - **Staged and reviewed before the commit:**
    - 79 entries: 59 renames (54 `R100`, plus 5 that are `R088`–`R099`: the files with self-references) and 20 modified consumers.
    - No added files and no other unstaged or untracked change.
    - Both ignored-but-tracked files were staged as `R100` through `git add -f` from the explicit list.
    - All 54 changed line pairs differ only by the anchored `test/` → `tests/` rewrite (checked by script).
  - **Before vs after (all equal):**

    | Check | Before | After |
    |---|---|---|
    | Path list | 59 | 59, diff 0; `git ls-files test` empty |
    | `npm run test:finance-calendar` | exit 0; tests 589, suites 107, pass 560, fail 0, skipped 0, todo 29 | same; identity SHA-256 `4BF71F11…C0CC3E4` on both sides, diff 0 |
    | 5 passing unscripted files | 91 tests, all pass | same identities, diff 0 |
    | `supabase-client.test.js` (baseline failure) | exit 1, file does not load: no export `createDataClient` | same identity and same error |
    | `whatsapp-message-templates.test.js` (baseline failure) | exit 1, 2 of 3 fail on the signature regex | same identities and same assertion lines |
    | `run-tests.js` | exit 0, "All tests passed." | same |
    | ESLint config for the moved test file | SHA-256 `e46c6579…` | identical |
    | `npm run lint` / `lint:api` | exit 0; 717 / 220 files scanned; 0 problems | same; scan lists equal after mapping `test/`→`tests/` |
    | `lint:sql` / `lint:upsert-conflicts` | 0 errors, 21 warnings / passed | same |
    | Local data | 190 entries; per-entry file counts and bytes | identical (checked before the new run) |
    | `runner.js --validate` | exit 0; 15 scripts pass; 15 stale warnings | identical result lines |
    | Real `leave-settings` run | exit 0; 13/13; same 13 step results | exit 0; 13/13; step results diff 0; report `tests/automatic-tester/reports/run-2026-11-23T16-39-41/report.html` |
    | `git status` after the real run | — | the new report is ignored; nothing untracked |
    | `npm run build` | exit 0; 276 untracked 5xx, 21 SQL warnings, 3081 type issues, 3559 modules | identical figures |

  - **Tester modes:**
    - `--validate` proved that the runner starts from `tests/` and its 15 scripts resolve.
    - The real run proved that `.env` is read, Playwright loads from the moved `node_modules`, and the report is written under the new path.
    - Its starting state was the same: the scenario resets both organisation defaults itself.
  - **No regression found.**
  - **Out-of-repo follow-ups, for owner approval:**
    - Claude memory files that name `test/` paths: `MEMORY.md`, `keep-tests-current-feedback.md`, `ux-improvement-initiative.md`.
    - `.claude/launch.json` has no reference.
    - The wiki was not checked.
  - **Gaps:**
    - Nothing is pushed.
    - Stage 1 is a local commit on `repository-reconstruction`.
    - The 5 files that were renamed and edited show `R088`–`R099`, as expected.
  - **Joint review pending.**
- **2026-11-23, stage 1 review outcome.** Passed the joint review; the owner approved stage 2 only.
  - **Out-of-repo follow-ups done.**
    - Three memory files (`MEMORY.md`, `keep-tests-current-feedback.md`, `ux-improvement-initiative.md`) now point to `tests/` in their commands and current locations. They hold no historical mentions.
    - The Functions host started for the pilot (`preview_start api`) was stopped by its own server id.
    - The Vite server that was already running on `:5173` before the pilot was left untouched.
- **2026-11-23, stage 2: plan registry and `lint:plans`.**
  - **Added:**
    - `docs/plans/README.md` (20 lines);
    - `docs/plans/index.csv`, with this plan as `active`;
    - `scripts/validate-plans-index.js`, with a built-in RFC 4180 parser and no new dependency;
    - the npm script `lint:plans`;
    - `tests/validate-plans-index.test.js`.

    "Resume here" now points to `index.csv` for the overall status.
  - **What the validator checks:**
    - **Both directions:** every `docs/plans/<topic>/<plan>.md` (except `README.md`) has exactly one row, and every row points to an existing file in its topic folder. A `.md` placed directly in `docs/plans/` is also reported.
    - **Rows:** the exact header; 3 fields per record; a non-empty title; a valid status; paths in the form `<topic>/<plan>.md`; no duplicates.
    - **Quoting:** an unterminated quote, a quote inside an unquoted field, and text after a closing quote are each reported.
  - **Real registry:** `npm run lint:plans` exits 0 with "Plans index OK: 1 plan(s) (planned 0, active 1, completed 0, canceled 0)."
  - **Acceptance tests:** `node --test tests/validate-plans-index.test.js` exits 0; 21 tests, 21 pass.
    - **Pass cases:**
      - plain;
      - a title with a comma;
      - a title with doubled inner quotes;
      - a title with a line break inside a quoted field, with CRLF line endings and no final newline;
      - all four statuses;
      - supporting files and `README.md` files ignored.
    - **Fail cases:**
      - an unterminated quote;
      - a quote inside an unquoted field;
      - text after a closing quote;
      - a wrong field count;
      - a wrong header;
      - a bad status;
      - a duplicate path;
      - a missing file;
      - a plan with no row;
      - 4 invalid path shapes;
      - a loose plan file in `docs/plans/`;
      - an empty title or a blank line;
      - a missing `index.csv`.
    - **Also covered:** a parser unit test, and two command-line tests (exit 0 with a summary; exit 1 naming the record, line and reason).
  - **Q9:** the owner decided that `lint:plans` stays a standalone command for now.
  - **No change to existing behaviour:**
    - `npm run lint` exits 0 with 0 problems. The scan list is the stage 1 list plus exactly the two new files: 719.
    - `npm run test:finance-calendar` exits 0, with the identity SHA-256 `4BF71F11…C0CC3E4` unchanged and a diff of 0.
    - The new test is run directly; it is not added to an npm script.
  - **Gaps:** nothing is pushed; CI does not run `lint:plans` (Q9).
  - **Joint review pending.**
- **2026-11-23, stage 2 completion after the joint review.**
  - **Q9 changed by the owner.** CI enforces the registry; `lint:plans` stays local and outside `build`.
  - **Two checker bugs reproduced by Codex, fixed:**
    1. **The header was compared as joined text.** A single quoted field `"path,title,status"` therefore passed. It is now compared field by field, and exactly three fields are required.
    2. **A row only had to name something that exists.** A folder named `folder.md` therefore counted as a plan. Rows are now matched against the plan files the checker itself discovers under `docs/plans/<topic>/`.
  - **Confirmed against the previous version** (`8b9454d`), on a copy of the real tree: both cases exited 0. With the fix, both exit 1 with the reason.
  - **Regression tests added:**
    - the quoted single-field header;
    - a header with an extra field;
    - a row pointing to a folder `payroll/folder.md` that holds a supporting file.
  - **Workflow added:** `.github/workflows/plan-registry.yml`.
    - Workflow and job are named "Plan registry".
    - Triggers: `pull_request` (opened, synchronize, reopened) to `staging` or `main`, and `push` to them. There is no path filter, so documentation-only PRs run it too.
    - Node 20, the same as `integrity-checks.yml`; `permissions: contents: read`; a 5-minute timeout.
    - Steps: checkout, setup-node, `npm run lint:plans`, `node --test tests/validate-plans-index.test.js`. Either one failing fails the job, which is the default step behaviour.
    - No `npm ci`: both commands use only Node built-ins.
  - **Verified locally (Node v25.2.1):**
    - `npm run lint:plans` exits 0, "1 plan(s) (planned 0, active 1, …)";
    - the checker tests exit 0, 24 of 24 passing;
    - the workflow YAML parses (js-yaml) to the intended triggers, permissions, job name and steps;
    - `npm run lint` exits 0 with 0 problems, over 719 scanned files (YAML is not linted).
  - **Not verified yet:**
    - **On GitHub.** The workflow runs only after a push. The first push to `staging` will also run it on the open PR #62.
    - **On Node 20 itself.** Its APIs (`node:test` `describe`/`it`/`after`, `fs.mkdtempSync`, `spawnSync`) are available in Node 20, but this was not run under Node 20 locally.
  - **Branch rules.** Making "Plan registry" a required check is a separate owner decision. No branch settings were changed.
  - **Joint review pending.**
- **2026-11-23, stage 2 review outcome.** Passed the joint review. The owner approved subtask 3.1 only: a proposal, with no edits to the instruction files.
- **2026-11-24, subtask 3.1 decided (plan-only update).**
  - **Proposal:** presented on 2026-11-23 against `0339f45`. The owner and Codex reviewed it, and the owner decided on 2026-11-24. The decisions are recorded in [3.1](#31-decisions-c1c7-and-d8d9-owner-2026-11-24).
  - **Facts re-verified at `0339f45`:**
    - **C1:** 41 `api/*/index.js` files have no `ensureMembership` call. They were classified by pattern, not audited one by one. `ensureMembership` returns the role or `null`.
    - **C2:**
      - 276 untracked 5xx in 100 files;
      - 0 `tracked-error-exempt` comments;
      - `trackErrorEvent` returns a code with no client and after a failed insert;
      - `respondTracked` is untracked without `attachErrorTracking`.
    - **C3:** `createSingleClient` appears in 21 files under `api/`: 20 endpoint `index.js` files plus its definition in `org-bff.js:272`. The stale hint is at `validate-api-endpoints.js:27`. The "26" given in the 2026-11-23 proposal was wrong; the original plan's 27 was right. A fourth stale hint was found in `docs/api-validation-tool.md:49`.
    - **C4:** 5 migration files. Only `tests/dated-settings.test.js` reads one. No general migration checker exists.
    - **C7:** 52 tracked `*.test.js` files. 30 are in `test:finance-calendar`, which `verify:beta` also runs. 1 runs directly in "Plan registry" CI. 21 are in no npm script and in no checked workflow (10 `api/`, 2 `src/`, 7 `tests/`, 2 `implementations/`).
  - **Plan changes:**
    - the 3.1 table was replaced by the decisions C1–C7, D8 (keep documentation current) and D9;
    - subtasks 3.3–3.7 were updated, and 3.11–3.12 added;
    - the stage 3 acceptance gains the D8, C7 and C1 agent tasks;
    - new **stage 3F**: F1 (the client-profiles writes), F2 (the support-code runtime bug) and F3 (strict error tracking as a blocking CI check);
    - new **stage 4R** (the migration workflow research) and [Q11](#q11-migration-workflow); stage 5 now depends on 4R;
    - a [Test classification](#test-classification) section in the migration map; 7.3 classifies before moving;
    - **contradictions corrected:**
      - the Non-goals now list the error-tracking CI exception and the plan-tracked coverage gap;
      - scope rule 3 allows 3F's own tests;
      - the 3.4 hard-limits item no longer asserts memory-only rules;
      - the workflows row in the migration map.
  - **Agent-memory rules:** their status is in the D9 table. Only the test rule became binding.
  - **Not done in this round:**
    - no edit to `AGENTS.md`, `CLAUDE.md` or `agents-docs/`;
    - no move;
    - no code fix;
    - no settings change;
    - no push.
  - **Joint review pending** before 3.2.
- **2026-11-24, owner decisions before stage 3.**
  - **Q10:** stays open. The commit policy and 3.10 are completed without it, and the existing attribution settings stay. Recorded in `0ce043b`.
  - **4R and Q11:** deferred, because there is no plan today for another database beyond preprod. Stage 5 gained the practical check 5.0 instead. The plan stays `active`. Recorded in `0ce043b`.
- **2026-11-24, stage 3: one instruction source.** The owner approved 3.2–3.12.
  - **Commits** (local, on top of `cc97a82`):
    - `0ce043b` `docs(plans): defer the migration research and record the Q10 decision`
    - `c576742` `refactor(docs): move agents-docs to docs/project-rules`
    - `f74bdf4` `fix(lint): point deprecated tenant-client hints to createSingleClient`
    - `83d4b1a` `docs(agents): make AGENTS.md the single entry point`
    - `0eb74a2` `docs(agents): keep the still-valid dialog gotchas in the frontend rules`
    - `0d52f96` `docs(agents): name Conventional Commits in the pointer and drop a deleted start file`
    - plus the commit that records this entry.
  - **Link map before the move** (`$env:TEMP\reinex-restructure\stage3\before.json`, script `linkmap.cjs`), over tracked `.md` files at `cc97a82`:
    - 157 files, 393 relative links: 376 resolve and 17 are broken at the baseline.
    - Inside `agents-docs/` there were 285 links. The plan's 262 counted only `../`. Of these, 275 leave the folder, 10 stay inside it, and 1 was already broken.
  - **Baseline broken links** (17, recorded separately and not fixed by the move):
    - `ProjectDoc/TutTiud_Agents.md:135`;
    - `README.md:82`;
    - `Reinex-Refactor-and-Migration-Plan.md:783`;
    - `agents-docs/90:19` (`api/backup-status`, deleted in `bd7c90a`);
    - `docs/README.md:59`;
    - `docs/employee-leave-ledger-reference-review.md:18-19` (absolute `C:/dev` paths);
    - `docs/guardian-integration-implementation-summary.md:462-463`;
    - `implementations/calendar/workflow/README.md:65-71` and `phase-01-foundation.md:79` (absolute `C:/dev` paths).
  - **After the move** (`after-move.json`, compared by `compare.cjs`): 393 of 393 links resolve to the same file as before, with the 17 baseline breaks unchanged. Nothing is missing or extra.
    - `git` shows 11 renames, from `R054` to `R100`. `20-frontend-shared-helpers.md` shows as delete and add because more than half of its lines are links.
  - **Inbound references** were rewritten from `agents-docs` to `docs/project-rules`:
    - `AGENTS.md`, `CLAUDE.md`;
    - `eslint.config.js:10`, `api/_shared/leave-entitlement.js:37` (comments);
    - 8 files under `implementations/`.

    `git grep agents-docs` outside `docs/plans/` now finds nothing.
  - **Out-of-repo consumers:** no Claude memory file names `agents-docs/` (checked by grep). The wiki was not checked.
  - **After the content changes** (`after-content.json`): 158 files, 412 links, the same 17 baseline breaks.
    - `AGENTS.md`, `CLAUDE.md` and `docs/project-rules/**` have **0 broken links**. The one baseline break there, `api/backup-status`, was removed from the "Start here" list in `90`.
    - Every repository path quoted in backticks in `AGENTS.md` exists.
    - The link labels in `project-rules` still showed `../api/…` after the move. 261 labels were aligned with their targets (`83d4b1a`).
  - **What was written:**
    - `AGENTS.md` is 58 lines, and `CLAUDE.md` is `@AGENTS.md`.
    - `00` gained "Schema" (C4, plus the DDL rules), "Money in code", "Finding and running tests" (C7) and the upsert contract. Its validation table copy was removed.
    - `30` gained "Org isolation in the API" (C1) and "5xx responses and the support code" (C2). The second states that F2 and F3 are still needed.
    - `80` gained a tests pointer.
    - `commits.md` was added.
    - "Start here" is now in each domain file.
    - The mapping of every old line is in [3.13](#313-instruction-mapping-old-claudemd-and-agentsmd-at-0339f45).
  - **One-place checks (`git grep`):**
    - "Conventional Commits" appears in `commits.md` and on one link line in `AGENTS.md`;
    - `withOrgScope(client, table, orgId)` appears in `30` and on one line in `AGENTS.md`;
    - one validation table, in `AGENTS.md`;
    - `resolveTenantClient` appears only in `00`, as the prohibition.
  - **Checks** (Node v25.2.1):

    | Check | Result | vs. stage 2 |
    |---|---|---|
    | `npm run test:finance-calendar` | exit 0; tests 589, pass 560, fail 0, todo 29; identity SHA-256 `4BF71F11…C0CC3E4` | identical |
    | `npm run lint:sql` | exit 0; 0 errors, 21 warnings | identical |
    | `npm run lint:upsert-conflicts` | passed | identical |
    | `npm run lint:plans` | OK, 1 plan, active | identical |
    | `npm run lint:error-tracking` | 276 untracked 5xx in 100 files (warn-only) | identical; F2 and F3 not started |
    | `node scripts/validate-api-endpoints.js` | exit 1, the same 93 output lines before and after the C3 edit | pre-existing findings; message text only |
    | `npx eslint` on the 3 code files touched | 0 problems | — |
    | `npm run lint` (`eslint .`) | exit 0; 719 files; 0 errors, 0 warnings | identical (719) |
    | `npm run lint:api` (`eslint api/`) | exit 0; 220 files; 0 problems | identical |
  - **Findability tests through `AGENTS.md`.** Two new read-only agents were told to start from `AGENTS.md`, not to read `docs/plans/`, and to use no outside memory.
    - **Commits:** passed. It found `commits.md` through `AGENTS.md` and proposed `refactor(tests): move test/ to tests/` together with the npm, ESLint and ignore updates, and a separate `test(<area>): …` commit for the new test, with the reason.
    - **D8 (three cases):** passed.
      - The renamed script: update the instructions that cite it (`AGENTS.md`, `00`, `95`).
      - The approved product decision: record it in its domain source (`80` until stage 4 creates `docs/product/`).
      - The internal refactor: no documentation edit.
    - **C7:** passed. It named `tests/pay-calculation.test.js`, `payroll-rules`, `pay-summary`, and the tester scenario `pay-summary`. It gave the run commands and said that neither `build` nor CI runs them.
    - **C1:** passed. Its order was `ensureMembership`, then a stop on `null`, then `isAdminRole`, then `withOrgScope` for each read and update, plus `respondTrackedError`, `function.json` and `lint:api`.
    - **Limit of the test.** The agents ran inside this session, which had loaded the old `CLAUDE.md` before the change. One agent therefore reported a stale validation table in `CLAUDE.md`; on disk and in `HEAD` the file is only `@AGENTS.md`. A truly fresh run is stage 8.1, in a new session.
  - **Open, with reasons:**
    - **3.8:** each deletion needs owner approval per file. The preparation is in [3.8 Retirement candidates](#38-retirement-candidates).
    - **3.9:** an owner decision; the recommendation is recorded there.
    - **3.4 item 2 (hard limits):** it waits for the D9 decisions (`main`, preview and production claims).
  - **Plan correction:** the `IF NOT EXISTS`, money ESLint, `function.json` and explicit `onConflict` rules were only in `CLAUDE.md`, not in agents-docs as 3.1 listed them. They were moved to `00`.
  - **Not done:** 3F, no push, no settings change.
  - **Joint review pending** before 3F.
- **2026-11-24, stage 3 review fixes** (owner request after the joint review).
  - **Commits** (local, on top of `a49188d`):
    - `5853c5d` `docs(agents): use withOrgScope in the standard endpoint flow`
    - `b40beea` `docs(agents): drop the removed resolveTenantClient name from active guidance`
    - `9b0453c` `docs(agents): restore when to read the finance contract and hardening protocol`
    - `fdebc18` `feat(docs): add lint:doc-links for the agent instruction links`
    - `2d71c48` `ci(docs): add the Doc links check`
    - plus the commit that records this entry.
  - **1. Endpoint flow and C1.** The "Standard endpoint flow" in `30` offered `.eq('org_id', orgId)` as a normal alternative to `withOrgScope`.
    - It now has two separate steps: authorisation (`ensureMembership` for a member, stop on `null`, then role and instructor checks) and org scoping (`withOrgScope` for every supported operation). RPC, storage and auth-admin calls point to the C1 section.
    - A `git grep` over `AGENTS.md`, `CLAUDE.md` and `docs/project-rules/` found no other instruction that offers a manual filter.
    - Reviewing the implementations and changing API code stay in 3F.
  - **2. `resolveTenantClient`.** `git grep -n resolveTenantClient` over every tracked file at `a49188d` matched 10 files.
    - No file under `api/`, `src/`, `tests/` or `scripts/` defines, exports, imports or calls it, and neither do `eslint.config.js`, `package.json` or `.github/`. **The function has been removed.**
    - **Removed:**
      - `docs/project-rules/00-core-rules.md`: the name was removed from the list of retired patterns. The shared-database rule, the ban on per-org credentials, and the `createSingleClient(env)` and `withOrgScope` guidance remain.
      - `docs/api-validation-tool.md`: the bracketed note was removed. The old import path `../_shared/supabase-tenant.js`, which the validator still detects, and the current guidance remain.
    - **Kept, and why:**
      - `refactor-phase1.js` and `refactor-phase1.py`: one-time migration scripts that look for the name as a string, to rewrite old endpoints. They do not call it. They are already delete candidates in stage 6 (migration map, root files).
      - `implementations/database/one-db-refactor/one-db-refactor.md`: the migration log. It records what was removed and when (57 endpoints, the shim removed on 2026-04-18). Removing the name would lose that history. Stage 7 triage.
      - `Reinex-Refactor-and-Migration-Plan.md:775`: a completed TutTiud-to-Reinex plan that describes the old design. Already mapped to `docs/plans/repository/` as `completed` in stage 7.
      - `docs/plans/repository/directory-restructure.md`: this plan's own record of C3.
    - **Waiting for stage 7, with a recommendation:**
      - `docs/guardians-api-fixes-summary.md:56,61,114`: a fix report whose code samples call the removed function. **Recommendation:** delete it, or move it to `docs/research/` with a banner. It is a point-in-time report and no instruction depends on it.
      - `implementations/admin-page/org-nuke/README.md:695`: a "No `resolveTenantClient()`" row in the org-purge spec, which code comments cite. **Recommendation:** drop the row when the spec moves to `docs/project-rules/` in stage 7; the rest of the row already says to use `createSingleClient(env)`.
      - `implementations/finance/hmo-claims/technical-implementation-plan.md:868`: "Do not use `resolveTenantClient`." inside an implementation plan. **Recommendation:** leave it, or trim it, when the plan is triaged in 7.1. It is not an active instruction file.
  - **3. Finance reading times in `AGENTS.md`.** The routing row now reads: before a change to finance behaviour, the finance workflow contract; before a finance rollout, the release hardening protocol. This matches the two headings in `80`. Both links resolve (checked by `lint:doc-links`).
  - **4. Subtask 3.9.** Recorded under 3.9:
    - the command `npm run lint:doc-links` (`scripts/check-doc-links.js`), with tests in `tests/check-doc-links.test.js`;
    - the workflow "Doc links".

    The command and its scope are documented in the `AGENTS.md` validation table and in `00` "Finding and running tests".
  - **Verified locally** (Node v25.2.1):
    - `npm run lint:doc-links` on the real tree: exit 0, "Doc links OK: 319 relative link(s) in 14 file(s)". The stage 3 link map gives the same scope: 319 links, 0 broken.
    - **Broken-link case on the real tree.** In a throwaway worktree (`git worktree add`, removed afterwards), one link to `../../api/no-such-endpoint/index.js` was added to `30`. The check exited 1 with `docs/project-rules/30-backend-shared-helpers.md:106: link "../../api/no-such-endpoint/index.js" -> missing target api/no-such-endpoint/index.js`.
    - `node --test tests/check-doc-links.test.js`: 12 of 12 pass. They cover file, folder, sibling and anchor links; skipped external, anchor-only, absolute and fenced links; nested folders; a missing target with source, line and target; resolving from the containing file; a broken link in `AGENTS.md`; a link that leaves the repository; a missing `AGENTS.md`; and the command line (exit 0 and exit 1).
    - The workflow YAML parses (js-yaml) to the intended name, triggers, permissions and steps.
    - `npx eslint` on the new script and test: 0 problems.
    - `npm run lint` (`eslint .`): exit 0, 0 problems over 721 files. That is the stage 3 count of 719 plus exactly the two new files.
    - `npm run test:finance-calendar`: exit 0, 589 tests, the identity SHA-256 `4BF71F11…C0CC3E4` unchanged.
    - `tests/validate-plans-index.test.js`: 24 of 24 pass. `npm run lint:plans`: OK.
  - **Waiting for GitHub Actions** (after a push): the first runs of "Doc links" and of "Plan registry". The first push to `staging` also runs them on PR #62. Neither has run on Node 20 yet; they use only built-ins available there.
  - **Not decided:** making "Doc links" (like "Plan registry") a required check in the branch rules. That needs separate owner approval; no settings were changed.
  - **Still open:**
    - **3.8:** each deletion needs a separate owner decision.
    - **3.4 hard limits:** they wait for D9.
  - **Not done:** 3F, no push.
  - **Joint review pending** before 3F.

- **2026-11-24, 3.9 gap closed, and F1 planned** (owner request after the review of the fixes).
  - **`lint:doc-links` gap, reproduced by the owner:**
    - `[guide](<missing guide.md>)` passed, because the pattern did not accept a space inside `<…>`.
    - `[guide][ref]` with `[ref]: missing.md` on its own line passed, because reference definitions were not read.
    - A link example inside inline code was counted as a real link.
  - **Fix in `e553f38`** (`fix(docs): check angle-bracket and reference links, skip inline code`). The parser was changed in place, keeping Node built-ins only:
    - inline links accept `<target>` with spaces, an optional title, and balanced parentheses in a bare target;
    - every reference definition (`[label]: target` or `<target>`, up to 3 spaces of indent) is checked on its own line, which covers `[text][label]` and `[label]`;
    - footnotes (`[^1]: …`) are skipped;
    - code spans of any backtick length are blanked to the same length before matching. An example inside inline code is therefore ignored, while link text that is code (`` [`a.js`](a.js) ``) is still checked.
  - **Tests:** 20 of 20 pass (12 before, 8 new): an existing and a missing angle-bracket target; an existing and a missing reference definition, the second also in angle brackets; inline-code examples with single and double backticks; code as link text; footnotes.
  - **Real instructions:** `npm run lint:doc-links` exits 0 with 319 links in 14 files, the same count as before.
    - **Why the count did not change:** the old and new versions were compared file by file (`$env:TEMP\reinex-restructure\stage3\diff-extract.mjs`) and found the same 319 links, with no link only in the old or only in the new version. The instructions contain no angle-bracket target, no reference definition and no link example inside inline code.
  - `npx eslint` on the script and the test: 0 problems.
  - **Waiting for GitHub Actions:** as before, "Doc links" runs only after a push.
  - **F1.1–F1.4** are done and written up in [F1 findings and proposal](#f1-findings-and-proposal-for-joint-review). No code was changed. **F1.5 waits for the joint review.**
  - **Open:** 3.8 deletions (owner, per file); 3.4 hard limits (D9); required checks in the branch rules (owner).

- **2026-11-24, F1 re-planned as atomic operations, and owner decisions recorded** (plan only; no code, settings or deletions changed).
  - **Product decision:** the operation must succeed in full during the user's request. The earlier F1 proposal (finish the links on a retry) was rejected and kept as history.
  - **New in F1:**
    - **F1.6, the operation boundary:** the boundary of each path, with the writes before and after the student step, what existed before, and an example of today's state after a failure. Read from the code at `a5c3819`.
    - **Findings while mapping:**
      - **Template create:** the student and links are written **before** the conflict and required-form checks. A `required_form_warnings` 200 or a 409 therefore leaves a new student behind.
      - **Capacity assign:** it reactivates the profile before its validations, and it does not revert the template update when the participant insert fails.
      - **Import:** a candidate failure leaves no `error_events` row and no stored reason.
    - **F1.7, the proposed solution:** validate first, then one PL/pgSQL RPC per operation, which is one transaction. It follows the existing lesson-RPC pattern.
      - Each function is org-scoped on every statement and granted to `service_role` only.
      - Locks are taken in a fixed order for concurrent requests.
      - On a lost-response retry: `already_committed` for the import, and a proposed `already_applied` for the waiting-list paths.
      - The scope is wider than F1 as defined, so it awaits owner approval (F1-Q1).
      - *Finding:* the existing lesson RPCs revoke `authenticated` only and keep the default `PUBLIC` grant. This is left for a separate fix.
    - **F1.8, the proof against local PostgreSQL:** a deliberate failure is raised by a temporary trigger after the early writes. Snapshots before and after must be identical, earlier data must be kept, a success must apply exactly once, org B must stay unchanged, and concurrent calls must create one student. Handler-level tests show what the user receives.
    - **F1.9, measuring attempts:** correlation metadata (`operation`, `operation_key`, `input_fingerprint`) on failure events, which are written after the rollback, and on success audit rows. No new table or column. The business import ledger is unchanged.
  - **Open (F1):** F1-Q1 (scope), F1-Q2 (idempotency for a direct template create), F1-Q3 (`already_applied`), F1-Q4 (F2 before F1.5). **F1.5 is blocked until they are answered.**
  - **Owner decisions recorded:**
    - **3.8:** deleting the Copilot chat mode is approved. Deleting `docs/AI-Coder-Gotchas.md` is approved after its references in `docs/README.md` and `ProjectDoc/TutTiud_Agents.md:574` are updated. Neither is executed yet.
    - **Q9 and "Doc links":** both become required checks for `staging` and `main` after their first successful run on GitHub Actions.
    - **D9:** every push or merge to `main` needs explicit owner approval (binding); straight quotes for quoted Hebrew UI names in UI-writing guidance (binding). Both are to be written in the next approved round.
    - **Q10:** `attribution.commit` is set to an empty string in the shared project settings, for commits only. Not applied yet.
    - **4R and Q11:** still deferred.

---

## Coverage check

| Required item | Where |
|---|---|
| Target tree, folder roles, root config files | Target structure; Root coverage check |
| Migration map for every inspected folder and root item | Migration map (53/53 root entries) |
| Owner decision 1: `test/` → `tests/` first; colocated tests stay | Stage 1; map rows for `api/` and `src/` |
| Owner decision 2: topic folders, fixed paths, `index.csv` (path, title, status), checkboxes and evidence | Stage 2 |
| Owner decision 3: `AGENTS.md` source of truth, `CLAUDE.md` pointer, start files as entry points, reasons with rules | Stage 3 |
| Owner decision 4: `docs/product/`, PAY-* IDs, tests, unverified sources marked | Stage 4 |
| Owner decision 5: `docs/research/README.md` design | Stage 4 draft |
| Owner decision 6: `scripts/`, `tools/` and `tests/` boundaries | Stage 6 |
| Owner decision 7: `database/`, all consumers, setup and upgrade preserved | Stage 5 |
| Owner decision 8: `local/`, tracked local files, tools with fixed paths | Local items; stages 1 and 6 |
| Owner decision 9: per-stage report and joint review | Shared execution rules, item 9 |
| Commit policy (Conventional Commits 1.0.0, one place, found through `AGENTS.md`) | Stage 3: subtask 3.10, section 3.3, stage acceptance; Non-goals; Q10; stage 1.3 step 10 |
| Test-scope rule (entry points, affected files, no coverage growth) | Purpose; stages 0, 1, 5; Dependencies |
| 3.1 decisions C1–C7, D8 (documentation currency), D9 | Stage 3: 3.1, subtasks 3.3–3.7 and 3.11–3.12, stage acceptance |
| Code fixes from 3.1: client-profiles writes, support-code bug, strict error tracking in CI | Stage 3F (F1, F2, F3); Non-goals; Dependencies |
| Migration workflow research (Vikunja) and decision | Stage 4R and Q11, both deferred; stage 5.0 practical check |
| Test classification (purpose, environment, entry point) | Migration map: Test classification; 7.3 |
| Silent-failure cases | Dependencies beyond imports |
| Open questions and Codex recommendations | Open decisions |
| Three success tests | Success tests |
