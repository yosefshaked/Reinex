# Finance Workflow Acceptance Criteria v1

Status: active baseline for Mission Step 2
Depends on: implementations/finance/ledger/finance-workflow-contract-v1.md
Date: 2026-04-15

## Objective
Define machine-checkable Given/When/Then acceptance criteria for finance workflow behavior, without changing implementation behavior.

## Bounded File Set
- implementations/finance/ledger/finance-workflow-contract-v1.md
- api/_shared/BillingLedgerService.js
- api/calendar-attendance/index.js
- api/hmo-authorizations/index.js
- src/features/calendar/components/LessonInstanceDialog.jsx

## Expected Output Schema
Each criterion must be expressed with this structure:

- id: unique string
- scope: billing | attendance-preview | attendance-apply | hmo-authorization | frontend-preview | generation-preview | claims-read-model | release-hardening
- level: unit | integration | ui-integration
- given:
  - fixture state fields and values
- when:
  - function call or HTTP request (method, route, body, query)
- then:
  - exact assertions with equality or contains checks
  - optional db assertions

## Criteria

### Billing decision and ledger rules

#### AC-BILL-001
- scope: billing
- level: unit
- given:
  - participant.participant_status = attended
  - participant.client_profile_id = cp-1
  - participant.student_id = null
  - service.default_customer_charge_amount = 18000
  - authorization = null
  - policies.billingConsumptionPolicy.attended = true
- when:
  - call buildDesiredChargeDescriptors with participant, service, authorization, policies
- then:
  - result.status equals debited
  - result.billingStatus equals charged
  - result.billingReason equals direct_client_charge
  - result.entries length equals 1
  - result.entries[0].accountType equals client_profile
  - result.entries[0].amount equals 18000
  - result.entries[0].rateSource equals service_rate

#### AC-BILL-002
- scope: billing
- level: unit
- given:
  - participant.participant_status = attended
  - participant.client_profile_id = cp-1
  - participant.student_id = st-1
  - service.default_customer_charge_amount = 18000
  - authorization = null
  - policies.billingConsumptionPolicy.attended = true
- when:
  - call buildDesiredChargeDescriptors
- then:
  - result.status equals debited
  - result.billingReason equals service_rate_charge
  - result.entries length equals 1
  - result.entries[0].accountType equals student
  - result.entries[0].amount equals 18000
  - result.entries[0].rateSource equals service_rate

#### AC-BILL-003
- scope: billing
- level: unit
- given:
  - participant.participant_status = attended
  - participant.client_profile_id = cp-1
  - participant.student_id = st-1
  - service.default_customer_charge_amount = 18000
  - authorization.id = auth-1
  - authorization.provider_id = hmo-1
  - authorization.provider_track.payment_mode = partially_paid_by_hmo
  - authorization.provider_track.default_customer_charge_amount = 1000
  - authorization.contracted_rate_amount = 12000
  - policies.billingConsumptionPolicy.attended = true
- when:
  - call buildDesiredChargeDescriptors
- then:
  - result.status equals debited
  - result.billingReason equals hmo_split_charge
  - result.entries length equals 2
  - contains entry where accountType equals student and amount equals 1000 and rateSource equals hmo_authorization and hmoAuthorizationId equals auth-1
  - contains entry where accountType equals hmo_provider and amount equals 12000 and rateSource equals hmo_authorization and hmoAuthorizationId equals auth-1

#### AC-BILL-004
- scope: billing
- level: unit
- given:
  - participant.participant_status = attended
  - participant.client_profile_id = cp-1
  - participant.student_id = st-1
  - service.default_customer_charge_amount = 10000
  - authorization.id = auth-1
  - authorization.provider_id = hmo-1
  - authorization.provider_track.payment_mode = fully_paid_by_hmo
  - authorization.provider_track.default_customer_charge_amount = 0
  - authorization.contracted_rate_amount = 12000
  - policies.billingConsumptionPolicy.attended = true
- when:
  - call buildDesiredChargeDescriptors
- then:
  - result.status equals debited
  - result.billingReason equals hmo_split_charge
  - result.entries length equals 1
  - result.entries[0].accountType equals hmo_provider
  - result.entries[0].amount equals 12000

#### AC-BILL-005
- scope: billing
- level: unit
- given:
  - participant.participant_status = cancelled_clinic
  - participant.client_profile_id = cp-1
  - participant.student_id = st-1
  - service.default_customer_charge_amount = 18000
  - authorization = null
  - policies.billingConsumptionPolicy.cancelled_clinic = false
- when:
  - call buildDesiredChargeDescriptors
- then:
  - result.status equals noop
  - result.billingStatus equals not_chargeable
  - result.entries length equals 0

#### AC-BILL-006
- scope: billing
- level: unit
- given:
  - participant.participant_status = attended
  - participant.client_profile_id = null
  - participant.student_id = st-1
  - service.default_customer_charge_amount = 18000
  - policies.billingConsumptionPolicy.attended = true
- when:
  - call buildDesiredChargeDescriptors
- then:
  - result.status equals blocked
  - result.billingReason equals missing_client_profile_id
  - result.warnings contains missing_client_profile_id

#### AC-BILL-007
- scope: billing
- level: integration
- given:
  - lesson participant has existing open lesson charge signature that exactly matches desired descriptor signature
- when:
  - call BillingLedgerService.syncLessonParticipantCharge
- then:
  - result.status equals noop
  - result.createdTransactionIds length equals 0
  - result.reversedTransactionIds length equals 0

#### AC-BILL-008
- scope: billing
- level: integration
- given:
  - lesson participant has existing open lesson charge that differs from desired descriptor
- when:
  - call BillingLedgerService.syncLessonParticipantCharge
- then:
  - result.status equals reversed_and_debited or reversed_only or debited
  - if any reversed rows exist, db contains inserted reversal rows where source_type equals reversal and reverses_transaction_id is not null
  - if any new desired rows exist, db contains inserted lesson_charge rows where source_type equals lesson_charge

### Attendance preview criteria

#### AC-PREVIEW-001
- scope: attendance-preview
- level: integration
- given:
  - existing participant status is scheduled
  - request target_participant_status is attended
- when:
  - POST api/calendar-attendance with body:
    - action = preview-participant-status-change
    - org_id, instance_id, participant_id, target_participant_status
- then:
  - response status equals 200
  - response has participant_id, participant_status_before, participant_status_after
  - response.impacts is an array
  - response.projected has billing_amount_before and billing_amount_after fields

#### AC-PREVIEW-002
- scope: attendance-preview
- level: integration
- given:
  - existing participant status is attended
  - request target_participant_status is scheduled
- when:
  - POST api/calendar-attendance with body:
    - action = preview-restore-to-scheduled
    - org_id, instance_id, participant_id
- then:
  - response status equals 200
  - response.participant_status_after equals scheduled
  - if open hmo_claim_submission dashboard task exists for participant, response.impacts contains type hmo_task_resolve

#### AC-PREVIEW-003
- scope: attendance-preview
- level: integration
- given:
  - participant status target is no_show
  - policy requires explicit instructor compensation decision for no_show
  - request omits instructor_compensation_decision
- when:
  - apply mutation action that changes participant_status to no_show
- then:
  - response status equals 400
  - response.code equals missing_instructor_compensation_decision

#### AC-PREVIEW-005
- scope: attendance-preview
- level: integration
- given:
  - status transitions are tested for attended, no_show, cancelled_student, and restore_to_scheduled
  - each transition is evaluated with and without active authorization where applicable
- when:
  - preview and supporting helper assertions are executed in automated tests
- then:
  - attended with authorization includes explicit HMO split details
  - no_show excluded by policy is not chargeable
  - cancelled_student included by policy is chargeable
  - restore_to_scheduled includes HMO task resolution signal only when an open HMO claim task exists

#### AC-PREVIEW-004
- scope: attendance-preview
- level: integration
- given:
  - participant has active HMO authorization for lesson service/date
  - preview action target_participant_status is attended
- when:
  - POST api/calendar-attendance with body:
    - action = preview-participant-status-change
    - org_id, instance_id, participant_id, target_participant_status
- then:
  - response status equals 200
  - response.projected.hmo_split_applied equals true
  - response.projected.hmo_authorization_id is not null
  - response.projected.hmo_provider_name is not null
  - response.projected.hmo_student_copay_amount is a number
  - response.projected.hmo_insurer_claim_amount is a number
  - response.projected.hmo_contracted_rate_amount is a number
  - response.impacts contains type hmo_split_detail
  - that hmo_split_detail impact includes hmo_authorization_id, hmo_provider_name, hmo_student_copay_amount, hmo_insurer_claim_amount

### Attendance apply and claim flow criteria

#### AC-APPLY-001
- scope: attendance-apply
- level: integration
- given:
  - valid mutation request updates participant_status
- when:
  - POST api/calendar-attendance mutation
- then:
  - billing sync is invoked via syncLessonInstanceCharges
  - instructor earnings sync is invoked via syncLessonInstructorEarnings
  - instructor attendance sync is invoked via syncInstructorAttendanceFromLessons
  - on sync error response status equals 500 and message equals failed_to_sync_financial_artifacts

#### AC-APPLY-002
- scope: attendance-apply
- level: integration
- given:
  - participant status changes to attended
  - participant has active authorization for instance service/date
- when:
  - POST api/calendar-attendance mutation
- then:
  - dashboard task exists with task_type equals hmo_claim_submission
  - task.resource_type equals lesson_participant
  - task.resource_id equals participant_id

#### AC-APPLY-003
- scope: attendance-apply
- level: integration
- given:
  - participant status changes to scheduled
  - open dashboard task exists with task_type equals hmo_claim_submission for participant
- when:
  - POST api/calendar-attendance mutation
- then:
  - task is resolved
  - resolved metadata contains resolved_by_restore_to_scheduled = true

### HMO authorization coupling criteria

#### AC-HMOAUTH-001
- scope: hmo-authorization
- level: integration
- given:
  - POST payload has student_id, provider_id, provider_track_id, authorized_lessons > 0
- when:
  - POST api/hmo-authorizations
- then:
  - response status equals 201
  - resyncAuthorizationWindow is called with reasonCode authorization_created

#### AC-HMOAUTH-002
- scope: hmo-authorization
- level: integration
- given:
  - PUT payload has id and valid authorization fields
- when:
  - PUT api/hmo-authorizations
- then:
  - response status equals 200
  - resyncAuthorizationWindow is called with reasonCode authorization_updated

#### AC-HMOAUTH-003
- scope: hmo-authorization
- level: integration
- given:
  - DELETE payload has id
- when:
  - DELETE api/hmo-authorizations
- then:
  - response status equals 200
  - response.deleted equals true
  - resyncAuthorizationWindow is called with reasonCode authorization_cancelled

### Frontend preview consumption criteria

#### AC-UI-PREVIEW-001
- scope: frontend-preview
- level: ui-integration
- given:
  - user opens lesson participant preview action
- when:
  - openAttendancePreview is called with targetStatus attended
- then:
  - request action equals preview-participant-status-change
  - payload includes org_id, instance_id, participant_id, target_participant_status

#### AC-UI-PREVIEW-002
- scope: frontend-preview
- level: ui-integration
- given:
  - restore preview is displayed with impacts from server
- when:
  - groupPreviewImpacts processes impacts array
- then:
  - impact type billing_reversal groups under billing
  - impact type instructor_earning_update groups under payroll
  - impact type instructor_attendance_update groups under attendance
  - impact type hmo_task_resolve groups under hmo

#### AC-UI-PREVIEW-003
- scope: frontend-preview
- level: ui-integration
- given:
  - preview response contains impacts entry with type hmo_split_detail
  - preview response projected.hmo_split_applied equals true
- when:
  - dialog renders restore preview section
- then:
  - impact type hmo_split_detail is grouped under hmo
  - UI renders provider, track, authorization id, student copay, insurer claim amount, contracted rate from server fields
  - UI does not recompute billing split values from service rate on client

### HMO setup and authorization UI criteria

#### AC-UI-SETUP-001
- scope: frontend-preview
- level: ui-integration
- given:
  - admin opens HmoSetupWorkspace to create or edit an HMO provider track
  - track.payment_mode = fully_paid_by_hmo
- when:
  - form renders with payment mode selected
- then:
  - customer charge field is disabled and locked to value ₪0.00
  - helper text reads: "ננעל על ₪0.00 כי במסלול זה הלקוח לא מחויב."
  - default_customer_charge_amount submitted as 0 regardless of previous value
  - billing ledger will charge student ₪0

#### AC-UI-SETUP-002
- scope: frontend-preview
- level: ui-integration
- given:
  - admin opens HmoSetupWorkspace to create or edit an HMO provider track
  - track.payment_mode = partially_paid_by_hmo
- when:
  - form renders with payment mode selected
- then:
  - customer charge field is enabled and allows empty/zero value
  - helper text reads: "השאירו ריק כדי לחשב אוטומטית: תעריף השירות פחות התעריף החוזי שבאישור. הזינו סכום רק אם ההשתתפות העצמית קבועה."
  - when saved with blank customer charge: buildDesiredChargeDescriptors will derive copay as max(service_rate - contracted_rate, 0)
  - when saved with positive customer charge: that fixed amount is used instead of derived formula
  - track summary shows "מחושב אוטומטית לפי תעריף השירות פחות התעריף החוזי" when customer charge is zero/blank

#### AC-UI-SETUP-003
- scope: frontend-preview
- level: ui-integration
- given:
  - admin opens HmoSetupWorkspace to create or edit an HMO provider track
  - track.payment_mode = fully_paid_by_customer
- when:
  - form renders with payment mode selected
- then:
  - insurer claim field is disabled and locked to value ₪0.00
  - helper text reads: "ננעל על ₪0.00 כי במסלול זה אין חיוב לגורם מממן."
  - customer charge field is enabled and allows empty/zero value to fallback to service_rate
  - default_insurer_claim_amount submitted as 0 regardless of previous value
  - billing ledger will charge hmo_provider ₪0

#### AC-UI-AUTH-001
- scope: frontend-preview
- level: ui-integration
- given:
  - admin opens HmoAuthorizationManager to create or edit student authorization
  - form.providerTrackId is selected
  - selectedService is resolved from track.service_id and services list
  - form.contractedRateAmount is a valid positive number
  - selectedTrack.payment_mode is one of (fully_paid_by_hmo, partially_paid_by_hmo, fully_paid_by_customer)
- when:
  - form renders split preview section
- then:
  - UI displays split preview with columns: service_rate, student_copay, insurer_claim
  - service_rate is coerceAgorot(selectedService.default_customer_charge_amount)
  - split calculation respects selectedTrack.payment_mode:
    - fully_paid_by_hmo: student 0, insurer contracted_rate, helper "במסלול זה הלקוח לא מחויב..."
    - partially_paid_by_hmo: student is fixed track amount if positive, else max(serviceRate - contractedRate, 0), insurer contracted_rate, helper "השתתפות הלקוח תחושב אוטומטית..."
    - fully_paid_by_customer: student is fixed track amount or service_rate, insurer 0, helper "במסלול זה אין חיוב לגורם מממן..."
  - UI warns if contracted_rate > service_rate only for partially_paid_by_hmo mode

#### AC-UI-AUTH-002
- scope: frontend-preview
- level: ui-integration
- given:
  - split preview is rendered with contractedRateAmount = 0 or empty
- when:
  - form is incomplete
- then:
  - split preview is hidden (returns null) when hmoShare or serviceRate is missing for the payment mode
  - form validation prevents save until contracted_rate_amount is valid positive number

### Generation preview criteria

#### AC-GEN-001
- scope: generation-preview
- level: integration
- given:
  - manual generation preview has candidate proposals with student_id and service_id
  - at least one candidate has no active authorization coverage on target date
- when:
  - POST api/calendar-generate with dry_run=true for date range
- then:
  - response status equals 200
  - response.summary.hmo_coverage_warnings is a number
  - response.warnings includes one or more entries of type hmo_authorization_gap
  - response.warnings entries include reason and target_date
  - generation remains non-blocking: warnings do not prevent proposals from appearing in to_insert_instances

#### AC-GEN-002
- scope: generation-preview
- level: integration
- given:
  - candidate proposal has active authorization that covers target date
- when:
  - build warning evaluation for the candidate
- then:
  - no hmo_authorization_gap warning is produced for that candidate

#### AC-GEN-003
- scope: generation-preview
- level: ui-integration
- given:
  - manual generation preview response includes summary.hmo_coverage_warnings > 0
  - response.warnings contains hmo_authorization_gap entries
- when:
  - ManualGenerationDialog renders preview results
- then:
  - UI shows warning count from summary.hmo_coverage_warnings
  - UI shows actionable grouped reason counts
  - UI lists warning rows with reason, student_id, service_id, and target_date
  - warnings do not disable apply action by themselves

### Claims read model criteria

#### AC-CLAIMS-001
- scope: claims-read-model
- level: integration
- given:
  - billing endpoint receives GET request with query view=hmo_claims and org_id
  - dashboard task and ledger artifacts exist
- when:
  - GET api/billing?view=hmo_claims is requested
- then:
  - response status equals 200
  - response contains summary with total_claim_tasks, open_claim_tasks, resolved_claim_tasks, unique_students, provider_count
  - response contains claims array derived from hmo_claim_submission tasks
  - response contains provider_receivables array derived from HMO provider receivables snapshots
  - endpoint remains read-only (no mutation side effects)

#### AC-CLAIMS-002
- scope: claims-read-model
- level: ui-integration
- given:
  - FinancialsPage loads claims read model from billing view=hmo_claims
- when:
  - user opens the HMO claims tab
- then:
  - UI shows claims summary cards
  - UI lists claim rows with student name, service/date, provider, and status
  - UI lists provider receivables (balance, receivable_total, payment_total, open invoice count)
  - view is informational/read-only with no payment mutation actions in this step

#### AC-CLAIMS-003
- scope: claims-read-model
- level: integration
- given:
  - admin user submits POST billing action record_hmo_claim_payment with hmo_provider_id and positive amount
- when:
  - billing mutation endpoint handles record_hmo_claim_payment
- then:
  - ledger credit is appended via BillingLedgerService.appendManualCredit using account_type hmo_provider
  - source_type is hmo_invoice_payment
  - response includes transaction_id and resolved_task_count
  - if resolve_open_claim_tasks is true, matching open hmo_claim_submission tasks for the provider are resolved

#### AC-CLAIMS-004
- scope: claims-read-model
- level: ui-integration
- given:
  - claims tab exposes controlled payment form to admin users
  - payment mutation succeeds
- when:
  - user records payment from claims view
- then:
  - claims read model refreshes from GET view=hmo_claims
  - provider receivables reflect updated ledger balance/payment totals
  - open claim task counts decrease when task resolution is enabled

### Release hardening criteria

#### AC-REL-001
- scope: release-hardening
- level: integration
- given:
  - a finance behavior-changing batch is marked ready for release
  - acceptance criteria ids and test commands are available
- when:
  - release hardening pass 1 and pass 2 are executed
- then:
  - pass 1 maps changed behavior to one or more AC ids with evidence
  - pass 2 confirms non-goals and coupling invariants are unchanged
  - unresolved high-severity findings block rollout

#### AC-REL-002
- scope: release-hardening
- level: integration
- given:
  - release candidate includes mission steps 1 through 9 outputs
- when:
  - staged rollout checklist is executed
- then:
  - pre-prod checks pass (tests, diagnostics, API anchor checks)
  - initial rollout is scoped and monitored
  - rollback path references immutable ledger correction policy (reverse then append, no direct edits)

## Explicit Non-Goals
- No behavior refactor or bug fix in this step.
- No contract expansion beyond v1 baseline.
- No schema changes.

## Verification Command Set
1. Validate this file includes all mission-critical domains:
   - billing split
   - attendance preview
   - attendance apply sync
   - hmo authorization resync
   - frontend preview grouping
2. Validate each criterion has id, scope, level, given, when, then.
3. Validate key reason and impact tokens match implementation anchors:
   - direct_client_charge
   - service_rate_charge
   - hmo_split_charge
   - hmo_claim_submission
   - hmo_task_resolve

## Rollback Note
Documentation-only step. Rollback by reverting this file and resetting Step 2 status in implementation-to-do.md.
