# Repository directory restructure

## Resume here

Read this block first when you continue this plan in a new conversation.

- **Plan status:** the overall status of this plan is recorded only in [`docs/plans/index.csv`](../index.csv). Check it with `npm run lint:plans`.
- **Current stage:** 2 is done (the registry and `lint:plans`); results are in the Progress log. Next: joint review of stage 2, then stage 3 (subtask 3.1). Stage 3 must not start before that review.
- **Execution branch:** `repository-reconstruction`, based on `origin/staging` `dce8f2e790e939b7f0805803d7d44e71a23346ba`. See [Planning base](#planning-base) and [Q1](#q1-execution-branch).
- **Repository state:**
  - `test/` is now `tests/`.
  - `docs/plans/index.csv` and `npm run lint:plans` exist.
  - The raw evidence is outside the repository, in `$env:TEMP\reinex-restructure\stage0\`, `stage1\` and `stage2\`.
  - Nothing has been pushed; the owner decides on the push together with Claude.
- **Last update:** 2026-11-23. Stage 2 completed after review: checker fixes and the "Plan registry" CI workflow.

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
3. **No coverage growth.** Nothing else is added to what is run.

**Non-goals.** Each of these is a separate initiative:

- adding `npm test`;
- running the unscripted test files as a whole;
- widening coverage;
- changing CI triggers or behaviour. The one owner-approved exception is the "Plan registry" workflow (Q9);
- automating migrations in deployment;
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
  - PRs into `staging` themselves get no CI. Triggers are on `main` only [V]. Since stage 2 the one exception is the "Plan registry" workflow, which also runs on PRs and pushes to `staging`.
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
| `.github/workflows/*`, `.github/actions/run-integrity-checks/` | Stay | They run npm scripts only and never reference `test/` [V]. Triggers: `main` only [V]. | GitHub Actions | — | — |
| `.github/chatmodes/Azure_function_codegen_and_deployment.chatmode.md` | Delete candidate | A competing instruction source: Copilot, naming "Claude Sonnet 4" [V] | Copilot chat | Owner confirms unused | 3 |
| `.vscode/extensions.json` | Stays | Editor recommendation | VS Code | — | — |
| `test/` (all of it) | `tests/` | Owner decision 1. Contents and consumers are in stage 1.1. | see 1.1 | Stage 1 | 1 |
| `test/verify-backup.cjs` | Moves with `test/` in stage 1, then to `tools/backup/` | Not a test: a manual check needing `<orgId> <date>` and a real backup [V] | Its own usage text | Stage 6 | 1, then 6 |
| `test/automatic-tester/supabase/.branches/_current_branch` | Moves with `test/` in stage 1; untracked in stage 6 | Tracked although its own `.gitignore` ignores `.branches` [V] | Supabase CLI | `git check-ignore` | 1, then 6 |
| `implementations/database/one-db-refactor/{e2e-smoke,rls-isolation}.test.js`, `isolation-stress-test.js` | `tests/integration/` | Integration tests needing a running DB and API [V]. `e2e-smoke` was maintained in #55 [V]. | `package.json` `test:isolation-stress-test` [V]; they import `../../../api/…` [V] | [P] Fix import depth; `node --check`; npm script path exists | 7 |
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

#### 3.1 Conflicts to resolve before shortening `CLAUDE.md` [V]

| # | Topic | Sources | Proposed rule (for joint review) |
|---|---|---|---|
| C1 | Org isolation | `CLAUDE.md`: "All DB writes must go through `withOrgScope` — never raw `client.from`". `AGENTS.md:8` and `agents-docs/00:19`: `ensureMembership()` + `.eq('org_id', orgId)` or `withOrgScope`; "every query must filter by `org_id`". `agents-docs/30:55-64`: auth and membership checks first; "tenant reads/writes must always be org-scoped". `withOrgScope` (`org-bff.js` ~310-324) adds `.eq('org_id')` to select, update and delete, and stamps `org_id` on insert and upsert rows. | **Rule.** Every tenant endpoint first verifies membership in the request's org (`ensureMembership`). Every tenant table operation is then limited to that org, through `withOrgScope(client, table, orgId)` or an explicit equivalent that fits the operation: `.eq('org_id', orgId)` on select, update and delete; `org_id: orgId` on inserted or upserted rows. **Why:** the API uses the service-role client, which bypasses RLS, so a missing filter crosses orgs. **Existing case for review:** `api/_shared/client-profiles.js:459-464` updates four tables by `client_profile_id` without an org filter, with the comment that the profile was just read in this org. It is recorded as an existing case that needs a point review. It is **not** a general permission to omit org scoping. Guard test: `test/org-scope-reads.test.js`. |
| C2 | 5xx responses | `AGENTS.md`: "must return through `respond(context, ...)`". `agents-docs/30:61`: 5xx with a service-role client available should use `respondTrackedError(...)` or `respondTracked(...)`; pre-client configuration failures may stay direct `respond(context, 500, ...)`. `scripts/validate-error-tracking.js:1-29`: it accepts `respondTracked`, `respondTrackedError` or a `respond<Name>Error` wrapper that delegates to them, plus a `tracked-error-exempt` comment for a 5xx raised before the client exists. It is **warn-only** (exits 0 unless `--strict`), both in build and in CI. | **Rule for writers.** Responses go through `respond`. A 5xx that has a service-role client available goes through `respondTrackedError`, `respondTracked`, or a documented `respond<Name>Error` wrapper. A configuration failure raised before a suitable client exists may use `respond(context, 500, …)` with a `tracked-error-exempt` comment. **Why:** a tracked 5xx stores the internal detail in `error_events` and returns an `error_id` support code; an untracked one loses both. **Separate fact, stated separately:** the validator currently only warns, so the build does not enforce this. |
| C3 | Tenant client | `AGENTS.md`: "Never use `resolveTenantClient()`". `eslint.config.js:103,143` and `scripts/validate-api-endpoints.js:27` say "Use resolveTenantClient from org-bff.js instead". It is no longer exported: `org-bff.js:272` exports `createSingleClient`, used in 21 API files. | Fix the three messages to name `createSingleClient`. This is a message-only code edit. |
| C4 | Schema source | `CLAUDE.md`: "`setup-sql.js` — single source of truth for the entire DB schema". `migrations/README.md`: the snapshot plus numbered migrations; on an existing DB the migrations run first. Neither instruction file mentions `migrations/`. | **Rule.** The schema is the snapshot plus the migrations, applied in the documented order. **Why:** a new DB needs only the snapshot; an existing DB needs the one-time changes first. Paths are updated in stage 5. |
| C5 | Build description | `CLAUDE.md` lists 4 build steps. `package.json` `build` runs 6. | The validation table names npm scripts only. |
| C6 | Context scope | `AGENTS.md`: "Load ONLY the source files listed there". | "Start from these files. They are an entry point, not a boundary: follow imports, callers (grep the symbol), dependencies and tests." |
| C7 | Test coverage | Both files present `test:finance-calendar` as the finance check. 21 `*.test.js` files are in no npm script (10 in `api/`, 2 in `src/`, 7 in `test/`, 2 in `implementations/`) [V], including `api/_shared/employee-finance.test.js`. | State the gap in `project-rules/80` with an issue number. Fixing it is a non-goal here. |

**Rules found in only one file** must be kept once, in the right place:
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
  - Keep the Hub Alive.

**Instruction sources to retire** (merge any valid items first):
- `.github/chatmodes/…chatmode.md`;
- `ProjectDoc/TutTiud_Agents.md`;
- `ProjectDoc/Conventions.md`;
- `docs/AI-Coder-Gotchas.md`.

**Rules that exist only in agent memory.** Each needs owner confirmation before it becomes binding:
- every change updates node tests and tester scenarios;
- never push or merge to `main` without the owner;
- the preview environment uses the production DB;
- straight quotes in UI terms.

#### 3.2 Subtasks

- [ ] 3.1 Present the conflicts table with the proposed wording. **Joint review.** Record the answers to C1–C7.
- [ ] 3.2 `git mv agents-docs docs/project-rules`, keeping the file names.
- [ ] 3.3 Rewrite the 262 relative links inside them (`../api` becomes `../../api`, and so on). Also rewrite every inbound link:
  - `AGENTS.md`;
  - `CLAUDE.md`;
  - the comment at `eslint.config.js:10`;
  - `implementations/**`.
- [ ] 3.4 Rewrite `AGENTS.md`, at most about 100 lines:
  1. what Reinex is;
  2. hard limits (`main`, the production DB, the preview environment);
  3. always-on rules, each with a one-line why;
  4. a routing table (task → `project-rules` → `product` → tests → start files);
  5. the validation table (npm script names);
  6. how to continue a plan: "Resume here", then `docs/plans/index.csv`.
- [ ] 3.5 Make `CLAUDE.md` exactly `@AGENTS.md`, plus Claude-only notes if any remain.
- [ ] 3.6 Add a "Start here" list to each `project-rules` file, with the C6 wording.
- [ ] 3.7 Fix the C3 messages.
- [ ] 3.8 Delete the retired instruction sources after owner confirmation.
- [ ] 3.9 Decide whether the link check becomes `scripts/check-doc-links.js`. It resolves relative Markdown links and the `implementations/`, `docs/`, `tests/` and `database/` paths cited in code comments.
- [ ] 3.10 Define one commit policy for every development agent in Reinex. The owner requested it on 2026-11-23. See 3.3.

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

**Acceptance (stage 3 as a whole):**
- A checklist maps every line of the old `CLAUDE.md` and `AGENTS.md` to its new location.
- The link check over `AGENTS.md`, `CLAUDE.md` and `docs/project-rules/**` finds 0 broken links.
- `npm run lint` and `npm run lint:api` show the stage 2 counts.
- The commit policy acceptance in 3.3 passes.

**Rollback:** revert.

**Evidence:**
- the line-mapping checklist;
- the link-check output;
- the resolved conflicts;
- the commit-policy agent test: the task given, and the agent's titles and grouping.

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

### Stage 5: Database assets into `database/`

**Goal:** the snapshot and the migrations live in `database/`.
- A new DB is still set up from the snapshot alone.
- An existing DB is still upgraded with the migrations first, then the snapshot.
- No bridge file is left behind.

**Depends on:** stage 3 (C4), and stage 4 if it edited `setup-sql.js:6801`.

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
- [ ] 7.3 Move the integration tests from `implementations/database/one-db-refactor/` to `tests/integration/`:
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
| A test leaves the run without failing | `test:finance-calendar` is an explicit list. 21 `*.test.js` files are in no npm script, among them `purge-manifest.test.js`, which reads the schema by path. `test:isolation-stress-test` points into `implementations/`. | Run the real npm script with the identity reporter and compare identities, not just exit codes. Run the stage's affected unscripted files directly (scope rule 2). Check that every file path named in `package.json` scripts exists. |
| A test passes but reads a different file | `dated-settings.test.js:387` (migration 0002); `pay-calculation.test.js:699` (`api/calendar-attendance/index.js`) | A missing file throws, so a pass after the move proves the new path. Confirm through the identity comparison. |
| A blanket replace corrupts a non-path string | `https://app.test/…` fixtures in `src/lib/analytics/posthog.test.js` and `api/_shared/error-events.test.js` | Only the anchored inventory grep and targeted edits are used. The identity and results of those two suites stay unchanged when they are in scope. |
| A tracked file drops out on staging | `reports/.gitkeep` and `supabase/.branches/_current_branch` are tracked but matched by ignore rules | Stage the explicit tracked list with `-f`, and compare the path lists (stage 1.3 steps 5, 7 and 8). |
| Local data gets staged after a move | `.gitignore:44` is path-specific. Also `/manual-db-backup/backups` and `/test-data`. | Add the new rule before the move; run `git check-ignore -v` at the new path; never use `git add -A` over the folder. |
| The app builds but bundles a different schema | `SetupAssistant.jsx` bundles `SETUP_SQL_SCRIPT` | Compare the hash, and check the `dist/assets` marker. |
| Docs and comments point to moved specs | 16 session-reports comment references (plus 3 in the schema), `purge-manifest.js:6`, `payroll-rules.test.js:2`, `AGENTS.md:34-35`, and 262 relative links in agents-docs | The stage 3 link check |
| An instruction names a helper that is gone | `eslint.config.js:103,143` and `validate-api-endpoints.js:27` recommend the removed `resolveTenantClient` | `git grep` each helper named in the rules and check that it is exported. |

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
  - Stage PRs into `staging` get no CI before merge, apart from "Plan registry" since stage 2.
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
  - **Not decided yet:** making "Plan registry" a required check for merging in the branch rules. That needs separate owner approval.

### Q10 Co-authored-by trailer
- **Known:** the owner decided on 2026-11-23 that this question is settled separately from the commit policy (stage 3.3). Claude currently appends a `Co-Authored-By:` trailer by default.
- **Missing:** whether the policy requires, allows or forbids the trailer for agents.
- **Who:** the owner.
- **When:** before 3.10 is closed. The policy is written without the topic until then.

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
| Silent-failure cases | Dependencies beyond imports |
| Open questions and Codex recommendations | Open decisions |
| Three success tests | Success tests |
