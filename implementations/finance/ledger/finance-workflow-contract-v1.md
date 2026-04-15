# Finance Workflow Contract v1 (Source-of-Truth Baseline)

Status: active baseline for Mission Step 1
Scope freeze date: 2026-04-15

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
- Student without active authorization creates one DEBIT entry on `student` with `rateSource: service_rate` and reason `service_rate_charge`.
- Student with active authorization uses split billing:
	- if `authorization.provider_track` exists, track pricing is authoritative:
		- `payment_mode = authorization.provider_track.payment_mode`
		- `studentCopay = authorization.provider_track.default_customer_charge_amount` for `partially_paid_by_hmo` only when that value is greater than zero
		- if `partially_paid_by_hmo` track customer charge is blank or `0`, fallback is `max(service.default_customer_charge_amount - authorization.contracted_rate_amount, 0)`
		- `studentCopay = 0` for `fully_paid_by_hmo`
		- `studentCopay = authorization.provider_track.default_customer_charge_amount || service.default_customer_charge_amount` for `fully_paid_by_customer`
		- `insurerClaim = authorization.contracted_rate_amount` for `partially_paid_by_hmo` and `fully_paid_by_hmo`
		- `insurerClaim = 0` for `fully_paid_by_customer`
		- `default_insurer_claim_amount` on the track is setup guidance and authorization seeding only; live billing still uses `authorization.contracted_rate_amount`
	- if no provider track is present, fallback remains `max(service.default_customer_charge_amount - authorization.contracted_rate_amount, 0)` for student copay
	- student DEBIT entry on `student` only if `studentCopay > 0`
	- insurer DEBIT entry on `hmo_provider` only if `insurerClaim > 0`
	- reason is `hmo_split_charge` when entries exist

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
	- when status becomes `attended` and active authorization exists, create dashboard task type `hmo_claim_submission`
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
	- billing: `billing_reversal`, `billing_charge`, `billing_update`, `billing_blocked`
	- payroll: `instructor_earning_reversal`, `instructor_earning_add`, `instructor_earning_update`
	- attendance: `instructor_attendance_remove`, `instructor_attendance_update`, `instructor_attendance_add`
	- hmo: `hmo_task_resolve`, `hmo_split_detail`
	- workflow: all others
- Preview exposes explicit student copay vs insurer claim split details from shared billing metadata and shows blocked billing reasons when preview cannot price the lesson.

## Explicit Non-Goals (Step 1)
- No behavior change in billing, payroll, attendance, HMO authorization, or task resolution logic.
- No API schema expansion yet.
- No UI rendering changes yet.
- No DB migration or table/index changes.

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
