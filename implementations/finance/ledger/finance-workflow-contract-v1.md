# Finance Workflow Contract v1 (Source-of-Truth Baseline)

Status: active baseline
Scope freeze date: 2026-04-19

## Objective
Freeze the current cross-domain finance workflow contract so all AI agents implement from one authoritative behavior baseline before any feature edits.

## Bounded File Set (Authoritative Sources)
- `api/_shared/BillingLedgerService.js`
- `api/calendar-attendance/index.js`
- `api/hmo-authorizations/index.js`
- `src/features/calendar/components/LessonInstanceDialog.jsx`

## Expected Output Schema (Contract Shape)
This contract defines current behavior only.

```ts
type FinanceWorkflowContractV1 = {
	billingDecisionRules: {
		participantStatusesThatCanBill: string[];
		directClientRule: {
			appliesWhen: string;
			accountType: "client_profile";
			direction: "DEBIT";
			rateSource: "service_rate";
		};
		studentNoAuthorizationRule: {
			appliesWhen: string;
			accountType: "student";
			direction: "DEBIT";
			rateSource: "service_rate";
		};
		studentWithAuthorizationRule: {
			appliesWhen: string;
			studentCopayFormula: string;
			hmoClaimFormula: string;
			trackDefaultsMeaning: string[];
			rateSource: "hmo_authorization";
		};
	};
	ledgerMutationRules: {
		writeModel: "append_only";
		updateModel: "reverse_then_append";
		blockedReasons: string[];
		syncResultStatuses: string[];
	};
	attendanceCouplingRules: {
		previewActions: string[];
		onApplySyncSequence: string[];
		hmoTaskCreationTrigger: string;
		hmoTaskResolveTrigger: string;
	};
	authorizationCouplingRules: {
		createUpdateDeleteResync: boolean;
		resyncScope: string;
	};
	frontendPreviewConsumptionRules: {
		actionEndpoints: string[];
		impactGrouping: Record<string, string>;
		currentHmoPreviewLimitation: string;
	};
};
```

## Contract Details

### 1) Billing decision rules (current behavior)
Source: `api/_shared/BillingLedgerService.js`

- Billable participant statuses are resolved from finance policy and resolved statuses; non-billable statuses return `not_chargeable` with no entries.
- If service default charge is missing, the result is blocked: `missing_service_default_customer_charge_amount`.
- If participant has no `client_profile_id`, the result is blocked: `missing_client_profile_id`.
- One-time customer path (`!student_id`) creates one DEBIT entry on `client_profile` with `rateSource: service_rate` and reason `direct_client_charge`.
- Student without matching active coverage creates one DEBIT entry on `student` with `rateSource: service_rate` and reason `service_rate_charge`.
- Student coverage is resolved only through `resolveLessonCoverageDecision(...)` in `api/_shared/hmo.js`.
- `covered`:
	- live covered pricing comes from the explicit authorization snapshot:
		- `covered_customer_charge_amount`
		- `covered_insurer_claim_amount`
	- student DEBIT entry on `student` only if the covered customer amount is greater than `0`
	- insurer DEBIT entry on `hmo_provider` only if the covered insurer amount is greater than `0`
	- reason is `covered_hmo_charge`
- `post_coverage`:
	- applies only when a matching active in-range authorization has no remaining entitlement
	- `post_coverage_policy = service_default` charges the service list price on `student`
	- `post_coverage_policy = explicit_customer_charge` charges `post_coverage_customer_charge_amount` on `student`
	- `post_coverage_policy = manual_block` blocks billing with `authorization_exhausted_manual_block`
- `blocked`:
	- used for explicit coverage-data conflicts/failures such as `authorization_conflict`, `missing_authorization_pricing`, and `missing_post_coverage_policy`
- `authorized_lessons` is enforced dynamically from active ledger rows that carry `hmo_authorization_id`; reversing covered rows restores entitlement
- no billing path may derive student copay from `service default - insurer amount`

### 2) Ledger mutation rules (current behavior)
Source: `api/_shared/BillingLedgerService.js`

- Ledger model is append-only; existing open lesson charges are not updated in place.
- If desired signature equals existing signature, sync is `noop`.
- If changes are needed:
	- existing `lesson_charge` rows are reversed via new `reversal` rows
	- new `lesson_charge` rows are appended for desired state
- Participant sync statuses returned by service include: `blocked`, `noop`, `debited`, `reversed_only`, `reversed_and_debited`.
- Instance sync aggregates participant results into:
	- `createdTransactionCount`
	- `reversedTransactionCount`
	- `blockedParticipantIds`

### 3) Attendance coupling rules (current behavior)
Source: `api/calendar-attendance/index.js`

- Preview actions:
	- `preview-restore-to-scheduled`
	- `preview-participant-status-change`
- Preview payload includes projected impacts across:
	- participant status
	- lesson status
	- billing amount change
	- instructor earnings change
	- instructor attendance change
	- pending HMO task resolution on restore
- Applying attendance mutation triggers this sync sequence (after participant/instance updates):
	1. `billingService.syncLessonInstanceCharges(...)`
	2. `syncLessonInstructorEarnings(...)`
	3. `syncInstructorAttendanceFromLessons(...)`
- HMO claim task workflow:
	- when status becomes `attended` and coverage resolves to `covered`, create dashboard task type `hmo_claim_submission`
	- when status becomes `scheduled`, open `hmo_claim_submission` task is resolved

### 4) HMO authorization coupling rules (current behavior)
Source: `api/hmo-authorizations/index.js`

- Authorization create (`POST`) and update (`PUT`) both call:
	- `billingService.resyncAuthorizationWindow({ hmoAuthorizationId, reasonCode })`
- Authorization cancel (`DELETE` via status update to `cancelled`) also calls the same resync method.
- Resync scope is constrained to lesson participants for:
	- same `student_id`
	- same `service_id`
	- lesson datetime within authorization window (`valid_from`..`expires_at` if present)

### 5) Frontend preview consumption rules (current behavior)
Source: `src/features/calendar/components/LessonInstanceDialog.jsx`

- Frontend calls `calendar/attendance` preview actions via `openAttendancePreview(...)`.
- Preview impacts are grouped by type into UI domains:
	- billing: `billing_reversal`, `billing_charge`, `billing_update`, `billing_blocked`, `post_coverage_charge`
	- payroll: `instructor_earning_reversal`, `instructor_earning_add`, `instructor_earning_update`
	- attendance: `instructor_attendance_remove`, `instructor_attendance_update`, `instructor_attendance_add`
	- hmo: `hmo_task_resolve`, `hmo_split_detail`
	- workflow: all others
- Preview exposes explicit covered customer vs insurer split details from shared billing metadata, surfaces `post_coverage_charge` when entitlement is exhausted, and shows blocked billing reasons when preview cannot price the lesson.

## Explicit Non-Goals
- No full generic `tracks/authorizations` migration outside the HMO domain.
- No automatic resolution of overlapping active authorizations.
- No fallback copay derivation from service price minus insurer amount.

## Verification Command Set (Step 1)
Use these checks to verify this contract remains mapped to code before Step 2+ edits:

1. Confirm all anchor functions still exist:
	 - `buildDesiredChargeDescriptors`
	 - `syncLessonInstanceCharges`
	 - `resyncAuthorizationWindow`
	 - `buildParticipantStatusPreview`
	 - `openAttendancePreview`

2. Confirm attendance apply path still syncs billing + earnings + attendance.

3. Confirm authorization create/update/delete still invoke resync.

4. Confirm preview impact grouping still maps HMO task impact type.

## Rollback Note
This artifact is documentation-only. Rollback is to remove or replace this contract file if future code-level discovery shows a mismatch.

## Implementation Guidance For AI Agents
- Treat this file as read-only baseline until Step 2 acceptance criteria are committed.
- Any agent proposing behavior that conflicts with this contract must raise a change request first (do not silently alter behavior assumptions).
