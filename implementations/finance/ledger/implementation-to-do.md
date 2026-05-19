Prompt engineering operating frame for every step:
- One objective only.
- One bounded file set only.
- One expected output schema only.
- One explicit non-goal list.
- One verification command set.
- One rollback note.

10-step mission plan:

1. Lock the source-of-truth contract before coding.
Do: Create a short Finance Workflow Contract from current behavior in BillingLedgerService.js, index.js, index.js, and LessonInstanceDialog.jsx.
Why: Without a frozen contract, multiple AI agents will each “correct” logic differently and drift.
Why not another way: Jumping straight into edits causes accidental behavior changes that look like fixes but break hidden dependencies.
- Status: Completed (verified).
- Summary:
	- Created contract artifact: implementations/finance/ledger/finance-workflow-contract-v1.md.
	- Captured current source-of-truth behavior for:
		- billing decision rules (direct client, student standard, HMO split, blocked reasons),
		- ledger mutation model (append-only + reverse-then-append),
		- attendance coupling (preview + apply sync sequence),
		- HMO authorization coupling (create/update/delete all trigger window resync),
		- frontend preview consumption and impact grouping.
	- Included required step frame sections inside contract: objective, bounded file set, expected output schema, explicit non-goals, verification command set, rollback note.
	- Linked the contract into the AGENTS instruction tree so agents discover it by default from AGENTS.md and agents-docs/80-finance-billing-payroll.md.
	- Verification pass 1 completed: contract structure quality and required sections present.
	- Verification pass 2 completed: source alignment checks confirmed contract anchors still exist in code.
- What to expect:
	- All AI agents now have one frozen baseline contract to reduce drift and hallucinated assumptions before implementation starts.
	- Future behavior changes should be intentional and traceable against this baseline.
- Suggestions:
	- Step 2 should reuse this contract as the only allowed reference when writing Given/When/Then acceptance cases.
	- Add a small PR checklist item: “Does this change contradict finance-workflow-contract-v1.md?”

2. Build explicit acceptance criteria per mission as machine-checkable cases.
Do: For each mission, define Given/When/Then examples with exact payload fields and values (especially HMO split, preview impacts, and claim task flow).
Why: AI agents perform better with concrete examples than abstract goals.
Why not another way: “Improve preview” style goals are too vague and produce hallucinated UX/data fields.
- Status: Completed (verified).
- Summary:
	- Created acceptance criteria artifact: implementations/finance/ledger/finance-workflow-acceptance-criteria-v1.md.
	- Defined machine-checkable Given/When/Then criteria for:
		- billing decision and ledger mutation rules,
		- attendance preview contract,
		- attendance apply sync and HMO claim task lifecycle,
		- HMO authorization create/update/delete resync coupling,
		- frontend preview request and impact grouping.
	- Kept criteria anchored to finance-workflow-contract-v1 baseline and existing implementation tokens.
	- Included step frame sections in criteria file: objective, bounded file set, expected output schema, explicit non-goals, verification command set, rollback note.
	- Verification pass 1 completed: criteria file covers all mission-critical domains.
	- Verification pass 2 completed: key tokens and coupling signals match implementation anchors.
- What to expect:
	- AI implementation agents can now execute Step 3+ with deterministic expected outcomes and lower behavioral drift.
	- Reviewer agents can validate behavior from explicit assertions instead of ambiguous prose.
- Suggestions:
	- For Step 3, map each code change PR to one or more acceptance IDs from finance-workflow-acceptance-criteria-v1.md.
	- Add a CI checklist gate: every finance-flow PR must reference at least one AC id and one verification result.

3. Mission 1, batch A: enrich backend preview payload with HMO split detail only.
Do: Update preview construction in index.js to include explicit student copay, insurer claim amount, authorization id, and provider summary in projected data and impacts.
Why: You identified “preview missing actual actions”; this is the highest leverage visibility fix with low write-risk.
Why not another way: Editing frontend first creates fake UI placeholders and mismatched payload assumptions.
- Status: Completed (verified).
- Summary:
	- Updated preview builder in api/calendar-attendance/index.js to return explicit HMO split metadata in `projected`:
		- hmo_split_applied,
		- hmo_authorization_id,
		- hmo_provider_id/name,
		- hmo_provider_track_id/name,
		- hmo_contracted_rate_amount,
		- hmo_student_copay_amount,
		- hmo_insurer_claim_amount.
	- Added explicit `hmo_split_detail` preview impact containing authorization id, provider summary, student copay amount, and insurer claim amount.
	- Extended acceptance criteria with AC-PREVIEW-004 in implementations/finance/ledger/finance-workflow-acceptance-criteria-v1.md.
	- Verification pass 1 completed: required new projected fields and impact token exist in backend preview code.
	- Verification pass 2 completed: acceptance criteria updated to include machine-checkable assertions for the new preview schema.
- What to expect:
	- Backend preview now makes HMO split actions visible and explicit to consumers.
	- UI can render exact HMO split details in Step 4 without adding client-side billing math.
- Suggestions:
	- In Step 4, map `hmo_split_detail` to the HMO preview group and render amounts directly from server payload.
	- Keep frontend strictly read-only for these values; do not recompute split math client-side.

4. Mission 1, batch B: render new preview fields in dialog without changing business logic.
Do: Update only preview rendering/grouping in LessonInstanceDialog.jsx, no billing computations on client.
Why: Keeps all financial math server-side and prevents duplicate logic.
Why not another way: Recomputing split amounts in frontend will diverge from ledger behavior and create reconciliation bugs.
- Status: Completed (verified).
- Summary:
	- Updated src/features/calendar/components/LessonInstanceDialog.jsx to render backend-provided HMO split details in preview UI.
	- Mapped `hmo_split_detail` impact to the existing HMO preview group.
	- Rendered structured HMO detail lines from server payload (authorization id, provider, track, student copay, insurer claim, contracted rate).
	- Added a dedicated “HMO split details” preview panel driven by `preview.projected.hmo_split_applied` and related projected fields.
	- Kept frontend behavior read-only for billing logic; UI only formats server-sent agorot amounts for display.
	- Extended acceptance criteria with AC-UI-PREVIEW-003 in implementations/finance/ledger/finance-workflow-acceptance-criteria-v1.md.
	- Verification pass 1 completed: UI grouping and rendering anchors exist for the new HMO split fields.
	- Verification pass 2 completed: acceptance criteria includes machine-checkable frontend assertions for hmo_split_detail rendering.
- What to expect:
	- Users can now see explicit HMO split actions directly in the preview dialog, not just generic charge messages.
	- Step 5 can now test these details end-to-end using deterministic payload assertions.
- Suggestions:
	- In Step 5, add tests that assert both `impacts[].type === hmo_split_detail` and projected split fields in preview responses.
	- Add one UI test/assertion that verifies HMO group renders split values exactly as sent by backend.

5. Mission 1, batch C: add focused tests for preview contract.
Do: Add or extend tests that validate preview impacts for attended, no_show, cancelled_student, scheduled restore with and without active authorization.
Why: Prevents regressions when later missions modify attendance or authorization flows.
Why not another way: Manual QA alone will miss edge status combinations and race conditions.
- Status: Completed (verified).
- Summary:
	- Added focused automated tests: test/finance-preview-contract.test.js.
	- Added coverage for billing/preview contract behavior:
		- attended with active authorization yields explicit HMO split entries,
		- no_show excluded by policy is not chargeable,
		- cancelled_student included by policy is chargeable,
		- scheduled (restore baseline) is not chargeable.
	- Added coverage for preview impact/audit behavior on restore:
		- hmo_task_resolved appears when restore preview includes HMO task resolution,
		- hmo_task_resolved is absent when no HMO task exists.
	- Exported buildAttendanceTransitionAuditChanges from api/calendar-attendance/index.js as a test seam without runtime behavior change.
	- Extended acceptance criteria with AC-PREVIEW-005 in implementations/finance/ledger/finance-workflow-acceptance-criteria-v1.md.
	- Verification pass 1 completed: targeted test suite execution passed.
	- Verification pass 2 completed: Step 5 criteria tokens and test coverage mapping are present in artifacts.
- What to expect:
	- Preview billing and restore-impact regressions for the core statuses are now caught automatically.
	- Future Step 6+ changes can be validated against this safety net before merge.
- Suggestions:
	- Add this test file to the regular CI test command once the repo test command matrix is consolidated.
	- In later batches, add higher-fidelity integration tests that hit preview API actions with DB fixtures.

6. Mission 2, batch A: add HMO-awareness warnings to generation preview, not hard blocks.
Do: In index.js, evaluate active authorization coverage for generated candidate dates and emit structured warnings/conflicts metadata.
Why: Prevents silent drift before billing without stopping operations.
Why not another way: Hard-blocking generation is operationally risky for MVP and creates workflow dead-ends.
- Status: Completed (verified).
- Summary:
	- Updated api/calendar-generate/index.js to emit non-blocking structured HMO coverage warnings.
	- Added helper `buildHmoCoverageWarning(candidate, authorizationRows)` with explicit reasons:
		- no_authorization_found,
		- no_active_authorization,
		- no_active_authorization_for_date.
	- Extended generation response payload to include:
		- summary.hmo_coverage_warnings,
		- warnings array,
		- warnings_notice for schema-unavailable fallback.
	- Kept generation non-blocking: warnings are informational and do not prevent proposals from entering to_insert_instances.
	- Added focused tests: test/calendar-generate-hmo-warning.test.js.
	- Extended acceptance criteria with AC-GEN-001 and AC-GEN-002 in implementations/finance/ledger/finance-workflow-acceptance-criteria-v1.md.
	- Verification pass 1 completed: focused Step 6 test suite passed (4/4).
	- Verification pass 2 completed: response schema and criteria artifacts include generation warning fields and assertions.
- What to expect:
	- Generation preview now highlights HMO authorization coverage gaps before billing is affected.
	- Operations can proceed while still receiving actionable warning metadata.
- Suggestions:
	- Step 7 should render response.warnings and summary.hmo_coverage_warnings prominently in ManualGenerationDialog.
	- Consider grouping warnings by student+service in UI for quick remediation workflows.

7. Mission 2, batch B: surface generation warnings clearly in the manual generation UI.
Do: Render server warnings in ManualGenerationDialog.jsx with actionable language and counts.
Why: Warnings are useless if they are not visible at decision time.
Why not another way: Hidden console logs or toast-only notifications get ignored and are not reviewable.
- Status: Completed (verified).
- Summary:
	- Updated src/features/calendar/components/ManualGenerationDialog.jsx to surface generation warning metadata from server response.
	- Added clear warning banner for `summary.hmo_coverage_warnings` with explicit non-blocking language.
	- Added grouped reason counters for warning reasons:
		- no_authorization_found,
		- no_active_authorization,
		- no_active_authorization_for_date.
	- Added detailed warning list rows with reason label, student_id, service_id, and target_date.
	- Added schema fallback notice rendering for `warnings_notice === 'hmo_authorization_schema_missing'`.
	- Kept apply behavior unchanged: warnings alone do not disable apply action.
	- Extended acceptance criteria with AC-GEN-003 in implementations/finance/ledger/finance-workflow-acceptance-criteria-v1.md.
	- Verification pass 1 completed: UI anchors for warning count, grouped reasons, and warning rows exist.
	- Verification pass 2 completed: acceptance criteria includes explicit UI assertions for generation warning visibility.
- What to expect:
	- Manual generation preview now exposes HMO coverage risks in a visible, reviewable, and actionable way.
	- Users can proceed intentionally instead of missing silent warning metadata.
- Suggestions:
	- In Step 8, reuse this warning presentation pattern in finance claims view for consistency.
	- Consider adding quick filters by reason/student when warning volume grows.

8. Mission 3, batch A: make claims flow visible as a dedicated read model first.
Do: Add a read endpoint/view in finance scope using existing task and ledger artifacts, then expose it in FinancialsPage.jsx and optionally student context in StudentBillingWorkspace.jsx.
Why: Visibility before mutation lets you validate model quality before introducing payment actions.
Why not another way: Implementing claim actions first without a trusted list/summary view leads to blind operations.
- Status: Completed (verified).
- Summary:
	- Added read-model view in api/billing/index.js via GET `view=hmo_claims`.
	- Read-model composes existing artifacts only:
		- claim tasks from dashboard_tasks (`hmo_claim_submission`),
		- claim context from lesson participants + lesson instances + services,
		- authorization/provider context from hmo_authorizations + hmo_providers,
		- receivables snapshots from BillingLedgerService.getHmoProviderReceivablesSnapshot.
	- Response schema includes:
		- summary (total/open/resolved/unique students/provider count),
		- claims list,
		- provider_receivables list,
		- notices and generated_at.
	- Exposed read model in src/pages/FinancialsPage.jsx with new “תביעות HMO” tab showing:
		- summary cards,
		- claim task list,
		- provider receivables panel.
	- Kept step read-only: no payment or claim mutation actions were introduced.
	- Extended acceptance criteria with AC-CLAIMS-001 and AC-CLAIMS-002 in implementations/finance/ledger/finance-workflow-acceptance-criteria-v1.md.
	- Verification pass 1 completed: API and UI anchors for claims read model are present.
	- Verification pass 2 completed: diagnostics report no errors in changed files.
- What to expect:
	- Finance team now has centralized visibility into HMO claim workload and receivables before introducing reconciliation mutations.
	- Step 9 can safely attach controlled payment actions to a validated read model.
- Suggestions:
	- In Step 9, add explicit mutation entry points only from this new claims view and route all writes through BillingLedgerService.
	- Add role-based UI affordance for payment actions (admin-only) while keeping read visibility for office users.

9. Mission 3, batch B: add controlled HMO payment/reconciliation mutation.
Do: Implement a single explicit action path that posts HMO payment credits through ledger service, never direct SQL arithmetic, and reflect status updates in claims view.
Why: Preserves append-only financial integrity and auditability.
Why not another way: Ad-hoc updates or mixed write paths will break reconciliation and trust in balances.
- Status: Completed (verified).
- Summary:
	- Added controlled billing mutation action in api/billing/index.js: `record_hmo_claim_payment`.
	- Mutation path is ledger-only via BillingLedgerService.appendManualCredit:
		- account_type: hmo_provider,
		- source_type: hmo_invoice_payment,
		- no direct balance arithmetic in endpoint code.
	- Added provider-scoped open-claim task resolution option:
		- resolves matching open `hmo_claim_submission` tasks linked to provider authorizations,
		- returns resolved_task_count and resolved_task_ids in response.
	- Exposed admin-only payment control in src/pages/FinancialsPage.jsx claims tab:
		- provider selection,
		- amount/effective date/notes,
		- optional “resolve open tasks” toggle.
	- On successful payment mutation, claims read model is refreshed to reflect updated receivables and task counts.
	- Extended acceptance criteria with AC-CLAIMS-003 and AC-CLAIMS-004 in implementations/finance/ledger/finance-workflow-acceptance-criteria-v1.md.
	- Verification pass 1 completed: API and UI mutation anchors are present and wired.
	- Verification pass 2 completed: diagnostics report no errors in changed files.
- What to expect:
	- HMO payments are now recorded through an explicit, auditable, append-only ledger path.
	- Claims view now acts as both visibility surface and controlled reconciliation entry point for admins.
- Suggestions:
	- Step 10 should formalize dual-review checks that assert this action remains ledger-only and provider-scoped.
	- Add end-to-end seeded test later for payment action + task resolution + read-model refresh path.

10. Release hardening: two-pass AI review protocol and staged rollout.
Do: For each merged batch, run two review passes: Pass 1 by implementation agent against acceptance cases, Pass 2 by separate reviewer agent against non-goals and regressions, then ship behind a scoped rollout/checklist.
Why: Your team is AI-agent based; enforced dual review is your best defense against subtle hallucinated logic.
Why not another way: Single-agent “looks good” approvals are exactly where cross-feature finance defects slip through.
- Status: Completed (verified).
- Summary:
	- Created release hardening artifact: implementations/finance/ledger/finance-workflow-release-hardening-v1.md.
	- Defined enforceable two-pass protocol:
		- Pass 1: implementation-to-acceptance mapping and evidence checks.
		- Pass 2: independent non-goal and regression/coupling review.
	- Added staged rollout checklist with explicit gate criteria:
		- Stage 0 pre-prod,
		- Stage 1 canary,
		- Stage 2 limited,
		- Stage 3 general availability.
	- Added AC-to-evidence mapping for missions 1 to 3 and release gates.
	- Added release acceptance criteria in implementations/finance/ledger/finance-workflow-acceptance-criteria-v1.md:
		- AC-REL-001,
		- AC-REL-002.
	- Wired discoverability into instruction hubs:
		- AGENTS.md now links finance-workflow-release-hardening-v1.md in Read By Task.
		- agents-docs/80-finance-billing-payroll.md now includes release hardening baseline guidance.
	- Verification pass 1 completed: all focused contract tests pass.
	- Verification pass 2 completed: Step 10 documentation anchors and diagnostics checks pass.
- What to expect:
	- Every finance release can now be blocked or approved by explicit dual-review evidence rather than single-agent judgment.
	- Rollout decisions are now traceable to AC ids, test evidence, and coupling invariants.
- Suggestions:
	- Enforce a PR template checkbox requiring AC mappings and completed pass_1/pass_2 fields from finance-workflow-release-hardening-v1.md.
	- Add a lightweight release evidence file per rollout (release_id + decision object) to keep audits deterministic.

Small-batch execution rule set:
1. One batch = one mission slice, max 2 to 4 files touched.
2. No mixed concerns in one batch (preview, generation, claims each separate).
3. Every batch must include: objective, file scope, non-goals, validation steps, rollback note.
4. No schema or API contract expansion without updating acceptance cases first.