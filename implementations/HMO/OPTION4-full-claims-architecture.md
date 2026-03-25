# HMO Option 4 Future Claims Architecture

## Goal
Option 4 is the full claims system that would sit on top of the current option 3 baseline. The target is not only to model providers, tracks, and authorizations, but also to manage the full month-end and post-submission lifecycle:
- claim preparation
- submission
- remittance
- reconciliation
- denial handling
- auditability

## Why Option 3 Is Not Enough
Option 3 solves operational billing and authorization-backed charging, but it does not create first-class records for:
- which lessons were sent in which submission batch
- whether the claim was submitted, accepted, partially paid, denied, or reopened
- how remittance was matched back to claim lines
- how underpayments, denials, and resubmissions were tracked

That means option 3 is the correct base, but not the full financial claims workflow.

## Target Domain Model

### 1. Provider Contracts
- `hmo_provider_contracts`
- Stores contract-specific rules over time:
  - valid-from / valid-to
  - payment mode defaults
  - billing deadlines
  - claim submission method
  - required references
  - reminder cadence

### 2. Claim Batches
- `hmo_claim_batches`
- One operational submission unit, usually monthly.
- Fields should include:
  - provider_id
  - contract_id
  - period_start
  - period_end
  - status
  - prepared_at
  - submitted_at
  - submitted_by
  - submission_reference
  - notes

### 3. Claim Lines
- `hmo_claim_lines`
- One billable lesson or billable event inside a batch.
- Fields should include:
  - batch_id
  - authorization_id
  - lesson_participant_id
  - lesson_instance_id
  - student_id
  - service_id
  - date_of_service
  - billed_amount
  - patient_amount
  - insurer_amount
  - status
  - denial_code
  - denial_notes

### 4. Remittance Records
- `hmo_remittances`
- Represents money or explanation-of-benefits coming back from the provider.
- Fields should include:
  - provider_id
  - contract_id
  - remittance_reference
  - received_at
  - total_amount
  - currency
  - raw_attachment / document link
  - notes

### 5. Remittance Line Matches
- `hmo_remittance_lines`
- Links remittance money back to specific claim lines.
- Fields should include:
  - remittance_id
  - claim_line_id
  - approved_amount
  - paid_amount
  - denied_amount
  - adjustment_reason
  - denial_reason

## Workflow

### Phase A: Claim Preparation
- Filter chargeable HMO-backed lessons for a provider and period.
- Exclude already-batched lines.
- Group into a prepared batch.
- Allow finance staff to review and remove incorrect lines before submission.

### Phase B: Submission
- Mark the batch as submitted.
- Store:
  - submission timestamp
  - human reference number
  - exported CSV/PDF artifact
  - operator

### Phase C: Remittance
- Record remittance receipt.
- Import or enter line results.
- Match remittance lines to claim lines.

### Phase D: Reconciliation
- Calculate:
  - billed vs paid
  - open vs settled
  - denied vs partially paid
- Surface unresolved claim lines in the finance dashboard.

### Phase E: Recovery
- Support:
  - resubmission
  - manual write-off
  - appeal
  - correction

## UI Surfaces Required
- Provider contracts page
- Claim preparation queue
- Batch review screen
- Submission history screen
- Remittance intake screen
- Reconciliation dashboard
- Denial / resubmission work queue

## Execution Plan

### Step 1. Stabilize Option 3
- Keep provider / track / authorization as the source of service eligibility and pricing.
- Ensure every claimable lesson can be traced to one authorization and one provider track snapshot.

### Step 2. Introduce Claim Tables
- Add:
  - `hmo_provider_contracts`
  - `hmo_claim_batches`
  - `hmo_claim_lines`
  - `hmo_remittances`
  - `hmo_remittance_lines`
- Keep them additive and non-destructive.

### Step 3. Add Batch Preparation
- Build a finance workflow that creates claim batches from charged HMO lessons.
- Prevent duplicate batching of the same lesson.

### Step 4. Add Submission State
- Track prepared / submitted / accepted / partially paid / denied / closed.
- Save export artifacts and references.

### Step 5. Add Remittance and Reconciliation
- Import remittance results.
- Match to claim lines.
- Compute settlement and open balances.

### Step 6. Add Recovery Flows
- Resubmission queue
- Manual closure / write-off
- Denial categorization

## Acceptance Criteria For Option 4
- Every billed HMO lesson can be traced from authorization to claim line to remittance line.
- Monthly submission batches are reviewable and reproducible.
- Paid, denied, and open amounts are visible without spreadsheet reconstruction.
- Partial payments and denials can be handled without mutating historical lesson billing.
- Finance staff can explain the state of every HMO-backed lesson from one system workflow.

## Recommendation
Do not build option 4 before option 3 is stable in production data. Option 4 should be implemented as a second phase that reuses option 3 entities rather than replacing them.
