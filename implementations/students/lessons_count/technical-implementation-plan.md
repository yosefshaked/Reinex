# Student Lessons Count - Technical Implementation Plan

Status: planned
Owner: AI dev team
Created: 2026-04-27
Primary domains: students / finance / calendar / HMO

## 1. Purpose

This document is the source of truth for fixing and redesigning "lessons left" behavior in student-facing billing surfaces.

The current behavior is not reliable enough for production use because the displayed remaining-lessons counts are still tied to legacy commitment-usage assumptions and do not correctly reflect the live lesson lifecycle in the calendar.

This implementation must:

- make remaining-lessons counts consistent with the current lesson-instance and attendance model
- split ambiguous "lessons left" into operationally clear buckets
- preserve financial correctness
- avoid counting HMO no-shows as insurer-consumed lessons
- remain understandable to office staff and instructors

This plan must be followed instead of relying on AI memory.

If implementation reveals a direct contradiction between this plan and the real code/files listed here, the implementer may amend the plan only after documenting:

- what was incorrect in the plan
- what file/code reality proved otherwise
- what replacement decision was adopted

Do not silently diverge.

---

## 2. Mandatory Reading Before Any Code

Every implementer must read these files before editing code:

- `AGENTS.md`
- `agents-docs/40-students-and-clients.md`
- `agents-docs/60-calendar-and-sessions.md`
- `agents-docs/80-finance-billing-payroll.md`
- `implementations/finance/ledger/finance-workflow-contract-v1.md`
- `src/features/students/components/StudentBillingWorkspace.jsx`
- `api/billing/index.js`
- `api/_shared/commitment-behavior.js`
- `api/_shared/BillingLedgerService.js`
- `api/_shared/hmo.js`
- `api/_shared/employee-finance.js`
- `src/lib/setup-sql.js`

If any of those files materially change during implementation, re-read the affected section before continuing.

---

## 3. Problem Statement

### 3.1 Current user-facing problem

In the student pages, the displayed amount of lessons left in a package/HMO authorization is not updating correctly.

The count needs to reflect:

- scheduled lessons
- occurred lessons
- reversals/corrections
- the different meaning of "consumed" for standard commitments versus HMO authorizations

### 3.2 Current technical problem

The current runtime in `api/_shared/commitment-behavior.js` still derives lesson usage from legacy commitment/entry semantics:

- it groups lesson usage via `usage_type` / `source_type`
- it counts `consumed_lessons`
- it does not model the modern lesson lifecycle directly from `lesson_participants` + `lesson_instances` + current attendance semantics

This is incompatible with the current architecture, where:

- lesson truth lives in `lesson_instances` and `lesson_participants`
- billing truth lives in append-only `ledger_transactions`
- HMO entitlement truth lives in `hmo_authorizations`
- calendar attendance changes trigger billing and HMO workflow side-effects

The UI therefore shows a count that looks authoritative but is based on stale assumptions.

---

## 4. Decisions Already Locked

These decisions are approved for this implementation unless a documented amendment is added later in this file.

| # | Decision | Detail |
|---|----------|--------|
| 1 | No generic "lessons left" only | Replace ambiguous single count with explicit buckets |
| 2 | Use 3 buckets everywhere possible | `נוצלו`, `מתוכננים`, `זמינים לקביעת תור` |
| 3 | HMO no-show does not consume HMO entitlement | Hard-coded for now |
| 4 | HMO no-show, if billable by org policy, charges regular student/service pricing | Not HMO covered pricing |
| 5 | HMO should also show the same 3 buckets | Not just remaining count |
| 6 | Claim/payment workflow must not change lesson entitlement counts | Claims are workflow metadata, not entitlement truth |
| 7 | Fixes are allowed only when the plan is proven wrong by code | Amend the plan explicitly before diverging |

---

## 5. Clarified Business Rules

### 5.1 There is no separate package-level "billable-from-package" toggle today

The current codebase does not expose a dedicated package-specific "consume from package" switch.

What exists today is org-level `billing_consumption_policy`, which is status-based:

- `attended`
- `no_show`
- `cancelled_student`
- `cancelled_clinic`

This policy governs whether a resolved lesson status is billable.

It does not independently distinguish:

- "bill the student"
- "consume package entitlement"
- "consume HMO entitlement"

This implementation must therefore formalize those distinctions in runtime logic, not by pretending a missing setting already exists.

### 5.2 HMO no-show rule

For this implementation:

- `no_show` does not consume HMO authorized lessons
- `no_show` does not create HMO claimable usage
- if the org bills `no_show`, it bills the student/private side using the regular service pricing path
- HMO covered pricing (`covered_customer_charge_amount`, `covered_insurer_claim_amount`) must not be used for HMO no-show consumption

### 5.3 HMO should expose the same 3 operational counts

HMO authorization display must show:

- `נוצלו`
- `מתוכננים`
- `זמינים לקביעת תור`

This is required because a single remaining count is operationally misleading.

---

## 6. Target Product Model

The display model must distinguish three quantities:

### 6.1 `Consumed lessons`

Lessons that have already used real entitlement.

Meaning:

- For package/subscription: lessons that consumed package/subscription lesson allowance
- For HMO: lessons that consumed HMO authorization allowance

### 6.2 `Reserved lessons`

Future scheduled lessons that are expected to use entitlement if not changed before occurrence.

Meaning:

- the lesson is in the calendar
- it is still relevant for future capacity planning
- it should reduce "available to book"
- it is not yet fully consumed

### 6.3 `Available to book`

The operationally safe number for more scheduling.

Formula:

- `available = total_authorized - consumed - reserved`

Never show this as a hidden/internal concept only.

For staff UX, this is the number that matters most for booking decisions.

---

## 7. Rule Matrix

This matrix is the contract for counting logic.

### 7.1 Package / subscription commitments

| Participant status | Future/past | Billable by policy? | Consumed? | Reserved? | Notes |
|---|---|---:|---:|---:|---|
| `scheduled` | future | not relevant yet | no | yes | Holds capacity only |
| `attended` | occurred | yes | yes | no | Standard consumption |
| `no_show` | occurred | no | no | no | No billing, no consumption |
| `no_show` | occurred | yes | yes | no | Billed missed lesson consumes package/subscription |
| `cancelled_student` | future/past | no | no | no | Releases slot |
| `cancelled_student` | occurred-like edge case | yes | yes | no | Only if org policy explicitly bills this status |
| `cancelled_clinic` | any | no | no | no | Clinic cancellation never consumes |

### 7.2 HMO authorizations

| Participant status | Future/past | Billable by policy? | Consumed HMO? | Reserved HMO? | Student charge path |
|---|---|---:|---:|---:|---|
| `scheduled` | future | not relevant yet | no | yes | None yet |
| `attended` + covered | occurred | yes | yes | no | Covered customer + insurer split |
| `attended` + post-coverage | occurred | yes | no | no | Student post-coverage pricing only |
| `attended` + no authorization | occurred | yes | no | no | Standard student/service pricing |
| `no_show` | occurred | no | no | no | No billing |
| `no_show` | occurred | yes | no | no | Standard student/service pricing, not HMO |
| `cancelled_student` | any | no | no | no | Releases reservation |
| `cancelled_student` | occurred-like edge case + billable | yes | no | no | Student/service pricing only |
| `cancelled_clinic` | any | no | no | no | Releases reservation |

### 7.3 Global correction rules

- Reversing an attended lesson must restore consumed entitlement
- Cancelling a future scheduled lesson must restore reserved entitlement
- Changing `scheduled -> attended` must move the lesson from reserved to consumed
- Changing `scheduled -> no_show` must:
  - remove reservation
  - then apply status-specific consumption rule
- Claim submission, claim cancellation, and claim payment do not change consumed/reserved counts

---

## 8. Source-of-Truth Design

### 8.1 What must stop being used as the primary count source

Do not continue using the current legacy `groupLessonUsage(entries)` model as the primary source for lessons-consumed display.

It is still useful as a compatibility layer for some commitment runtime output, but not as the entitlement truth for this feature.

### 8.2 What must become the primary count source

Primary counting source:

- `lesson_participants`
- joined `lesson_instances`
- matched commitment or matched HMO authorization decision

Supporting source:

- `ledger_transactions` only where needed to confirm actual covered HMO usage semantics or active billing state

### 8.3 HMO-specific truth source

For HMO:

- consumed entitlement must align with actual covered-authorization usage semantics
- reserved entitlement must be derived from future scheduled lessons that would resolve to the active authorization if they occurred now
- post-coverage and standard-uncovered lessons must not consume HMO entitlement

This must remain consistent with `resolveLessonCoverageDecision(...)` in `api/_shared/hmo.js`.

---

## 9. Required Output Shape

The student billing/read model must return explicit lesson-count sections instead of only implicit remaining values.

### 9.1 Commitment/package/subscription output

At minimum:

```ts
{
  total_authorized_lessons: number | null,
  consumed_lessons: number | null,
  reserved_lessons: number | null,
  available_lessons_to_book: number | null
}
```

For package lines:

```ts
package_items: [
  {
    service_id: string,
    lessons_count: number,
    consumed_lessons: number,
    reserved_lessons: number,
    available_lessons_to_book: number
  }
]
```

### 9.2 HMO output

At minimum:

```ts
{
  authorized_lessons: number,
  consumed_lessons: number,
  reserved_lessons: number,
  available_lessons_to_book: number
}
```

### 9.3 UI labels

UI must use Hebrew labels aligned with the approved product language:

- `נוצלו`
- `מתוכננים`
- `זמינים לקביעת תור`

Avoid exposing only one "נותרו" number where it can be misread.

---

## 10. Execution Plan

Each step must be completed in order unless a documented amendment is added.

For every step:

- update the `Step Status` table below
- record files changed
- record what actually differed from the plan, if anything

### Step 0 - Baseline audit

Goal:

- confirm every current place in the repo that displays or derives lesson-balance counts

Required checks:

- `StudentBillingWorkspace`
- any student overview/detail cards
- any billing API output for student commitments
- any HMO authorization manager displays

Deliverables:

- exact list of current count fields
- exact list of current consuming code paths

### Step 1 - Introduce lesson-count rule helpers

Goal:

- create a new shared backend helper layer for lesson-count semantics

Requirements:

- separate `consumed`, `reserved`, `available`
- support package, subscription, and HMO
- accept lesson participants / lesson instances as inputs
- keep logic thin and testable

Constraints:

- do not put this logic in page components
- do not duplicate logic separately for package and HMO in two unrelated modules

Expected file area:

- likely `api/_shared/commitment-behavior.js` or a new adjacent helper if clearer

### Step 2 - Build live lesson-usage loaders from calendar data

Goal:

- derive count inputs from current lesson lifecycle data instead of legacy entry-only assumptions

Requirements:

- load relevant lesson participants by student
- load lesson instance dates/status/service ids
- distinguish future scheduled vs occurred/resolved states
- map lessons to package/service lines and to HMO authorization usage

Must handle:

- service-specific package lines
- HMO authorization matching by student/service/date
- exclusion of irrelevant statuses

### Step 3 - Implement package/subscription count semantics

Goal:

- make package and subscription counts reflect real lesson lifecycle

Requirements:

- `scheduled` future lessons reserve
- `attended` consumes
- billable `no_show` consumes for package/subscription
- non-billable `no_show` does not consume
- clinic cancellation never consumes

### Step 4 - Implement HMO-specific count semantics

Goal:

- make HMO counts follow the approved HMO rule matrix

Requirements:

- scheduled future covered lessons reserve HMO capacity
- attended covered lessons consume HMO entitlement
- no-show never consumes HMO
- billable no-show falls back to student/service pricing only
- post-coverage lessons do not consume HMO entitlement
- standard uncovered lessons do not consume HMO entitlement

Must stay aligned with:

- `resolveLessonCoverageDecision(...)`
- current billing split rules in `BillingLedgerService`

### Step 5 - Expose new count fields in billing/read models

Goal:

- return the new count model from the backend APIs consumed by student pages

Requirements:

- do not break existing consumers silently
- add new fields explicitly
- update derived runtime structures as needed

Expected file areas:

- `api/billing/index.js`
- `api/_shared/student-billing.js`
- shared commitment runtime output

### Step 6 - Update student UI

Goal:

- show the 3-bucket model clearly in student pages

Requirements:

- package/subscription display uses:
  - `נוצלו`
  - `מתוכננים`
  - `זמינים לקביעת תור`
- HMO display uses the same buckets
- no ambiguous single-number-only display where it would mislead staff

UX requirements:

- keep language simple
- show clearly whether a count is for package line, subscription, or HMO authorization
- if needed, add small helper text explaining that scheduled lessons are already holding slots

### Step 7 - Correct edge-case behavior and reversals

Goal:

- make count changes resilient to real corrections

Required scenarios:

- scheduled -> attended
- scheduled -> cancelled_student
- scheduled -> cancelled_clinic
- scheduled -> no_show
- attended -> reversed/corrected
- HMO authorization changed/cancelled
- lesson moved in date across authorization window

### Step 8 - Tests

Goal:

- create regression coverage that prevents this from drifting again

Required automated tests:

- package line counts
- subscription counts
- HMO counts
- HMO no-show non-consumption
- billable package no-show consumption
- reserved count release on cancellation
- reversal restores count

At least one test must verify:

- the same student with both scheduled and attended lessons under one HMO authorization

### Step 9 - Documentation update

Goal:

- keep architecture docs aligned with the new rule set

Update required:

- `agents-docs/80-finance-billing-payroll.md`
- possibly `agents-docs/60-calendar-and-sessions.md` if new cross-domain coupling is introduced

---

## 11. Edge Cases Checklist

The implementation is not complete until every item here has an explicit answer in code and tests.

- Future scheduled lesson reserves one slot and does not double count
- Rescheduled lesson does not create two reservations
- Cancelled future lesson releases reservation
- Attended lesson consumes exactly one slot
- Billable no-show on package/subscription consumes one slot
- Non-billable no-show on package/subscription consumes zero
- HMO no-show consumes zero even if student is billed
- HMO post-coverage consumes zero HMO lessons
- HMO uncovered lesson consumes zero HMO lessons
- HMO authorization overlap still blocks billing, and blocked lessons do not count as consumed
- Reversal/correction restores entitlement correctly
- Claim creation/submission/payment never changes entitlement counts
- Moving a lesson outside authorization date range updates the reserved/consumed HMO buckets correctly

---

## 12. Validation / QA Plan

Manual QA must include:

1. Student with package and future scheduled lesson
2. Student with package and attended lesson
3. Package student marked no-show with billable policy on
4. Package student marked no-show with billable policy off
5. HMO student with:
   - one future scheduled covered lesson
   - one attended covered lesson
   - one no-show billed privately
6. HMO student after authorization exhaustion
7. Status correction from attended back to scheduled/cancelled

Expected operator-facing result:

- staff can explain the count without reading internal docs
- the visible numbers match what the calendar and HMO workflow imply

---

## 13. Step Status Tracker

Update this table during implementation.

| Step | Title | Status | Owner | Last Updated | Notes |
|---|---|---|---|---|---|
| 0 | Baseline audit | pending | AI dev team | - | - |
| 1 | Introduce lesson-count rule helpers | pending | AI dev team | - | - |
| 2 | Build live lesson-usage loaders from calendar data | pending | AI dev team | - | - |
| 3 | Implement package/subscription semantics | pending | AI dev team | - | - |
| 4 | Implement HMO semantics | pending | AI dev team | - | - |
| 5 | Expose new count fields in backend read models | pending | AI dev team | - | - |
| 6 | Update student UI | pending | AI dev team | - | - |
| 7 | Correct edge-case behavior and reversals | pending | AI dev team | - | - |
| 8 | Tests | pending | AI dev team | - | - |
| 9 | Documentation update | pending | AI dev team | - | - |

Status values:

- `pending`
- `in_progress`
- `blocked`
- `completed`
- `amended`

---

## 14. Change Log / Amendments

Every plan correction must be recorded here.

| Date | Step | Type | Summary | Reason | Files proving the change |
|---|---|---|---|---|---|
| 2026-04-27 | initial | created | Initial plan created | Planning baseline | `api/_shared/commitment-behavior.js`, `api/_shared/hmo.js`, `src/features/students/components/StudentBillingWorkspace.jsx` |

Type values:

- `created`
- `clarification`
- `design_correction`
- `scope_change`
- `implementation_discovery`

---

## 15. Non-Goals

These items are out of scope unless explicitly approved later:

- redesigning the entire commitments data model
- changing claim/payment workflow semantics
- introducing a new per-package billing-consumption setting UI
- changing HMO claim submission model
- rewriting student financial balance semantics

---

## 16. Final Acceptance Criteria

This implementation is complete only when:

1. Student package/subscription counts are derived from live lesson lifecycle, not legacy commitment-only usage assumptions
2. HMO counts are split into consumed/reserved/available
3. HMO no-show is non-consuming and billed privately if billable
4. Student pages show the new counts clearly in Hebrew
5. Automated tests cover the rule matrix and reversals
6. Docs are updated
7. The Step Status Tracker and Change Log in this file are updated to match reality

